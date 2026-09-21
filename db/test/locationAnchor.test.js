// The Location anchor's compare-and-swap (db/lib/syncZones/roomThreads.js).
//
// On 2026-09-20 at 21:45 every one of the 56 Location channels ended up with two
// identical pinned cards twelve seconds apart: two provisioning passes each read
// "no anchor yet", each posted one, and the second pass's write took
// `anchorMessageId` with it — orphaning the first card where nothing could find
// it. The mirror only knows one id, the channel doctor does not read messages, so
// it sat there until the channels were noticed to look wrong.
//
// A fresh re-read before deciding shrank that window from minutes to
// milliseconds but could not close it, because a read followed by a write is
// still two steps. The write is now CONDITIONAL on the row still holding what was
// read, so exactly one pass can win and the loser cleans up after itself.
//
// LOCAL_MODE stands in for Discord — db/lib/localMode.js answers postMessage and
// deleteMessage with stand-ins, so this needs no token and no network.
process.env.LOCAL_MODE = "true";

const test = require("node:test");
const assert = require("node:assert/strict");

const { syncLocationAnchor } = require("../lib/syncZones/roomThreads");

const LOCATION = {
  id: "loc-1",
  slug: "fortress-4",
  name: "Keep",
  description: "The old keep.",
  attributes: [],
  discordChannelId: "chan-1",
  anchorMessageId: null,
  anchorHash: null,
};

// Records what the anchor asked the database to do. `claimCount` is what the
// conditional update reports back: 1 when this pass won the race, 0 when another
// pass got there first.
function fakePrisma({ claimCount = 1, stored = null } = {}) {
  const calls = { updateMany: [], findUnique: 0 };
  return {
    calls,
    location: {
      findUnique: async () => {
        calls.findUnique += 1;
        return stored ?? { anchorMessageId: null, anchorHash: null };
      },
      updateMany: async (args) => {
        calls.updateMany.push(args);
        return { count: claimCount };
      },
      update: async () => ({}),
    },
  };
}

test("the winner claims the row, conditionally on what it read", async () => {
  const prisma = fakePrisma({ claimCount: 1 });
  const location = { ...LOCATION };

  const outcome = await syncLocationAnchor(prisma, location, []);

  assert.equal(outcome, "created");
  assert.equal(prisma.calls.updateMany.length, 1, "the write must be the conditional one");

  // The WHERE is the whole point: it names the value this pass read, so a row
  // some other pass has already changed will not match.
  const { where, data } = prisma.calls.updateMany[0];
  assert.equal(where.id, "loc-1");
  assert.equal(where.anchorMessageId, null, "must be conditional on the id we read, not unconditional");
  assert.ok(data.anchorMessageId, "the new message id is written");
  assert.ok(data.anchorHash, "the body hash is written beside it");

  // And the caller's row is updated in place, so the pass that owns it carries on
  // with the truth.
  assert.equal(location.anchorMessageId, data.anchorMessageId);
});

test("the loser deletes the card it posted and adopts the winner's", async () => {
  // count: 0 is the database saying "somebody else changed this row first".
  const prisma = fakePrisma({
    claimCount: 0,
    stored: { anchorMessageId: null, anchorHash: null },
  });
  const location = { ...LOCATION };

  // What the winner left behind, which the loser must end up pointing at.
  let readCount = 0;
  prisma.location.findUnique = async () => {
    readCount += 1;
    // First read is the freshness check before posting; the second is the loser
    // asking who won.
    return readCount === 1
      ? { anchorMessageId: null, anchorHash: null }
      : { anchorMessageId: "the-winners-card", anchorHash: "winning-hash" };
  };

  const outcome = await syncLocationAnchor(prisma, location, []);

  // NOT "created" — this pass created nothing that survived.
  assert.equal(outcome, "unchanged");
  // It adopted the winner's card rather than leaving a second one pinned and
  // unreferenced, which is exactly the state that had to be cleaned up by hand.
  assert.equal(location.anchorMessageId, "the-winners-card");
  assert.equal(location.anchorHash, "winning-hash");
});

test("a row that already matches is left alone, and never posts", async () => {
  const prisma = fakePrisma({
    stored: { anchorMessageId: "existing", anchorHash: null },
  });
  const location = { ...LOCATION };

  // Run once to learn the hash this body produces, then feed it back as stored.
  await syncLocationAnchor(prisma, location, []);
  const hash = prisma.calls.updateMany[0]?.data.anchorHash ?? location.anchorHash;

  const second = fakePrisma({ stored: { anchorMessageId: "existing", anchorHash: hash } });
  const outcome = await syncLocationAnchor(second, { ...LOCATION }, []);

  assert.equal(outcome, "unchanged");
  assert.equal(second.calls.updateMany.length, 0, "nothing to claim when nothing changed");
});

test("a Location with no channel does nothing at all", async () => {
  const prisma = fakePrisma();
  const outcome = await syncLocationAnchor(prisma, { ...LOCATION, discordChannelId: null }, []);
  assert.equal(outcome, "skipped");
  assert.equal(prisma.calls.findUnique, 0);
});
