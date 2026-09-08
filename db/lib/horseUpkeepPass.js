// The horse's feed: 1 ⬢ per turn from everyone holding one, run from
// db/index.js#resolveNeeds() so the bot's cron advance and the Dev Panel's
// "End turn" button behave identically. See TURN-ENGINE.md for the ordering.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
//
// Two rules worth stating outright, because both are the opposite of what the
// rest of the horse does:
//
//   * HELD, not equipped. db/lib/mounts.js gates the free zone move on
//     `equipped`, and an indoors Location parks the animal at the door. The
//     feed ignores all of that: a horse in your pocket still eats, so stowing
//     it is not a way to skip the bill.
//   * Can't pay, nothing happens. A character under the cost is charged
//     nothing and keeps the horse — no starving marker, no runaway. Same shape
//     as the Hunger pass's 0 ⬢ case, and the reason the whole charge fits in
//     one updateMany below.
const { HORSE_SLUG, HORSE_UPKEEP_COST } = require("./constants");

async function runHorseUpkeepPass(prisma, turn) {
  const horse = await prisma.tag.findUnique({
    where: { slug: HORSE_SLUG },
    select: { id: true },
  });
  if (!horse) {
    console.error(`Horse upkeep skipped: no "${HORSE_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // The floor is structural rather than a Math.max on an earlier read: the
  // where-guard matches its own decrement, so resources can never go negative
  // and a character who cannot afford the feed simply isn't matched.
  const { count } = await prisma.character.updateMany({
    where: {
      status: "ALIVE",
      resources: { gte: HORSE_UPKEEP_COST },
      tags: { some: { tagId: horse.id } },
    },
    data: { resources: { decrement: HORSE_UPKEEP_COST } },
  });

  return { turnNumber: turn.number, fed: count };
}

module.exports = { runHorseUpkeepPass };
