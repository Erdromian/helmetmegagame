// `knows:` in docs/roles.yaml -> Role.knowsRoleSlugs, and who that seeds
// (db/lib/syncRoles.js#resolveKnows, db/lib/acquaintances.js#seedRows;
// docs/systemdocs/MEMORIES.md §2a). Pure, no Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { parseRolesYaml, resolveKnows } = require("../lib/syncRoles");
const { seedRows } = require("../lib/acquaintances");

const role = (slug, groupSlug, knowsAuthored = []) => ({ slug, groupSlug, knowsAuthored });

test("a group slug stands for every seat in it, its own included", () => {
  const roles = [role("baron", "court", ["court"]), role("servant", "court"), role("bishop", "clergy")];
  assert.deepEqual(resolveKnows(roles).get("baron"), ["baron", "servant"]);
  assert.deepEqual(resolveKnows(roles).get("bishop"), []);
});

test("role and group slugs mix, and come out in file order", () => {
  const roles = [role("baron", "court", ["bishop", "court"]), role("servant", "court"), role("bishop", "clergy")];
  assert.deepEqual(resolveKnows(roles).get("baron"), ["baron", "servant", "bishop"]);
});

test("an unknown slug stops the sync before it writes", () => {
  assert.throws(() => resolveKnows([role("baron", "court", ["barron"])]), /neither a role nor a group/);
});

test("the real roles.yaml resolves, and Ravenheart knows itself", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "roles.yaml"), "utf8"));
  const { roles } = parseRolesYaml(doc);
  const knows = resolveKnows(roles);
  assert.ok(knows.get("baron").includes("servant"));
  assert.ok(knows.get("servant").includes("baron"));
  // Nobody knows a migrant, and a migrant knows nobody.
  assert.deepEqual(knows.get("migrant"), []);
  for (const [, known] of knows) assert.ok(!known.includes("migrant"));
});

const person = (id, slug, knowsRoleSlugs = [], { examineVisible = true, roleTitle } = {}) => ({
  id,
  firstName: id.toUpperCase(),
  lastName: "Doe",
  name: `${id.toUpperCase()} Doe`,
  roleTitle: roleTitle ?? slug,
  role: { slug, name: slug, knowsRoleSlugs, examineVisible },
});

test("seeding runs both ways and never makes an entry about yourself", () => {
  const baron = person("b", "baron", ["servant", "baron"]);
  const servant = person("s", "servant", ["baron"]);
  const migrant = person("m", "migrant");
  const rows = seedRows(baron, [baron, servant, migrant]);
  const pairs = rows.map((r) => `${r.ownerId}>${r.subjectId}`).sort();
  assert.deepEqual(pairs, ["b>s", "s>b"]);
  assert.ok(rows.every((r) => r.source === "SEED"));
});

test("a late arrival is added to everyone whose seat knows theirs", () => {
  const serpent = person("n", "serpent", []);
  const esculap = person("e", "esculap", ["serpent"]);
  const rows = seedRows(serpent, [esculap]);
  assert.deepEqual(rows.map((r) => `${r.ownerId}>${r.subjectId}`), ["e>n"]);
  assert.equal(rows[0].roleText, "serpent");
});

test("an antagonist seat is named but never given a role", () => {
  const tribune = person("t", "tribune", ["tribune"], { examineVisible: false });
  const other = person("u", "tribune", ["tribune"], { examineVisible: false });
  const rows = seedRows(tribune, [other]);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.roleText, null);
    assert.equal(row.roleSlug, null);
    assert.ok(row.name);
  }
});

test("the character's own title is what is remembered", () => {
  const knight = person("k", "courtier", [], { roleTitle: "Disgraced Knight" });
  const baron = person("b", "baron", ["courtier"]);
  const [row] = seedRows(knight, [baron]);
  assert.equal(row.roleText, "Disgraced Knight");
  assert.equal(row.roleSlug, "courtier");
});
