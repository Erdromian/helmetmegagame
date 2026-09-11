// The upkeep for every animal on the horse's family tree: 1 ⬢ per turn, per
// species, from everyone holding one — run from db/index.js#resolveNeeds() so
// the bot's cron advance and the Dev Panel's "End turn" button behave
// identically. See TURN-ENGINE.md for the ordering.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
//
// Two rules worth stating outright, because both are the opposite of what the
// rest of the horse does:
//
//   * HELD, not equipped. db/lib/mounts.js gates the free zone move on
//     `equipped`, and an indoors Location parks the animal at the door. The
//     feed ignores all of that: an animal in your pocket still eats, so stowing
//     it is not a way to skip the bill.
//   * Can't pay, nothing happens. A character under the cost is charged
//     nothing and keeps the animal — no starving marker, no runaway. Same shape
//     as the Hunger pass's 0 ⬢ case, and the reason each species' charge fits
//     in one updateMany below.
//
// A THIRD rule, new with the Arelitz: each species bills SEPARATELY. A
// character holding both a Horse and an Arelitz (Warbeast) pays 2 ⬢ this
// turn, not 1 — they are two different animals with two different mouths,
// and the pass never merges the slugs into one query to avoid that.
const { HORSE_SLUG, HORSE_UPKEEP_COST, UPKEEP_SLUGS } = require("./constants");

async function runHorseUpkeepPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: UPKEEP_SLUGS } },
    select: { id: true, slug: true },
  });
  if (!tags.length) {
    console.error(`Horse upkeep skipped: no "${HORSE_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // The floor is structural rather than a Math.max on an earlier read: the
  // where-guard matches its own decrement, so resources can never go negative
  // and a character who cannot afford the feed simply isn't matched.
  let fed = 0;
  for (const tag of tags) {
    const { count } = await prisma.character.updateMany({
      where: {
        status: "ALIVE",
        resources: { gte: HORSE_UPKEEP_COST },
        tags: { some: { tagId: tag.id } },
      },
      data: { resources: { decrement: HORSE_UPKEEP_COST } },
    });
    fed += count;
  }

  return { turnNumber: turn.number, fed };
}

module.exports = { runHorseUpkeepPass };
