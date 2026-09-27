// node --test over the bomb (docs/systemdocs/NUKE.md): db/lib/nuke.js,
// nukeText.js, nukeKeypad.js and nukeBriefing.js. Run with `npm test --workspace=db`.
//
// The db/test/phone.test.js posture: the roll, the keypad's layout and custom-id
// round trip, the room button and who is briefed are pure, and tested here.
// The keypad's writes — a strike counted under a row lock, the button arming
// under a lock on GameState — are the database's to answer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { nukeRooms, rollCode, rollNuke, markNukeRoom, NUKE_FUSE_TURNS } = require("../lib/nuke");
const { NUKE_CODE_DIGITS, NUKE_MAX_STRIKES, NUKE_TEXT } = require("../lib/nukeText");
const { NUKE_KEY_PREFIX, NUKE_PRESS_PREFIX, parseKeyId, keypadRows, panelText } = require("../lib/nukeKeypad");
const { briefingFor } = require("../lib/nukeBriefing");
const { roomAffordances, ROOM_NUKE_PREFIX } = require("../lib/placeAffordances");
const { roomStarterRows } = require("../lib/roomStarterRow");

// --- the design document's numbers -------------------------------------------

test("an eight-digit sequence, three strikes, and the old two-turn fuse", () => {
  assert.equal(NUKE_CODE_DIGITS, 8);
  assert.equal(NUKE_MAX_STRIKES, 3);
  assert.equal(NUKE_FUSE_TURNS, 2);
  for (let i = 0; i < 50; i += 1) assert.match(rollCode(), /^[0-9]{8}$/);
});

test("a sequence may start with a zero, and stays a string", () => {
  const code = rollCode(() => 0);
  assert.equal(code, "00000000");
  assert.equal(typeof code, "string");
});

test("the bomb's words use straight quotes", () => {
  for (const line of Object.values(NUKE_TEXT)) {
    const text = typeof line === "function" ? line(2) : line;
    assert.equal(/[‘’“”]/.test(text), false, `straight quotes only: ${text}`);
  }
  assert.equal(NUKE_TEXT.noteBody("Keep"), "The bomb is in the Keep.");
  assert.equal(NUKE_TEXT.noteBody("The Old Cock Inn"), "The bomb is in The Old Cock Inn.");
});

// --- where it may go ---------------------------------------------------------

function fakeDb(rooms, state = {}) {
  return {
    room: { findMany: async () => rooms },
    gameState: {
      update: async ({ data }) => Object.assign(state, data),
    },
    state,
  };
}

const room = (id, locationSlug, attributes = {}) => ({
  id,
  slug: `${locationSlug}-1`,
  name: id,
  location: { slug: locationSlug, name: locationSlug, attributes },
});

test("never the Undercroft, never the Charon", async () => {
  const rooms = [
    room("hall", "fortress-3"),
    room("sauna", "undertown-1"),
    room("cockpit", "fortress-6", { offMap: true }),
    room("bar", "town-7"),
  ];
  const kept = await nukeRooms(fakeDb(rooms));
  assert.deepEqual(
    kept.map((r) => r.id),
    ["hall", "bar"],
  );
});

test("a roll picks a room from the pool and clears the countdown", async () => {
  const db = fakeDb([room("hall", "fortress-3"), room("bar", "town-7")], { nukeArmedTurn: 9 });
  const picks = [1, 3, 1, 4, 1, 5, 9, 2, 6];
  let i = 0;
  const rolled = await rollNuke(db, () => picks[i++]);
  assert.equal(rolled.roomId, "bar");
  assert.equal(rolled.code, "31415926");
  assert.deepEqual(db.state, { nukeRoomId: "bar", nukeCode: "31415926", nukeArmedTurn: null });
});

test("no public room anywhere leaves it unplaced rather than throwing", async () => {
  const db = fakeDb([]);
  const rolled = await rollNuke(db);
  assert.deepEqual(rolled, { roomId: null, code: null });
  assert.equal(db.state.nukeRoomId, null);
});

// --- the button on the wall --------------------------------------------------

test("only the marked room offers the Bomb button, on both faces", () => {
  const [bomb, plain] = markNukeRoom([{ id: "r1", slug: "town-7-2" }, { id: "r2", slug: "town-7-1" }], "r1");
  const ids = (r) => roomAffordances(r, null, { web: true }).map((a) => a.id);
  assert.ok(ids(bomb).includes("nuke"));
  assert.ok(!ids(plain).includes("nuke"));
  const entry = roomAffordances(bomb).find((a) => a.id === "nuke");
  assert.equal(entry.customId, `${ROOM_NUKE_PREFIX}r1`);
  assert.equal(entry.tone, "danger");
  const discord = roomStarterRows(bomb).flatMap((row) => row.components);
  assert.ok(discord.some((b) => b.custom_id === `${ROOM_NUKE_PREFIX}r1` && b.label === NUKE_TEXT.label));
});

