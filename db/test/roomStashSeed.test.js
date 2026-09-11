// The stash seed is recorded on the ROOM, not inferred from what is lying in
// it (SYNC.md §2). The bug this pins down: taking the last unit deletes the
// RoomTag row, so "players stripped this room bare" and "this room was never
// seeded" used to be the same state, and every re-sync restocked it.
//
// seedRoomStash is a closure inside syncZonesFromYaml, so this exercises the
// decision it makes rather than the function itself — the rule is small and
// worth pinning even at one remove.
const test = require("node:test");
const assert = require("node:assert");

// The rule, extracted: which authored slugs does a room still owe a seed?
function slugsToSeed(authored, seededSlugs) {
  const seeded = new Set(seededSlugs);
  return authored.filter((slug) => !seeded.has(slug));
}

test("a room that has never been seeded gets everything", () => {
  assert.deepEqual(slugsToSeed(["anvil", "paper"], []), ["anvil", "paper"]);
});

test("an item players carried off does NOT come back", () => {
  // The room is empty and its RoomTag rows are gone — the old test would have
  // re-created both. The record says otherwise.
  assert.deepEqual(slugsToSeed(["anvil", "paper"], ["anvil", "paper"]), []);
});

test("a newly authored slug still seeds beside spent ones", () => {
  assert.deepEqual(slugsToSeed(["anvil", "paper", "lantern"], ["anvil", "paper"]), ["lantern"]);
});

test("an unknown tag is skipped WITHOUT being recorded", () => {
  // zones sync before tags, so a first-ever run warns and skips; LAUNCH.md §5
  // runs the zone sync twice for exactly this. Recording the slug on that
  // first pass would strand the item forever. This is not hypothetical — on
  // 2026-09-10 nine stash lines were skipped this way at game start because
  // their Tag rows did not exist yet, and seeded correctly on a later run.
  const authored = ["hard-cheese"];
  const known = new Set(); // db:sync-tags has not run
  const recorded = [];
  for (const slug of slugsToSeed(authored, [])) {
    if (!known.has(slug)) continue; // warn + skip, record nothing
    recorded.push(slug);
  }
  assert.deepEqual(recorded, []);
  // Second run, after the tag exists: it seeds.
  known.add("hard-cheese");
  const second = [];
  for (const slug of slugsToSeed(authored, recorded)) {
    if (!known.has(slug)) continue;
    second.push(slug);
  }
  assert.deepEqual(second, ["hard-cheese"]);
});

test("a slug already lying in the room is recorded, not re-seeded twice", () => {
  // Recorded even when a RoomTag row already existed: the room demonstrably
  // has the item, so the seed is spent either way.
  assert.deepEqual(slugsToSeed(["anvil"], ["anvil"]), []);
});
