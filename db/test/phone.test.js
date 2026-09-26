// node --test over the telephone (docs/systemdocs/PHONES.md): db/lib/phone.js,
// phoneText.js, phoneVoice.js, phoneNumbers.js, phoneFrame.js and
// phoneKeypad.js. Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma, the db/test/slotMachine.test.js posture: the
// ring cadence, the holders' clocks, who hears which voice, the numbers and
// the keypad are pure, and everything that moves money or writes a row is
// behind them. What a database has to answer instead — that two people cannot
// ring the same office at once, or hold one receiver — is answered by unique
// indexes and a row lock, so it is the migration's job and not a unit test's.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ringsDueBy, ringingOver, holderVerdict, takesCalls, PHONE_RING_CAP_MS } = require("../lib/phone");
const { plain, routeLine } = require("../lib/phoneVoice");
const { muffle } = require("../lib/muffle");
const { roomAffordances } = require("../lib/placeAffordances");
const { pickPhoneNumber, phonebookText, PHONE_NUMBER_MIN, PHONE_NUMBER_MAX } = require("../lib/phoneNumbers");
const { handsetState, handsetTimers } = require("../lib/phoneFrame");
const {
  PHONE_KEY_PREFIX,
  PHONE_CALL_PREFIX,
  PHONE_HANGUP_PREFIX,
  parseKeyId,
  keypadRows,
  panelText,
} = require("../lib/phoneKeypad");
const {
  PHONE_RING_INTERVAL_MS,
  PHONE_BACKGROUND_MUFFLE,
  PHONE_COST,
  PHONE_PAID_MS,
  PHONE_OBOL_PROMPT_MS,
  PHONE_HOLD_IDLE_MS,
  PHONE_TEXT,
  normalizeDigits,
  clockLeft,
} = require("../lib/phoneText");

const NOW = Date.parse("2026-11-01T12:00:00Z");
const at = (ms) => new Date(NOW + ms);

// --- the design document's own lines --------------------------------------

test("the exchange says Bascinet's sentences, in house typography", () => {
  assert.equal(PHONE_TEXT.ownNumber(3365), "This phone's number is 3365.");
  assert.equal(PHONE_TEXT.ringing, "The phone rings urgently.");
  assert.equal(PHONE_TEXT.notInService, "The number you are trying to call is no longer in service.");
  assert.equal(PHONE_TEXT.busy, "The number you are trying to call is currently busy.");
  assert.equal(PHONE_TEXT.hungUp, "The call hung up.");
  for (const line of Object.values(PHONE_TEXT)) {
    if (typeof line === "string") assert.equal(/[‘’“”]/.test(line), false, `straight quotes only: ${line}`);
  }
});

// --- numbers ----------------------------------------------------------------

test("a phone number is four digits and never one already taken", () => {
  const taken = new Set([1000, 1001, 1002]);
  let calls = 0;
  const scripted = [1000, 1001, 1002, 4242];
  const n = pickPhoneNumber(taken, () => scripted[calls++]);
  assert.equal(n, 4242, "the picker rolls again past every taken number");
  for (let i = 0; i < 200; i += 1) {
    const got = pickPhoneNumber(new Set());
    assert.ok(got >= PHONE_NUMBER_MIN && got <= PHONE_NUMBER_MAX);
    assert.equal(String(got).length, 4, "no leading zero, so every number reads as four digits");
  }
});

test("the keypad only ever dials exactly four digits", () => {
  assert.equal(normalizeDigits("3365"), "3365");
  assert.equal(normalizeDigits(" 33 65 "), "3365");
  for (const bad of ["336", "33655", "33a5", "", null, undefined, "-336"]) assert.equal(normalizeDigits(bad), null);
});

test("the Phonebook lists every numbered phone, named ones first, payphones apart", () => {
  const text = phonebookText([
    { phone: "Sanctuary", payphone: false, phoneNumber: 3365 },
    { phone: "Inn", payphone: true, phoneNumber: 2179 },
    { phone: "Baron's Phone", payphone: false, phoneNumber: 7252 },
    { phone: "Den", payphone: true, phoneNumber: 1188 },
    { phone: "Hand", payphone: false, phoneNumber: null },
  ]);
  const lines = text.split("\n");
  assert.ok(lines.indexOf("Baron's Phone — 7252") < lines.indexOf("Sanctuary — 3365"), "alphabetical");
  assert.ok(lines.indexOf("Sanctuary — 3365") < lines.indexOf("**Payphones**"), "payphones come after");
  assert.ok(lines.indexOf("Den — 1188") > lines.indexOf("**Payphones**"));
  assert.equal(text.includes("Hand"), false, "a phone with no number yet is left out, not printed blank");
});

