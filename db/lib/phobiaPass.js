// The turn-close phobia safety net (docs/systemdocs/TAGS.md). settlePhobias
// already runs on every Move (db/lib/locationMove.js), so this pass only
// catches a character whose phobia mood is stale for some other reason — a
// phobia granted mid-turn, or a zone that changed under them without a Move.
// Run from db/index.js#resolveNeeds() right after the carry pass.
//
// One settle per character, each its own transaction — a bad row must not
// roll back a hundred good ones. Takes `prisma` as a parameter — see
// db/lib/dm.js.
const {
  AFRAID_SLUG,
  PANIC_SLUG,
  CLAUSTROPHOBIA_SLUG,
  ACROPHOBIA_SLUG,
} = require("./constants");
const { settlePhobias } = require("./phobias");

async function runPhobiaPass(prisma, turn) {
  // Any status, not just ALIVE: a character who just died or went Catatonic
  // still needs its condition rows swept, and settlePhobias itself is what
  // decides that ALIVE is required to grant anything new.
  const candidates = await prisma.character.findMany({
    where: {
      OR: [
        { tags: { some: { tag: { slug: { in: [CLAUSTROPHOBIA_SLUG, ACROPHOBIA_SLUG] } } } } },
        {
          tags: {
            some: {
              source: "CONDITION",
              tag: { slug: { in: [AFRAID_SLUG, PANIC_SLUG] } },
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  let granted = 0;
  let removed = 0;
  const failed = [];
  for (const { id } of candidates) {
    const result = await settlePhobias(prisma, id).catch((err) => {
      console.error(`Phobia settle failed for ${id}:`, err.message ?? err);
      failed.push(id);
      return null;
    });
    if (!result) continue;
    granted += result.granted.length;
    removed += result.removed.length;
  }

  return {
    turnNumber: turn.number,
    settled: candidates.length,
    granted,
    removed,
    failed,
  };
}

module.exports = { runPhobiaPass };
