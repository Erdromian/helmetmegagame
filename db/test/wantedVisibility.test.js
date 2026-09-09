// node --test over the `visible: named` rule: a Wanted man is read as wanted
// only while he is going under his own name. Run with
// `npm test --workspace=db`. Nothing here touches Prisma — examineReadout and
// seenByBystander are both pure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { seenByBystander } = require("../lib/medicalVision");
const { examineReadout } = require("../lib/examine");
const { matchesTypedName } = require("../lib/characterName");

const WANTED = {
  name: "Wanted",
  slug: "wanted",
  category: "General",
  inspectVisibility: "NAMED",
  requirementSkills: [],
};

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

// What a Disguise Kit mints: an ordinary hidden tag carrying a forcedName.
const DISGUISE = {
  name: "Disguise",
  slug: "custom-disguise-kellen-ward",
  category: "Items",
  inspectVisibility: "HIDDEN",
  forcedName: "Kellen Ward",
  requirementSkills: [],
};

// `concealed` is the player's WISH; it only takes effect while a concealing
// piece is equipped (db/lib/presentedIdentity.js). Both are needed, so the
// hooded case below passes it.
function subject(tags, { concealed = false } = {}) {
  return {
    id: "c1",
    name: "Sir Jorren \"the Blind\" Vask",
    appearance: "Tall.",
    concealed,
    age: 40,
    gender: "MAN",
    roleTitle: "Brigand",
    resources: 0,
    factionId: null,
    faction: null,
    tags,
  };
}

const held = (tag, equipped = false) => ({ equipped, expiresTurn: null, tag });

test("the gate itself: NAMED follows the name, ALWAYS and WORN do not", () => {
  assert.equal(seenByBystander(WANTED, held(WANTED), true), true);
  assert.equal(seenByBystander(WANTED, held(WANTED), false), false);
  // Nobody passing the third argument keeps the old behaviour exactly.
  assert.equal(seenByBystander(WANTED, held(WANTED)), true);
  assert.equal(seenByBystander({ inspectVisibility: "ALWAYS" }, {}, false), true);
  assert.equal(seenByBystander({ inspectVisibility: "WORN" }, { equipped: true }, false), true);
  assert.equal(seenByBystander({ inspectVisibility: "HIDDEN" }, {}, true), false);
});

test("bare-faced: Wanted is read off the man", () => {
  const out = examineReadout({ subject: subject([held(WANTED)]) });
  assert.equal(out.concealed, false);
  assert.deepEqual(out.tags.map((t) => t.slug), ["wanted"]);
});

test("under a hood: no name, and no warrant either", () => {
  const out = examineReadout({
    subject: subject([held(WANTED), held(HOOD, true)], { concealed: true }),
  });
  assert.equal(out.concealed, true);
  // The concealed read files non-Health rows under `equipment`, not `tags` —
  // which is where this used to leak.
  assert.equal(out.equipment.includes("Wanted"), false);
  assert.equal(out.ailments.includes("Wanted"), false);
  assert.deepEqual(out.tags, []);
  // The hood itself still shows. Hiding the man is not hiding his gear.
  assert.equal(out.equipment.includes("Sackcloth Hood"), true);
});

test("under a Disguise Kit's false name: read as somebody else, and not as wanted", () => {
  const out = examineReadout({ subject: subject([held(WANTED), held(DISGUISE)]) });
  assert.equal(out.concealed, false);
  assert.equal(out.name, "Kellen Ward");
  assert.equal(
    out.tags.some((t) => t.slug === "wanted"),
    false,
  );
});

test("a photograph of a hooded man does not name him later", () => {
  const out = examineReadout({
    subject: subject([held(WANTED)]),
    wasConcealedAs: "an unknown young man",
  });
  assert.equal(out.concealed, true);
  assert.equal(out.equipment.includes("Wanted"), false);
});

test("the warrant matches a whole name, either way it is written", () => {
  const jorren = { name: "Sir Jorren \"the Blind\" Vask", firstName: "Jorren", lastName: "Vask" };
  assert.equal(matchesTypedName(jorren, "jorren vask"), true);
  assert.equal(matchesTypedName(jorren, '  Sir  Jorren  "the Blind"  Vask '), true);
  // A first name alone is no longer enough, which is the point.
  assert.equal(matchesTypedName(jorren, "Jorren"), false);
  assert.equal(matchesTypedName(jorren, ""), false);
  // The other Jorren is a different man.
  const other = { name: "Jorren Aldwych", firstName: "Jorren", lastName: "Aldwych" };
  assert.equal(matchesTypedName(other, "jorren vask"), false);
});
