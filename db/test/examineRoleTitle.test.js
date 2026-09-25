// Where a look gets somebody's role from (db/lib/examine.js): the LOOKER's
// own memory of them — their Friends entry on /memories — and nowhere else
// (docs/systemdocs/MEMORIES.md §6). A stranger reads no role, whatever the
// seat; a friend reads whatever the looker remembers, true or not. Run with
// `npm test --workspace=db`. Nothing here touches Prisma — examineReadout,
// presentedStateFrom and rehydrateSubject are all pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { examineReadout } = require("../lib/examine");
const { presentedStateFrom, readPresentedState, rehydrateSubject } = require("../lib/examineSnapshot");

// A hood: concealsIdentity + a sprite + a layer, the three concealmentFrom reads.
const HOOD = {
  name: "Sackcloth Hood",
  slug: "hood",
  category: "Items",
  inspectVisibility: "WORN",
  concealsIdentity: true,
  concealSprite: "hood.webp",
  forcesConceal: false,
  equipLayer: 3,
  requirementSkills: [],
};

// What a Disguise Kit mints: a false name over a face nobody is hiding.
const DISGUISE = {
  name: "Disguise",
  slug: "custom-disguise-tomas-vell",
  category: "Items",
  inspectVisibility: "HIDDEN",
  forcedName: "Tomas Vell",
  requirementSkills: [],
};

const held = (tag, equipped = false) => ({ equipped, expiresTurn: null, tag });

// The character as a WRITER loads them (db/lib/examineSnapshot.js#PRESENTED_STATE_SELECT).
const speaker = ({ tags = [], concealed = false } = {}) => ({
  name: "Ivo Brandt",
  appearance: "Heavyset, sunburnt.",
  concealed,
  roleTitle: "Sheriff",
  tags: tags.map((ct) => ({ tagId: ct.tag.slug, equipped: ct.equipped, expiresTurn: null, quantity: 1, tag: ct.tag })),
});

const live = { id: "c1", name: "Ivo Brandt", age: 44, gender: "MAN", updatedAt: new Date(0), roleTitle: "Sheriff" };

// What db/lib/examineRow.js#memoryForLook hands over for a looker who knows him.
const FRIEND = { name: "Ivo Brandt", roleText: "Sheriff", roleGroup: "soil", notes: "Owes me a drink." };

// Say a line, then look at it — the whole path, the way examineRow.js walks it.
function look({ memory = null, ...over } = {}) {
  const character = speaker(over);
  const state = readPresentedState(presentedStateFrom(character));
  const catalog = (over.tags ?? []).map((ct) => ({ id: ct.tag.slug, ...ct.tag }));
  const subject = rehydrateSubject({ live, state, tags: catalog });
  return examineReadout({ subject, openTurnNumber: 9, memory });
}

test("a stranger reads no role, however public the seat", () => {
  const readout = look();
  assert.equal(readout.roleTitle, null);
  assert.equal(readout.roleGroup, null);
  assert.equal(readout.memory, null);
});

test("a friend reads the role they remember, in its estate's colour", () => {
  const readout = look({ memory: FRIEND });
  assert.equal(readout.roleTitle, "Sheriff");
  assert.equal(readout.roleGroup, "soil");
});

test("what the looker wrote is what they read back, true or not", () => {
  const readout = look({ memory: { ...FRIEND, roleText: "Probably a smuggler", roleGroup: null } });
  assert.equal(readout.roleTitle, "Probably a smuggler");
  assert.equal(readout.roleGroup, null);
});

test("a friend with no role remembered reads no role, and no colour", () => {
  const readout = look({ memory: { ...FRIEND, roleText: null } });
  assert.equal(readout.roleTitle, null);
  assert.equal(readout.roleGroup, null);
});

test("the looker's name for them and their notes ride along", () => {
  const readout = look({ memory: { ...FRIEND, name: "Old Ivo" } });
  assert.deepEqual(readout.memory, { name: "Old Ivo", notes: "Owes me a drink." });
  // The heading still says what the room heard.
  assert.equal(readout.name, "Ivo Brandt");
});

test("under a hood: no name, no office, and no memory", () => {
  const readout = look({ tags: [held(HOOD, true)], concealed: true, memory: FRIEND });
  assert.equal(readout.concealed, true);
  assert.equal(readout.roleTitle, undefined);
  assert.equal(readout.memory, undefined);
});

test("under a false name: somebody else, so nothing the looker remembers of the man underneath", () => {
  const readout = look({ tags: [held(DISGUISE)], memory: FRIEND });
  assert.equal(readout.name, "Tomas Vell");
  assert.equal(readout.roleTitle, null);
  assert.equal(readout.memory, null);
});

test("a raw character row leaks nothing — the subject's own title is never read", () => {
  const readout = examineReadout({
    subject: { id: "c2", name: "Ivo Brandt", appearance: "Heavyset.", concealed: false, roleTitle: "Tribune", tags: [] },
    openTurnNumber: 9,
  });
  assert.equal(readout.roleTitle, null);
});