// --- the ring ----------------------------------------------------------------

test("a phone rings on dialling, then every interval, with no count cap", () => {
  assert.equal(ringsDueBy(0), 1, "the first ring is immediate — dialling IS the first ring");
  assert.equal(ringsDueBy(PHONE_RING_INTERVAL_MS - 1), 1);
  assert.equal(ringsDueBy(PHONE_RING_INTERVAL_MS), 2);
  assert.equal(ringsDueBy(10 * PHONE_RING_INTERVAL_MS), 11, "it rings until somebody answers");
});

// The count is DERIVED from startedAt rather than incremented off a clock: a bot
// that was down for two ring slots comes back on the right ring.
test("a sweep that missed a pass catches up rather than stretching the call", () => {
  assert.equal(ringsDueBy(3 * PHONE_RING_INTERVAL_MS), 4);
});

test("a ring stops where a caller standing there would have been dropped", () => {
  assert.equal(PHONE_RING_CAP_MS, PHONE_HOLD_IDLE_MS);
  assert.equal(ringingOver(PHONE_RING_CAP_MS - 1), false);
  assert.equal(ringingOver(PHONE_RING_CAP_MS), true);
});

// --- busy ----------------------------------------------------------------------

test("a dead line or a phone off the wall does not take a call; a phone in a hand does", () => {
  const phone = { phone: "Sanctuary", retiredAt: null, phoneHolderId: null, phoneDeadSince: null };
  assert.equal(takesCalls(phone), true);
  // Busy means a call on the line. Somebody holding the phone at a dial tone
  // is not on one: it rings in their hand.
  assert.equal(takesCalls({ ...phone, phoneHolderId: "c1" }), true);
  assert.equal(takesCalls({ ...phone, phoneDeadSince: at(0) }), false);
  assert.equal(takesCalls({ ...phone, retiredAt: at(0) }), false);
  assert.equal(takesCalls({ ...phone, phone: null }), false);
});

// --- the handset ---------------------------------------------------------------

test("what a handset is doing comes off the live call and the room", () => {
  const room = { id: "a" };
  assert.equal(handsetState(room, null), "idle");
  assert.equal(handsetState(room, { status: "RINGING", fromRoomId: "a" }), "calling");
  assert.equal(handsetState(room, { status: "RINGING", fromRoomId: "b" }), "ringing");
  assert.equal(handsetState(room, { status: "CONNECTED", fromRoomId: "b" }), "connected");
  assert.equal(handsetState({ id: "a", phoneDeadSince: at(0) }, null), "dead");
});

test("a payphone wants a coin with no time paid, and again in its last minute", () => {
  const pay = { payphone: true, phonePaidUntil: null };
  assert.equal(handsetTimers(pay, "idle", NOW).needsCoin, true);
  assert.equal(handsetTimers({ ...pay, phonePaidUntil: at(PHONE_PAID_MS) }, "idle", NOW).needsCoin, false);
  assert.equal(handsetTimers({ ...pay, phonePaidUntil: at(PHONE_OBOL_PROMPT_MS) }, "idle", NOW).needsCoin, true);
  assert.equal(handsetTimers({ payphone: false }, "idle", NOW).needsCoin, false, "a named phone never takes a coin");
});

test("a named phone's patience runs only while no call is connected", () => {
  const room = { payphone: false, phoneIdleSince: at(0) };
  assert.equal(handsetTimers(room, "idle", NOW).idleEjectAt, NOW + PHONE_HOLD_IDLE_MS);
  assert.equal(handsetTimers(room, "connected", NOW).idleEjectAt, null);
});

test("the sweep ejects, prompts and lets go on the design document's clocks", () => {
  const here = { status: "ALIVE", locationId: "L" };
  const named = { payphone: false, locationId: "L", phoneIdleSince: at(-PHONE_HOLD_IDLE_MS), phoneObolPrompted: false };
  assert.equal(holderVerdict(named, here, "idle", NOW), "idle", "ten minutes with nobody on the line");
  assert.equal(holderVerdict(named, here, "connected", NOW), null, "not while a call is connected");
  assert.equal(holderVerdict(named, { status: "DEAD", locationId: "L" }, "idle", NOW), "left");
  assert.equal(holderVerdict(named, { status: "ALIVE", locationId: "M" }, "connected", NOW), "left");

  const pay = { payphone: true, locationId: "L", phoneIdleSince: null, phoneObolPrompted: false };
  assert.equal(holderVerdict({ ...pay, phonePaidUntil: at(-1) }, here, "connected", NOW), "unpaid", "out of time: the call hangs up");
  assert.equal(holderVerdict({ ...pay, phonePaidUntil: at(30_000) }, here, "connected", NOW), "prompt");
  assert.equal(holderVerdict({ ...pay, phonePaidUntil: at(30_000), phoneObolPrompted: true }, here, "connected", NOW), null, "asked once");
  assert.equal(holderVerdict({ ...pay, phonePaidUntil: at(5 * 60_000) }, here, "connected", NOW), null);
});

