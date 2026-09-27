// The fate seat rules (Fate Slot Logic.docx, CHARACTERS.md "Fate seats"): how
// many seats each fate has at a given game size, and which seats reopen when
// their holder dies. Getting the second backwards either refills the roster
// for free — a Merchant dies and another walks in — or locks the last two
// seats nobody can ever be locked out of.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  CONSTANT_FATE_COUNT,
  FATE_SHARE_TOTAL,
  fateSeatsFor,
  fateCapacity,
  fateMinimum,
  isLobbyFate,
  isPermanentSeat,
  isSpawnOnly,
  seatHolderStatuses,
  OPEN_FATE_SLUGS,
} = require("../lib/fateCapacity");
const { parseRolesYaml, assertFateSeats } = require("../lib/syncRoles");

const roster = () =>
  parseRolesYaml(yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/roles.yaml"), "utf8"))).roles;
const bySlug = () => new Map(roster().map((r) => [r.slug, r]));

test("only Bum and Migrant hand their seat back", () => {
  assert.deepEqual(OPEN_FATE_SLUGS, ["bum", "migrant"]);
  assert.deepEqual(seatHolderStatuses({ slug: "bum" }), ["ALIVE"]);
  assert.deepEqual(seatHolderStatuses({ slug: "migrant" }), ["ALIVE"]);
});

test("every other seat stays spent", () => {
  for (const slug of ["merchant", "cerberus", "baron", "docker", "mortus", "minstrel"]) {
    assert.equal(isPermanentSeat({ slug }), true, slug);
    assert.deepEqual(seatHolderStatuses({ slug }), ["ALIVE", "DEAD"], slug);
  }
});

test("an unknown slug is treated as permanent, not as free", () => {
  assert.equal(isPermanentSeat({ slug: "not-a-role" }), true);
  assert.equal(isPermanentSeat(null), true);
});

test("the lobby lists neither Bum, Migrant nor a spawn-only seat", () => {
  assert.equal(isLobbyFate({ slug: "bum" }), false);
  assert.equal(isLobbyFate({ slug: "migrant" }), false);
  assert.equal(isLobbyFate({ slug: "tribune" }), false);
  assert.equal(isLobbyFate({ slug: "cerberus" }), true);
  assert.equal(isLobbyFate({ slug: "baron" }), true);
});

test("fate seats are the readied count plus 10%, rounded up", () => {
  assert.equal(fateSeatsFor(72), 80); // the doc's own example
  assert.equal(fateSeatsFor(50), 55); // 50 * 1.1 in floating point would ceil to 56
  assert.equal(fateSeatsFor(100), 110);
  assert.equal(fateSeatsFor(1), 2);
  assert.equal(fateSeatsFor(0), 0);
});

test("the three shapes", () => {
  assert.equal(fateCapacity({ isUnique: true }, 200), 1);
  assert.equal(fateCapacity({ unlimited: true }, 10), Infinity);
  // A share of the pool: 80 seats less 20 constant = 60, so a weight is its own seat count.
  assert.equal(fateCapacity({ weight: 4 }, 80), 4);
  // Pool of 90: 1 * 90 / 60 is exactly a half over, and a half rounds up.
  assert.equal(fateCapacity({ weight: 1 }, 110), 2);
  assert.equal(fateCapacity({ weight: 3 }, 110), 5);
  // Never below its minimum, even with no pool at all.
  assert.equal(fateCapacity({ weight: 6 }, 11), 3);
  assert.equal(fateCapacity({ weight: 6 }, 0), 3);
  assert.equal(fateCapacity({ weight: 1 }, 0), 1);
});

test("a fate's minimum is half its share, rounded up, never 0", () => {
  // The doc's own two examples: a Cerberus keeps 3, a Preacher 1.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(fateMinimum), [1, 1, 2, 2, 3, 3]);
  const roles = bySlug();
  assert.equal(fateCapacity(roles.get("cerberus"), fateSeatsFor(1)), 3);
  assert.equal(fateCapacity(roles.get("preacher"), fateSeatsFor(1)), 1);
  // The minimum gives way to the share once the share is bigger: Cerberus
  // stays at 3 through 49 readied (a pool of 34, 3.4 seats) and is 4 at 50.
  assert.equal(fateCapacity(roles.get("cerberus"), fateSeatsFor(49)), 3);
  assert.equal(fateCapacity(roles.get("cerberus"), fateSeatsFor(50)), 4);
});

test("the roster holds the doc's 20 constant fates, Minstrel among them", () => {
  const constants = roster().filter((r) => r.isUnique && !isSpawnOnly(r)).map((r) => r.slug);
  assert.equal(constants.length, CONSTANT_FATE_COUNT);
  for (const slug of ["baron", "baroness", "heir", "successor", "hand", "meister", "arbiter", "censor", "incarn",
    "sheriff", "bishop", "inquisitor", "esculap", "merchant", "banneret", "geschef", "exactor", "pusher",
    "innkeeper", "minstrel"]) {
    assert.ok(constants.includes(slug), slug);
  }
  const roles = bySlug();
  assert.equal(fateCapacity(roles.get("minstrel"), 500), 1);
  assert.equal(fateCapacity(roles.get("bum"), 20), Infinity);
  assert.equal(fateCapacity(roles.get("migrant"), 20), Infinity);
});

test("72 readied gives every fate exactly its share from the doc", () => {
  const shares = {
    courtier: 3, servant: 4, cerberus: 6, squire: 2, chaplain: 2, preacher: 1, practicus: 3, serpent: 4,
    docker: 3, refugee: 4, goon: 2, courtesan: 2, slave: 3, "inn-staff": 3, metalsmith: 3, mortus: 4,
    soiler: 5, prospector: 2, mercenary: 4,
  };
  assert.equal(Object.values(shares).reduce((a, b) => a + b, 0), FATE_SHARE_TOTAL);
  const roles = bySlug();
  for (const [slug, share] of Object.entries(shares)) {
    const role = roles.get(slug);
    assert.ok(role, slug);
    assert.equal(role.weight, share, slug);
    assert.equal(fateCapacity(role, fateSeatsFor(72)), share, slug);
  }
});

test("the published examples, at 10 to 150 readied", () => {
  const readied = [10, 20, 40, 50, 60, 72, 80, 100, 120, 150];
  const roles = bySlug();
  const row = (slug) => readied.map((n) => fateCapacity(roles.get(slug), fateSeatsFor(n)));
  assert.deepEqual(row("cerberus"), [3, 3, 3, 4, 5, 6, 7, 9, 11, 15]);
  assert.deepEqual(row("soiler"), [3, 3, 3, 3, 4, 5, 6, 8, 9, 12]);
  assert.deepEqual(row("servant"), [2, 2, 2, 2, 3, 4, 5, 6, 7, 10]);
  assert.deepEqual(row("courtier"), [2, 2, 2, 2, 2, 3, 3, 5, 6, 7]);
  assert.deepEqual(row("squire"), [1, 1, 1, 1, 2, 2, 2, 3, 4, 5]);
  assert.deepEqual(row("preacher"), [1, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
  // Every capped seat in the lobby, constants included. The minimums hold it
  // at 54 until 49 readied; from 50 up it tracks the +10%.
  const lobby = roster().filter(isLobbyFate);
  const total = (n) => lobby.reduce((sum, r) => sum + fateCapacity(r, fateSeatsFor(n)), 0);
  assert.deepEqual(readied.map(total), [54, 54, 54, 55, 67, 80, 87, 114, 133, 166]);
});

test("the sync accepts the real roster and refuses one that drifts from the rules", () => {
  const roles = roster();
  assert.doesNotThrow(() => assertFateSeats(roles));
  const minstrelShared = roles.map((r) => (r.slug === "minstrel" ? { ...r, isUnique: false, weight: 1 } : r));
  assert.throws(() => assertFateSeats(minstrelShared), /19 fates are "multiple: false"/);
  const heavier = roles.map((r) => (r.slug === "soiler" ? { ...r, weight: 6 } : r));
  assert.throws(() => assertFateSeats(heavier), /add up to 61/);
});

test("the sync refuses the retired base_seats", () => {
  const one = (role) => parseRolesYaml({ groups: { court: { x: { name: "X", ...role } } } });
  assert.throws(() => one({ multiple: true, weight: 5, base_seats: 1 }), /base_seats, which is retired/);
  assert.throws(() => one({ multiple: true, weight: 5, base_seats: 0 }), /retired/);
  assert.equal(one({ multiple: true, weight: 5 }).roles[0].baseSeats, 0);
});
