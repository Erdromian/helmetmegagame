// The verbs a character does to their own sheet, both faces: Destroy, Break
// restraints, Disguise, the Stepstone and the pointer device. Each was a web
// server action in web/app/(app)/character/actions/misc.js and still is — that
// action now resolves the character from the session and calls the function
// here, and the Discord bot (bot/src/lib/verbs/self.js) resolves it from the
// interaction and calls the same one. See ./common.js for the result shape.
//
// `character` is the acting row as the web's requireCharacter loads it (tags
// with their tag and group, location.indoors, role) — the bot's loads more.
const { dropCharacterTag, grantTagSlugs } = require("../tagWrites");
const { presentationStamp } = require("../gmPresentation");
const { rollTagChain } = require("../tagShapes");
const { lockCharacter } = require("../moveLedger");
const { logAudit } = require("../auditLog");
const { rollWithAdvantage } = require("../advantage");
const { resolveBreakRestraints, formatBreakRestraintsRoll, ESCAPE_ARTIST_SLUG } = require("../breakRestraints");
const { RESTRAINT_SLUGS } = require("../bind");
const { DISGUISE_KIT_SLUG, DISGUISE_TURNS, normalizeDisguiseName, mintDisguise, activeDisguise, resolveDisguiseJob } = require("../disguiseMint");
const { namesCharacter } = require("../disguises");
const { heldReasonFor } = require("../intercept");
const { arrivableWhere, isArrivable, isOffRoad } = require("../offRoad");
const { cavingRestrictionsFor, cavingRefusalFor, standingZoneKind } = require("../cavingPass");
const { isPointerDeviceSlug, partnerSlugOf, locatePointerPartner } = require("../pointerMint");
const { FAST_TRAVEL_SLUGS } = require("../mounts");
const { MOTION_SICKNESS_SLUG } = require("../constants");
const { HANDS_TAG_FIELDS, findEquipProblem, handsFor, isLockedOn, equipSfx } = require("../equipSlots");
const { blockerFor, ACT } = require("../incapacitation");
const { canDetectPoison } = require("../poison");
const {
  isSkinlessTags,
  SKINLESS_BARRED_SLOTS,
  SKINLESS_EQUIP_REFUSAL,
  SKINLESS_DISGUISE_REFUSAL,
} = require("../skinless");
const { refuse, asResult, requireFreeMove, fileAutoRoutine, parseCount } = require("./common");

const STEPSTONE_SLUG = "stepstone";
const STEPSTONE_NOT_THERE = "The stone will not carry you there.";
const STEPSTONE_NOT_FROM_HERE = "The stone will not carry you from here.";

// --- Destroy (web: destroyTagRequestImpl) ------------------------------------

// Drops an item you hold (`Tag.removable`). No refund — destroying is throwing
// away. Whatever Tag.removesInto declares is rolled up front and granted once,
// whatever the quantity.
function destroyHeldTag(prisma, { character, discordUserId, tagId, quantity: rawQuantity, openTurn }) {
  return asResult(async () => {
    const held = character.tags.find((ct) => ct.tagId === tagId);
    if (!held) refuse("You don't have that tag.");
    if (!held.tag.removable) refuse("That isn't something you can destroy.");
    const quantity = held.tag.stackable ? (parseCount(rawQuantity, { min: 1, max: held.quantity }) ?? 1) : held.quantity;
    const restore = { tagId: held.tagId, source: held.source, expiresTurn: held.expiresTurn, quantity };
    const aftermathSlugs = rollTagChain(held.tag.removesInto);
    let granted = [];
    await prisma.$transaction(async (tx) => {
      await dropCharacterTag(tx, character.id, tagId, quantity);
      granted = await grantTagSlugs(tx, character.id, aftermathSlugs, openTurn?.number ?? null);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_destroy_tag",
        targetCharacterId: character.id,
        // The details blob is the only record, so it carries what a GM needs to
        // put the tag back AS IT WAS rather than as a fresh grant.
        details: { tagId, tagName: held.tag.name, quantity, granted: granted.map((g) => g.tagName), restore },
      });
    });
    return { touched: [character.id], name: held.tag.name, quantity };
  });
}

// --- Break restraints (web: breakRestraintsRequestImpl) -----------------------

