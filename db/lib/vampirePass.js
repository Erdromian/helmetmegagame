// Per-turn upkeep for the Vampire's two 0-100 meters, run from
// db/index.js#resolveNeeds() right after Hunger. See docs/systemdocs/
// VAMPIRE.md and TURN-ENGINE.md for the full ordering.
//
// The meters themselves (thresholds, bands, the turn-length scaling) live in
// the Prisma-free db/lib/vampire.js — this file is the Prisma-in-tx half:
// reading every ALIVE vampire's two stats, writing the decay/regen, and
// granting/dropping the checkpoint tags off them.
//
// Unlike Hunger, which runs over the WHOLE roster and therefore batches its
// writes into decay-rate buckets for that scale, a Vampire seat is a small
// antagonist count — this pass writes one `character.update` per vampire
// rather than bucketing, which stays simple and correct at this N.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const {
  PALE_SLUG,
} = require("./constants");
const {
  VAMPIRE_SLUG,
  FLUSH_SLUG,
  SATIATED_SLUG,
  THIRSTY_SLUG,
  FAMISHED_SLUG,
  BLOODCRAZED_SLUG,
  BLACK_SCLERA_SLUG,
  HUMANE_SLUG,
  ESTRANGED_SLUG,
  DISTURBED_SLUG,
  WARPED_SLUG,
  BESTIAL_SLUG,
  WIGHT_SLUG,
} = require("./secretSlugs");
const { alivePassCharacters } = require("./aliveCharacters");
const { logBatchSystemTagChange } = require("./tagAudit");
const {
  clampBlood,
  clampHumanity,
  perTurnRate,
  bloodUrgencyBand,
  isPale,
  hasBlackSclera,
  humanityBand,
  HUMANITY_LOSS_BLOODCRAZED,
  vampireDm,
} = require("./vampire");

// The urgency and humanity tracks are each mutually exclusive — a vampire
// holds exactly one slug from its own list at all times. Appearance
// (black-sclera; pale is handled separately since it's a reused, shared tag)
// is additive, not part of either list.
const URGENCY_SLUGS = [FLUSH_SLUG, SATIATED_SLUG, THIRSTY_SLUG, FAMISHED_SLUG, BLOODCRAZED_SLUG];
const HUMANITY_BAND_SLUGS = [HUMANE_SLUG, ESTRANGED_SLUG, DISTURBED_SLUG, WARPED_SLUG];
const CYCLIC_SLUGS = [...URGENCY_SLUGS, BLACK_SCLERA_SLUG, PALE_SLUG, ...HUMANITY_BAND_SLUGS];
const ALL_TRACKED_SLUGS = [...CYCLIC_SLUGS, BESTIAL_SLUG, WIGHT_SLUG];

