// lastSightings (db/lib/sightings.js) reads only THIS game's lines. Turn numbers start again every
// game, so the open turn's number alone also matched the same turn of every game Restart Game kept:
// on 2026-10-04 that was 17,775 old rows against 38 of this game's, and 55 of the 66 "sightings" it
// returned were characters from the last game.
const test = require("node:test");
const assert = require("node:assert/strict");

// sightings.js takes placesFor at require time, so the stand-in goes in first.
const feedAccess = require("../lib/feedAccess");
feedAccess.placesFor = async () => [{ placeKey: "loc:square" }, { placeKey: "room:pub" }];

const { lastSightings } = require("../lib/sightings");
const { forgetGameFloor } = require("../lib/feedWipe");

function fakePrisma({ floor }) {
  const seen = { where: null };
  const prisma = {
    seen,
    turn: { findFirst: async () => ({ number: 5 }) },
    gameState: {
      findUnique: async () => ({ gameId: "g2", game: { createdAt: new Date(Date.now() - 3600 * 1000) } }),
    },
    gameConfig: {
      findUnique: async () => ({ messageWipeEnabled: false, feedWipeSeq: 0n, feedWipeSummarySeq: 0n }),
    },
    $queryRaw: async () => [{ seq: floor }],
    archiveEntry: {
      groupBy: async ({ where }) => {
        seen.where = where;
        return [{ characterId: "ada", _max: { seq: 145400n } }];
      },
      findMany: async () => [
        { seq: 145400n, characterId: "ada", characterName: "Ada", concealedAlias: null, disguised: false, presentedAvatarPath: null },
      ],
    },
  };
  return prisma;
}

test.beforeEach(() => forgetGameFloor());

test("the open turn is read above the previous game's floor", async () => {
  const prisma = fakePrisma({ floor: 145311n });
  const seen = await lastSightings(prisma, { id: "viewer" });

  assert.deepEqual(prisma.seen.where.seq, { gt: 145311n });
  assert.equal(prisma.seen.where.turnNumber, 5);
  assert.equal(seen.get("ada")?.name, "Ada");
});

test("with no previous game there is no floor to add", async () => {
  const prisma = fakePrisma({ floor: null });
  await lastSightings(prisma, { id: "viewer" });

  assert.equal(prisma.seen.where.seq, undefined);
});
