// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
// See TURN-ENGINE.md §5 for the full ordering.
//
// The meter itself (thresholds, decay, bands, what a character eats to stay
// out of Starving) lives in the Prisma-free db/lib/hunger.js — this file is
// the Prisma half: reading every ALIVE character, writing the decay, eating
// the tastiest thing somebody carries when they are about to drop into
// Starving (or give in to it while Hungry, or as a Glutton), and keeping each
// character's one descriptor tag (Full, Hungry or Starving) in step.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { Prisma } = require("@prisma/client");
const {
  FULL_SLUG,
  HUNGER_SLUG,
  STARVING_SLUG,
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  DYING_SLUG,
  GLUTTON_SLUG,
} = require("./constants");
const { applyMoodTerms, dishMoodTerms, scaleTerms, EVENTS } = require("./mood");
const { alivePassCharacters } = require("./aliveCharacters");
const { logBatchSystemTagChange } = require("./tagAudit");
const { dropCharacterTag, grantTagSlugs } = require("./tagWrites");
const { lockCharacter } = require("./moveLedger");
const { resolveConsumeGrants, resistSlugsOf, heldSlugsOf } = require("./consumeGrants");
const {
  HUNGER_MAX,
  DESCRIPTORS,
  bandOf,
  decayFor,
  unitHungerFor,
  foodMoodFor,
  autoEdible,
  planHunger,
  resolveHunger,
  rawFoodMoodTerms,
  hungerDm,
  DYING_DM,
} = require("./hunger");

const BANDS = ["full", "hungry", "starving"];

// Everything autoEdible and the mood/hunger figures read off a food's row.
const FOOD_TAG_SELECT = {
  id: true,
  slug: true,
  name: true,
  consumable: true,
  consumesInto: true,
  consumesIntoResources: true,
  consumesIntoTagPoints: true,
  consumeChoice: true,
  cures: true,
  administerSkill: true,
  cooked: true,
  cookedFrom: true,
  mealHunger: true,
  mealMood: true,
};

// Only rows that could possibly be food: a meal or dish (mealHunger) or a raw
// ingredient (a `cooked:` block). autoEdible makes the real call.
const FOOD_ROW_WHERE = {
  quantity: { gt: 0 },
  tag: { consumable: true, OR: [{ mealHunger: { gt: 0 } }, { cooked: { not: Prisma.DbNull } }] },
};

// Every ingredient row the carried dishes name, in one read.
async function loadIngredients(db, rows) {
  const slugs = [...new Set(rows.flatMap((r) => r.tag.cookedFrom ?? []))];
  if (!slugs.length) return new Map();
  const tags = await db.tag.findMany({ where: { slug: { in: slugs } }, select: FOOD_TAG_SELECT });
  return new Map(tags.map((t) => [t.slug, t]));
}

// One character's carried food, as db/lib/hunger.js#planHunger reads it, plus
// what applying its mood needs. A dish's ingredient that no longer resolves is
// dropped, the same as consumeTagRequestImpl does.
function foodsFrom(rows, ingredientsBySlug) {
  const foods = [];
  for (const row of rows) {
    const ingredients = (row.tag.cookedFrom ?? []).map((slug) => ingredientsBySlug.get(slug)).filter(Boolean);
    if (!autoEdible(row.tag, ingredients)) continue;
    const isDish = ingredients.length > 0 || row.tag.mealMood != null;
    foods.push({
      tagId: row.tagId,
      slug: row.tag.slug,
      name: row.tag.name,
      quantity: row.quantity,
      hunger: unitHungerFor(row.tag, ingredients),
      mood: foodMoodFor(row.tag, ingredients),
      moodTerms: isDish
        ? dishMoodTerms(row.tag.mealMood, ingredients.map((t) => t.cooked?.mood ?? 0))
        : rawFoodMoodTerms(row.tag.cooked?.mood ?? 0),
    });
  }
  return foods;
}

