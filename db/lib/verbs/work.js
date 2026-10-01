// A day's work at a place that offers it, both faces: Mine (or Gather), Farm,
// Refine, Break In, and Harvest Godflesh. Each was a web server action under
// web/app/(app)/character/actions/ (mine.js, soilery.js, refine.js,
// arelitz.js, misc.js) and still is — that action calls the function here, and
// so does the Discord bot (bot/src/lib/verbs/work.js). Each file's header
// there, and the db/lib module each names, is the rulebook; this is only the
// writer. See ./common.js for the result shape.
const { blockerFor, ACT } = require("../incapacitation");
const { hasAttribute, SOILERY_ATTRIBUTE, GODFLESH_ATTRIBUTE } = require("../locationAttributes");
const { resolveMiningRate, lazyYield, lazyExpression, formatMiningBonusNote } = require("../mining");
const { rollResourceRange } = require("../resourceDelta");
const { applyMoveEffects } = require("../moveEffects");
const { workVerbByKey } = require("../gathering");
const { farmRefusalFor, FARM_PLANTS } = require("../soilery");
const {
  isRefinery,
  refineryInput,
  refineFatigueRefusal,
  refinersThisTurn,
  REFINERY_MAX_WORKERS,
  REFINERY_FULL_MESSAGE,
} = require("../refinery");
const { isDayLongTurn } = require("../turnClock");
const { breakInRefusalFor } = require("../arelitz");
const { livestockInReach } = require("../corpses");
const { rollWithAdvantage } = require("../advantage");
const { gambitModifierTotal } = require("../gambitModifier");
const { lockRoom, addToStack } = require("../tagWrites");
const { lockCharacter } = require("../moveLedger");
const { extractToolFor, extractTurnKey, rollExtraction, extractionDm, GODFLESH_SLUG } = require("../godflesh");
const { expiryForGrant } = require("../grantExpiry");
const { AUTO_MINE_NOTE, AUTO_REFINE_NOTE, FERTILIZED_FIELDS_SLUG, UNRULY_ARELITZ_SLUG } = require("../constants");
const { logAudit } = require("../auditLog");
const { refuse, asResult, requireFreeMove, fileAutoRoutine } = require("./common");

// --- Mine (web: actions/mine.js#mineRequestImpl) ------------------------------

// Paid AT THE PRESS: a day in the seam is a roll against a range, with nothing
// for a GM to arbitrate. The LocationMining row IS the gate (db/lib/mining.js).
function mineHere(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const rate = await resolveMiningRate(prisma, character.id);
    if (!rate.ok) refuse(rate.reason);
    const verb = workVerbByKey(rate.verb);
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You're in no state to work — you're ${blocker.name}.`);
    await requireFreeMove(prisma, character, openTurn);

    // Lazy takes its quarter AFTER the roll, and the stored range is cut the same way.
    const heldSlugs = new Set((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
    const roll = rollResourceRange(rate.expression);
    const value = lazyYield(roll?.value ?? 0, heldSlugs);
    const expression = lazyExpression(rate.expression, heldSlugs);

    let applied = null;
    await prisma.$transaction(async (tx) => {
      await lockCharacter(tx, character.id);
      let action;
      try {
        action = await tx.action.create({
          data: {
            characterId: character.id,
            turnId: openTurn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "ROUTINE",
            moveReviewStatus: "PASSED",
            description: verb.description,
            resourceDelta: value,
            resourceRollExpression: expression,
            resourceRollValue: value,
            zoneId: rate.zoneId ?? character.zoneId ?? null,
            locationId: character.locationId ?? null,
            gmNotes: AUTO_MINE_NOTE,
          },
        });
      } catch (err) {
        // @@unique([characterId, turnId]) is the real gate — two tabs can race requireFreeMove.
        if (err?.code === "P2002") refuse("You've already used your Move this turn.");
        throw err;
      }
      // Pays now; stamping appliedEffects tells the turn-end push to skip it.
      applied = await applyMoveEffects(tx, action);
      await tx.action.update({ where: { id: action.id }, data: { appliedEffects: applied } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_mine",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { actionId: action.id, value, expression, coefficient: rate.locationCoefficient, verb: verb.key },
      });
    });

    const drop = applied?.miningDrop;
    return {
      touched: [character.id],
      line: [
        verb.paid(value),
        drop?.kind === "TAG" ? `You turned up ${drop.tagName}${drop.quantity > 1 ? ` ×${drop.quantity}` : ""}.` : null,
        formatMiningBonusNote(rate),
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

// --- Farm (web: actions/soilery.js#farmRequestImpl) ---------------------------

// A farmer always plants the same field; the wither die resolves at the push.
function farmHere(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const location = character.locationId
      ? await prisma.location.findUnique({
          where: { id: character.locationId },
          select: { id: true, name: true, attributes: true },
        })
      : null;
    if (!hasAttribute(location, SOILERY_ATTRIBUTE)) refuse("There's nothing to farm here.");
    const refusal = farmRefusalFor(character.tags, false);
    if (refusal) refuse(refusal);
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You're in no state to work a field — you're ${blocker.name}.`);
    await requireFreeMove(prisma, character, openTurn);

    const gameConfig = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { farmMaxCrops: true } });
    const planted = gameConfig?.farmMaxCrops ?? FARM_PLANTS;
    const fertilized = character.tags.some((ct) => ct.tag?.slug === FERTILIZED_FIELDS_SLUG);
    const farmPlan = { v: 3, locationId: location.id, planted, fertilized };

    await prisma.$transaction(async (tx) => {
      await lockCharacter(tx, character.id);
      const action = await fileAutoRoutine(
        tx,
        character,
        openTurn,
        `Working the fields: planting ${planted} crops.`,
        "auto:farm",
        null,
        { deferEffects: true, farmPlan },
      );
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_farm",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { farmPlan, locationName: location?.name ?? null, actionId: action.id },
      });
    });
    return {
      touched: [character.id],
      line: `You planted ${planted} crops. The harvest comes in when the turn closes.`,
    };
  });
}

