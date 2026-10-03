// node --test over the on-foot way (MAP.md §2c): a connection too narrow for a
// mount or a Cart refuses anyone HOLDING one, out or stowed. It used to unequip
// them at the threshold and let them through, which walked a Cart and its whole
// load straight past the one thing meant to keep it out.
//
// Pure — db/lib/mounts.js#blocksOnFoot, db/lib/locationGraph.js#crossingCheck
// and #distancesFrom, no Prisma — plus one read of docs/zones.yaml.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { blocksOnFoot, STOWABLE_SLUGS } = require("../lib/mounts");
const { crossingCheck, distancesFrom, ON_FOOT_REFUSAL } = require("../lib/locationGraph");
const { parseZonesYaml } = require("../lib/syncZones/parse");

const WAY = { hidden: false, requiredTagSlug: null, modular: false, isOpen: true, onFoot: true, tightSqueeze: false };
const held = (slug, extra = {}) => ({ equipped: true, tag: { slug, name: slug }, ...extra });

test("blocksOnFoot: every mount rung and the Cart, whether out or stowed", () => {
  for (const slug of STOWABLE_SLUGS) {
    assert.equal(blocksOnFoot([held(slug)]), true, `${slug}, out`);
    assert.equal(blocksOnFoot([held(slug, { equipped: false })]), true, `${slug}, stowed`);
  }
  assert.equal(blocksOnFoot([held("motorcycle-ridden-2", { equipped: false })]), true, "a spent bike in a pack is still a bike");
});

test("blocksOnFoot: nothing else, and not a row that has run out", () => {
  assert.equal(blocksOnFoot([]), false);
  assert.equal(blocksOnFoot(undefined), false);
  assert.equal(blocksOnFoot([held("pickaxe"), held("arelitz-tack"), held("arelitz-egg")]), false);
  assert.equal(blocksOnFoot([held("cart", { quantity: 0 })]), false);
  assert.equal(blocksOnFoot([held("cart", { quantity: 1 })]), true);
});

test("crossingCheck: an on-foot way lists itself and refuses a holder", () => {
  const verdict = crossingCheck(WAY, { tagSlugs: [], onFootBlocked: true });
  assert.equal(verdict.listed, true, "they can see the way and learn what to leave");
  assert.equal(verdict.passable, false);
  assert.equal(verdict.refusal, ON_FOOT_REFUSAL);
  assert.equal(verdict.dismounts, undefined, "nothing dismounts any more");
});

test("crossingCheck: an on-foot way is an ordinary way to anyone else", () => {
  const verdict = crossingCheck(WAY, { tagSlugs: [], onFootBlocked: false });
  assert.equal(verdict.passable, true);
  assert.equal(verdict.refusal, null);
  assert.equal(crossingCheck({ ...WAY, onFoot: false }, { tagSlugs: [], onFootBlocked: true }).passable, true);
});

test("crossingCheck: a lock or a shut gate is what a holder hears about first", () => {
  const locked = crossingCheck({ ...WAY, requiredTagSlug: "den-key" }, { tagSlugs: [], onFootBlocked: true });
  assert.equal(locked.refusal, "This way isn't open to you.");
  const hidden = crossingCheck({ ...WAY, hidden: true, requiredTagSlug: "tunnel-rat" }, { tagSlugs: [], onFootBlocked: true });
  assert.equal(hidden.listed, false, "a hidden way stays hidden");
  const keyed = crossingCheck({ ...WAY, requiredTagSlug: "den-key" }, { tagSlugs: ["den-key"], onFootBlocked: true });
  assert.equal(keyed.refusal, ON_FOOT_REFUSAL, "the key opens the lock, not the gap");
});

test("distancesFrom: a fight past an on-foot way is out of a holder's reach", () => {
  const graph = { links: [{ aId: "A", bId: "B", ...WAY }] };
  const out = distancesFrom(graph, "A", [
    { id: "walker", locationId: "B", accessSlugs: new Set() },
    { id: "rider", locationId: "B", accessSlugs: new Set(["arelitz-ridden-1"]) },
    { id: "carter", locationId: "B", accessSlugs: new Set(["cart"]) },
  ]);
  assert.equal(out.get("walker").hops, 1);
  assert.equal(out.get("rider").hops, 4);
  assert.equal(out.get("carter").hops, 4);
});

// --- docs/zones.yaml ------------------------------------------------------

// The rule is unconditional, so the map has to leave a wide way to everywhere a
// mount is meant to reach — the caves most of all, where a Motorcycle is found
// as loot and has to be able to come out. Take every on-foot way off the map
// and what is left must still be one piece, bar the places listed here: each is
// a room at the end of a crawl, and none of them is somewhere a mount is made,
// sold or found. A new on-foot way that cuts off anything else fails this.
const ON_FOOT_ONLY = ["undertown-3", "undertown-9", "undertown-b", "undertown-f", "undertown-h"];

test("docs/zones.yaml: only the named places are closed to a mount or a Cart", () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "zones.yaml"), "utf8"));
  const { connections } = parseZonesYaml(doc);
  const every = [...new Set(connections.flatMap((c) => [c.a, c.b]))];
  const wide = new Map();
  for (const c of connections) {
    if (c.onFoot) continue;
    for (const [from, to] of [[c.a, c.b], [c.b, c.a]]) {
      if (!wide.has(from)) wide.set(from, []);
      wide.get(from).push(to);
    }
  }
  const reached = new Set(["town-1"]);
  const queue = ["town-1"];
  while (queue.length > 0) {
    for (const next of wide.get(queue.pop()) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  assert.ok(every.includes("town-1"), "the search starts somewhere real");
  assert.deepEqual(every.filter((slug) => !reached.has(slug)).sort(), ON_FOOT_ONLY);
});