// `rng` is the snack roll's source, one draw per character; a test may pass
// its own.
async function runHungerPass(prisma, turn, { bornBefore, rng = Math.random } = {}) {
  const tags = await prisma.tag.findMany({
    where: {
      slug: {
        in: [FULL_SLUG, HUNGER_SLUG, STARVING_SLUG, HUNGERLESS_SLUG, FAST_METABOLISM_SLUG, DYING_SLUG, GLUTTON_SLUG],
      },
    },
    select: { id: true, slug: true, name: true },
  });
  const bySlug = new Map(tags.map((t) => [t.slug, t]));
  const descriptorTag = {
    full: bySlug.get(FULL_SLUG),
    hungry: bySlug.get(HUNGER_SLUG),
    starving: bySlug.get(STARVING_SLUG),
  };
  if (BANDS.some((band) => !descriptorTag[band])) {
    console.error(
      `Hunger pass skipped: a hunger descriptor tag (${FULL_SLUG}/${HUNGER_SLUG}/${STARVING_SLUG}) is missing — run npm run db:sync-tags.`,
    );
    return null;
  }
  const descriptorIds = BANDS.map((band) => descriptorTag[band].id);
  const hungerlessId = bySlug.get(HUNGERLESS_SLUG)?.id ?? null;
  const fastMetabolismId = bySlug.get(FAST_METABOLISM_SLUG)?.id ?? null;
  const dyingTag = bySlug.get(DYING_SLUG) ?? null;
  if (!dyingTag) {
    console.error(`Hunger pass: no "${DYING_SLUG}" tag — run npm run db:sync-tags. Starving to death won't grant it.`);
  }
  const gluttonId = bySlug.get(GLUTTON_SLUG)?.id ?? null;

  const turnLengthHours = turn.turnLengthHours ?? 24;
  // Turns per in-game day (GameConfig.turnsPerDay, 0 = the calendar day).
  // Read without a select, so this still works before that column exists.
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const turnsPerDay = config?.turnsPerDay ?? 0;
  const turnNumber = turn.number;
  const perTurn = decayFor(new Set(), turnLengthHours, turnsPerDay);
  const perTurnFast = decayFor(new Set([FAST_METABOLISM_SLUG]), turnLengthHours, turnsPerDay);

  // Only what this pass reads as INPUT: the three gating traits, and (below)
  // whatever food somebody carries. The descriptors are its OUTPUT, worked
  // out from the meter, never read back.
  const gateIds = [hungerlessId, fastMetabolismId, gluttonId].filter(Boolean);
  // A character born mid-close (see db/index.js#resolveNeeds) wasn't alive
  // for the turn that's closing — exclude them rather than charge a body for
  // a day it never had.
  const characters = await alivePassCharacters(prisma, {
    where: bornBefore ? { createdAt: { lt: bornBefore } } : undefined,
    select: {
      id: true,
      discordUserId: true,
      hungerValue: true,
      starvingSinceTurn: true,
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true, quantity: true } },
    },
  });

  // Everybody's carried food in one read, not one per character.
  const foodRows = characters.length
    ? await prisma.characterTag.findMany({
        where: { characterId: { in: characters.map((c) => c.id) }, ...FOOD_ROW_WHERE },
        select: { characterId: true, tagId: true, quantity: true, tag: { select: FOOD_TAG_SELECT } },
      })
    : [];
  const ingredientsBySlug = await loadIngredients(prisma, foodRows);
  const foodRowsBy = new Map();
  for (const row of foodRows) {
    if (!foodRowsBy.has(row.characterId)) foodRowsBy.set(row.characterId, []);
    foodRowsBy.get(row.characterId).push(row);
  }

  const hungerlessIds = [];
  // The decay is uniform within a turn for each rate, so everybody who does
  // not eat goes into one of four buckets and one updateMany each. The WHERE
  // side of each bucket matches its own decrement, so hungerValue can never
  // go negative.
  const buckets = { normal: [], normalFloor: [], fast: [], fastFloor: [] };
  const eaters = [];
  const outcomes = new Map(); // characterId -> { before, final, band, cross, zeroSince, newlyDying, notice, meals, eaten, discordUserId, prevZeroSince }

  for (const character of characters) {
    const heldIds = new Map(character.tags.map((ct) => [ct.tagId, ct]));
    if (hungerlessId && heldIds.has(hungerlessId)) {
      hungerlessIds.push(character.id);
      continue;
    }
    const fast = Boolean(fastMetabolismId && heldIds.has(fastMetabolismId));
    const heldSlugs = [
      ...(fast ? [FAST_METABOLISM_SLUG] : []),
      ...(gluttonId && heldIds.has(gluttonId) ? [GLUTTON_SLUG] : []),
    ];
    // Drawn once and kept, so the re-plan under the lock rolls the same.
    const roll = rng();
    const plan = planHunger(
      {
        hungerValue: character.hungerValue,
        starvingSinceTurn: character.starvingSinceTurn,
        heldSlugs,
        foods: foodsFrom(foodRowsBy.get(character.id) ?? [], ingredientsBySlug),
      },
      { turnLengthHours, turnsPerDay, turnNumber, roll },
    );
    if (plan.meals.length) {
      eaters.push({ id: character.id, heldSlugs, roll });
    } else {
      const decay = fast ? perTurnFast : perTurn;
      const key = character.hungerValue >= decay ? (fast ? "fast" : "normal") : fast ? "fastFloor" : "normalFloor";
      buckets[key].push(character.id);
    }
    outcomes.set(character.id, {
      ...plan,
      before: character.hungerValue,
      discordUserId: character.discordUserId,
      prevZeroSince: character.starvingSinceTurn ?? null,
    });
  }

  let autoAteUnits = 0;
  let snacked = 0;
  let starvedAte = 0;
  const poisonedEaters = [];

  // ONE transaction: nobody lands at a new hungerValue without the matching
  // descriptor landing with it, and a Foodstuff is never eaten without the
  // meter moving. The pass is not idempotent, so all or nothing.
  await prisma.$transaction(
    async (tx) => {
      await tx.character.updateMany({
        where: { id: { in: hungerlessIds } },
        data: { hungerValue: HUNGER_MAX, starvingSinceTurn: null },
      });
      if (perTurn > 0) {
        await tx.character.updateMany({ where: { id: { in: buckets.normal } }, data: { hungerValue: { decrement: perTurn } } });
      }
      await tx.character.updateMany({ where: { id: { in: buckets.normalFloor } }, data: { hungerValue: 0 } });
      if (perTurnFast > 0) {
        await tx.character.updateMany({ where: { id: { in: buckets.fast } }, data: { hungerValue: { decrement: perTurnFast } } });
      }
      await tx.character.updateMany({ where: { id: { in: buckets.fastFloor } }, data: { hungerValue: 0 } });

      // Eating to stay out of Starving (the doc), or giving in while Hungry:
      // the tastiest thing first. Re-read under the lock — the stacks or the
      // meter may have moved since the read above — and re-planned with the
      // same roll.
      let ladder = null;
      for (const eater of eaters) {
        await lockCharacter(tx, eater.id);
        const fresh = await tx.character.findUnique({
          where: { id: eater.id },
          select: { hungerValue: true, starvingSinceTurn: true },
        });
        const freshRows = await tx.characterTag.findMany({
          where: { characterId: eater.id, ...FOOD_ROW_WHERE },
          select: { characterId: true, tagId: true, quantity: true, tag: { select: FOOD_TAG_SELECT } },
        });
        const plan = planHunger(
          {
            hungerValue: fresh.hungerValue,
            starvingSinceTurn: fresh.starvingSinceTurn,
            heldSlugs: eater.heldSlugs,
            foods: foodsFrom(freshRows, ingredientsBySlug),
          },
          { turnLengthHours, turnsPerDay, turnNumber, roll: eater.roll },
        );
        for (const meal of plan.meals) {
          const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, eater.id, meal.tagId, meal.count);
          if (poisonedTaken > 0 && poisonPayload) {
            if (!ladder) {
              const rows = await tx.tag.findMany({
                where: { escalatesInto: { not: null } },
                select: { slug: true, escalatesInto: true },
              });
              ladder = new Map(rows.map((t) => [t.slug, t.escalatesInto]));
            }
            const poisoned = await applyPoison(tx, eater.id, poisonPayload, ladder, turnNumber);
            if (poisoned) poisonedEaters.push({ characterId: eater.id, ...poisoned, count: poisonedTaken });
          }
        }
        const settled = resolveHunger({
          before: fresh.hungerValue,
          afterDecay: plan.afterDecay,
          meals: plan.meals,
          snack: plan.snack,
          starvingSinceTurn: fresh.starvingSinceTurn,
          turnNumber,
        });
        autoAteUnits += settled.eaten;
        if (settled.eaten) {
          if (plan.snack) snacked += 1;
          else starvedAte += 1;
        }
        await tx.character.update({ where: { id: eater.id }, data: { hungerValue: settled.final } });
        outcomes.set(eater.id, {
          ...outcomes.get(eater.id),
          ...settled,
          meals: plan.meals,
          before: fresh.hungerValue,
          prevZeroSince: fresh.starvingSinceTurn ?? null,
        });
      }

      // The descriptors: exactly one per character, with no expiry — the pass
      // (and eating) move it, never the clock. The Hungerless hold none.
      const byBand = { full: [], hungry: [], starving: [] };
      for (const [id, o] of outcomes) byBand[o.band].push(id);
      for (const band of BANDS) {
        const ids = byBand[band];
        if (!ids.length) continue;
        const keepId = descriptorTag[band].id;
        await tx.characterTag.deleteMany({
          where: { characterId: { in: ids }, tagId: { in: descriptorIds.filter((id) => id !== keepId) } },
        });
        await tx.characterTag.createMany({
          data: ids.map((characterId) => ({ characterId, tagId: keepId, source: "EVENT", expiresTurn: null })),
          skipDuplicates: true,
        });
        // A row left over from the old one-turn grant keeps no clock.
        await tx.characterTag.updateMany({
          where: { characterId: { in: ids }, tagId: keepId, expiresTurn: { not: null } },
          data: { expiresTurn: null },
        });
      }
      if (hungerlessIds.length) {
        await tx.characterTag.deleteMany({ where: { characterId: { in: hungerlessIds }, tagId: { in: descriptorIds } } });
      }

      // The zero clock: stamped the first close the meter reads 0, cleared
      // the moment it reads anything else. Reaching 0 grants `dying`
      // (STARVING_DEATH_TURNS in db/lib/hunger.js).
      const stampIds = [];
      const clearIds = [];
      const newlyDyingIds = [];
      for (const [id, o] of outcomes) {
        if (o.zeroSince != null && o.prevZeroSince == null) stampIds.push(id);
        if (o.zeroSince == null && o.prevZeroSince != null) clearIds.push(id);
        if (o.newlyDying) newlyDyingIds.push(id);
      }
      await tx.character.updateMany({ where: { id: { in: stampIds } }, data: { starvingSinceTurn: turnNumber } });
      await tx.character.updateMany({ where: { id: { in: clearIds } }, data: { starvingSinceTurn: null } });
      if (newlyDyingIds.length && dyingTag) {
        await tx.characterTag.createMany({
          data: newlyDyingIds.map((characterId) => ({
            characterId,
            tagId: dyingTag.id,
            source: "EVENT",
            // One-turn clock: granted at close N, expires N + 1, then
            // db/lib/dyingDeathPass.js takes over. A GM confirms the death
            // by hand, same as every other terminal chain (tagExpiryPass.js).
            expiresTurn: turnNumber + 1,
          })),
          skipDuplicates: true,
        });
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // One summary audit row per descriptor a character moved INTO this close —
  // never one per character, or a roster-wide shift would flood /gm/audit.
  const movedInto = { full: [], hungry: [], starving: [] };
  const enteredHungryIds = [];
  const enteredStarvingIds = [];
  const newlyDyingIds = [];
  const hungerNotices = [];
  for (const [id, o] of outcomes) {
    if (bandOf(o.before) !== o.band) movedInto[o.band].push(id);
    if (o.cross.enteredHungry) enteredHungryIds.push(id);
    if (o.cross.enteredStarving) enteredStarvingIds.push(id);
    if (o.newlyDying) newlyDyingIds.push(id);
    if (o.notice) hungerNotices.push({ discordUserId: o.discordUserId, ...o.notice });
  }
  await Promise.all([
    ...BANDS.map((band) =>
      logBatchSystemTagChange(prisma, {
        system: "hunger",
        characterIds: movedInto[band],
        tagId: descriptorTag[band].id,
        tagName: descriptorTag[band].name,
        op: "add",
      }),
    ),
    ...(newlyDyingIds.length && dyingTag
      ? [logBatchSystemTagChange(prisma, { system: "hunger", characterIds: newlyDyingIds, tagId: dyingTag.id, tagName: dyingTag.name, op: "add" })]
      : []),
  ]).catch((err) => console.error("Hunger pass: tag-change audit failed:", err.message ?? err));

  // The dial, once the meter has landed: the one-time hit for dropping into
  // a band (charged on where the character ENDS, so eating your way back to
  // Hungry costs the Hungry hit and never the Starving one), whatever each
  // thing eaten does to the dial (exactly what eating it by hand would), and
  // the fright of Dying. One write per character.
  const moodDms = [];
  for (const [id, o] of outcomes) {
    const terms = [];
    if (o.cross.enteredHungry) terms.push({ kind: "HUNGRY_ONSET", base: EVENTS.HUNGRY_ONSET, ctx: {} });
    if (o.cross.enteredStarving) terms.push({ kind: "STARVING_ONSET", base: EVENTS.STARVING_ONSET, ctx: {} });
    if (o.newlyDying) terms.push({ kind: "DYING", base: EVENTS.DYING, ctx: {} });
    for (const meal of o.meals ?? []) terms.push(...(scaleTerms(meal.moodTerms, meal.count) ?? []));
    if (!terms.length) continue;
    const moved = await prisma
      .$transaction((tx) => applyMoodTerms(tx, id, terms, { notify: false }))
      .catch((err) => {
        console.error(`Hunger pass: mood failed for ${id}:`, err.message ?? err);
        return null;
      });
    if (moved?.dm) moodDms.push(moved.dm);
  }

  // DMs are deliberately NOT sent here — the list is handed back and sent
  // from advanceTurn()'s runSideEffects() instead, after the response
  // already flushed.
  return {
    turnNumber,
    turnLengthHours,
    turnsPerDay: turnsPerDay || undefined,
    perTurnDecay: perTurn,
    decayed: outcomes.size,
    skipped: hungerlessIds.length,
    autoAte: starvedAte,
    snacked,
    autoAteUnits,
    poisonedWhileEating: poisonedEaters.length || undefined,
    enteredHungry: enteredHungryIds.length,
    enteredStarving: enteredStarvingIds.length,
    newlyDying: newlyDyingIds.length,
    hungerNotices,
    moodDms,
    newlyDyingCharacterIds: newlyDyingIds,
  };
}

// A poisoned food eaten at the close does exactly what it would have
// done eaten by hand (web/app/(app)/character/actions/misc.js): the poison's
// own grants, through the same resolver and the same resist filter.
async function applyPoison(tx, characterId, poisonTagId, ladder, turnNumber) {
  const poisonTag = await tx.tag.findUnique({
    where: { id: poisonTagId },
    select: {
      id: true,
      name: true,
      consumesInto: true,
      consumesIntoUnless: true,
      consumesIntoDurations: true,
      consumesIntoOneOf: true,
      consumesIntoResources: true,
    },
  });
  if (!poisonTag) return null;
  const held = await tx.characterTag.findMany({
    where: { characterId },
    select: { tagId: true, tag: { select: { slug: true, resists: true } } },
  });
  const grants = resolveConsumeGrants(poisonTag, heldSlugsOf(held), ladder, resistSlugsOf(held));
  for (const slug of grants.removes) {
    const row = held.find((ct) => ct.tag.slug === slug);
    if (row) await dropCharacterTag(tx, characterId, row.tagId, 1);
  }
  // First live turn is the one about to open.
  await grantTagSlugs(tx, characterId, grants.slugs, turnNumber + 1, grants.durations);
  return { poisonTagId: poisonTag.id, poisonName: poisonTag.name };
}

module.exports = {
  runHungerPass,
  hungerDm,
  DYING_DM,
  DESCRIPTORS,
};
