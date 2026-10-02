// node --test over the `visible: face` rule: a thing on somebody's face
// (Disfigured, a missing eye, Pretty) is read off them only while the face
// shows. A hood or mask covers it; a Disguise Kit's false name does not. Run
// with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  seenByBystander,
  medicallyVisibleTags,
  hideableFromSearch,
  onShowWhateverCarried,
} = require("../lib/medicalVision");
const { examineReadout } = require("../lib/examine");
const { onShowTags } = require("../lib/search");

// The twelve the catalog marks `visible: face`, and the migration moves.
const FACE_SLUGS = [
  "black-sclera",
  "disfigured",
  "ugly",
  "missing-eye",
  "glass-eye-worn",
  "broken-jaw",
  "wired-jaw",
  "lockjaw",
  "phrygian-toxin",
  "pretty",
  "beautiful",
  "otherworldly-beauty",
];

// A Health face tag with a cure a Basic medic can do as routine.
const DISFIGURED = {
  id: "t-disfigured",
  name: "Disfigured",
  slug: "disfigured",
  category: "Health",
  inspectVisibility: "FACE",
  requirementGambit: false,
  requirementSkills: [{ id: "skill-medical" }],
};

const PRETTY = {
  id: "t-pretty",
  name: "Pretty",
  slug: "pretty",
  category: "General",
  inspectVisibility: "FACE",
  tradeable: false,
  requirementSkills: [],
};

// Stays ALWAYS: a festering wound is not on the face.
const INFECTED = {
  id: "t-infected",
  name: "Infected",
  slug: "infected",
  category: "Health",
  inspectVisibility: "ALWAYS",
  tradeable: false,
  requirementSkills: [],
};

const WANTED = {
  name: "Wanted",
  slug: "wanted",
  category: "General",
  inspectVisibility: "NAMED",
  requirementSkills: [],
};

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

const DISGUISE = {
  name: "Disguise",
  slug: "custom-disguise-kellen-ward",
  category: "Items",
  inspectVisibility: "HIDDEN",
  forcedName: "Kellen Ward",
  requirementSkills: [],
};

function subject(tags, { concealed = false } = {}) {
  return { id: "c1", name: "Mira Holt", appearance: "Short.", concealed, age: 30, gender: "WOMAN", tags };
}

const held = (tag, equipped = false) => ({ tagId: tag.id, equipped, expiresTurn: null, quantity: 1, tag });

const shownNames = (out) => [...out.tags.map((t) => t.name), ...out.ailments, ...out.equipment];

test("the gate itself: FACE follows the face, and the face follows the name unless told apart", () => {
  assert.equal(seenByBystander(PRETTY, held(PRETTY)), true);
  assert.equal(seenByBystander(PRETTY, held(PRETTY), true), true);
  // Every caller that says "hooded" by passing false hides the face with it.
  assert.equal(seenByBystander(PRETTY, held(PRETTY), false), false);
  // A false name over a bare face: the name is hidden, the face is not.
  assert.equal(seenByBystander(PRETTY, held(PRETTY), false, true), true);
  assert.equal(seenByBystander(WANTED, held(WANTED), false, true), false);
  assert.equal(seenByBystander(PRETTY, held(PRETTY), true, false), false);
});

test("bare-faced: the face tag is read off them", () => {
  const out = examineReadout({ subject: subject([held(PRETTY), held(INFECTED)]) });
  assert.equal(out.concealed, false);
  assert.deepEqual(out.tags.map((t) => t.slug).sort(), ["infected", "pretty"]);
});

test("under a hood: the face tags go, a wound elsewhere stays", () => {
  const out = examineReadout({
    subject: subject([held(PRETTY), held(DISFIGURED), held(INFECTED), held(HOOD, true)], { concealed: true }),
  });
  assert.equal(out.concealed, true);
  const names = shownNames(out);
  assert.equal(names.includes("Pretty"), false);
  assert.equal(names.includes("Disfigured"), false);
  assert.equal(out.ailments.includes("Infected"), true);
  assert.equal(out.equipment.includes("Sackcloth Hood"), true);
});

test("under a Disguise Kit: the face is bare, so the face tag stays while Wanted goes", () => {
  const out = examineReadout({ subject: subject([held(PRETTY), held(WANTED), held(DISGUISE)]) });
  assert.equal(out.concealed, false);
  assert.equal(out.name, "Kellen Ward");
  const slugs = out.tags.map((t) => t.slug);
  assert.equal(slugs.includes("pretty"), true);
  assert.equal(slugs.includes("wanted"), false);
});

test("a photograph of a hooded face does not show what was under the hood", () => {
  const out = examineReadout({ subject: subject([held(PRETTY), held(DISFIGURED)]), wasConcealedAs: "an unknown young woman" });
  assert.equal(out.concealed, true);
  const names = shownNames(out);
  assert.equal(names.includes("Pretty"), false);
  assert.equal(names.includes("Disfigured"), false);
});

test("a medic's eye still finds a face wound they could treat under a mask", () => {
  const hooded = [held(DISFIGURED), held(PRETTY)];
  assert.deepEqual(medicallyVisibleTags(hooded, new Set(), false), []);
  const trained = medicallyVisibleTags(hooded, new Set(["skill-medical"]), false);
  assert.deepEqual(
    trained.map((r) => [r.characterTag.tag.slug, r.viaSkill]),
    [["disfigured", true]],
  );
});

test("a face cannot be palmed before a search, and a hooded face is not on show", () => {
  assert.equal(hideableFromSearch({ inspectVisibility: "FACE" }), false);
  assert.equal(onShowWhateverCarried({ inspectVisibility: "FACE" }, true), true);
  assert.equal(onShowWhateverCarried({ inspectVisibility: "FACE" }, false), false);
  assert.equal(onShowWhateverCarried({ inspectVisibility: "NAMED" }, true), false);
  assert.deepEqual(
    onShowTags([held(PRETTY), held(INFECTED)], true).map((r) => r.name),
    ["Pretty", "Infected"],
  );
  assert.deepEqual(
    onShowTags([held(PRETTY), held(INFECTED)], false).map((r) => r.name),
    ["Infected"],
  );
});

test("the catalog marks exactly the face tags `visible: face`, none of them gear", () => {
  const catalog = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/tags.yaml"), "utf8")).tags;
  const face = Object.entries(catalog)
    .filter(([, t]) => t?.visible === "face")
    .map(([slug]) => slug);
  assert.deepEqual(face.sort(), [...FACE_SLUGS].sort());
  for (const slug of FACE_SLUGS) assert.equal(Boolean(catalog[slug].equippable), false, slug);
});

test("the migration moves the same slugs the catalog names", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../prisma/migrations/20261212000100_face_tags_hidden_under_hood/migration.sql"),
    "utf8",
  );
  // Lower-case quoted words only: the slugs, not 'FACE' or 'ALWAYS'.
  const slugs = [...sql.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(slugs.sort(), [...FACE_SLUGS].sort());
});
