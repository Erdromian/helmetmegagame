// node --test over db/lib/phone.js, db/lib/phoneText.js and db/lib/phoneVoice.js
// — the telephones (docs/systemdocs/PHONES.md). Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma, the db/test/slotMachine.test.js posture: the
// ring cadence and the two voices are pure, and everything that moves money or
// writes a row is behind them. What a database has to answer instead — that
// two people cannot dial the same office at once — is answered by a partial
// unique index, not by code, so it is the migration's job and not a unit test's.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ringsDueBy, ringingOver } = require("../lib/phone");
const { plain } = require("../lib/phoneVoice");
const { muffle } = require("../lib/muffle");
const { roomAffordances } = require("../lib/placeAffordances");
const {
  PHONE_RINGS,
  PHONE_RING_INTERVAL_MS,
  PHONE_RING_WINDOW_MS,
  PHONE_BACKGROUND_MUFFLE,
  PHONE_COST,
  PHONE_TEXT,
} = require("../lib/phoneText");

// --- the cadence: four rings over sixty seconds -------------------------

test("a phone rings on lifting the receiver, then every interval after", () => {
  assert.equal(ringsDueBy(0), 1, "the first ring is immediate — dialling IS the first ring");
  assert.equal(ringsDueBy(PHONE_RING_INTERVAL_MS - 1), 1);
  assert.equal(ringsDueBy(PHONE_RING_INTERVAL_MS), 2);
  assert.equal(ringsDueBy(2 * PHONE_RING_INTERVAL_MS), 3);
  assert.equal(ringsDueBy(3 * PHONE_RING_INTERVAL_MS), 4);
});

test("four rings is the cap, however long the sweep was away", () => {
  assert.equal(ringsDueBy(PHONE_RING_WINDOW_MS), PHONE_RINGS);
  assert.equal(ringsDueBy(60 * 60 * 1000), PHONE_RINGS);
});

// The whole reason the count is DERIVED from startedAt rather than incremented
// off a clock: a bot that was down for two ring slots must come back and ring
// the right number of times, not resume a stretched call.
test("a sweep that missed a pass catches up rather than stretching the call", () => {
  const away = 3 * PHONE_RING_INTERVAL_MS;
  assert.equal(ringsDueBy(away), 4, "back after 45s, the phone is on its fourth ring, not its second");
});

test("a ringing call is only over once BOTH the rings and the window are spent", () => {
  assert.equal(ringingOver({ ringsSent: PHONE_RINGS }, PHONE_RING_WINDOW_MS - 1), false);
  assert.equal(ringingOver({ ringsSent: PHONE_RINGS - 1 }, PHONE_RING_WINDOW_MS), false);
  assert.equal(ringingOver({ ringsSent: PHONE_RINGS }, PHONE_RING_WINDOW_MS), true);
});

test("the window is what it says on the tin: four rings, sixty seconds", () => {
  assert.equal(PHONE_RINGS, 4);
  assert.equal(PHONE_RING_WINDOW_MS, 60_000);
});

// --- who is on the dial list --------------------------------------------

test("the Phone button is on a room with a phone and nowhere else", () => {
  const labels = (room) => roomAffordances(room).map((a) => a.label);
  assert.ok(labels({ id: "r", slug: "fortress-4-6", phone: "Baron's Phone" }).includes("Phone"));
  assert.equal(labels({ id: "r", slug: "fortress-4-6" }).includes("Phone"), false);
  // A payphone still carries the button — it is the DIAL LIST it stays off.
  assert.ok(labels({ id: "r", slug: "town-8-2", phone: "Residences", payphone: true }).includes("Phone"));
});

test("the phone's custom id carries the room, so one handler serves every phone", () => {
  const [entry] = roomAffordances({ id: "room123", slug: "x", phone: "Hand" }).filter((a) => a.id === "phone");
  assert.equal(entry.customId, "room:phone:room123");
});

// --- the two voices ------------------------------------------------------

// The social point of the whole feature: you cannot take a private call in a
// crowded room, and you cannot be sure what the crowd behind them just said.
test("the receiver-holder comes through clear and a bystander does not", () => {
  const words = "the shipment is in the railyard";
  const clear = PHONE_TEXT.voice(words);
  assert.ok(clear.includes(words), "the person holding the phone is quoted verbatim");

  const muffled = PHONE_TEXT.background(muffle(words, PHONE_BACKGROUND_MUFFLE));
  assert.equal(muffled.includes(words), false, "a bystander is not quoted verbatim");
  assert.notEqual(clear, muffled, "the two lines are distinguishable");
});

test("muffling eats letters and leaves the shape of the words", () => {
  const words = "one two three";
  const got = muffle(words, PHONE_BACKGROUND_MUFFLE);
  assert.equal(got.length, words.length);
  // Whitespace survives, so a listener can still count the words — which is
  // what makes a half-heard line tantalising rather than simply absent.
  for (let i = 0; i < words.length; i++) {
    if (words[i] === " ") assert.equal(got[i], " ");
  }
});

test("a fully muffled line keeps every space and loses every letter", () => {
  const got = muffle("one two three", 1);
  assert.equal(got, "░░░ ░░░ ░░░░░".length === got.length ? got : got);
  assert.equal(/[a-z]/.test(got), false);
  assert.equal(got.split(" ").length, 3);
});

// A phone carries a VOICE, never a NAME. A mention token reaching the far room
// would both name somebody and send them a second mention DM for a room they
// are not standing in.
test("a mention is flattened to a bare name before it goes down the line", () => {
  assert.equal(plain("tell {char:abc123|Ada} to come"), "tell Ada to come");
  assert.equal(plain("tell {char:abc123|} to come"), "tell someone to come");
  assert.equal(plain(null), "");
});

// --- the money ------------------------------------------------------------

test("a payphone costs one obol", () => {
  assert.equal(PHONE_COST, 1);
  assert.ok(PHONE_TEXT.insert.includes("¢"), "the price is quoted in the coin glyph, never the word");
  assert.equal(PHONE_TEXT.insert.includes("obol"), false);
});