// A Bound character's own struggle against the knots (LESSONS.md §3c). NOT
// gated on ACT — `bound` blocks ACT, so that gate would make this unreachable
// for the one character who needs it. Filed as a ROUTINE already PASSED, and it
// spends the Move win or lose. A success doesn't free them yet: `bound` is
// stamped to lapse at this turn's close.
function breakRestraints(prisma, { character, discordUserId, openTurn }) {
  return asResult(async () => {
    const restraint = character.tags.find((ct) => RESTRAINT_SLUGS.includes(ct.tag.slug));
    if (!restraint) refuse("You aren't restrained.");
    const heldSlugs = character.tags.map((ct) => ct.tag.slug);
    const shackled = restraint.tag.slug === "shackled";
    if (shackled && !heldSlugs.includes(ESCAPE_ARTIST_SLUG)) refuse("Breaking free is impossible.");

    await requireFreeMove(prisma, character, openTurn);
    const turnsElapsed = character.boundSinceTurnNumber == null ? 0 : openTurn.number - character.boundSinceTurnNumber;
    const roll = rollWithAdvantage(character.tags, 6);
    const result = resolveBreakRestraints({ die: roll.die, turnsElapsed, heldSlugs, shackled });
    const rollLine = result.automatic
      ? null
      : formatBreakRestraintsRoll({ die: roll.die, threshold: result.threshold, rolls: roll.rolls });
    const outcome = result.success ? "broke free" : "still bound";

    await prisma.$transaction(async (tx) => {
      if (result.success) {
        await tx.characterTag.updateMany({
          where: { characterId: character.id, tagId: restraint.tagId },
          data: { expiresTurn: openTurn.number },
        });
        await tx.character.update({ where: { id: character.id }, data: { boundSinceTurnNumber: null } });
      }
      await fileAutoRoutine(
        tx,
        character,
        openTurn,
        `Tried to break their restraints${rollLine ? `: ${rollLine}` : ""} — ${outcome}.`,
        "auto:breakRestraints",
        null,
        { presentedAs: await presentationStamp(tx, character.id) },
      );
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_break_restraints",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { automatic: result.automatic, die: roll.die, threshold: result.threshold, success: result.success },
      });
    });

    return {
      touched: [character.id],
      success: result.success,
      line: result.success
        ? result.automatic
          ? "You broke your restraints. This will take effect at the end of the turn."
          : `${rollLine}. You broke your restraints. This will take effect at the end of the turn.`
        : `${rollLine}. ${shackled ? "The shackles hold." : "The knots hold."}`,
    };
  });
}

// --- Disguise (web: disguiseSelfRequestImpl) ---------------------------------

// A false name and face for DISGUISE_TURNS turns. The mention token follows the
// false name (PROXYING.md §6) — that rename is the FACE's to do, best-effort
// and after this returns (`renamed` says it should), because the disguise is
// the tag, not the role, and a Discord hiccup must not cost somebody their kit.
//
// `name` is `{ honorific, firstName, lastName }`, or one typed string. Who the
// name fools is decided later, per reader (db/lib/disguises.js): a real
// character's full name fools the people who know them, whatever title it
// carries. A title is any text; one of the game's own is worn in the form the
// wearer's own gender takes. `job` is any job title, real or made up,
// or empty for none: the job the disguise claims
// (disguiseMint.js#resolveDisguiseJob). A real seat's name wears its estate's
// colour; any other job is worn as typed, with no colour.
function disguiseSelf(prisma, { character, discordUserId, name: rawName, job: rawJob = null, openTurn }) {
  return asResult(async () => {
    if (!character.tags.some((ct) => ct.tag.slug === DISGUISE_KIT_SLUG)) refuse("You have no disguise kit.");
    // Raw musculature passes for nobody else (db/lib/skinless.js).
    if (isSkinlessTags(character.tags)) refuse(SKINLESS_DISGUISE_REFUSAL);
    const name = normalizeDisguiseName(rawName, { gender: character.gender });
    if (!name) refuse("Pick a name to go by.");
    if (name === character.name || namesCharacter(name, character)) refuse("That is already your name.");
    const job = await resolveDisguiseJob(prisma, rawJob);
    // One at a time: two forcedName rows would race.
    const already = await activeDisguise(prisma, character.id);
    if (already) refuse(`You are already going by ${already.tag.forcedName}. Wait for it to wear off.`);
    if (!openTurn) refuse("No turn is open.");
    // Minted OUTSIDE the transaction: its retry loop cannot run inside one.
    const tag = await mintDisguise(prisma, character.id, name, openTurn, { job });
    if (!tag) refuse("Couldn't put that name on. Try another.");
    await logAudit(prisma, {
      actorDiscordUserId: discordUserId,
      actionType: "request_disguise_self",
      targetCharacterId: character.id,
      details: { tagId: tag.id, tagName: tag.name, disguiseName: name, disguiseJob: job?.name ?? null, disguiseJobSlug: job?.slug ?? null, turns: DISGUISE_TURNS },
    });
    return { touched: [character.id], name, job: job?.name ?? null, renamed: true };
  });
}

