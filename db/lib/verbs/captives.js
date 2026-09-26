// What a character does to somebody tied up or helpless, both faces: Free,
// Crucify, Shackle and Brand. Each was a web server action in
// web/app/(app)/character/actions/misc.js and still is — that action calls the
// function here, and so does the Discord bot (bot/src/lib/verbs/captives.js).
// See ./common.js for the result shape.
//
// Every target arrives as a KEY (db/lib/targetKey.js) and is refused in the
// blank form when it was a hood: a refusal that prints the name is the
// unmasking itself (web/lib/hereTarget.js#refusalFor).
const { resolveTargetKey, splitTargetKey } = require("../targetKey");
const { isHere, notHereMessage } = require("../presence");
const { addToStack, dropCharacterTag } = require("../tagWrites");
const { applyMood } = require("../mood");
const { expiryForGrant } = require("../grantExpiry");
const { structuresAt } = require("../structures");
const { ambientLine } = require("../ambientLine");
const { INCAPACITATING_SLUGS } = require("../incapacitation");
const { RESTRAINT_SLUGS } = require("../bind");
const { mintCustomCraft, unmintCustomCraft } = require("../customCraftMint");
const { cleanCustomText } = require("../customText");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");

const CRUCIFIX_SLUG = "crucifix";
const CRUCIFIED_SLUG = "crucified";
const FUNDAMENTALIST_SLUG = "fundamentalist";
const DUNGEONS_SLUG = "dungeons";
const SHACKLED_SLUG = "shackled";
const BRANDING_IRON_SLUG = "branding-iron";
const BRAND_SLUG = "brand";
const ACHING_SLUG = "aching";
// web/lib/customCraft.js#CUSTOM_DESCRIPTION_MAX — the brand's words are a
// custom item's description.
const BRAND_DESCRIPTION_MAX = 300;

function refusalFor(key, target) {
  return splitTargetKey(key).kind === "hood" ? "They aren't here." : notHereMessage(target);
}

// The ground a structure stands on, and the channel its ambient line goes to
// (web character/actions/shared.js#loadBuildGround).
function loadGround(prisma, locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, slug: true, indoors: true, attributes: true, discordChannelId: true },
  });
}

// --- Free (web: freeCharacterRequestImpl) ------------------------------------

// Anyone standing there may cut somebody loose — ropes or shackles, Free cuts
// either (Bascinet's ruling on Dungeons).
function freeCharacter(prisma, { character, discordUserId, targetKey }) {
  return asResult(async () => {
    const targetId = await resolveTargetKey(prisma, character, targetKey);
    if (!character.locationId) refuse("You aren't anywhere you could do that.");
    const target = await prisma.character.findFirst({
      where: { id: targetId ?? "", status: "ALIVE" },
      include: {
        tags: {
          where: { tag: { slug: { in: RESTRAINT_SLUGS } } },
          include: { tag: { select: { id: true, name: true } } },
        },
      },
    });
    if (!target || !isHere(character, target, { allowConcealed: true })) refuse(refusalFor(targetKey, target));
    const held = target.tags[0];
    if (!held) refuse(`${target.name} isn't bound.`);
    await prisma.$transaction(async (tx) => {
      for (const row of target.tags) await dropCharacterTag(tx, target.id, row.tagId);
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_free_character",
        targetCharacterId: target.id,
        details: {
          targetCharacterId: target.id,
          targetName: target.name,
          tagId: held.tagId,
          tagName: held.tag.name,
          quantity: held.quantity,
          source: held.source,
          expiresTurn: held.expiresTurn,
        },
      });
    });
    return { touched: [target.id], notify: [{ character: target, text: "Someone freed you." }], name: target.name };
  });
}

// --- Crucify (web: crucifyCharacterRequestImpl) -------------------------------

