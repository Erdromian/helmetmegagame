// destroyNotice — what a tear does when nobody has hands to take the paper
// into (docs/systemdocs/PAPERWORK.md §7).
//
// Three things it has to get right, and each of them was a real hazard while
// this was being written:
//
//   1. The paper goes WITH the post. A GM's tear that deleted only the post
//      would leave the Tag row unowned, unpinned and unreachable — an orphan
//      db:prune-tags skips, because it skips every `custom` row on purpose.
//   2. `ephemeral` is the whole guard. A catalog tag that somehow found its
//      way onto a wall must survive being torn off it. This is the same guard
//      the expiry sweep in db/index.js uses, and the reason it is a
//      deleteMany with a predicate rather than a delete by id.
//   3. A lost race deletes NOTHING. The post delete IS the claim, so if
//      somebody else got there first the paper must be left exactly where it
//      is — it is in their hands now, not on the floor.

const test = require("node:test");
const assert = require("node:assert/strict");
const { destroyNotice } = require("../lib/noticeboard");

// A stand-in for the Prisma client that records what it was asked to delete.
// The two calls this makes are both deleteMany, and what matters is the
// `where` each one carried.
function fakePrisma({ postsDeleted = 1 } = {}) {
  const calls = [];
  return {
    calls,
    noticePost: {
      deleteMany: async (args) => {
        calls.push(["noticePost", args.where]);
        return { count: postsDeleted };
      },
    },
    tag: {
      deleteMany: async (args) => {
        calls.push(["tag", args.where]);
        return { count: 1 };
      },
    },
  };
}

test("the paper goes with the post", async () => {
  const db = fakePrisma();
  const claimed = await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  assert.equal(claimed.count, 1);
  assert.deepEqual(db.calls, [
    ["noticePost", { id: "post-1" }],
    ["tag", { id: "tag-1", ephemeral: true }],
  ]);
});

test("only an ephemeral tag is destroyed", async () => {
  const db = fakePrisma();
  await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  const tagWhere = db.calls.find(([model]) => model === "tag")[1];
  // Without this, a GM tearing down a catalog tag somebody pinned would delete
  // it out of the game for everybody.
  assert.equal(tagWhere.ephemeral, true);
});

test("a lost race leaves the paper alone", async () => {
  const db = fakePrisma({ postsDeleted: 0 });
  const claimed = await destroyNotice(db, { id: "post-1", tagId: "tag-1" });

  assert.equal(claimed.count, 0);
  // Somebody else tore it down first and is holding it. Deleting the tag here
  // would take the paper out of their hands.
  assert.equal(
    db.calls.some(([model]) => model === "tag"),
    false,
  );
});
