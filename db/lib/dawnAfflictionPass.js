// Dawn afflictions (docs/systemdocs/TAGS.md): Guilt Ridden and Insomniac each
// carry a nightly chance of waking Exhausted. Run from
// db/index.js#resolveNeeds() right after the hunger pass. Takes `prisma` as a
// parameter — see db/lib/dm.js.
const { EXHAUSTED_SLUG, GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

const GUILT_RIDDEN_ODDS = 0.05;
const INSOMNIAC_ODDS = 0.2;

async function runDawnAfflictionPass(prisma, turn, { rng = Math.random } = {}) {
  const exhaustedTag = await prisma.tag.findUnique({
    where: { slug: EXHAUSTED_SLUG },
    select: { id: true, defaultDurationTurns: true },
  });
  if (!exhaustedTag) {
    console.error(`runDawnAfflictionPass: no "${EXHAUSTED_SLUG}" tag — run npm run db:sync-tags. Dawn afflictions won't bite.`);
    return { turnNumber: turn.number, rolled: 0, granted: 0, notices: [] };
  }

  const characters = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      tags: { some: { tag: { slug: { in: [GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG] } } } },
    },
    select: {
      id: true,
      discordUserId: true,
      name: true,
      tags: {
        where: { tag: { slug: { in: [GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG, EXHAUSTED_SLUG] } } },
        select: { tag: { select: { slug: true } } },
      },
    },
  });

  let rolled = 0;
  let granted = 0;
  const notices = [];
  const expiresTurn = expiryFrom(turn.number + 1, exhaustedTag.defaultDurationTurns ?? 1);

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    let hit = false;
    if (held.has(GUILT_RIDDEN_SLUG)) {
      rolled += 1;
      if (rng() < GUILT_RIDDEN_ODDS) hit = true;
    }
    if (held.has(INSOMNIAC_SLUG)) {
      rolled += 1;
      if (rng() < INSOMNIAC_ODDS) hit = true;
    }
    if (!hit || held.has(EXHAUSTED_SLUG)) continue;

    const result = await prisma.characterTag
      .createMany({
        data: [
          {
            characterId: character.id,
            tagId: exhaustedTag.id,
            source: "EVENT",
            quantity: 1,
            expiresTurn,
          },
        ],
        skipDuplicates: true,
      })
      .catch((err) => {
        console.error(`runDawnAfflictionPass: exhausted grant failed for ${character.id}:`, err.message ?? err);
        return null;
      });
    if (!result || result.count === 0) continue;

    granted += 1;
    if (character.discordUserId) {
      notices.push({
        discordUserId: character.discordUserId,
        content: "You barely slept. You wake **Exhausted**. ‡",
      });
    }
  }

  return { turnNumber: turn.number, rolled, granted, notices };
}

module.exports = { runDawnAfflictionPass };
