// node --test over the freeze that makes a look answer for the MOMENT you saw
// somebody: db/lib/examineSnapshot.js, and the readout it feeds.
//
// The bug these lock down is the one a player found. Examining somebody read
// their gear live, so a cultist could chat bare-faced in Town, walk two zones
// off, robe up, and every old line of his showed the robes to anyone who
// clicked the eye. Secret gear and secret business, handed over for free.
//
// Prisma-free on purpose, like presentedIdentity.test.js: everything here is
// the pure half, fed rows in the shape the queries return.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  presentedStateFrom,
  readPresentedState,
  rehydrateSubject,
} = require("../lib/examineSnapshot");
const { examineReadout } = require("../lib/examine");

// The catalog rows examineRow fetches live off Tag, in EXAMINE_TAG_SELECT's
// shape plus the id it looks them up by.
const catalogTag = (over) => ({
  id: over.id,
  name: over.name,
  slug: over.slug ?? over.id,
  category: over.category ?? "Items",
  inspectVisibility: over.inspectVisibility ?? "ALWAYS",
  forcedName: over.forcedName ?? null,
  concealsIdentity: over.concealsIdentity ?? false,
  concealSprite: over.concealSprite ?? null,
  forcesConceal: false,
  equipLayer: over.equipLayer ?? null,
  requirementGambit: false,
  requirementTurns: null,
  requirementPerTurn: null,
  requirementResources: null,
  requirementItems: null,
  requirementSkills: [],
  armorMelee: null,
  armorBallistic: null,
});

const SWORD = catalogTag({ id: "t-sword", name: "Sword", slug: "sword" });
const ROBES = catalogTag({
  id: "t-robes",
  name: "Black Robes",
  slug: "black-robes",
  concealsIdentity: true,
  concealSprite: "hood",
  equipLayer: 3,
});
const KIT = catalogTag({ id: "t-kit", name: "Disguise Kit", slug: "disguise-kit", forcedName: "Tomas Vell" });

// A character row in PRESENTED_STATE_SELECT's shape.
const speaker = (tags) => ({
  name: "Semyun Varyutskaya",
  appearance: "Tall, with a burn along one jaw.",
  roleTitle: null,
  resources: 4,
  factionId: null,
  concealed: false,
  tags,
});

const held = (tag, { equipped = false, expiresTurn = null } = {}) => ({
  tagId: tag.id,
  equipped,
  expiresTurn,
  tag: { forcedName: tag.forcedName, name: tag.name, concealsIdentity: tag.concealsIdentity, concealSprite: tag.concealSprite, forcesConceal: false, equipLayer: tag.equipLayer },
});

const live = { id: "c1", name: "Semyun Varyutskaya", age: 30, gender: "WOMAN", updatedAt: new Date(0) };

const roundTrip = (character) => readPresentedState(presentedStateFrom(character));

// The headline case, and the whole reason this module exists.
test("a look answers for the line, not for what they are wearing now", () => {
  // What the room saw: a sword, no robes.
  const state = roundTrip(speaker([held(SWORD, { equipped: true })]));

  // The catalog at LOOK time holds the robes too — the cultist has since put
  // them on, and a live read would have found them.
  const subject = rehydrateSubject({ live, state, tags: [SWORD, ROBES] });

  const readout = examineReadout({ subject, openTurnNumber: 9 });
  const names = readout.tags.map((row) => row.name);
  assert.deepEqual(names, ["Sword"]);
  assert.equal(readout.concealed, false);
  assert.equal(readout.name, "Semyun Varyutskaya");
});

test("the tag list is replaced, never merged with the live one", () => {
  const state = roundTrip(speaker([held(SWORD, { equipped: true })]));
  const subject = rehydrateSubject({
    live: { ...live, tags: [{ equipped: true, expiresTurn: null, tag: ROBES }] },
    state,
    tags: [SWORD, ROBES],
  });
  assert.equal(subject.tags.length, 1);
  assert.equal(subject.tags[0].tag.name, "Sword");
});

test("a tag since deleted from the catalog drops out rather than throwing", () => {
  const state = roundTrip(speaker([held(SWORD, { equipped: true }), held(ROBES, { equipped: true })]));
  const subject = rehydrateSubject({ live, state, tags: [SWORD] });
  assert.deepEqual(subject.tags.map((row) => row.tag.name), ["Sword"]);
});

// The wish and the gear both, which is what presentedIdentity asks for: a
// hood conceals when the player has asked to be concealed and is wearing
// something that does it. Both halves are in the snapshot.
test("a hood frozen on the line still reads as a hood after it comes off", () => {
  const state = roundTrip({ ...speaker([held(ROBES, { equipped: true })]), concealed: true });
  // The catalog still has the robes; the character no longer wears them.
  const subject = rehydrateSubject({ live, state, tags: [ROBES] });
  const readout = examineReadout({ subject, openTurnNumber: 9 });
  assert.equal(readout.concealed, true);
  assert.equal(readout.appearance, null);
});

test("a forced name frozen on the line survives the kit expiring", () => {
  const state = roundTrip(speaker([held(KIT, { expiresTurn: 12 })]));
  const subject = rehydrateSubject({ live, state, tags: [KIT] });
  const readout = examineReadout({ subject, openTurnNumber: 10 });
  // A Beast is being something, not hiding: the ordinary read, under the
  // forced name.
  assert.equal(readout.concealed, false);
  assert.equal(readout.name, "Tomas Vell");
});

test("a duration counts against the turn the line was said in", () => {
  const state = roundTrip(speaker([held(KIT, { expiresTurn: 12 })]));
  const subject = rehydrateSubject({ live, state, tags: [KIT] });
  // Read at the turn it was said: three turns left. Read against today's turn
  // it would have been a countdown that is both false and a tell.
  const row = examineReadout({ subject, openTurnNumber: 10 }).tags.find((t) => t.slug === "disguise-kit");
  assert.match(row.detail ?? "", /3 turns/);
});

test("the name and the appearance come off the snapshot", () => {
  const state = roundTrip(speaker([]));
  const subject = rehydrateSubject({ live: { ...live, name: "Renamed Later" }, state, tags: [] });
  assert.equal(subject.name, "Semyun Varyutskaya");
  assert.equal(subject.appearance, "Tall, with a burn along one jaw.");
});

// A bad row must degrade to the live read, never throw: this is the one look
// path in the game.
test("readPresentedState refuses anything it does not recognise", () => {
  assert.equal(readPresentedState(null), null);
  assert.equal(readPresentedState(undefined), null);
  assert.equal(readPresentedState({}), null);
  assert.equal(readPresentedState({ v: 2, t: [] }), null);
  assert.equal(readPresentedState("{}"), null);
  assert.equal(readPresentedState([]), null);
  assert.equal(readPresentedState({ v: 1 }), null);
});

test("readPresentedState survives junk inside a well-formed payload", () => {
  const state = readPresentedState({ v: 1, n: 7, a: null, r: null, s: "x", f: null, c: 1, t: [null, ["ok", 1, 3], [4, 1, 1], ["bad", 0, "soon"]] });
  assert.equal(state.name, null);
  assert.equal(state.resources, null);
  assert.equal(state.concealed, true);
  assert.deepEqual(state.tags, [
    { tagId: "ok", equipped: true, expiresTurn: 3 },
    { tagId: "bad", equipped: false, expiresTurn: null },
  ]);
});