test("the payphone's clock reads as minutes and seconds", () => {
  assert.equal(clockLeft(9 * 60_000 + 5_000), "9:05");
  assert.equal(clockLeft(0), "0:00");
  assert.equal(clockLeft(-5000), "0:00");
});

// --- the Phone button ------------------------------------------------------------

test("the Phone button is on a room with a phone and nowhere else", () => {
  const labels = (room) => roomAffordances(room).map((a) => a.label);
  assert.ok(labels({ id: "r", slug: "fortress-4-6", phone: "Baron's Phone" }).includes("Phone"));
  assert.equal(labels({ id: "r", slug: "fortress-4-6" }).includes("Phone"), false);
  assert.ok(labels({ id: "r", slug: "town-8-2", phone: "Residences", payphone: true }).includes("Phone"));
});

test("the phone's custom id carries the room, so one handler serves every phone", () => {
  const [entry] = roomAffordances({ id: "room123", slug: "x", phone: "Hand" }).filter((a) => a.id === "phone");
  assert.equal(entry.customId, "room:phone:room123");
});

// --- the Discord keypad ----------------------------------------------------------

test("a key press carries the digits so far, and parses back", () => {
  const rows = keypadRows("room123", { state: "idle" }, "33");
  const five = rows[1].find((b) => b.label === "5");
  assert.equal(five.id, `${PHONE_KEY_PREFIX}room123:335`);
  assert.deepEqual(parseKeyId(five.id, PHONE_KEY_PREFIX), { roomId: "room123", digits: "335" });
  const back = rows[3][0];
  assert.deepEqual(parseKeyId(back.id, PHONE_KEY_PREFIX), { roomId: "room123", digits: "3" });
  assert.equal(parseKeyId(`${PHONE_KEY_PREFIX}room123:12a`, PHONE_KEY_PREFIX), null, "a forged id is refused");
  assert.equal(parseKeyId(`${PHONE_KEY_PREFIX}room123:12345`, PHONE_KEY_PREFIX), null);
});

test("every button on a keypad has its own custom id, full or empty", () => {
  for (const digits of ["", "3", "336", "3365"]) {
    const ids = keypadRows("room123", { state: "idle" }, digits).flat().map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, `unique ids at "${digits}"`);
    assert.ok(ids.every((id) => id.length <= 100), "Discord caps a custom id at 100");
  }
});

test("Dial waits for four digits, and the keys lock while a call is on", () => {
  const dial = (digits, state = "idle") => keypadRows("r", { state }, digits)[3][2];
  assert.equal(dial("336").disabled, true);
  assert.equal(dial("3365").disabled, false);
  assert.equal(dial("3365").id, `${PHONE_CALL_PREFIX}r:3365`);
  const connected = keypadRows("r", { state: "connected" }, "");
  assert.ok(connected.slice(0, 4).flat().every((b) => b.disabled), "no dialling mid-call");
  const hangUp = connected[4].find((b) => b.id.startsWith(PHONE_HANGUP_PREFIX));
  assert.equal(hangUp.disabled, false);
});

test("a phone ringing in your hand offers Answer, and Hang up turns the caller away", () => {
  const [controls] = keypadRows("r", { state: "ringing" }, "").slice(4);
  assert.equal(controls[0].label, PHONE_TEXT.answer);
  assert.equal(controls[0].id, "room:phone:answer:r");
  assert.equal(controls.find((b) => b.label === PHONE_TEXT.hangUp).disabled, false);
  const [pay] = keypadRows("r", { state: "ringing", payphone: true, needsCoin: true }, "").slice(4);
  assert.ok(pay[0].label.includes(`${PHONE_COST} ¢`), "a payphone says its price on the button");
  assert.equal(keypadRows("r", { state: "idle" }, "")[4].some((b) => b.label === PHONE_TEXT.answer), false);
});

