// Which seats reopen when their holder dies. Getting this backwards either
// refills the roster for free — a Merchant dies and another walks in — or
// locks the last two seats nobody can ever be locked out of.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  roleCapacity,
  isPermanentSeat,
  seatHolderStatuses,
  REOPENING_SEAT_ROLE_SLUGS,
} = require("../lib/roleCapacity");

test("only Bum and Migrant hand their seat back", () => {
  assert.deepEqual(REOPENING_SEAT_ROLE_SLUGS, ["bum", "migrant"]);
  assert.deepEqual(seatHolderStatuses({ slug: "bum" }), ["ALIVE"]);
  assert.deepEqual(seatHolderStatuses({ slug: "migrant" }), ["ALIVE"]);
});

test("every other seat stays spent", () => {
  for (const slug of ["merchant", "cerberus", "baron", "docker", "mortus"]) {
    assert.equal(isPermanentSeat({ slug }), true, slug);
    assert.deepEqual(seatHolderStatuses({ slug }), ["ALIVE", "DEAD"], slug);
  }
});

test("an unknown slug is treated as permanent, not as free", () => {
  assert.equal(isPermanentSeat({ slug: "not-a-role" }), true);
  assert.equal(isPermanentSeat(null), true);
});

test("capacity itself is unchanged", () => {
  assert.equal(roleCapacity({ isUnique: true }, 100), 1);
  assert.equal(roleCapacity({ unlimited: true }, 100), Infinity);
  assert.equal(roleCapacity({ weight: 4 }, 100), 4);
  assert.equal(roleCapacity({ weight: 1 }, 10), 1); // never rounds below 1
});

test("base seats come before the per-100 share", () => {
  const role = { weight: 5, baseSeats: 1 };
  const at = (n) => roleCapacity(role, n);
  assert.deepEqual([20, 40, 60, 80, 100, 120, 150].map(at), [2, 3, 4, 5, 6, 7, 9]);
  // A role with no base seats reads exactly as it did before the column existed.
  assert.equal(roleCapacity({ weight: 6, baseSeats: 0 }, 20), roleCapacity({ weight: 6 }, 20));
  // Unique and unlimited ignore it.
  assert.equal(roleCapacity({ isUnique: true, baseSeats: 3 }, 100), 1);
  assert.equal(roleCapacity({ unlimited: true, baseSeats: 3 }, 100), Infinity);
});

test("Courtier and Cerberus: 2 seats at 20 players, 3 at 40", () => {
  const { parseRolesYaml } = require("../lib/syncRoles");
  const yaml = require("js-yaml");
  const fs = require("node:fs");
  const path = require("node:path");
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/roles.yaml"), "utf8"));
  const bySlug = new Map(parseRolesYaml(doc).roles.map((r) => [r.slug, r]));
  for (const slug of ["courtier", "cerberus"]) {
    const role = bySlug.get(slug);
    assert.equal(roleCapacity(role, 20), 2, slug);
    assert.equal(roleCapacity(role, 40), 3, slug);
  }
});

test("the sync refuses base_seats where nothing would read it", () => {
  const { parseRolesYaml } = require("../lib/syncRoles");
  const one = (role) => parseRolesYaml({ groups: { court: { x: { name: "X", ...role } } } });
  assert.throws(() => one({ multiple: false, base_seats: 1 }), /no numeric weight/);
  assert.throws(() => one({ multiple: true, weight: "unlimited", base_seats: 1 }), /no numeric weight/);
  assert.throws(() => one({ multiple: true, weight: 5, base_seats: -1 }), /whole number/);
  assert.equal(one({ multiple: true, weight: 5, base_seats: 1 }).roles[0].baseSeats, 1);
  assert.equal(one({ multiple: true, weight: 5 }).roles[0].baseSeats, 0);
});