test("no bomb placed marks nothing", () => {
  const [r] = markNukeRoom([{ id: "r1" }], null);
  assert.equal(r.nuke, false);
});

// --- the Discord keypad ------------------------------------------------------

const VIEW = { ok: true, armed: false, lockedOut: false, gone: false };

test("the keypad's ids round-trip, and every id on a pad is unique", () => {
  for (const digits of ["", "1", "1234567", "12345678"]) {
    const rows = keypadRows("room-1", VIEW, digits, digits.length === 8);
    const ids = rows.flat().map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, `unique ids at "${digits}"`);
    assert.ok(ids.every((id) => id.length <= 100), "Discord caps a custom id at 100");
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.length <= 5));
  }
  assert.deepEqual(parseKeyId(`${NUKE_KEY_PREFIX}room-1:123`, NUKE_KEY_PREFIX), { roomId: "room-1", digits: "123" });
  assert.deepEqual(parseKeyId(`${NUKE_KEY_PREFIX}room-1:~c`, NUKE_KEY_PREFIX), { roomId: "room-1", digits: "" });
  assert.equal(parseKeyId(`${NUKE_KEY_PREFIX}room-1:123456789`, NUKE_KEY_PREFIX), null);
  assert.equal(parseKeyId(`${NUKE_KEY_PREFIX}room-1:12a`, NUKE_KEY_PREFIX), null);
});

test("the button is dead until the server says the sequence is right, then green", () => {
  const dead = keypadRows("room-1", VIEW, "12345678", false).at(-1)[0];
  assert.equal(dead.disabled, true);
  assert.equal(dead.style, "secondary");
  const lit = keypadRows("room-1", VIEW, "12345678", true).at(-1)[0];
  assert.equal(lit.disabled, false);
  assert.equal(lit.style, "success");
  assert.equal(lit.label, NUKE_TEXT.arm);
  assert.deepEqual(parseKeyId(lit.id, NUKE_PRESS_PREFIX), { roomId: "room-1", digits: "12345678" });
  const armed = keypadRows("room-1", { ...VIEW, armed: true }, "12345678", true).at(-1)[0];
  assert.equal(armed.label, NUKE_TEXT.disarm);
});

test("a locked-out character gets a dead pad", () => {
  const rows = keypadRows("room-1", { ...VIEW, lockedOut: true }, "", false);
  assert.ok(rows.flat().every((b) => b.disabled));
  assert.match(panelText({ ...VIEW, lockedOut: true }), new RegExp(NUKE_TEXT.lockedOut));
});

test("the readout shows eight wells", () => {
  assert.match(panelText(VIEW, "123"), /`1 2 3 · · · · ·`/);
});

// --- who is briefed ----------------------------------------------------------

const who = (roleSlug, tagSlugs = []) => briefingFor({ role: { slug: roleSlug }, tags: tagSlugs.map((slug) => ({ tag: { slug } })) });

test("the leaders and the Tribunal get the note; only the Ordinator gets the code", () => {
  for (const slug of ["baron", "bishop", "inquisitor", "censor", "esculap", "merchant", "exactor"]) {
    assert.deepEqual(who(slug), { note: true, paper: false }, slug);
  }
  assert.deepEqual(who("tribune"), { note: true, paper: false });
  assert.deepEqual(who("tribunal-ordinator"), { note: true, paper: true });
  assert.deepEqual(who("bastard"), { note: false, paper: false });
  assert.deepEqual(who("bum"), { note: false, paper: false });
});

test("a GM's Assign counts by the seat tag, since it leaves the role alone", () => {
  assert.deepEqual(who("bum", ["ordinator-insignia"]), { note: true, paper: true });
  assert.deepEqual(who("bum", ["tribunal-helmet"]), { note: true, paper: false });
});

// --- what it sounds like -----------------------------------------------------

test("every sound the keypad makes is a cue with a measured gain", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { SFX } = require("../lib/sfx");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "web", "app", "components", "sfx.js"), "utf8");
  const table = (name) => new RegExp(`const ${name} = \\{([\\s\\S]*?)\\r?\\n\\};`).exec(src)[1];
  const cues = table("CUES");
  const gains = table("GAIN");
  for (const cue of ["nuke-key", SFX.NUKE_PING, SFX.NUKE_ARM, SFX.NUKE_DISARM, SFX.CONSOLE_REFUSE]) {
    assert.match(cues, new RegExp(`"${cue}":`), `${cue} has no file in CUES`);
    assert.match(gains, new RegExp(`"${cue}":`), `${cue} has no measured GAIN`);
  }
});