// --- Refine (web: actions/refine.js#refineRequestImpl) ------------------------

// A shift on the Factory floor. Commits the Move now, the cubes come at the
// push. Only so many fit on the floor: checked fast here, and again under an
// advisory lock, which is the check that holds.
function refineHere(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const location = character.locationId
      ? await prisma.location.findUnique({
          where: { id: character.locationId },
          select: { id: true, name: true, attributes: true },
        })
      : null;
    if (!isRefinery(location)) refuse("There's nothing to refine here.");
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You're in no state to work — you're ${blocker.name}.`);
    const input = await refineryInput(prisma, { id: character.id, locationId: character.locationId });
    if (!input) refuse("There's no Godflesh here to refine.");
    await requireFreeMove(prisma, character, openTurn);
    const fatigue = refineFatigueRefusal((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
    if (fatigue) refuse(fatigue);
    if ((await refinersThisTurn(prisma, openTurn.id)) >= REFINERY_MAX_WORKERS) refuse(REFINERY_FULL_MESSAGE);

    await prisma.$transaction(async (tx) => {
      await lockCharacter(tx, character.id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refinery:${openTurn.id}`}))`;
      if ((await refinersThisTurn(tx, openTurn.id)) >= REFINERY_MAX_WORKERS) refuse(REFINERY_FULL_MESSAGE);
      const action = await fileAutoRoutine(
        tx,
        character,
        openTurn,
        "Refining Godflesh on the Factory floor.",
        AUTO_REFINE_NOTE,
        null,
        { deferEffects: true },
      );
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_refine",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { locationName: location?.name ?? null, actionId: action.id, source: input.kind },
      });
    });
    return {
      touched: [character.id],
      line: isDayLongTurn(openTurn)
        ? "You spent the day on the floor. The cubes come off the line when the turn closes."
        : "You worked your shift on the floor. The cubes come off the line when the turn closes.",
    };
  });
}

// --- Break In (web: actions/arelitz.js#breakInArelitzRequestImpl) --------------

// Every unruly arelitz in reach — held, or stashed in a Room here — in
// livestockInReach's row shape (ARELITZ.md §5).
async function unrulyArelitzInReach(prisma, character) {
  const rows = await livestockInReach(prisma, character);
  return rows.filter((r) => r.tagSlug === UNRULY_ARELITZ_SLUG);
}

// A Gambit that rolls now and resolves at the turn push.
function breakInArelitz(prisma, { character, discordUserId, tagId, sourceKey, openTurn }) {
  return asResult(async () => {
    const stable = character.locationId
      ? await prisma.room.findFirst({ where: { locationId: character.locationId, stable: true }, select: { id: true } })
      : null;
    if (!stable) refuse("There's no stable here.");
    const refusal = breakInRefusalFor(character.tags, false);
    if (refusal) refuse(refusal);
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You're in no state to break in an animal — you're ${blocker.name}.`);
    const target = (await unrulyArelitzInReach(prisma, character)).find(
      (r) => r.tagId === tagId && r.sourceKey === sourceKey,
    );
    if (!target) refuse("That arelitz isn't there any more.");
    await requireFreeMove(prisma, character, openTurn);

    const breakInPlan = {
      v: 1,
      kind: target.source.kind,
      ...(target.source.kind === "character" ? { characterId: target.source.id } : { roomId: target.source.id }),
      tagId: target.tagId,
      tagName: target.tagName,
    };
    await prisma.$transaction(async (tx) => {
      // Character first, then room — medical.js's deadlock-avoidance order.
      await lockCharacter(tx, character.id);
      if (target.source.kind === "room") await lockRoom(tx, target.source.id);
      const still =
        target.source.kind === "character"
          ? await tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId: target.source.id, tagId: target.tagId } },
              select: { quantity: true },
            })
          : await tx.roomTag.findUnique({
              where: { roomId_tagId: { roomId: target.source.id, tagId: target.tagId } },
              select: { quantity: true },
            });
      if (!still?.quantity) refuse("That arelitz isn't there any more.");
      const advantage = rollWithAdvantage(character.tags, 6);
      let action;
      try {
        action = await tx.action.create({
          data: {
            characterId: character.id,
            turnId: openTurn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "GAMBIT",
            // Settled by the push's `brokeIn` entry, never by a GM (db/lib/autoGambits.js).
            moveReviewStatus: "SOLVED",
            description: `Breaking in ${target.tagName}.`,
            diceRoll: advantage.die,
            diceModifier: gambitModifierTotal(character.tags, { mood: character.mood }),
            zoneId: character.zoneId ?? null,
            locationId: character.locationId ?? null,
            gmNotes: "auto:break_arelitz",
            breakInPlan,
          },
        });
      } catch (err) {
        if (err?.code === "P2002") refuse("You've already used your Move this turn.");
        throw err;
      }
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_break_arelitz",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { breakInPlan, actionId: action.id },
      });
    });
    return {
      touched: [character.id],
      line: "You start working the arelitz. You'll know how it went at the end of the turn.",
    };
  });
}

