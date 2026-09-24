const test = require("node:test");
const assert = require("node:assert/strict");

// The pickup hold's "is anybody else in this private room" (CARRY.md §6a).
test("whoMayOpen: a private room opens for a key, a guest row or a quest allowance, and nobody else", () => {
  const { whoMayOpen } = require("../lib/roomAccess");
  const room = { id: "r1", kind: "PRIVATE", accessTagSlugs: ["key-vault"] };
  const people = [
    { id: "keyed", tagSlugs: new Set(["key-vault"]) },
    { id: "guest", tagSlugs: new Set() },
    { id: "quested", tagSlugs: new Set() },
    { id: "stranger", tagSlugs: new Set(["lantern"]) },
  ];
  const opened = whoMayOpen(room, people, new Set(["guest"]), new Set(["quested"])).map((p) => p.id);
  assert.deepEqual(opened, ["keyed", "guest", "quested"]);
  // A public room opens for everyone — the exemption never applies there.
  assert.equal(whoMayOpen({ ...room, kind: "PUBLIC" }, people).length, 4);
});
