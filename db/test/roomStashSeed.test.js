// The stash seed is recorded on the ROOM, not inferred from what is lying in
// it (SYNC.md §2): taking the last unit deletes the RoomTag row, so "stripped
// bare" and "never seeded" would otherwise be the same state and every
// re-import would restock it. seedRoomStash is the "Seed these items now"
// action in the /gm/dev/zones editor (web/app/(app)/gm/dev/zones/actions.js);
// this exercises the decision it makes at one remove.
const test = require("node:test");
const assert = require("node:assert");

function slugsToSeed(authored, seededSlugs) {
  const seeded = new Set(seededSlugs);
  return authored.filter((slug) => !seeded.has(slug));
}

test("a room that has never been seeded gets everything", () => {
  assert.deepEqual(slugsToSeed(["anvil", "paper"], []), ["anvil", "paper"]);
});

test("an item players carried off does NOT come back", () => {
  assert.deepEqual(slugsToSeed(["anvil", "paper"], ["anvil", "paper"]), []);
});

test("a newly authored slug still seeds beside spent ones", () => {
  assert.deepEqual(slugsToSeed(["anvil", "paper", "lantern"], ["anvil", "paper"]), ["lantern"]);
});

// Zones sync before tags, so a first-ever run warns and skips (LAUNCH.md §5
// runs the zone sync twice for this); recording the slug that first pass
// would strand the item forever.
test("an unknown tag is skipped WITHOUT being recorded", () => {
  const authored = ["hard-cheese"];
  const known = new Set(); // db:sync-tags has not run
  const recorded = [];
  for (const slug of slugsToSeed(authored, [])) {
    if (!known.has(slug)) continue; // warn + skip, record nothing
    recorded.push(slug);
  }
  assert.deepEqual(recorded, []);
  known.add("hard-cheese"); // second run, after the tag exists: it seeds
  const second = [];
  for (const slug of slugsToSeed(authored, recorded)) {
    if (!known.has(slug)) continue;
    second.push(slug);
  }
  assert.deepEqual(second, ["hard-cheese"]);
});

test("a slug already lying in the room is recorded, not re-seeded twice", () => {
  assert.deepEqual(slugsToSeed(["anvil"], ["anvil"]), []);
});

// The seed shape itself, now that a room can hold stock under the floor
// (SEARCH.md §9). ONE entry per slug, visible and hidden side by side —
// seededStashSlugs is keyed by slug, so a slug in both lists must be one row
// poured once, not two rows where the second is refused as already seeded.
const { stashSeedEntries } = require("../lib/roomStashSeed");

test("stashSeedEntries flattens items and hidden into one entry per slug", () => {
  const seed = { resources: 3, items: [["rock", 3], ["alcohol", 1]], hidden: [["alcohol", 4], ["resources", 8], ["dagger", 1]] };
  assert.deepEqual(stashSeedEntries(seed), [
    ["resources", 3, 8],
    ["rock", 3, 0],
    ["alcohol", 1, 4],
    ["dagger", 0, 1],
  ]);
});

test("a seed with no hidden list reads as before, with a zero hidden count", () => {
  assert.deepEqual(stashSeedEntries({ resources: 0, items: [["paper", 12]] }), [["paper", 12, 0]]);
  assert.deepEqual(stashSeedEntries(null), []);
});