// --- Harvest Godflesh (web: misc.js#extractGodfleshRequestImpl) ----------------

// Once a turn, no Move. The claim is the first thing written — a conditional
// updateMany whose WHERE is the check — so two tabs can't both cut. The die is
// DM'd whatever it said: `notify` carries it to the cutter.
function extractGodflesh(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const location = character.locationId
      ? await prisma.location.findUnique({
          where: { id: character.locationId },
          select: { id: true, name: true, attributes: true },
        })
      : null;
    if (!hasAttribute(location, GODFLESH_ATTRIBUTE)) refuse("There's nothing to cut here.");
    if (!extractToolFor(character.tags)) refuse("You need a hatchet, a battle-axe or a chainsaw in your hands.");
    const floored = blockerFor(character.tags, ACT);
    if (floored) refuse(`You're in no state to be swinging anything — you're ${floored.name}.`);
    const turnKey = extractTurnKey(openTurn);
    if (!turnKey) refuse("No turn is open.");

    const result = rollExtraction(character.tags);
    const [godflesh, injury] = await Promise.all([
      prisma.tag.findUnique({ where: { slug: GODFLESH_SLUG }, select: { id: true, name: true, stackable: true } }),
      result.injury
        ? prisma.tag.findUnique({
            where: { slug: result.injury.tagSlug },
            select: { id: true, name: true, defaultDurationTurns: true },
          })
        : null,
    ]);
    if (!godflesh) refuse("The catalog has no Godflesh in it. Tell a GM.");
    const effect = {
      die: result.die,
      tool: result.tool,
      tagId: godflesh.id,
      tagName: godflesh.name,
      quantity: result.quantity,
      injuryTagId: injury?.id ?? null,
      injuryTagName: injury?.name ?? null,
      locationName: location?.name ?? null,
    };
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.character.updateMany({
        where: { id: character.id, OR: [{ extractTurnKey: null }, { extractTurnKey: { not: turnKey } }] },
        data: { extractTurnKey: turnKey },
      });
      if (claimed.count === 0) refuse("You already harvested Godflesh this turn.");
      await addToStack(tx, character.id, godflesh.id, result.quantity, { source: "EVENT", stackable: godflesh.stackable });
      if (injury) {
        await addToStack(tx, character.id, injury.id, 1, {
          source: "EVENT",
          expiresTurn: await expiryForGrant(tx, injury, openTurn, { characterId: character.id, where: "extractGodflesh" }),
        });
      }
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_extract_godflesh",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: effect,
      });
    });
    const got = result.quantity > 0 ? `${result.quantity} Godflesh` : "nothing";
    const hurt = injury ? ` It got hold of you first — ${injury.name}.` : "";
    return {
      touched: [character.id],
      notify: [{ character, text: extractionDm(result, { locationName: location?.name ?? null }) }],
      die: result.die,
      quantity: result.quantity,
      injury: injury?.name ?? null,
      line: `You went out into the marsh and cut. The die came up ${result.die}: ${got}.${hurt}`,
    };
  });
}

module.exports = { mineHere, farmHere, refineHere, breakInArelitz, unrulyArelitzInReach, extractGodflesh };