// --- The Stepstone (web: stepstoneRequestImpl) --------------------------------

// Break the stone and stand somewhere else on the SURFACE. A hold or a Caving
// 1 this turn stops it from underground, as they stop the walk up. The move's
// side effects (applyLocationMoveSideEffects, the caving roll) are the face's
// to run after this returns — `moved` carries what they need.
//
// Never onto or off a place with no road (db/lib/offRoad.js): the Charon has a
// door of its own, and the stone is not it. Both Charons sit in SURFACE zones,
// so the zone test alone let a stone drop somebody straight into orbit.
function stepstone(prisma, { character, discordUserId, locationId, openTurn }) {
  return asResult(async () => {
    const held = character.tags.find((ct) => ct.tag.slug === STEPSTONE_SLUG && ct.quantity > 0);
    if (!held) refuse("You aren't carrying a Stepstone.");
    const heldBy = heldReasonFor(character);
    if (heldBy) refuse(heldBy);
    // The stone only ever lands on the surface, so from underground this is
    // exactly the way up the Die can shut.
    const caving = await cavingRestrictionsFor(prisma, character.id, await standingZoneKind(prisma, character));
    const cavingRefusal = cavingRefusalFor(caving, "SURFACE");
    if (cavingRefusal) refuse(cavingRefusal);

    const targetId = String(locationId ?? "");
    if (!targetId) refuse("Pick somewhere.");
    if (character.locationId === targetId) refuse("You're already there.");
    const location = await prisma.location.findUnique({ where: { id: targetId }, include: { zone: true } });
    if (!location) refuse("There's no such place.");
    // SURFACE only, tested that way round so a new zone kind stays out by default.
    if (location.zone?.kind !== "SURFACE") refuse("The stone will not carry you underground.");
    if (!(await isArrivable(prisma, location.id))) refuse(STEPSTONE_NOT_THERE);

    let fromLocationId = character.locationId;
    const restore = { tagId: held.tagId, source: held.source, expiresTurn: held.expiresTurn, quantity: 1 };
    await prisma.$transaction(async (tx) => {
      await lockCharacter(tx, character.id);
      const stillHeld = await tx.characterTag.findFirst({
        where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
        select: { id: true },
      });
      if (!stillHeld) refuse("You aren't carrying a Stepstone.");
      // Where they stand NOW, under the lock: a second tab may have walked them
      // through the Panic Room since the row was read.
      const standing = await tx.character.findUnique({ where: { id: character.id }, select: { locationId: true } });
      fromLocationId = standing?.locationId ?? null;
      if (fromLocationId === location.id) refuse("You're already there.");
      if (await isOffRoad(tx, fromLocationId)) refuse(STEPSTONE_NOT_FROM_HERE);
      await dropCharacterTag(tx, character.id, held.tagId, 1);
      await tx.character.update({
        where: { id: character.id },
        data: { locationId: location.id, zoneId: location.zoneId, escortedById: null },
      });
      // Nobody follows a stone: the party is cut loose here.
      await tx.character.updateMany({ where: { escortedById: character.id }, data: { escortedById: null } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_stepstone",
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        details: {
          restore,
          fromLocationId,
          toLocationId: location.id,
          toLocationName: location.name,
          toZoneName: location.zone?.name ?? null,
        },
      });
    });
    return {
      locationName: location.name,
      zoneName: location.zone?.name ?? null,
      moved: { characterId: character.id, fromLocationId, toLocationId: location.id, location },
    };
  });
}

