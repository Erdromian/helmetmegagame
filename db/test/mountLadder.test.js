// The mount ladder (db/lib/mounts.js, ARELITZ.md §2a): a fresh mount buys a
// fixed number of crossings a turn, every ride takes its tag one rung down,
// and the rung says how many are left. Pure, so it needs no database.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MOUNT_RIDES,
  MOUNT_STAGES,
  FAST_TRAVEL_SLUGS,
  ARELITZ_MOUNT_SLUGS,
  ridesLeft,
  nextStage,
  mountHead,
  equippedSlugs,
  fastTravelBonus,
  fastTravelRides,
  fastTravelCapacity,
  isMounted,
} = require("../lib/mounts");
const fs = require("node:fs");
const path = require("node:path");

const held = (slug, equipped = true) => [{ equipped, tag: { slug, name: slug } }];

test("an arelitz and a motorcycle buy 2 rides fresh, a tacked arelitz 3", () => {
  assert.equal(MOUNT_RIDES.arelitz, 2);
  assert.equal(MOUNT_RIDES.motorcycle, 2);
  assert.equal(MOUNT_RIDES["arelitz-tacked"], 3);
});

test("each ride is one rung down, and the bottom rung has nothing left", () => {
  assert.equal(nextStage("arelitz"), "arelitz-ridden-1");
  assert.equal(nextStage("arelitz-ridden-1"), "arelitz-ridden-2");
  assert.equal(nextStage("arelitz-ridden-2"), null);
  assert.deepEqual([ridesLeft("arelitz"), ridesLeft("arelitz-ridden-1"), ridesLeft("arelitz-ridden-2")], [2, 1, 0]);
  assert.deepEqual(
    ["arelitz-tacked", "arelitz-tacked-ridden-1", "arelitz-tacked-ridden-2", "arelitz-tacked-ridden-3"].map(ridesLeft),
    [3, 2, 1, 0],
  );
  assert.equal(nextStage("arelitz-tacked-ridden-3"), null);
});

test("every rung knows its head, and the unruly arelitz is on no ladder", () => {
  for (const [slug, stage] of MOUNT_STAGES) assert.equal(mountHead(slug), stage.head);
  assert.equal(mountHead("arelitz-tacked-ridden-2"), "arelitz-tacked");
  assert.equal(mountHead("unruly-arelitz"), null);
  assert.equal(ridesLeft("unruly-arelitz"), 0);
  assert.equal(FAST_TRAVEL_SLUGS.has("unruly-arelitz"), false);
});

test("the bonus is read off the rung, never off a rider's counter", () => {
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz"))), 2);
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz-ridden-1"))), 1);
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz-ridden-2"))), 0);
  assert.equal(fastTravelBonus(equippedSlugs(held("motorcycle-ridden-1"))), 1);
  // Stowed in a pack it is not a mount at all.
  assert.equal(fastTravelBonus(equippedSlugs(held("arelitz", false))), 0);
  assert.equal(isMounted(equippedSlugs(held("arelitz", false))), false);
});

test("a spent mount is still a mount: seats, the indoors park and the cart all still apply", () => {
  const spent = equippedSlugs(held("arelitz-ridden-2"));
  assert.equal(isMounted(spent), true);
  assert.equal(fastTravelCapacity(spent), 2);
  assert.equal(fastTravelCapacity(new Set(["arelitz-tacked-ridden-3", "cart"])), 6);
  assert.equal(fastTravelCapacity(new Set(["motorcycle-ridden-2", "cart"])), 2);
  assert.equal(fastTravelRides(spent), 2);
  assert.equal(fastTravelRides(equippedSlugs(held("arelitz-tacked-ridden-1"))), 3);
});

test("the arelitz family is every arelitz rung and nothing else", () => {
  assert.deepEqual(
    [...ARELITZ_MOUNT_SLUGS].sort(),
    [
      "arelitz",
      "arelitz-ridden-1",
      "arelitz-ridden-2",
      "arelitz-tacked",
      "arelitz-tacked-ridden-1",
      "arelitz-tacked-ridden-2",
      "arelitz-tacked-ridden-3",
    ],
  );
});

test("every rung the code generates is authored in docs/tags.yaml, equippable in the MOUNT slot, at its head's price", () => {
  const yaml = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "tags.yaml"), "utf8");
  const entry = (slug) => {
    const m = yaml.match(new RegExp(`^  ${slug.replace(/[-]/g, "\\-")}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|^[^ ])`, "m"));
    assert.ok(m, `docs/tags.yaml has no "${slug}"`);
    return m[1];
  };
  const price = (body) => Number((body.match(/^\s+sellablePrice: (\d+)/m) ?? [])[1]);
  for (const [slug, stage] of MOUNT_STAGES) {
    const body = entry(slug);
    assert.match(body, /^\s+equippable: true/m, `${slug} must be equippable`);
    assert.match(body, /^\s+equipSlot: MOUNT/m, `${slug} must sit in the MOUNT slot`);
    assert.equal(price(body), price(entry(stage.head)), `${slug} must carry its head's price so the ledger adds up across a rung swap`);
  }
});