// `hold` is what a GM staged at this close's push (db/lib/stagedScalesApply.js
// #loadHeldScales). A Vampire in `hold.blood` keeps the blood the GM set, with
// no drain; one in `hold.humanity` keeps the humanity, with no regen and no
// Bloodcrazed loss from a drain crossing tonight. The band tags are still
// worked out from where each meter ends.
async function runVampirePass(prisma, turn, config, { hold = {} } = {}) {
  const holdBlood = hold.blood ?? new Set();
  const holdHumanity = hold.humanity ?? new Set();
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [VAMPIRE_SLUG, ...ALL_TRACKED_SLUGS] } },
    select: { id: true, slug: true, name: true },
  });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));

  const missing = [VAMPIRE_SLUG, ...ALL_TRACKED_SLUGS].filter((slug) => !bySlug.has(slug));
  if (missing.length) {
    console.error(`Vampire pass skipped: missing tag(s) ${missing.join(", ")} — run npm run db:sync-tags.`);
    return null;
  }
  const vampireTag = bySlug.get(VAMPIRE_SLUG);
  const trackTagIds = ALL_TRACKED_SLUGS.map((slug) => bySlug.get(slug).id);

  const characters = await alivePassCharacters(prisma, {
    where: { tags: { some: { tagId: vampireTag.id } } },
    select: {
      id: true,
      discordUserId: true,
      vampireBloodLevel: true,
      vampireHumanity: true,
      tags: { where: { tagId: { in: trackTagIds } }, select: { tagId: true } },
    },
  });

  if (characters.length === 0) {
    return { turnNumber: turn.number, vampires: 0, enteredBloodcrazed: 0, enteredBestial: 0, bandDms: [] };
  }

  // Both rates are per in-game day, so a day of several turns splits them.
  const turnsPerDay = config.turnsPerDay ?? 0;
  const bloodRate = perTurnRate(config.vampireBloodDecayPerDay, turn.turnLengthHours, turnsPerDay);
  const humanityRate = perTurnRate(config.vampireHumanityRegenPerDay, turn.turnLengthHours, turnsPerDay);

  const characterUpdates = [];
  // slug -> characterId[]
  const grantIds = new Map(CYCLIC_SLUGS.map((slug) => [slug, []]));
  const dropIds = new Map(CYCLIC_SLUGS.map((slug) => [slug, []]));
  const bestialGrantIds = [];
  const wightGrantIds = [];
  const bandDms = [];
  let enteredBloodcrazed = 0;
  let enteredBestial = 0;

  for (const character of characters) {
    const held = new Set(character.tags.map((t) => t.tagId));

    const beforeBlood = clampBlood(character.vampireBloodLevel);
    const beforeUrgency = bloodUrgencyBand(beforeBlood);
    const afterBlood = holdBlood.has(character.id) ? beforeBlood : clampBlood(beforeBlood - bloodRate);
    const afterUrgency = bloodUrgencyBand(afterBlood);
    const justEnteredBloodcrazed = beforeUrgency !== "bloodcrazed" && afterUrgency === "bloodcrazed";

    const heldBestial = held.has(bySlug.get(BESTIAL_SLUG).id);
    const humanityHeld = holdHumanity.has(character.id);
    const beforeHumanity = clampHumanity(character.vampireHumanity);
    let afterHumanity = heldBestial || humanityHeld ? beforeHumanity : clampHumanity(beforeHumanity + humanityRate);
    if (justEnteredBloodcrazed) {
      if (!humanityHeld) afterHumanity = clampHumanity(afterHumanity - HUMANITY_LOSS_BLOODCRAZED);
      enteredBloodcrazed += 1;
    }

    if (afterBlood !== character.vampireBloodLevel || afterHumanity !== character.vampireHumanity) {
      characterUpdates.push({
        id: character.id,
        data: { vampireBloodLevel: afterBlood, vampireHumanity: afterHumanity },
      });
    }

    // Urgency: mutually exclusive, so grant the target if not already held
    // and drop every OTHER urgency slug that IS held — self-healing rather
    // than relying on the before-band having matched a held tag exactly
    // (a freshly-assigned vampire holds none of them yet).
    for (const slug of URGENCY_SLUGS) {
      const tagId = bySlug.get(slug).id;
      const isTarget = slug === afterUrgency;
      const isHeld = held.has(tagId);
      if (isTarget && !isHeld) {
        grantIds.get(slug).push(character.id);
        if (slug !== beforeUrgency) bandDms.push({ discordUserId: character.discordUserId, kind: slug });
      } else if (!isTarget && isHeld) {
        dropIds.get(slug).push(character.id);
      }
    }

    // Appearance: additive, independent of urgency.
    const wantPale = isPale(afterBlood);
    const paleTagId = bySlug.get(PALE_SLUG).id;
    if (wantPale && !held.has(paleTagId)) grantIds.get(PALE_SLUG).push(character.id);
    else if (!wantPale && held.has(paleTagId)) dropIds.get(PALE_SLUG).push(character.id);

    const wantBlackSclera = hasBlackSclera(afterBlood);
    const blackScleraTagId = bySlug.get(BLACK_SCLERA_SLUG).id;
    if (wantBlackSclera && !held.has(blackScleraTagId)) grantIds.get(BLACK_SCLERA_SLUG).push(character.id);
    else if (!wantBlackSclera && held.has(blackScleraTagId)) dropIds.get(BLACK_SCLERA_SLUG).push(character.id);

    // Humanity band: mutually exclusive over 1-100, null (no band) at 0 —
    // that's Bestial/Wight territory instead, handled below.
    const afterBand = heldBestial ? null : humanityBand(afterHumanity);
    for (const slug of HUMANITY_BAND_SLUGS) {
      const tagId = bySlug.get(slug).id;
      const isTarget = slug === afterBand;
      const isHeld = held.has(tagId);
      if (isTarget && !isHeld) {
        grantIds.get(slug).push(character.id);
        bandDms.push({ discordUserId: character.discordUserId, kind: slug });
      } else if (!isTarget && isHeld) {
        dropIds.get(slug).push(character.id);
      }
    }

    // Crossing into 0 humanity: permanent, one-time. Drops whichever
    // numbered band tag was held (afterBand is null so the loop above
    // already queued that drop) and grants Bestial + Wight for good.
    if (!heldBestial && afterHumanity <= 0) {
      bestialGrantIds.push(character.id);
      wightGrantIds.push(character.id);
      enteredBestial += 1;
      bandDms.push({ discordUserId: character.discordUserId, kind: "bestial" });
    }
  }

  // Every grant here is permanent: a band tag stays until this pass (or
  // db/lib/vampireBands.js) drops it because the meter moved out of the band.
  // With a one-turn expiry the sweep took every band off each close and this
  // pass put it straight back, re-sending the humanity band DM every turn.
  await prisma.$transaction([
    ...characterUpdates.map(({ id, data }) => prisma.character.updateMany({ where: { id }, data })),
    ...CYCLIC_SLUGS.flatMap((slug) => {
      const tag = bySlug.get(slug);
      const toGrant = grantIds.get(slug);
      const toDrop = dropIds.get(slug);
      return [
        prisma.characterTag.createMany({
          data: toGrant.map((characterId) => ({
            characterId,
            tagId: tag.id,
            source: "EVENT",
          })),
          skipDuplicates: true,
        }),
        prisma.characterTag.deleteMany({
          where: { characterId: { in: toDrop }, tagId: tag.id },
        }),
      ];
    }),
    prisma.characterTag.createMany({
      data: bestialGrantIds.map((characterId) => ({
        characterId,
        tagId: bySlug.get(BESTIAL_SLUG).id,
        source: "EVENT",
      })),
      skipDuplicates: true,
    }),
    prisma.characterTag.createMany({
      data: wightGrantIds.map((characterId) => ({
        characterId,
        tagId: bySlug.get(WIGHT_SLUG).id,
        source: "EVENT",
      })),
      skipDuplicates: true,
    }),
  ]);

  // One summary row per grant/drop kind this pass actually moved — never one
  // per character, matching db/lib/hungerPass.js's own reasoning.
  await Promise.all(
    [
      ...CYCLIC_SLUGS.flatMap((slug) => {
        const tag = bySlug.get(slug);
        return [
          logBatchSystemTagChange(prisma, { system: "vampire", characterIds: grantIds.get(slug), tagId: tag.id, tagName: tag.name, op: "add" }),
          logBatchSystemTagChange(prisma, { system: "vampire", characterIds: dropIds.get(slug), tagId: tag.id, tagName: tag.name, op: "remove" }),
        ];
      }),
      logBatchSystemTagChange(prisma, { system: "vampire", characterIds: bestialGrantIds, tagId: bySlug.get(BESTIAL_SLUG).id, tagName: bySlug.get(BESTIAL_SLUG).name, op: "add" }),
      logBatchSystemTagChange(prisma, { system: "vampire", characterIds: wightGrantIds, tagId: bySlug.get(WIGHT_SLUG).id, tagName: bySlug.get(WIGHT_SLUG).name, op: "add" }),
    ],
  ).catch((err) => console.error("Vampire pass: tag-change audit failed:", err.message ?? err));

  return {
    turnNumber: turn.number,
    vampires: characters.length,
    enteredBloodcrazed,
    enteredBestial,
    bandDms: bandDms
      .map((notice) => ({ discordUserId: notice.discordUserId, content: vampireDm(notice) }))
      .filter((dm) => dm.content),
  };
}

module.exports = { runVampirePass };