// A Fundamentalist, a COMPLETE Cross where they stand, and the target standing
// there too. Free like Bind; it kills on a clock. The ambient line names the
// victim and never the actor — a crucifixion is a public example.
function crucifyCharacter(prisma, { character, discordUserId, targetKey, openTurn }) {
  return asResult(async () => {
    const targetId = await resolveTargetKey(prisma, character, targetKey);
    if (!character.locationId) refuse("You aren't anywhere you could do that.");
    if (targetId === character.id) refuse("You can't crucify yourself.");
    if (!character.tags.some((ct) => ct.tag.slug === FUNDAMENTALIST_SLUG)) refuse("Only a Fundamentalist would.");
    const location = await loadGround(prisma, character.locationId);
    const standing = await structuresAt(prisma, character.locationId, { statuses: ["COMPLETE"] });
    const cross = standing.find((s) => s.typeSlug === CRUCIFIX_SLUG) ?? null;
    if (!cross) refuse("There is no cross standing here.");
    const target = await prisma.character.findFirst({
      where: { id: targetId ?? "", status: "ALIVE" },
      select: {
        id: true,
        name: true,
        status: true,
        locationId: true,
        concealed: true,
        discordUserId: true,
        tags: { select: { tag: { select: { slug: true } } } },
      },
    });
    if (!target || !isHere(character, target, { allowConcealed: true })) refuse(refusalFor(targetKey, target));
    if (target.tags.some((ct) => ct.tag.slug === CRUCIFIED_SLUG)) refuse(`${target.name} is already on the cross.`);
    const crucified = await prisma.tag.findUnique({ where: { slug: CRUCIFIED_SLUG } });
    if (!crucified) refuse("The Crucified tag is missing from the catalog — tell a GM.");
    if (!openTurn) refuse("No turn is open.");
    const expiresTurn = await expiryForGrant(prisma, crucified, openTurn);
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: crucified.id,
      tagName: crucified.name,
      expiresTurn,
      structureId: cross.id,
      locationId: location?.id ?? character.locationId,
      locationName: location?.name ?? null,
    };
    await prisma.$transaction(async (tx) => {
      await addToStack(tx, target.id, crucified.id, 1, { source: "EVENT", expiresTurn, stackable: crucified.stackable });
      await applyMood(tx, target.id, { kind: "CRUCIFIED" });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_crucify_character",
        targetCharacterId: target.id,
        details: effect,
      });
    });
    return {
      touched: [target.id],
      notify: [{ character: target, text: "You've been put on the cross." }],
      speak: [{ channelId: location?.discordChannelId ?? null, line: ambientLine(`${target.name} hangs on the cross.`) }],
      name: target.name,
    };
  });
}

// --- Shackle (web: shackleCharacterRequestImpl) -------------------------------

// Turning someone's ropes into shackles, at COMPLETE Dungeons. The escape clock
// restarts, since only an Escape Artist can work shackles loose.
function shackleCharacter(prisma, { character, discordUserId, targetKey, openTurn }) {
  return asResult(async () => {
    const targetId = await resolveTargetKey(prisma, character, targetKey);
    if (!character.locationId) refuse("You aren't anywhere you could do that.");
    if (targetId === character.id) refuse("You can't shackle yourself.");
    const location = await loadGround(prisma, character.locationId);
    const standing = await structuresAt(prisma, character.locationId, { statuses: ["COMPLETE"] });
    const dungeon = standing.find((s) => s.typeSlug === DUNGEONS_SLUG) ?? null;
    if (!dungeon) refuse("There are no dungeons here.");
    const target = await prisma.character.findFirst({
      where: { id: targetId ?? "", status: "ALIVE" },
      select: {
        id: true,
        name: true,
        status: true,
        locationId: true,
        concealed: true,
        discordUserId: true,
        tags: { select: { tagId: true, tag: { select: { slug: true } } } },
      },
    });
    if (!target || !isHere(character, target, { allowConcealed: true })) refuse(refusalFor(targetKey, target));
    if (target.tags.some((ct) => ct.tag.slug === SHACKLED_SLUG)) refuse(`${target.name} is already shackled.`);
    const boundRow = target.tags.find((ct) => ct.tag.slug === "bound");
    if (!boundRow) refuse(`${target.name} isn't bound.`);
    const shackledTag = await prisma.tag.findUnique({ where: { slug: SHACKLED_SLUG } });
    if (!shackledTag) refuse("The Shackled tag is missing from the catalog — tell a GM.");
    if (!openTurn) refuse("No turn is open.");
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: shackledTag.id,
      tagName: shackledTag.name,
      structureId: dungeon.id,
      locationId: location?.id ?? character.locationId,
      locationName: location?.name ?? null,
    };
    await prisma.$transaction(async (tx) => {
      await dropCharacterTag(tx, target.id, boundRow.tagId);
      await addToStack(tx, target.id, shackledTag.id, 1, { source: "EVENT", stackable: shackledTag.stackable });
      await tx.character.update({ where: { id: target.id }, data: { boundSinceTurnNumber: openTurn.number } });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "request_shackle_character",
        targetCharacterId: target.id,
        turnId: openTurn.id,
        details: effect,
      });
    });
    return { touched: [target.id], notify: [{ character: target, text: "You've been shackled." }], name: target.name };
  });
}

