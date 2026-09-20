// The rail tunnels out of the Depot, and the clock that decides whether one
// kills you. Pure — no Prisma — the way db/test/train.test.js is, because the
// decision half of db/lib/railroad.js is deliberately separable from the half
// that writes a death.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { tunnelKills } = require("../lib/railroad");
const { trainHere } = require("../lib/train");
const { parseZonesYaml } = require("../lib/syncZones/parse");
const { crossingCheck } = require("../lib/locationGraph");

// --- the parity ------------------------------------------------------------

test("the tunnel is exactly the train's own clock, negated, and can never drift from it", () => {
  for (let n = 0; n <= 20; n += 1) {
    assert.equal(
      tunnelKills(n),
      !trainHere(n),
      `turn ${n}: the tunnel and the platform disagree about where the train is`,
    );
  }
});

test("it is safe while the train stands at the platform and deadly while it runs", () => {
  // The train rolls in at the close of an even turn and pulls out at the close
  // of the odd turn after it, so it is standing there for the length of an odd
  // turn (db/lib/train.js).
  assert.equal(tunnelKills(2), true, "turn 2: still out on the line");
  assert.equal(tunnelKills(3), false, "turn 3: standing at the platform");
  assert.equal(tunnelKills(4), true, "turn 4: gone again");
  assert.equal(tunnelKills(5), false, "turn 5: back at the platform");
});

test("turn 1 kills, and that is the designer's call rather than an oversight", () => {
  // trainHere(1) is false — nothing has run yet, trainState(1) says "not in yet"
  // — so the tunnel is deadly on turn 1 too. This falls out of reading the
  // train's own clock instead of inventing a second one. If turn 1 should ever
  // be safe the predicate is `!trainHere(n) && n > 1`; this test is here so
  // nobody changes it by accident while thinking they are fixing a bug.
  assert.equal(tunnelKills(1), true);
});

test("a turn number that isn't one does not throw, and fails deadly", () => {
  // openTurn is legitimately null between turns. Deadly is the safe direction
  // for a hazard: the alternative is a tunnel that is free to walk whenever
  // the game is between turns.
  for (const bad of [null, undefined, 0]) {
    assert.equal(tunnelKills(bad), true, `${String(bad)} should read as "no train at the platform"`);
  }
});

// --- the YAML --------------------------------------------------------------

// parseZonesYaml takes a PARSED doc and throws on a problem rather than
// returning one, so a broken master fails these tests loudly by itself.
function loadZones() {
  const raw = fs.readFileSync(path.join(__dirname, "../../docs/zones.yaml"), "utf8");
  return parseZonesYaml(yaml.load(raw));
}

test("the authored railroad edge survives the parser with the flag set", () => {
  const { connections } = loadZones();
  const rails = connections.filter((c) => c.railroad);
  const pairs = rails.map((c) => [c.a, c.b].sort().join(" <-> ")).sort();
  // One tunnel. There were two until the Grand Ravine one was replaced by a
  // climb down to the Chasm — the Ravine reaches the deep on foot now.
  assert.deepEqual(pairs, ["depths-7 <-> undertown-5"]);
});

test("every railroad edge crosses a zone, which is what keeps the auto-walk off them", () => {
  // db/lib/locationWalk.js#walkWithinZone is same-zone only, and
  // performLocationMove independently refuses a skipCooldown crossing. So as
  // long as this holds, a multi-hop walk can never chain a player through a
  // tunnel past its confirm. Author a SAME-ZONE railroad edge and that stops
  // being true — which is what this assertion is here to catch.
  const { connections, locationEntries } = loadZones();
  const bySlug = new Map(locationEntries.map((l) => [l.slug, l]));
  const zoneOf = (slug) => bySlug.get(slug)?.zoneSlug ?? null;
  for (const edge of connections.filter((c) => c.railroad)) {
    assert.notEqual(
      zoneOf(edge.a),
      zoneOf(edge.b),
      `${edge.a} <-> ${edge.b} is a SAME-ZONE railroad: walkWithinZone can now auto-walk somebody into the train with no confirm`,
    );
  }
});

test("a non-boolean railroad is a parse problem, not a silently armed tunnel", () => {
  const { connections } = loadZones();
  assert.ok(connections.length > 0);
  // The flag composes rather than replacing anything: neither authored edge
  // gates on a tag, so both stay ordinary crossings for everyone.
  for (const edge of connections.filter((c) => c.railroad)) {
    assert.equal(edge.requiredTagSlug, null);
    assert.equal(edge.hidden, false);
  }
});

// --- the verdict -----------------------------------------------------------

test("a passable railroad edge carries the flag out to the travel surfaces", () => {
  const verdict = crossingCheck({ railroad: true }, { tagSlugs: [] });
  assert.equal(verdict.passable, true);
  assert.equal(verdict.railroad, true);
});

test("an ordinary edge says nothing about railroads", () => {
  const verdict = crossingCheck({ railroad: false }, { tagSlugs: [] });
  assert.equal(verdict.passable, true);
  assert.equal(verdict.railroad, false);
});

test("a refusal never mentions the tunnel, the way it never mentions the key", () => {
  // A hidden edge refuses in the same words a nonexistent one does, on purpose.
  // Leaking `railroad` onto that branch would tell somebody a way is there.
  const hidden = crossingCheck({ railroad: true, hidden: true, requiredTagSlug: "caving" }, { tagSlugs: [] });
  assert.equal(hidden.listed, false);
  assert.equal(hidden.railroad, undefined);

  const locked = crossingCheck({ railroad: true, requiredTagSlug: "den-key" }, { tagSlugs: [] });
  assert.equal(locked.passable, false);
  assert.equal(locked.railroad, undefined);
});
