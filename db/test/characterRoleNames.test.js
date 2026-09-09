// The personal role's title, and what it must not give away.
//
// WHAT A FAILURE HERE MEANS. A character's mention role is a name token
// (PROXYING.md §6), and it follows a held Tag.forcedName so a disguised
// character's @-token reads as the name they are going by rather than the one
// in the prose beside it. Two ways for that to fail quietly: the colour not
// following the name (a deterministic swatch is a fingerprint that survives
// every disguise its owner ever wears), and the reconcile PATCHing roles that
// already agree (role edits are a slow per-guild bucket).
const test = require("node:test");
const assert = require("node:assert/strict");

const { characterRoleAppearance, CATATONIC_ROLE_COLOR } = require("../lib/characterRoleAppearance");
const { reconcileCharacterRoleNames, MAX_RENAMES_PER_PASS } = require("../lib/characterRoleNames");
const { hashNameToColor } = require("../lib/roleColor");
const { CATATONIC_SLUG } = require("../lib/constants");

test("a forced name takes the title AND the colour", () => {
  const real = characterRoleAppearance("Sir Alder");
  const fake = characterRoleAppearance("Sir Alder", { forcedName: "John" });

  assert.equal(fake.name, "John");
  // The load-bearing half. Colouring by the real name while titling by the
  // false one leaves a stable swatch beside every disguise the same character
  // ever wears — worse than not renaming at all.
  assert.equal(fake.color, hashNameToColor("John"));
  assert.notEqual(fake.color, real.color);
});

test("the Catatonic suffix survives a disguise, and vice versa", () => {
  const both = characterRoleAppearance("Sir Alder", { forcedName: "John", catatonic: true });
  assert.equal(both.name, "John • Catatonic");
  assert.equal(both.color, CATATONIC_ROLE_COLOR);
  // And a blank or whitespace forcedName is not a name; the bare one stands.
  assert.equal(characterRoleAppearance("Sir Alder", { forcedName: "  " }).name, "Sir Alder");
  assert.equal(characterRoleAppearance("Sir Alder", { forcedName: null }).name, "Sir Alder");
});

function fakePrisma(characters) {
  return { character: { findMany: async () => characters } };
}
const person = (id, roleId, firstName, tags = []) => ({
  id,
  discordRoleId: roleId,
  firstName,
  lastName: null,
  tags,
});
const disguisedAs = (name) => [{ tag: { slug: `custom-disguise-${name}`, forcedName: name } }];
const catatonic = [{ tag: { slug: CATATONIC_SLUG, forcedName: null } }];

test("only roles that disagree are patched", async () => {
  const prisma = fakePrisma([
    person("a", "r1", "Ada"), // agrees
    person("b", "r2", "Bran", disguisedAs("John")), // disguised, role still says Bran
  ]);
  const roles = [
    { id: "r1", name: "Ada", color: hashNameToColor("Ada") },
    { id: "r2", name: "Bran", color: hashNameToColor("Bran") },
  ];
  const updates = await reconcileCharacterRoleNames(prisma, roles);
  assert.deepEqual(updates, [{ roleId: "r2", name: "John", color: hashNameToColor("John") }]);
});

test("the disguise coming off puts the real name back", async () => {
  const prisma = fakePrisma([person("b", "r2", "Bran")]);
  const roles = [{ id: "r2", name: "John", color: hashNameToColor("John") }];
  const updates = await reconcileCharacterRoleNames(prisma, roles);
  assert.deepEqual(updates, [{ roleId: "r2", name: "Bran", color: hashNameToColor("Bran") }]);
});

test("a role the guild does not have is skipped, not invented", async () => {
  const prisma = fakePrisma([person("a", "gone", "Ada", disguisedAs("John"))]);
  assert.deepEqual(await reconcileCharacterRoleNames(prisma, [{ id: "r1", name: "x", color: 1 }]), []);
  // And no role list at all is a no-op rather than a hundred renames.
  assert.deepEqual(await reconcileCharacterRoleNames(prisma, []), []);
  assert.deepEqual(await reconcileCharacterRoleNames(prisma, null), []);
});

test("one pass cannot spend the guild's whole role budget", async () => {
  const many = Array.from({ length: MAX_RENAMES_PER_PASS + 10 }, (_, i) =>
    person(`c${i}`, `r${i}`, `Name${i}`, disguisedAs(`Fake${i}`)),
  );
  const roles = many.map((c) => ({ id: c.discordRoleId, name: c.firstName, color: 0 }));
  const updates = await reconcileCharacterRoleNames(fakePrisma(many), roles);
  assert.equal(updates.length, MAX_RENAMES_PER_PASS);
});

test("catatonia and a disguise are read off the same one query", async () => {
  const prisma = fakePrisma([person("b", "r2", "Bran", [...disguisedAs("John"), ...catatonic])]);
  const roles = [{ id: "r2", name: "Bran", color: hashNameToColor("Bran") }];
  const [update] = await reconcileCharacterRoleNames(prisma, roles);
  assert.equal(update.name, "John • Catatonic");
  assert.equal(update.color, CATATONIC_ROLE_COLOR);
});

test("the character-role signature the orphan sweep matches on still holds", () => {
  // db/scripts/ops/prune-orphan-roles.js#looksLikeCharacterRole tests
  // `mentionable && color === hashNameToColor(role.name)`. It skips a role a
  // character claims before it ever gets there, but the signature has to keep
  // holding anyway — a renamed role that failed it would be a deletion
  // candidate the moment its owner died.
  const { name, color } = characterRoleAppearance("Sir Alder", { forcedName: "John" });
  assert.equal(color, hashNameToColor(name));
});