// --- Brand (web: brandCharacterRequestImpl) -----------------------------------

// A permanent brand on somebody bound or helpless, with the brander's own words
// on it. The brand is a minted custom row, made OUTSIDE the transaction and
// unwound if the transaction fails.
function brandCharacter(prisma, { character, discordUserId, targetKey, description: rawDescription, openTurn }) {
  return asResult(async () => {
    const targetId = await resolveTargetKey(prisma, character, targetKey);
    if (!character.locationId) refuse("You aren't anywhere you could do that.");
    if (targetId === character.id) refuse("You can't brand yourself.");
    if (!character.tags.some((ct) => ct.tag.slug === BRANDING_IRON_SLUG)) refuse("You don't have a branding iron.");
    const description = cleanCustomText(rawDescription, BRAND_DESCRIPTION_MAX);
    if (!description) refuse("Say what the brand marks them with.");
    const target = await prisma.character.findFirst({
      where: { id: targetId ?? "", status: "ALIVE" },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!target || !isHere(character, target, { allowConcealed: true })) refuse(refusalFor(targetKey, target));
    if (!target.tags.map((ct) => ct.tag.slug).some((slug) => INCAPACITATING_SLUGS.has(slug))) {
      refuse(`${target.name} could still stop you — that's not something you can just do to them.`);
    }
    const [achingTag, brandBase] = await Promise.all([
      prisma.tag.findUnique({ where: { slug: ACHING_SLUG }, select: { id: true, stackable: true, defaultDurationTurns: true } }),
      prisma.tag.findUnique({ where: { slug: BRAND_SLUG } }),
    ]);
    if (!achingTag || !brandBase) refuse("Something's missing from the catalog. Tell a GM.");
    const achingExpiresTurn = await expiryForGrant(prisma, achingTag, openTurn, {
      characterId: target.id,
      where: "brandCharacter",
    });
    let grant;
    try {
      grant = await mintCustomCraft(prisma, brandBase, { description: `A permanent brand. ${description}` });
    } catch (err) {
      refuse(err.message);
    }
    try {
      await prisma.$transaction(async (tx) => {
        await addToStack(tx, target.id, achingTag.id, 1, {
          source: "EVENT",
          expiresTurn: achingExpiresTurn,
          stackable: achingTag.stackable,
        });
        await addToStack(tx, target.id, grant.tag.id, 1, { source: "EVENT", stackable: false });
        await applyMood(tx, target.id, { kind: "BRANDED" });
        await logAudit(tx, {
          actorDiscordUserId: discordUserId,
          actionType: "request_brand_character",
          targetCharacterId: target.id,
          turnId: openTurn?.id ?? null,
          details: { targetName: target.name, description, brandTagId: grant.tag.id },
        });
      });
    } catch (err) {
      await unmintCustomCraft(prisma, grant);
      throw err;
    }
    return {
      touched: [target.id],
      notify: [{ character: target, text: "Somebody held a hot iron to you. It'll never fade." }],
      name: target.name,
    };
  });
}

module.exports = { freeCharacter, crucifyCharacter, shackleCharacter, brandCharacter, BRAND_DESCRIPTION_MAX };