// Where the stone may take somebody: every live SURFACE place on the roads but
// where they stand, the list the web's dialog draws (web/lib/itemPools.js).
// Nothing at all from a place with no road, since the stone will not leave one.
async function stepstoneTargets(prisma, character) {
  if (await isOffRoad(prisma, character.locationId)) return [];
  const rows = await prisma.location.findMany({
    where: {
      AND: [{ zone: { kind: "SURFACE" } }, arrivableWhere()],
      ...(character.locationId ? { id: { not: character.locationId } } : {}),
    },
    select: { id: true, name: true, zone: { select: { name: true } } },
    orderBy: [{ zone: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return rows.map((l) => ({ id: l.id, name: l.name, zoneName: l.zone?.name ?? null }));
}

// --- The pointer device (web: readPointerDeviceImpl) --------------------------

function readPointerDevice(prisma, { character }) {
  return asResult(async () => {
    const held = character.tags.find((ct) => isPointerDeviceSlug(ct.tag.slug) && ct.quantity > 0);
    if (!held) refuse("You aren't carrying a pointer device.");
    const partnerSlug = partnerSlugOf(held.tag.slug);
    const locationId = partnerSlug ? await locatePointerPartner(prisma, partnerSlug) : null;
    const location = locationId
      ? await prisma.location.findUnique({ where: { id: locationId }, select: { name: true } })
      : null;
    if (!location) return { line: "The other pointer isn't anywhere the map can see." };
    return { line: `The other pointer is located in ${location.name}.` };
  });
}

// --- Equip and Unequip (web: character/equipActions.js#equipOne / unequipOne) --

// One unit out of a held stack into its own slot. Equipping writes no audit
// row: it costs nothing and is undone in one tap. A refusal thrown inside the
// transaction rolls the write back — the Character row lock serializes every
// equip for this character, since READ COMMITTED alone would let two tabs both
// fit into one slot. `character` needs location (indoors, attributes, name,
// zone.kind) and tags (tag.slug, tag.name).
function equipOneTag(prisma, { character, characterTagId }) {
  return asResult(async () => {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You can't work your hands right now — you're ${blocker.name}.`);
    const held = await prisma.characterTag.findFirst({
      where: { id: characterTagId ?? "", characterId: character.id },
      select: {
        id: true,
        quantity: true,
        equippedQuantity: true,
        tag: { select: { equippable: true, name: true, slug: true, equipSlot: true, fighting: true } },
      },
    });
    if (!held) refuse("You aren't holding that.");
    if (!held.tag.equippable) refuse(`${held.tag.name} isn't something you can equip.`);
    if (held.equippedQuantity >= held.quantity) refuse(`You don't have another ${held.tag.name} to equip.`);
    // A Skinless wears nothing on the body (db/lib/skinless.js); weapons and mounts are fine.
    if (SKINLESS_BARRED_SLOTS.includes(held.tag.equipSlot) && isSkinlessTags(character.tags)) {
      refuse(SKINLESS_EQUIP_REFUSAL);
    }
    // The gates below only fire on the FIRST unit out — none of these slugs is stackable.
    const firstUnitOut = held.equippedQuantity === 0;
    if (
      firstUnitOut &&
      FAST_TRAVEL_SLUGS.has(held.tag.slug) &&
      character.tags.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG)
    ) {
      refuse(`Your stomach won't have it — you can't ride ${held.tag.name}.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${character.id} FOR UPDATE`;
      await tx.characterTag.update({ where: { id: held.id }, data: { equippedQuantity: { increment: 1 }, equipped: true } });
      const worn = await tx.characterTag.findMany({
        where: { characterId: character.id, equippedQuantity: { gt: 0 } },
        select: {
          equippedQuantity: true,
          tag: { select: { name: true, slug: true, equipSlot: true, equipLayer: true, twoHanded: true } },
        },
      });
      // The player's own toggle REFUSES rather than sheds — only an involuntary change sheds (db/lib/tagOps.js).
      const holdings = await tx.characterTag.findMany({
        where: { characterId: character.id, quantity: { gt: 0 } },
        select: { tag: { select: HANDS_TAG_FIELDS } },
      });
      const problem = findEquipProblem(worn, handsFor(holdings));
      if (problem) refuse(problem);
    });
    return { touched: [character.id], equipped: true, name: held.tag.name, sfx: equipSfx(held.tag) };
  });
}

// One unit back. The bomb collar is on by somebody else's hand and off by a key.
function unequipOneTag(prisma, { character, characterTagId }) {
  return asResult(async () => {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) refuse(`You can't work your hands right now — you're ${blocker.name}.`);
    const held = await prisma.characterTag.findFirst({
      where: { id: characterTagId ?? "", characterId: character.id },
      select: { id: true, equippedQuantity: true, tag: { select: { name: true, slug: true } } },
    });
    if (!held) refuse("You aren't holding that.");
    if (held.equippedQuantity <= 0) refuse(`${held.tag.name} isn't equipped.`);
    if (isLockedOn(held.tag)) refuse(`${held.tag.name} is locked on. It needs the Exactor's or the Pusher's ring.`);
    const equippedQuantity = held.equippedQuantity - 1;
    await prisma.characterTag.update({
      where: { id: held.id },
      data: { equippedQuantity, equipped: equippedQuantity > 0 },
    });
    return { touched: [character.id], equipped: equippedQuantity > 0, name: held.tag.name };
  });
}

// --- Lacing a meal (web: actions/poison.js#poisonItemRequestImpl) --------------

// Dosing a meal or drink you're holding. Only somebody who can detect poison is
// told a stack is already tainted or full — for anybody else the dose is
// silently accepted and lost, or lacing would be a free, repeatable detector.
function poisonHeldItem(prisma, { character, discordUserId, poisonTagId, targetTagId, openTurn }) {
  return asResult(async () => {
    const heldPoison = character.tags.find((ct) => ct.tagId === poisonTagId);
    if (!heldPoison) refuse("You don't have that.");
    if (!heldPoison.tag.poison) refuse("That isn't a poison.");
    const heldFood = character.tags.find((ct) => ct.tagId === targetTagId);
    if (!heldFood) refuse("You don't have that.");
    if (!heldFood.tag.consumable || heldFood.tag.poison) refuse("That isn't something you can lace.");
    const foodGroup = heldFood.tag.group?.slug;
    if (foodGroup !== "items-food" && foodGroup !== "items-drink") refuse("That isn't something you can lace.");
    const canDetect = canDetectPoison(character.tags);
    await prisma.$transaction(async (tx) => {
      await lockCharacter(tx, character.id);
      const freshPoison = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId: poisonTagId } },
      });
      if (!freshPoison || freshPoison.quantity < 1) refuse("You don't have that any more.");
      const freshFood = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId: targetTagId } },
      });
      if (!freshFood) refuse("You don't have that any more.");
      const taintedDifferently = Boolean(freshFood.poisonPayload && freshFood.poisonPayload !== poisonTagId);
      if (taintedDifferently && canDetect) refuse("That's already tainted with something else.");
      const stackFull = freshFood.poisonedCount > 0 && freshFood.poisonedCount >= freshFood.quantity;
      if (stackFull && !taintedDifferently && canDetect) refuse("It can't hold any more poison than that.");
      const wasted = taintedDifferently || (stackFull && !taintedDifferently);
      const poisonedCount = wasted ? freshFood.poisonedCount : Math.min(freshFood.poisonedCount + 1, freshFood.quantity);
      if (!wasted) {
        await tx.characterTag.update({ where: { id: freshFood.id }, data: { poisonedCount, poisonPayload: poisonTagId } });
      }
      await dropCharacterTag(tx, character.id, poisonTagId, 1);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_poison_item",
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        details: {
          poisonTagId,
          poisonName: heldPoison.tag.name,
          foodTagId: targetTagId,
          foodName: heldFood.tag.name,
          poisonedCount,
          quantity: freshFood.quantity,
          wasted: wasted || undefined, // GM-only detail, never surfaced to the actor
        },
      });
    });
    return { touched: [character.id], poisonName: heldPoison.tag.name, foodName: heldFood.tag.name };
  });
}

module.exports = {
  STEPSTONE_SLUG,
  equipOneTag,
  unequipOneTag,
  poisonHeldItem,
  destroyHeldTag,
  breakRestraints,
  disguiseSelf,
  stepstone,
  stepstoneTargets,
  readPointerDevice,
};