test("the keypad says the phone's own number and a payphone's price", () => {
  const text = panelText({ number: 3365, state: "idle", payphone: true, paidUntil: null }, "33");
  assert.ok(text.includes("This phone's number is 3365."));
  assert.ok(text.includes(`${PHONE_COST} ¢`));
  assert.ok(text.includes("`3 3 · ·`"));
});

// --- the two voices ----------------------------------------------------------------

test("the holder's words reach the far holder clear and the far room half-garbled", () => {
  const route = routeLine({ speakerHolds: true, farHolderId: "h", words: "come now", garbled: "c░me n▒w" });
  assert.deepEqual(route.holder, { text: PHONE_TEXT.voice("come now"), only: "h" });
  assert.deepEqual(route.room, { text: PHONE_TEXT.voice("c░me n▒w"), except: "h" });
});

test("a bystander reaches the far holder alone, half-garbled, and nobody else", () => {
  const route = routeLine({ speakerHolds: false, farHolderId: "h", words: "come now", garbled: "c░me n▒w" });
  assert.deepEqual(route.holder, { text: PHONE_TEXT.background("c░me n▒w"), only: "h" });
  assert.equal(route.room, null);
});

test("with nobody holding the far phone, the room hears the holder half-garbled and nothing else", () => {
  const held = routeLine({ speakerHolds: true, farHolderId: null, words: "come now", garbled: "c░me n▒w" });
  assert.equal(held.holder, null);
  assert.deepEqual(held.room, { text: PHONE_TEXT.voice("c░me n▒w"), except: null });
  const stray = routeLine({ speakerHolds: false, farHolderId: null, words: "come now", garbled: "c░me n▒w" });
  assert.deepEqual(stray, { holder: null, room: null });
});

test("muffling eats letters and leaves the shape of the words", () => {
  const words = "one two three";
  const got = muffle(words, PHONE_BACKGROUND_MUFFLE);
  assert.equal(got.length, words.length);
  for (let i = 0; i < words.length; i++) {
    if (words[i] === " ") assert.equal(got[i], " ");
  }
});

// A phone carries a VOICE, never a NAME. A mention token reaching the far room
// would both name somebody and send them a second mention DM for a room they
// are not standing in.
test("a mention is flattened to a bare name before it goes down the line", () => {
  assert.equal(plain("tell {char:abc123|Ada} to come"), "tell Ada to come");
  assert.equal(plain("tell {char:abc123|} to come"), "tell someone to come");
  assert.equal(plain(null), "");
});

// --- the money ------------------------------------------------------------------

test("a payphone costs one obol for ten minutes", () => {
  assert.equal(PHONE_COST, 1);
  assert.equal(PHONE_PAID_MS, 10 * 60_000);
  assert.ok(PHONE_TEXT.insert.includes("¢"), "the price is quoted in the coin glyph, never the word");
  assert.equal(PHONE_TEXT.insert.includes("obol"), false);
});

// --- who reads which row --------------------------------------------------------

test("a row for the holder reaches the holder alone, and the room's row everybody else", async () => {
  const { feedRowShape } = require("../lib/archive");
  const { createLens, readsRow } = require("../lib/strangers");
  const base = { seq: 1n, placeKey: "room:b", content: "x", source: "SYSTEM", sentAt: new Date(NOW) };
  const mine = feedRowShape({ ...base, seq: 1n, onlyCharacterId: "h" });
  const room = feedRowShape({ ...base, seq: 2n, exceptCharacterId: "h" });
  const plainRow = feedRowShape({ ...base, seq: 3n });

  for (const row of [mine, room, plainRow]) {
    assert.equal(JSON.stringify(row).includes('"h"'), false, "the holder's id never goes on the wire");
  }
  assert.equal(readsRow(mine, { characterId: "h" }), true);
  assert.equal(readsRow(mine, { characterId: "z" }), false);
  assert.equal(readsRow(room, { characterId: "h" }), false);
  assert.equal(readsRow(room, { characterId: "z" }), true);
  assert.equal(readsRow(mine, { gm: true }), true, "a GM reads both");

  // No speaker on a SYSTEM row, so the lens never asks the database anything.
  const seqs = async (characterId) =>
    (await createLens(null, { characterId }).all([mine, room, plainRow])).map((r) => r.seq);
  assert.deepEqual(await seqs("h"), ["1", "3"]);
  assert.deepEqual(await seqs("z"), ["2", "3"]);
  assert.equal(createLens(null, { characterId: "z" }).apply(mine), null, "the live stream drops it too");
});
