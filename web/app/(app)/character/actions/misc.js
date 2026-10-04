// Everything not broken out into its own module: destroy/consume a tag,
// claiming a Desire, changing your name, looting, bind/free/
// crucify/torture, disguise, harm, the Godard Factory, the Bird, the
// Stepstone, and the pointer device readout.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  prisma,
  isDynastyHead,
  isDynastyMember,
  canOpenCrate,
} from "@lifeweb/db";
import { wornRingAccess } from "@lifeweb/db/lib/rings";
import {
  COLLAR_SELECT,
  wearsCollar,
  remoteRefusal,
  unlockRefusal,
  needsNoConsent as collarNeedsNoConsent,
  pickLooseCollar,
  applyCollar,
  createCollarOffer,
  unlockCollar,
  remoteReading,
  detonateCollar,
} from "@lifeweb/db/lib/collar";
import { isLockedCollarSlug } from "@lifeweb/db/lib/collarGlyphs";
import { resourcesOf, isResourcesRow } from "@lifeweb/db/lib/resourceStack";
import { speakAtPlaces } from "@lifeweb/db/lib/inventoryTail";
import { resolveTargetKey, splitTargetKey } from "@lifeweb/db/lib/targetKey";
import { capitalizeFirst } from "@lifeweb/db/lib/concealedIdentity";
import { resolveHereTarget, refusalFor, seenName } from "@/lib/hereTarget";
import { seenById } from "@lifeweb/db/lib/intercept";
import { applyHiddenCures } from "@lifeweb/db/lib/hiddenCures";
import {
  canSendBird as holdsBirdAndLetters,
  isBirdReachableZone,
  deliveryDm,
  sentReceiptDm,
  replyButtonRow,
  canReadLetters,
  BIRD_SLUG,
  BIRD_RESTING,
  birdRestingToday,
} from "@lifeweb/db/lib/bird";
import { sendBirdReply } from "@lifeweb/db/lib/birdReply";
import {
  dmAction,
  DM_ACTION,
} from "@lifeweb/db/lib/dmActions";
import {
  readBlock,
  CANNOT_READ,
} from "@lifeweb/db/lib/reading";
import { CANONICAL_ORIGIN } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import {
  presentedIdentity,
  forcedNameFrom,
} from "@lifeweb/db/lib/presentedIdentity";
import {
  logAudit,
  MAX_REASON_LENGTH,
} from "@/lib/requests";
import { craftMoveCost } from "@/lib/craftBudget";
import { UserError } from "@/lib/actionResult";
import { SFX } from "@lifeweb/db/lib/sfx";
import { autoClaimOutcome, findAutoEvidence } from "@lifeweb/db/lib/desireAutoVerify";
import { describeTurn } from "@/lib/turnFormat";
import { isDaylight } from "@lifeweb/db/lib/turnClock";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { holdLimitRefusal } from "@lifeweb/db/lib/mounts";
import {
  requireFreeMove,
  fileAutoRoutine,
} from "@/lib/moveSpend";
import {
  isTradeable,
} from "@/lib/tagRequests";
import {
  addToStack,
  addToRoomStack,
  creditResources,
  dropCharacterTag,
  grantTagSlugs,
  moveResources,
} from "@/lib/tagEffects";
import { stampLeftOnFloor } from "@lifeweb/db/lib/floorSettle";
import {
  buildSkillAncestry,
  isInflictable,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  isHere,
  notHereMessage,
  rosterHere,
  pickerName,
} from "@/lib/peopleHere";
import {
  applyBind,
  createBindOffer,
  needsNoConsent,
  isBound as isBoundTarget,
  BIND_SELECT,
} from "@lifeweb/db/lib/bind";
import {
  resolveConsumeGrants,
  heldSlugsOf,
  resistSlugsOf,
} from "@/lib/consumeGrants";
import { recordArchiveEvent } from "@/lib/archive";
import {
  ensureCharacterRole,
  sendDm,
  killCharacter,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { revealSurface } from "@lifeweb/db/lib/locationVisits";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { breakSeal } from "@lifeweb/db/lib/paperMint";
import { CAMERA_SLUG } from "@lifeweb/db/lib/photoMint";
import {
  POINTER_DEVICE_KIT_SLUG,
  mintPointerPair,
  attachPointerPair,
} from "@lifeweb/db/lib/pointerMint";
import { WANTED_SLUG } from "@lifeweb/db/lib/wanted";
import {
  TORTURING_EQUIPMENT_SLUG,
  TORTURER_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
  IMPERTURBABLE_SLUG,
  TAG_CATEGORY,
  CORPSE_SENSE_SLUG,
} from "@lifeweb/db/lib/constants";
import { pingCorpseSense } from "@lifeweb/db/lib/corpseSense";
import {
  resolveTorture,
  formatTortureRoll,
  buildTortureEmbed,
} from "@lifeweb/db/lib/torture";
import {
  EXAMINE_SUBJECT_SELECT,
  tortureReadout,
} from "@lifeweb/db/lib/examine";
import { crateWeight } from "@lifeweb/db/lib/depotCrates";
import { packRefusal, crateValue, crateSaleFields, isCrateTag } from "@lifeweb/db/lib/crates";
import { chargeCrateHaul } from "@lifeweb/db/lib/crateHaul";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { RAILYARD_ROOM_SLUG } from "@lifeweb/db/lib/train";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import {
  gambitModifierTotal,
  gambitModifiers,
} from "@lifeweb/db/lib/gambitModifier";
import {
  mergeDishGrants,
  mergeDishCures,
  tasteLine,
} from "@/lib/cooking";
import { formatStack, pickRandomPublicRoom } from "@lifeweb/db/lib/roomStash";
import { markdownName } from "@lifeweb/db/lib/markdownName";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import {
  BASE_BIRD_SENDS_PER_DAY,
  birdAllowanceFrom,
  rookeryCooldown,
} from "@lifeweb/db/lib/rookery";
import {
  structuresAt,
  WORKING_STATUSES,
} from "@lifeweb/db/lib/structures";
import { notifyCharacter } from "@/lib/notifyCharacter";
// The verbs both faces run: the rule is there, and each action below resolves
// the character from the session and applies the web's own tail.
import {
  destroyHeldTag,
  breakRestraints,
  disguiseSelf,
  stepstone,
  readPointerDevice,
} from "@lifeweb/db/lib/verbs/self";
import { disguiseJobChoices } from "@lifeweb/db/lib/disguiseMint";
import { titleWordsFor } from "@lifeweb/db/lib/titles";
import { freeCharacter, crucifyCharacter, shackleCharacter, brandCharacter } from "@lifeweb/db/lib/verbs/captives";
import { extractGodflesh } from "@lifeweb/db/lib/verbs/work";
import {
  evaluateDesireCatalog,
  slotStates,
  desireSlotsNeverLock,
} from "@lifeweb/db/lib/desireGates";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";
import {
  INCAPACITATING_SLUGS,
  FINISHABLE_SLUGS,
  blockerFor,
  ACT,
} from "@lifeweb/db/lib/incapacitation";
import {
  applyMood,
  applyMoodTerms,
  consumeReliefFor,
  consumeSetsMoodToMax,
  setMood,
  dishMoodTerms,
  scaleTerms,
  woundMoodFor,
  MOOD_MAX,
  DESIRE_RELIEF_PER_POINT,
} from "@lifeweb/db/lib/mood";
import {
  HUNGER_MAX,
  unitHungerFor,
  eatMaxFor,
  rawFoodMoodTerms,
} from "@lifeweb/db/lib/hunger";
import { syncHungerDescriptor } from "@lifeweb/db/lib/hungerDescriptor";
import { earnsDined, grantDined } from "@lifeweb/db/lib/dined";
import { GLUTTON_SLUG, HUNGERLESS_SLUG } from "@lifeweb/db/lib/constants";
import {
  NAME_LIMITS,
  formatCharacterName,
} from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";
import { DRUG_STATE_SLUGS } from "@/lib/drugHighs";
import { autoMovesOpen } from "@lifeweb/db/lib/turnGate";
import {
  requireCharacter,
  revalidateAll,
  parseCount,
  lockCharacter,
  resolveCraftMove,
  spendCraftMove,
  craftLedgerEntry,
} from "./shared.js";

// --- Destroy -------------------------------------------------------------

// Drops an item you hold (`Tag.removable`). No refund, no ⬢ field — destroying is throwing away; a cure is Heal's job (TAGS.md §5).
export async function destroyTagRequestImpl({
  tagId,
  quantity: rawQuantity,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/self.js's, shared with Discord's /item destroy.
  const result = await destroyHeldTag(prisma, {
    character,
    discordUserId: session.discordUserId,
    tagId,
    quantity: rawQuantity,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return {};
}

// Consuming: the tag comes off and whatever Tag.consumesInto declares goes
// on. Always exactly ONE unit, so a stack feeds several times. No resource
// cost — the item already cost ⬢ to make. A grant may be conditional on
// what's already held, so the slug list runs through resolveConsumeGrants.
// Breaking a seal. Opening a letter is Consume because that is what it is —
// the seal is used up and cannot be put back — and routing it through the same
// button means a player never has to learn a second verb for it.
//
// Two things come out: the letter, exactly as it was written, and the spent
// envelope. The envelope is the point of the whole mechanism: it is evidence
// that somebody opened this, and whose wax was on it when they did.
async function breakSealRequestImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();

  let opened;
  await prisma.$transaction(async (tx) => {
    opened = await breakSeal(tx, character.id, held.tag);

    const effect = {
      tagId: held.tagId,
      tagName: held.tag.name,
      // What the row is called NOW, so an Undo can find its way back.
      openedName: opened.paper.name,
      sealMark: held.tag.sealMark ?? null,
      envelopeTagId: opened.envelope?.id ?? null,
      envelopeName: opened.envelope?.name ?? null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_break_seal",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, name: opened.paper.name, sfx: SFX.SEAL_BREAK };
}

// Pointing the camera at nothing. The other thing you can do with an Instant
// Camera — 📸-reacting somebody's message is the real one, and that one is
// free (bot/src/events/messageReactionAdd.js). This path spends the camera and
// hands back a print of nobody.
//
// It takes its own road out of consumeTagRequestImpl for breakSeal's reason:
// the ordinary path reads `consumesInto`, which names CATALOG slugs, and a
// photo is a runtime row no slug in docs/tags.yaml can ever name.
async function pointerDeviceKitRequestImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();

  // Minted BEFORE the transaction, for the same reason the camera's print
  // is: createWithRetry's name-collision retry cannot survive inside one
  // (db/lib/pointerMint.js). If the transaction below rolls back, both
  // halves are left minted but unheld, which the next Restart Game sweeps
  // (they carry `ephemeral: true`).
  const pair = await mintPointerPair(prisma, held.tag);

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await attachPointerPair(tx, character.id, pair);

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: {
        tagId: held.tagId,
        tagName: held.tag.name,
        restore: { tagId: held.tagId, source: held.source, expiresTurn: held.expiresTurn, quantity: 1 },
        // Both runtime rows, the same reason the camera's print records
        // photoTagId — a GM's Undo has to delete these, not just re-grant
        // the kit.
        pointerTagIds: [pair.a.id, pair.b.id],
      },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, line: "You open the kit. Two devices, always pointing at each other." };
}

// Cracking a crate — a Depot shipment, or one a player packed themselves
// (packageItemsRequestImpl). It used to be a button on /depot; it is a
// Consume now, which is both one verb fewer to learn and the only thing that
// made sense once a crate walked out of the landing pad and got carried
// somewhere else entirely. See docs/systemdocs/DEPOT.md §0e.
//
// Only the Merchant's or the Baron's ring opens one, sealed or not
// (depotCrates.js#canOpenCrate), checked here rather than trusted from
// whatever surface offered the button. The catalog's crate props open on the
// ordinary path and anybody may open them.
//
// A crate's real contents live in `crateContents`, not `consumesInto`: the
// ordinary consume path resolves a grant through resolveConsumeGrants and
// grantTagSlugs, and grantTagSlugs knows nothing whatsoever about poison. A
// poisoned line item packed into a crate has to come back out poisoned
// (LAUNDERING CLASS, fix round M4), or packing it was a free bleach.
async function openCrateRequestImpl({ session, character, held }) {
  const crate = held.tag;
  const contents = Array.isArray(crate.crateContents) ? crate.crateContents : null;
  if (!contents) throw new UserError("That isn't a crate.");
  if (!canOpenCrate(wornRingAccess(character.tags))) {
    throw new UserError("It's locked. Only the Merchant's or the Baron's ring opens it.");
  }

  const inner = await prisma.tag.findMany({ where: { id: { in: contents.map((c) => c.tagId).filter(Boolean) } } });

  const openTurn = await getOpenTurn();
  const byId = new Map(inner.map((t) => [t.id, t]));

  // ⬢ ride the crate in the field the ordinary consume path already grants,
  // so nothing here has to know how the shipment was packed.
  const resourcesGranted = crate.consumesIntoResources ?? 0;

  const granted = [];
  // A non-stackable ware already held can't go on the sheet (one per
  // character), so it's set down in a public room here instead. It used to be
  // skipped, which deleted it with the crate — a Merchant buying a second
  // suit of armour to hand on lost it.
  const dropped = [];
  let spareRoom = null;
  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    // Double-fire guard (gate review): a crate is always quantity 1, and two
    // concurrent opens would otherwise both grant contents before the
    // second's own crate-row delete aborts the whole transaction on a raw
    // engine error. Same re-read-under-the-lock shape the poison actions
    // use, and the same refusal they give.
    const freshCrate = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId: character.id, tagId: held.tagId } },
    });
    if (!freshCrate || freshCrate.quantity < 1) {
      throw new UserError("You don't have that any more.");
    }
    const heldIds = new Set(
      (
        await tx.characterTag.findMany({
          where: { characterId: character.id, tagId: { in: [...byId.keys()] } },
          select: { tagId: true },
        })
      ).map((ct) => ct.tagId),
    );
    // Units of a non-stackable line that can't go on the sheet: all of them if
    // one is already held, else all but the first. Crates aggregate by tag, so
    // two separate orders of one pistol can share a line.
    const sparesOf = (line, tag) =>
      tag.stackable ? 0 : Math.max(0, (line.quantity ?? 1) - (heldIds.has(tag.id) ? 0 : 1));
    const spare = contents.find((line) => {
      const tag = byId.get(line.tagId);
      return tag && sparesOf(line, tag) > 0;
    });
    if (spare) {
      spareRoom = await pickRandomPublicRoom(tx, character.locationId);
      // Refuse rather than lose it: the crate stays shut until they're
      // somewhere with a floor.
      if (!spareRoom) {
        throw new UserError(
          `You already carry ${byId.get(spare.tagId).name}, and there's nowhere here to set the spare down.`,
        );
      }
    }
    for (const line of contents) {
      const tag = byId.get(line.tagId);
      // A ware pruned out of the catalog between landing and opening is gone.
      // Skipping it beats throwing: the rest of the crate should still open.
      if (!tag) continue;
      const expiresTurn = await expiryForGrant(tx, tag, openTurn, {
        characterId: character.id,
        where: "openCrate",
      });
      // The laundering fix: what packageItemsRequestImpl's own manifest
      // stored for this line rides onto the landing row, sheet or floor.
      const poisonedCount = line.poisonedCount ?? 0;
      const poisonPayload = line.poisonPayload ?? null;
      const spares = sparesOf(line, tag);
      const landed = tag.stackable ? line.quantity : (line.quantity ?? 1) - spares;
      if (landed > 0) {
        await addToStack(tx, character.id, tag.id, landed, {
          source: "EVENT",
          stackable: tag.stackable,
          expiresTurn,
          // Poison rides the sheet copy first; a non-stackable unit is one thing.
          poisonedCount: Math.min(poisonedCount, landed),
          poisonPayload,
        });
        granted.push({ tagId: tag.id, name: tag.name, quantity: landed });
      }
      if (spares > 0) {
        const sparePoisoned = Math.max(0, poisonedCount - Math.max(0, landed));
        await addToRoomStack(tx, spareRoom.id, tag.id, spares, {
          expiresTurn,
          poisonedCount: sparePoisoned,
          poisonPayload: sparePoisoned > 0 ? poisonPayload : null,
        });
        // The spare is the character's own, set down for want of a hand (CARRY.md §6a).
        await stampLeftOnFloor(tx, spareRoom.id, [tag.id]);
        dropped.push({ tagId: tag.id, name: tag.name, quantity: spares, roomId: spareRoom.id, roomName: spareRoom.name });
      }
    }

    if (resourcesGranted > 0) {
      await creditResources(
        tx,
        { kind: "character", id: character.id, name: character.name },
        resourcesGranted,
      );
    }

    await dropCharacterTag(tx, character.id, crate.id, null);

    const effect = {
      crateTagId: crate.id,
      crateName: crate.name,
      sealed: crate.sealedShipping,
      granted,
      dropped,
      resourcesGranted,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_crate_open",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });

    // The crate is a one-off catalog row and this was the last of it.
    const stillHeld = await tx.characterTag.count({ where: { tagId: crate.id } });
    const stillStashed = await tx.roomTag.count({ where: { tagId: crate.id } });
    if (stillHeld === 0 && stillStashed === 0) {
      await tx.tag.delete({ where: { id: crate.id } }).catch(() => {});
    }
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  const spareLine = dropped.length
    ? `You already carry ${dropped.map((d) => d.name).join(", ")}, so the spare is set down in ${spareRoom.name}.`
    : undefined;
  return { granted, dropped, resourcesGranted, line: spareLine, sfx: SFX.CRATE };
}

const RAVENHEART_MAP_SLUG = "ravenheart-map";

async function ravenheartMapRequestImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    // Same double-submit shape as Stepstone/openCrate: re-read under the
    // lock rather than trust the row loaded before this transaction opened.
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You don't have that any more.");
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await revealSurface(tx, character.id);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { tagId: held.tagId, tagName: held.tag.name, restore, revealedSurface: true },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, line: "The whole surface of Ravenheart unfolds before you." };
}

const BOX_OF_JUNK_SLUG = "box-of-junk";

async function boxOfJunkRequestImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
  };
  // 0-4 inclusive, randomly — consumesIntoResources (Int?) has no range
  // shape, so the roll happens here rather than in the catalog.
  const resourcesGranted = Math.floor(Math.random() * 5);

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You don't have that any more.");
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    if (resourcesGranted > 0) {
      await creditResources(tx, { kind: "character", id: character.id, name: character.name }, resourcesGranted);
    }
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { tagId: held.tagId, tagName: held.tag.name, restore, resourcesGranted },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return {
    ok: true,
    line:
      resourcesGranted > 0
        ? `You got ${resourcesGranted} ⬢.`
        : "You got nothing.",
  };
}

// consumeChoice (the Instrument Kit): the PLAYER picks what it becomes, where a
// consumesInto oneOf would roll it. The pick is checked against the catalog row here,
// never trusted — a server action is a public endpoint. Self only.
async function consumeChoiceRequestImpl({ session, character, held, choice }) {
  const options = held.tag.consumeChoice ?? [];
  if (typeof choice !== "string" || !options.includes(choice)) {
    throw new UserError("[PLACEHOLDER: pick one of the kit's options]");
  }
  const openTurn = await getOpenTurn();
  const restore = { tagId: held.tagId, source: held.source, expiresTurn: held.expiresTurn, quantity: 1 };
  let granted = [];
  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: held.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You don't have that any more.");
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    granted = await grantTagSlugs(tx, character.id, [choice], openTurn?.number ?? null);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: { tagId: held.tagId, tagName: held.tag.name, restore, chosen: choice, granted: granted.map((g) => g.tagName) },
    });
  });
  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true };
}

// `quantity` is the Consume slider (the Soilery Rework doc): how many of a stack to eat or use at
// once. Only an ordinary consume, on yourself, of a stack takes more than one; every special road
// below opens one thing at a time. Food is also capped by hunger (db/lib/hunger.js#eatMaxFor).
export async function consumeTagRequestImpl({ tagId, targetCharacterId, choice, quantity: rawQuantity }) {
  const { session, character } = await requireCharacter();

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");
  const n = parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1;
  if (n > 1) {
    const special =
      held.tag.consumeChoice?.length ||
      held.tag.paperKind === "SEALED" ||
      isCrateTag(held.tag) ||
      [CAMERA_SLUG, POINTER_DEVICE_KIT_SLUG, RAVENHEART_MAP_SLUG, BOX_OF_JUNK_SLUG, MULLIGAN_SLUG, STEPSTONE_SLUG].includes(held.tag.slug);
    if (special || !held.tag.stackable || held.tag.administerSkill) throw new UserError("One at a time.");
    if (n > held.quantity) throw new UserError("You don't have that many.");
  }

  if (held.tag.consumeChoice?.length) {
    if (targetCharacterId && targetCharacterId !== character.id) {
      throw new UserError("[PLACEHOLDER: the kit can only be opened yourself]");
    }
    return consumeChoiceRequestImpl({ session, character, held, choice });
  }

  // Breaking a seal takes its own road out of here. The ordinary consume path
  // below reads `consumesInto`, which names CATALOG SLUGS — and the letter
  // inside a sealed one is a runtime row that no slug in docs/tags.yaml can
  // ever name. See docs/systemdocs/PAPERWORK.md.
  if (held.tag.paperKind === "SEALED") {
    return breakSealRequestImpl({ session, character, held });
  }

  // An Instant Camera is never spent — it only takes pictures through the 📸
  // reaction. Refused here too, because a row synced before `consumable` came
  // off would otherwise fall through and eat the camera for nothing.
  if (held.tag.slug === CAMERA_SLUG) {
    throw new UserError("That tag can't be consumed.");
  }

  // And a Pointer Device Kit, for the same reason again: it mints two linked
  // runtime rows (db/lib/pointerMint.js), not a catalog grant.
  if (held.tag.slug === POINTER_DEVICE_KIT_SLUG && (!targetCharacterId || targetCharacterId === character.id)) {
    return pointerDeviceKitRequestImpl({ session, character, held });
  }

  // And a crate, for the same reason again: what falls out of one is a list
  // of tag IDs printed on the crate at packing or landing, not catalog slugs,
  // and it also has a lock the ordinary path knows nothing about. Only for
  // opening it yourself — administering a crate to someone else is not a
  // thing (it has no `cures` and isn't `administerable`), so that case falls
  // through to the ordinary path below, which already refuses it with the
  // same message any other non-curative item gets.
  //
  // Only a crate with a manifest takes this road. The catalog's three crates
  // (crates.js#CATALOG_CRATE_SLUGS) are crates to every other rule, but what
  // falls out of them is written in `consumesInto`, so they open on the
  // ordinary path below.
  if (isCrateTag(held.tag) && Array.isArray(held.tag.crateContents) && (!targetCharacterId || targetCharacterId === character.id)) {
    return openCrateRequestImpl({ session, character, held });
  }

  // The Ravenheart Map's own road out: it reveals every SURFACE Location at
  // once (db/lib/locationVisits.js#revealSurface), which no `consumesInto`
  // chain can name. Self only — nobody's asked for handing someone else the
  // map through a dose.
  if (held.tag.slug === RAVENHEART_MAP_SLUG && (!targetCharacterId || targetCharacterId === character.id)) {
    return ravenheartMapRequestImpl({ session, character, held });
  }

  // Box of Junk grants a ROLLED ⬢ amount — consumesIntoResources (schema:
  // Int?) is a flat number, not a range, so "0-4 randomly" needs its own
  // road out the same way the map's does.
  if (held.tag.slug === BOX_OF_JUNK_SLUG && (!targetCharacterId || targetCharacterId === character.id)) {
    return boxOfJunkRequestImpl({ session, character, held });
  }

  // The Mulligan Potion is the one consumable that cannot be drunk from here:
  // it needs a name typed into it, so its road out is changeNameRequestImpl,
  // opened from the tag's own tooltip. Without this the generic path would
  // spend the bottle on nothing at all — it has no `consumesInto`.
  // MULLIGAN_SLUG is declared beside that function, further down this file.
  if (held.tag.slug === MULLIGAN_SLUG) {
    throw new UserError("Use the Mulligan button.");
  }

  // The Stepstone cannot be drunk from here, for the reason the Mulligan
  // gives: the generic path below reads `consumesInto`, and it does not turn
  // into a tag at all. It asks where you are going, so it comes in through
  // its own button on the Actions grid and spends the bottle there. Without
  // this branch the generic path would swallow it for nothing.
  if (held.tag.slug === STEPSTONE_SLUG) {
    throw new UserError("Use the Stepstone button.");
  }

  // Administerable: the item's `cures` intersects what a target holds, or
  // it's flagged `administerable` outright (Mercy, which cures nothing on a
  // list but stabilizes all the same) — never a bare force-feed. Hoisted
  // once here: the targeted-administer gate below and the cure-application
  // pass further down both read this same list, and used to compute it
  // twice.

  // A COOKED DISH (docs/systemdocs/COOKING.md) is the one consumable whose
  // effects are not written on its own row. It carries `cookedFrom` — the
  // ingredient slugs the cook slotted — and what it does is worked out from
  // those NOW, off the live catalog, rather than from a snapshot taken when
  // it was cooked. web/lib/cooking.js says why at length.
  //
  // findMany does not preserve the order it was asked for, and slot order is
  // what the taste sentence reads in, so the rows are put back in
  // `cookedFrom` order by hand. A slug that no longer resolves (an ingredient
  // pruned out of the catalog) is dropped rather than throwing: the dish is
  // already in somebody's hands and refusing to let them eat it would be the
  // worse answer.
  const cookedFrom = held.tag.cookedFrom ?? [];
  let ingredientTags = [];
  if (cookedFrom.length) {
    const rows = await prisma.tag.findMany({ where: { slug: { in: cookedFrom } } });
    const bySlug = new Map(rows.map((t) => [t.slug, t]));
    ingredientTags = cookedFrom.map((slug) => bySlug.get(slug)).filter(Boolean);
  }
  // ONE call, never one per ingredient: resolveConsumeGrants tracks what the
  // eater WILL hold across the list it is handed, which is how the drinking
  // ladder resolves against a rung the same swallow just granted. Two calls
  // would each resolve against a stale sheet and double-grant.
  const resolveAgainst = ingredientTags.length
    ? { ...held.tag, ...mergeDishGrants(held.tag, ingredientTags) }
    : held.tag;
  // What the dish CURES, unioned across the ingredients that opted in with
  // `cooked.cures: true` — a drunk tonic works in a stew, a dressing does
  // not. See web/lib/cooking.js#mergeDishCures and COOKING.md §5.
  const dishCures = mergeDishCures(held.tag, ingredientTags);

  // For a dish this is the INGREDIENTS' cure list, not the plate's — the
  // administerable gate below and the cure pass further down both read it.
  const curesList = dishCures.cures;

  // Administering to someone else (the medical pass, TAGS.md §5c): the item
  // leaves the ACTOR's hand, but every grant it makes — the cure below
  // included — lands on `target`, which defaults to the actor. Self-consume
  // is deliberately not ACT-gated (TAGS.md §5f); administering someone else
  // is, since it's an act done TO them rather than to your own sheet.
  // A key rather than a bare id (db/lib/targetKey.js), so "character:<id>" and
  // "hood:<token>" both name somebody. splitTargetKey is what tells self from
  // other now — the old bare comparison would read "character:<me>" as another
  // person and ACT-gate a self-consume.
  const posted = splitTargetKey(targetCharacterId ?? "");
  const administered = Boolean(posted.value) && !(posted.kind === "character" && posted.value === character.id);
  let target = character;
  if (administered && n > 1) throw new UserError("One at a time.");
  if (administered) {
    const blocker = blockerFor(character.tags, ACT);
    if (blocker) {
      throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
    }
    if (!character.locationId) {
      throw new UserError("You aren't anywhere you could treat someone.");
    }
    // A hood costs you your name, not your right to be handed a cure by the
    // person standing next to you. resolveHereTarget throws the blank refusal
    // for a token, so a "no" never prints the name behind the mask.
    const found = await resolveHereTarget(character, targetCharacterId, {
      status: "ALIVE",
      select: {
        id: true,
        name: true,
        concealed: true,
        locationId: true,
        status: true,
        buriedAt: true,
        discordUserId: true,
        // A food handed to somebody else still stops at their full meter.
        hungerValue: true,
        // `resists` (M4): resolveConsumeGrants below needs the TARGET's own
        // resist-traits, administered or self — Iron Constitution shrugging
        // off a poison lands on whoever holds it, not whoever swallowed it.
        tags: { include: { tag: { select: { id: true, slug: true, name: true, resists: true } } } },
      },
    });
    const targetSlugs = new Set(found.tags.map((ct) => ct.tag.slug));
    const intersects = curesList.some((slug) => targetSlugs.has(slug));
    if (!intersects && !held.tag.administerable) {
      // Never their name when a mask, or a face you don't know, is what you
      // are looking at (seenName).
      throw new UserError(`${await seenName(character, found.id)} doesn't have anything that ${held.tag.name} can treat.`);
    }
    target = found;
  }

  const openTurn = await getOpenTurn();

  // administerSkill gates EVERY consume of the item — self included
  // (fitting a prosthetic needs medical-expert even on your own leg). A
  // different question from the ACT gate above, which self stays exempt
  // from and this never is — except here: this consume FILES A MOVE (below),
  // and a Bound or Paralyzed character cannot file one even for themselves
  // (review fix, M2). `administered`'s own ACT check above already covers
  // the targeted branch; self needs its own, checked only once (an
  // administered consume never reaches this un-ACT-gated by definition).
  //
  // M2 lands the fee: a gated consume also costs 1/2 Move from the medical
  // family (fitting is surgery, and the Expert's scarce Move is the fee —
  // this replaces any separate fitting ⬢). A synthetic tag prices the fixed
  // half, since the fee is a flat administer cost, never the ITEM's own
  // craft requirementTurns (Mercy's craft cost has nothing to do with
  // fitting it onto somebody). Priced and checked here for a fast fail, and
  // spent for real inside the transaction below, same as every other budget
  // craft. With no turn open there is nothing to bill and nothing to file —
  // same posture as a heal's priceHeal returning null — so the fee simply
  // does not apply rather than refusing "No turn is open."
  let administerMoveCost = null;
  if (held.tag.administerSkill) {
    const catalog = await prisma.tag.findMany({
      select: { id: true, slug: true, name: true, parentTagId: true },
    });
    const skillTag = catalog.find((t) => t.slug === held.tag.administerSkill);
    const ancestry = buildSkillAncestry(catalog);
    const satisfied = satisfiedSkillIds(character.tags.map((ct) => ct.tagId), ancestry);
    if (!skillTag || !satisfied.has(skillTag.id)) {
      throw new UserError(`You need ${skillTag?.name ?? "the right training"} to use ${held.tag.name}.`);
    }
    if (openTurn) {
      // The ACT gate belongs exactly here, not outside this branch (review
      // fix, round 3): it exists because filing the Move below is what a
      // Bound or Paralyzed character can't do even to themselves — self-
      // consume is otherwise ACT-exempt (TAGS.md §5f). With no turn open,
      // nothing files, so the gate has nothing to be about.
      if (!administered) {
        const blocker = blockerFor(character.tags, ACT);
        if (blocker) {
          throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
        }
      }
      administerMoveCost = craftMoveCost(
        // Half a Move, flat, and deliberately unrelated to what the item cost
        // to make (MEDICAL.md §2).
        { requirementTurns: 0.5 },
        { quantity: 1, family: "medical" },
      );
      await resolveCraftMove(character, openTurn, administerMoveCost);
    }
  }

  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: n,
  };

  // The drinking ladder (docs/systemdocs/BREWING.md). Only status tags carry
  // an `escalatesInto`, so this is a handful of rows however big the catalog
  // gets — and it has to come from the CATALOG rather than from the tags this
  // character holds, because the walk needs the rungs ABOVE the one they are
  // standing on, which by definition they do not have yet.
  const ladderRows = await prisma.tag.findMany({
    where: { escalatesInto: { not: null } },
    select: { slug: true, escalatesInto: true },
  });
  const ladder = new Map(ladderRows.map((t) => [t.slug, t.escalatesInto]));

  // Iron Constitution's sidecar (M4): every `resists` slug the TARGET's own
  // held tags carry, so a grant that lands on that list shrugs off — the
  // trait is about the constitution swallowing it, not who administered it.
  const resistSlugs = resistSlugsOf(target.tags);


  // One resolve per unit eaten, against what the eater WILL hold after the
  // ones before it — so the third drink climbs the ladder the first two
  // started, and a status granted once is not granted again.
  const grantSlugs = [];
  const climbedFrom = [];
  const resistedSlugs = [];
  const grantDurations = {};
  let resourcesGranted = 0;
  let tagPointsGranted = 0;
  {
    const willHold = heldSlugsOf(target.tags);
    for (let i = 0; i < n; i++) {
      const g = resolveConsumeGrants(resolveAgainst, willHold, ladder, resistSlugs);
      grantSlugs.push(...g.slugs);
      climbedFrom.push(...g.removes);
      resistedSlugs.push(...g.resisted);
      Object.assign(grantDurations, g.durations);
      resourcesGranted += g.resources;
      tagPointsGranted += g.tagPoints;
      for (const slug of g.removes) willHold.delete(slug);
      for (const slug of g.slugs) willHold.add(slug);
    }
  }

  // Hunger (db/lib/hunger.js). What ONE unit restores: a dish sums its own
  // mealHunger plus every ingredient's; anything else is its own figure (0
  // for anything that isn't food at all). At a full meter food is refused
  // (unless Glutton), and the slider stops at the unit that fills it. The
  // Hungerless may eat, but food does nothing for them — no hunger, no mood.
  const perUnit = unitHungerFor(held.tag, ingredientTags);
  const isFood = perUnit > 0;
  const targetSlugs = heldSlugsOf(target.tags);
  const hungerless = targetSlugs.has(HUNGERLESS_SLUG);
  const glutton = targetSlugs.has(GLUTTON_SLUG);
  const eatRefusal = (hungerValue) => {
    if (!isFood) return null;
    const max = eatMaxFor({ hungerValue, perUnit, held: n, glutton, hungerless });
    if (max === 0) return "You're too full to eat that.";
    if (max < n) return "You can't eat that many right now.";
    return null;
  };
  {
    const refusal = eatRefusal(target.hungerValue ?? HUNGER_MAX);
    if (refusal) throw new UserError(refusal);
  }
  // A lavish meal leaves the eater Dined for one in-game day (db/lib/dined.js), and the length of a day is the GM's
  // turnsPerDay, so the config is read only when there is a Dined to grant.
  const dined = earnsDined(held.tag, { hungerless });
  const dinedConfig = dined
    ? await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { turnsPerDay: true, turnLengthHours: true } })
    : null;

  // The rungs the climb clears — Tipsy coming off as Wasted goes on. Built
  // INSIDE the transaction below, once the poisoned draw is known (fix
  // round, M4: the poison's own `removes` merges in there too) — snapshotted
  // the same way `cleared` normally is, so an Undo puts the drinker back
  // exactly where they were rather than leaving them Wasted with no Tipsy
  // underneath.

  // What this does to the dial (docs/systemdocs/MOOD.md), and the two rules
  // are different enough to be two functions.
  //
  // A DISH sums: its own small figure plus every ingredient's, harm and
  // relief kept apart so only the harm half is ever scaled. Saffron makes the
  // best thing in Ravenheart and feces the worst, and both are the
  // ingredient's doing rather than the recipe's.
  //
  // EVERYTHING ELSE takes the largest single figure, never a sum — Bliss is
  // one drink, and Sweets is a treat rather than a treat plus a meal.
  const isDish = ingredientTags.length > 0 || held.tag.mealMood != null;
  const hungerRestored = hungerless ? 0 : perUnit * n;
  // Food does nothing to a Hungerless character's dial either (the doc).
  const foodMood = hungerless && isFood;
  const moodTerms = foodMood
    ? null
    : scaleTerms(
        isDish
          ? dishMoodTerms(held.tag.mealMood, ingredientTags.map((t) => t.cooked?.mood ?? 0))
          : isFood
            ? rawFoodMoodTerms(held.tag.cooked?.mood ?? 0)
            : null,
        n,
      );
  // Heroin and Changa do not move the dial, they put it at the top. A delta
  // cannot say that -- +82 from a frightened character still lands short of
  // Ecstatic -- so these two skip the relief arithmetic entirely.
  const moodToMax = !foodMood && !moodTerms && consumeSetsMoodToMax(held.tag.slug);
  const moodRelief = foodMood || moodTerms || moodToMax ? 0 : consumeReliefFor(held.tag.slug, grantSlugs) * n;

  // What the eater is told, and the only thing they are told: a dish names
  // its tastes and never its ingredients. `line` is returned to the client,
  // which prefers it over the generic "It used up." (noticeLines.js). The
  // meal's own taste (Tag.mealTaste/mealTasteForm) reads FIRST, then each
  // additional ingredient's — COOKING.md §A6.
  const line = isDish
    ? tasteLine(held.tag.name, [
        { taste: held.tag.mealTaste ?? "", adjective: held.tag.mealTasteForm === "adjective" },
        ...ingredientTags.map((t) => ({
          taste: t.cooked?.taste ?? "",
          adjective: t.cooked?.tasteForm === "adjective",
        })),
      ], n)
    : null;
  let grantedNames = [];
  let resourcesGrantedOut = 0;

  // Cure application (the medical pass, TAGS.md §5c): every cured slug the
  // TARGET actually holds — not just the first, since one item (white-honey,
  // eventually) can cure several things a patient holds at once. `curesList`
  // itself was hoisted above, at the administer gate.
  const curedHeld = curesList.length
    ? target.tags.filter((ct) => curesList.includes(ct.tag.slug))
    : [];

  await prisma.$transaction(async (tx) => {
    // Deadlock avoidance (review fix, round 3): this transaction can lock
    // both the actor's row (the Move billing below) and the target's (the
    // patient-race re-check further down) — lock them in sorted-id order up
    // front, not actor-then-target, or two actors administering to each
    // other at the same instant lock in opposite orders and deadlock
    // (Postgres surfaces an unresolved cycle as a raw 40P01, not a
    // UserError).
    const lockIds =
      administered && target.id !== character.id
        ? [character.id, target.id].sort()
        : [character.id];
    for (const id of lockIds) await lockCharacter(tx, id);

    if (administerMoveCost) {
      // Re-checked here (review fix, round 3 — this was the one billed path
      // without an in-transaction gate check): resolveCraftMove checked it
      // outside, but that read and this spend are not atomic with each
      // other, the same reasoning craftRequestImpl's spill path and
      // healCharacterRequestImpl's own in-tx checks already act on.
      const gate = await autoMovesOpen(tx, { turn: openTurn });
      if (!gate.ok) throw new UserError(gate.message);
      // The Move is claimed first: it is the contended thing, and a refusal
      // here rolls back everything below it (craftRequestImpl's project path
      // does the same).
      await spendCraftMove(tx, {
        character,
        openTurn,
        need: administerMoveCost,
        entry: craftLedgerEntry(held.tag, administerMoveCost),
      });
    }

    // Patient-side race (review fix, M2, same shape as
    // healCharacterRequestImpl's): two actors administering to the same
    // target in the same instant both pass the outside intersects gate,
    // both would spend ⬢ and (if administerSkill-gated) a Move fraction, and
    // dropCharacterTag on an already-gone row is a silent no-op — the loser
    // would look successful and cure nothing. The target row is already
    // locked, above; re-read its held tags under that lock before touching
    // them. Only re-verified when this item's own gate depended on the
    // intersection — an `administerable` item like Mercy has nothing to
    // lose by curing nothing, race or not, so it never refuses here.
    let curedHeldNow = curedHeld;
    if (administered) {
      const freshTags = await tx.characterTag.findMany({
        where: { characterId: target.id },
        select: {
          tagId: true,
          source: true,
          expiresTurn: true,
          quantity: true,
          tag: { select: { slug: true } },
        },
      });
      const freshSlugs = new Set(freshTags.map((ct) => ct.tag.slug));
      const stillIntersects = curesList.some((slug) => freshSlugs.has(slug));
      if (!stillIntersects && !held.tag.administerable) {
        throw new UserError(`${await seenName(character, target.id)} was already treated for that.`);
      }
      curedHeldNow = curesList.length
        ? freshTags.filter((ct) => curesList.includes(ct.tag.slug))
        : [];
    }

    // The poisoned-draw odds (M4): dropCharacterTag draws this specific unit
    // against the row's own poisonedCount/quantity as it stands right now,
    // under this same lock — a Consume of a stack the poisoner tainted is
    // exactly the hypergeometric draw a Transfer/Loot move uses, just at
    // quantity 1. A poisoned draw applies the POISON's own consumesInto on
    // top of the food's — resolved through the very same resolveConsumeGrants
    // (and the very same resists filter) rather than a second mechanism, so
    // Iron Constitution shrugs off a forced poison exactly like it shrugs off
    // a food's own grant.
    // Re-checked under the lock: the stack or the meter may have moved since
    // the read above (another tab, the turn close).
    if (n > 1 || isFood) {
      const fresh = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId } },
        select: { quantity: true },
      });
      if (!fresh || fresh.quantity < n) throw new UserError("You don't have that many.");
      if (isFood) {
        const meter = await tx.character.findUnique({ where: { id: target.id }, select: { hungerValue: true } });
        const refusal = eatRefusal(meter?.hungerValue ?? HUNGER_MAX);
        if (refusal) throw new UserError(refusal);
      }
    }
    const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, character.id, tagId, n);
    let poisonDraw = null;
    if (poisonedTaken > 0 && poisonPayload) {
      const poisonTag = await tx.tag.findUnique({
        where: { id: poisonPayload },
        select: {
          id: true,
          slug: true,
          name: true,
          consumesInto: true,
          consumesIntoUnless: true,
          consumesIntoDurations: true,
          consumesIntoOneOf: true,
          consumesIntoResources: true,
        },
      });
      if (poisonTag) {
        poisonDraw = {
          tag: poisonTag,
          grants: resolveConsumeGrants(poisonTag, heldSlugsOf(target.tags), ladder, resistSlugs),
        };
      }
    }
    const allGrantSlugs = poisonDraw ? [...grantSlugs, ...poisonDraw.grants.slugs] : grantSlugs;
    // A collision here is the food's own duration override against the
    // poison's — spread order means the POISON wins (it's applied last),
    // which is deliberate: a poison landing on top of a food grant is the
    // more dangerous half of the two, and its own timing should be the one
    // that sticks rather than getting silently overridden by whatever the
    // meal itself happened to specify for the same slug.
    const allGrantDurations = poisonDraw
      ? { ...grantDurations, ...poisonDraw.grants.durations }
      : grantDurations;
    const allResisted = poisonDraw ? [...resistedSlugs, ...poisonDraw.grants.resisted] : resistedSlugs;
    // Grant asymmetry (fix round, M4): the merge above used to drop the
    // poison's own `removes` (ladder rungs ITS consumesInto clears) and
    // `resources` (flat ⬢ it grants) on the floor — honored below, the same
    // way the food's own halves already are.
    const allClimbedFrom = poisonDraw ? [...climbedFrom, ...poisonDraw.grants.removes] : climbedFrom;
    const allResourcesGranted = resourcesGranted + (poisonDraw?.grants.resources ?? 0);
    resourcesGrantedOut = allResourcesGranted;

    const climbed = allClimbedFrom
      .map((slug) => target.tags.find((ct) => ct.tag.slug === slug))
      .filter(Boolean)
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        source: ct.source,
        expiresTurn: ct.expiresTurn,
        quantity: 1,
      }));

    for (const rung of climbed) await dropCharacterTag(tx, target.id, rung.tagId, 1);
    const granted = await grantTagSlugs(
      tx,
      target.id,
      allGrantSlugs,
      openTurn?.number ?? null,
      allGrantDurations,
    );
    grantedNames = granted.map((g) => g.tagName);
    // A dose taken while the last one is still on grants nothing new — the
    // state is already held — so its acquiredAt would stay where the first
    // dose left it, and the song for taking a drug (MusicDirector.js), which
    // waits for that stamp to move, would never play again. Every drug state
    // this swallow granted is restamped, fresh or not.
    const dosed = allGrantSlugs.filter((slug) => DRUG_STATE_SLUGS.includes(slug));
    if (dosed.length) {
      await tx.characterTag.updateMany({
        where: { characterId: target.id, tag: { slug: { in: dosed } } },
        data: { acquiredAt: new Date() },
      });
    }
    if (dined) {
      const dinedName = await grantDined(tx, target.id, openTurn, dinedConfig);
      if (dinedName) grantedNames.push(dinedName);
    }
    // The Resources half — Purse and Supply Kit (CAVING.md). Most
    // consumables grant none, so this is usually a no-op.
    if (allResourcesGranted) {
      await creditResources(
        tx,
        { kind: "character", id: target.id, name: target.name },
        allResourcesGranted,
      );
    }
    // Ambrosia, and nothing else so far: a pill that leaves you better at
    // something. Unclamped like every other tagPoints write (db/lib/
    // stagedPush.js says why) -- the column may legitimately sit negative.
    if (tagPointsGranted) {
      await tx.character.update({
        where: { id: target.id },
        data: { tagPoints: { increment: tagPointsGranted } },
      });
    }
    // db/lib/hiddenCures.js. Runs after the ordinary grants and records
    // nothing on the request, on purpose. A dish runs it for each INGREDIENT
    // too, so a pie made with leeches still takes the bruise off — the cure
    // is a property of the leeches, not of eating them whole.
    await applyHiddenCures(tx, target.id, held.tag.slug);
    for (const ing of ingredientTags) await applyHiddenCures(tx, target.id, ing.slug);
    // The hunger meter (db/lib/hunger.js): one atomic, clamped write so a
    // concurrent write can never push it past HUNGER_MAX, then the
    // descriptor moves with it — Hungry to Full the moment you eat enough,
    // not at the next turn close.
    if (hungerRestored > 0) {
      const [row] = await tx.$queryRaw`
        UPDATE "Character" SET "hungerValue" = LEAST(${HUNGER_MAX}, "hungerValue" + ${hungerRestored})
        WHERE "id" = ${target.id} RETURNING "hungerValue" AS after`;
      await syncHungerDescriptor(tx, target.id, { hungerValue: row?.after ?? 0, hungerless });
    }
    if (moodTerms?.length) await applyMoodTerms(tx, target.id, moodTerms);
    else if (moodToMax) await setMood(tx, target.id, MOOD_MAX);
    else if (moodRelief) await applyMood(tx, target.id, { kind: "DRINK", base: moodRelief });

    // Per held cured tag: drop it, grant the aftermath (the item's own
    // `curesInto` override if it names this slug, else the cured tag's own
    // `removesInto` — same as an ordinary Heal), and ease half the wound's
    // mood cost. Re-read WITH group each time — the target load above omits
    // it, the same trap healCharacterRequestImpl already dodges, and
    // woundMoodFor needs it.
    const cured = [];
    for (const ct of curedHeldNow) {
      await dropCharacterTag(tx, target.id, ct.tagId);
      const curedTag = await tx.tag.findUnique({
        where: { id: ct.tagId },
        select: {
          slug: true,
          name: true,
          removesInto: true,
          requirementResources: true,
          requirementTurns: true,
          requirementPerTurn: true,
          requirementGambit: true,
          group: { select: { slug: true } },
        },
      });
      const override = dishCures.curesInto?.[curedTag.slug];
      const aftermathSlugs = override ? [override] : rollTagChain(curedTag.removesInto);
      const grantedAftermath = await grantTagSlugs(tx, target.id, aftermathSlugs, openTurn?.number ?? null);
      // woundMoodFor is signed (MOOD.md), hence the minus — the same
      // shape healCharacterRequestImpl uses.
      const relief = -woundMoodFor(curedTag) / 2;
      if (relief > 0) await applyMood(tx, target.id, { kind: "HEALED", base: relief });
      cured.push({
        tagId: ct.tagId,
        tagName: curedTag.name,
        aftermath: grantedAftermath.map((g) => g.tagName),
        restore: {
          tagId: ct.tagId,
          source: ct.source,
          expiresTurn: ct.expiresTurn,
          quantity: ct.quantity ?? 1,
        },
      });
    }

    // removesOnConsume (TAGS.md §5c note on Coffee/Bar Soap): a plain drop
    // of whatever unrelated tags this item names, off the CONSUMER only —
    // never the administered target, since nothing here has asked for
    // "dose someone else's Unhygienic away." No aftermath, no mood, no
    // curesInto override; it's the lighter cousin of the cure loop above on
    // purpose. Re-read fresh under the lock already held for the same
    // double-submit reason the cure loop re-reads target.tags.
    const removedOnConsume = [];
    if (held.tag.removesOnConsume?.length && target.id === character.id) {
      const freshSelfTags = await tx.characterTag.findMany({
        where: { characterId: character.id, tag: { slug: { in: held.tag.removesOnConsume } } },
        select: { tagId: true, source: true, expiresTurn: true, quantity: true, tag: { select: { name: true } } },
      });
      for (const ct of freshSelfTags) {
        await dropCharacterTag(tx, character.id, ct.tagId);
        removedOnConsume.push({
          tagId: ct.tagId,
          tagName: ct.tag.name,
          restore: { tagId: ct.tagId, source: ct.source, expiresTurn: ct.expiresTurn, quantity: ct.quantity ?? 1 },
        });
      }
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: target.id,
      // REQUESTS.md §1a: a row a future ration might count must carry
      // turnId — this one already feeds routineHealsThisTurn-shaped counters
      // once administerSkill bills a Move (review fix, M2).
      turnId: openTurn?.id ?? null,
      details: {
        tagId,
        tagName: held.tag.name,
        quantity: n > 1 ? n : undefined,
        restore,
        granted: grantedNames,
        resourcesGranted: allResourcesGranted,
        tagPointsGranted,
        moodRelief: moodRelief || undefined,
        hungerRestored: hungerRestored || undefined,
        // The GM's copy of what a dish was, which is the only place the
        // ingredients are ever written down after the craft — the eater is
        // told the taste and nothing else.
        cookedFrom: cookedFrom.length ? cookedFrom : undefined,
        moodTerms: moodTerms?.length ? moodTerms : undefined,
        climbed: climbed.map((c) => c.tagName),
        cured: cured.length ? cured : undefined,
        removedOnConsume: removedOnConsume.length ? removedOnConsume : undefined,
        administered: administered || undefined,
        targetName: administered ? target.name : undefined,
        // M4: what Iron Constitution shrugged off, and whether this draw came
        // up poisoned. The audit desk is a GM-only surface (web/app/(desk)/gm)
        // — this never rides along on a player-facing response.
        resisted: allResisted.length ? allResisted : undefined,
        poisoned: poisonDraw
          ? { poisonTagId: poisonDraw.tag.id, poisonName: poisonDraw.tag.name, count: poisonedTaken > 1 ? poisonedTaken : undefined }
          : undefined,
      },
    });
  });
  await afterInventoryChange([character.id, administered ? target.id : null]);
  if (administered) {
    notifyCharacter(target, `${await seenName(target, character.id)} used ${markdownName(held.tag.name)} on you.`);
  }
  // Corpse Salts answers straight away rather than waiting up to a minute for
  // the sweep to notice (db/lib/corpseSense.js). Keyed on the CONSUMED tag's
  // consumesInto, which names catalog slugs — `granted` above carries display
  // names. Fire-and-forget: a failed DM must not undo a consume that committed.
  if (held.tag.consumesInto?.includes(CORPSE_SENSE_SLUG)) {
    after(() =>
      pingCorpseSense(prisma, target).catch((err) =>
        console.error("Corpse sense first ping failed:", err),
      ),
    );
  }
  revalidateAll();
  // The taste sentence, which is the whole point of cooking — the one-click
  // Consume on the tag rail raises it too (COOKING.md §8). A random pick (a
  // Ration Box) says what it landed on, since nothing else would.
  if (!line && held.tag.consumesIntoOneOf?.some((entry) => entry)) {
    return { line: grantedNames.length ? `You got ${grantedNames.join(", ")}.` : "You got nothing." };
  }
  // A flat ⬢ grant (Purse, Supply Kit) — same "You got N ⬢." phrasing as
  // Box of Junk's own road out, said to the CONSUMER only: administering one
  // to someone else credits the target, not the actor, so there's nothing
  // for the actor to be told here.
  if (!line && resourcesGrantedOut > 0 && target.id === character.id) {
    return { line: `You got ${resourcesGrantedOut} ⬢.`, sfx: consumeSfx(held.tag) };
  }
  return line ? { line, sfx: consumeSfx(held.tag) } : { sfx: consumeSfx(held.tag) };
}

// A bottle and a bowl sound different. The held tag carries its group already
// (requireCharacter selects it for the recipe matcher), so this costs no query — and
// anything that is neither reads as eating, which is what consuming mostly is.
function consumeSfx(tag) {
  return tag?.group?.slug === "items-drink" ? SFX.DRINK : SFX.EAT;
}

// --- Looting a living, incapacitated target ----------------------------

// A helpless target (dying/catatonic/paralyzed/bound) is lootable the same
// way a corpse is; this handles both in one request, tags AND ⬢ together.
// The older TRANSFER_TAG/TRANSFER_RESOURCES LOOT direction still exists so
// old Request rows undo correctly, but nothing files one any more.
export async function lootCharacterRequestImpl({
  targetCharacterId,
  tagPicks: rawTagPicks,
  amount: rawAmount,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");

  // A target key, not a bare id: "hood:<token>" is how a person in a mask — or
  // a body still wearing one — is named without their id crossing the wire.
  // Going through the pockets of somebody who cannot stop you is the plainest
  // thing there is to do to a stranger, and Search already reached one
  // (SEARCH.md); Loot was the hold-out, which made a closed helmet a way to
  // keep your purse after you had been knocked cold.
  const target = await resolveHereTarget(character, targetCharacterId, {
    allowDead: true,
    select: {
      id: true,
      name: true,
      status: true,
      concealed: true,
      locationId: true,
      buriedAt: true,
      // notifyCharacter's two: the DM address, and the status it checks before
      // sending one to somebody who has since died (web/lib/notifyCharacter.js).
      discordUserId: true,
      tags: {
        include: {
          tag: {
            select: {
              name: true,
              category: true,
              stackable: true,
              slug: true,
              tradeable: true,
            },
          },
        },
      },
    },
  });
  // NOT a buriedAt check — resolveHereTarget's isHere(allowDead) already refuses
  // a buried row, so this would be unreachable. The specific sentence is kept
  // where it can still be said: db/lib/escort.js#escortRefusal.

  // A corpse needs no further excuse; a living target has to be helpless —
  // otherwise it's a Gambit for a GM to adjudicate.
  const incapacitated =
    target.status === "DEAD" ||
    target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (!incapacitated)
    throw new UserError("They aren't in any state to be looted.");

  const picks = Array.isArray(rawTagPicks) ? rawTagPicks : [];
  const amount = parseCount(rawAmount, { min: 0 }) ?? 0;
  if (!picks.length && amount <= 0)
    throw new UserError("Pick something to take.");

  const takenTags = [];
  for (const pick of picks) {
    const held = target.tags.find((ct) => ct.tagId === pick.tagId);
    if (!held || !isTradeable(held.tag)) {
      throw new UserError("That isn't something you can take off a body.");
    }
    // ⬢ are a tradeable stack row, so they pass the check above — and this
    // verb already has its own ⬢ field, which is the ledgered path
    // (moveResources -> moveParty writes the row; a tag pick writes none). The
    // picker filters them out (web/lib/peoplePools.js), but a picker is a hint
    // and not a lock (CLAUDE.md), so refuse them here too. Without this a
    // crafted post moves a body's whole purse with nothing in the book, and
    // both parties read as permanently drifted against the ledger (ECONOMY.md §3).
    if (isResourcesRow(held)) {
      throw new UserError("Take ⬢ with the Resources field, not as an item.");
    }
    const quantity = held.tag.stackable
      ? (parseCount(pick.quantity, { min: 1, max: held.quantity }) ?? null)
      : held.quantity;
    if (quantity == null)
      throw new UserError(`Bad quantity for ${held.tag.name}.`);
    takenTags.push({
      tagId: held.tagId,
      tagName: held.tag.name,
      crate: isCrateTag(held.tag),
      quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
      stackable: held.tag.stackable,
    });
  }

  const targetResources = resourcesOf(target);
  if (amount > targetResources)
    throw new UserError(`${await seenName(character, target.id)} only has ${targetResources} ⬢.`);

  // One mount, up to 3 unruly or young arelitz (db/lib/mounts.js): refused
  // rather than taken and set straight back down by the settle.
  const tooMany = holdLimitRefusal(
    character.tags,
    takenTags.map((t) => ({ slug: target.tags.find((ct) => ct.tagId === t.tagId)?.tag?.slug, quantity: t.quantity })),
  );
  if (tooMany) throw new UserError(tooMany);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // Loot lock (fix round M4b, fix 3): unlike Transfer and Heal, this used
    // to take no lock at all — two looters racing the same helpless target
    // would both run dropCharacterTag's absolute writes against the same
    // unlocked stack (duplicated units, or a poisoned split counted twice).
    // Same sorted-id lock the heal and poison paths use, for the same
    // deadlock-avoidance reason (a simultaneous cross-loot would otherwise
    // lock actor-then-target and target-then-actor at once).
    const lockIds = [character.id, target.id].sort();
    for (const id of lockIds) await lockCharacter(tx, id);

    // Race re-check under the lock: `takenTags`/`amount` were priced against
    // a read taken before the lock, so a concurrent loot (or anything else
    // that shrank the target's stack or purse since) needs a fresh look
    // before anything is actually taken. Refusing beats granting the SECOND
    // looter the full originally-requested amount regardless of what the
    // body still has — dropCharacterTag quietly takes less (or nothing) off
    // a shrunk row, but this loop would otherwise still hand the requester
    // the untouched request quantity.
    for (const t of takenTags) {
      const freshHeld = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: t.tagId } },
      });
      if (!freshHeld || freshHeld.quantity < t.quantity) {
        throw new UserError(`Someone already took that.`);
      }
    }
    // The ⬢ used to get the same treatment one line down — re-read under the
    // lock, compared, then moved — because the check above was priced against
    // a read taken before it. There is nothing left to re-read: moveResources
    // takes ⬢ with a conditional write that IS the balance check, so a body
    // someone else emptied in between refuses the whole loot here instead.

    for (const t of takenTags) {
      // Same poison hand-off as Transfer (M4): a body's held stack draws its
      // poisoned units proportionally, and they land on the looter under the
      // same "poisons don't mix" dilution addToStack enforces.
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, target.id, t.tagId, t.quantity);
      await addToStack(tx, character.id, t.tagId, t.quantity, {
        source: "EVENT",
        expiresTurn: t.expiresTurn,
        stackable: t.stackable,
        poisonedCount: poisonedTaken,
        poisonPayload,
      });
    }
    if (amount > 0) {
      await moveResources(tx, { kind: "character", id: target.id }, -amount);
      await moveResources(tx, { kind: "character", id: character.id }, amount);
    }

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      targetStatus: target.status,
      tags: takenTags.map((t) => ({
        tagId: t.tagId,
        tagName: t.tagName,
        quantity: t.quantity,
        source: t.source,
        expiresTurn: t.expiresTurn,
      })),
      amount,
    };
    // Waking up robbed is frightening; a corpse minds nothing (MOOD.md).
    if (target.status === "ALIVE") await applyMood(tx, target.id, { kind: "ROBBED" });
    // Hauling a crate off somebody is picking it up (db/lib/crateHaul.js).
    const crates = takenTags.reduce((n, t) => n + (t.crate ? t.quantity : 0), 0);
    await chargeCrateHaul(tx, character, { moved: crates, pickedUp: crates, turn: openTurn });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_loot_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // The looter's carry caps and doors, and the target's — settleCarry no-ops
  // for a DEAD character on its own, but a corpse still needs its weight
  // refreshed here (db/lib/corpseWeight.js#refreshCorpseWeight), or a fully
  // stripped body goes on weighing what it did before the loot.
  await afterInventoryChange([character.id, target.id]);

  const lootParts = [
    ...takenTags.map((t) => formatStack(t.tagName, t.quantity)),
    amount > 0 ? `${amount} ⬢` : null,
  ].filter(Boolean);
  if (lootParts.length)
    notifyCharacter(
      target,
      `Your body was searched: ${lootParts.join(", ")} taken.`,
    );

  revalidateAll();
  // Heard by the looter alone. Being gone through is bad enough without the room
  // getting a noise about it.
  return { sfx: SFX.LOOT };
}

// --- Moving another character: GONE ------------------------------------
//
// MOVE_CHARACTER shoved one person one hop for free, with no consent and no
// record beyond an audit row, and it duplicated the drag picker's predicate
// word for word. Both are replaced by escorting: you attach somebody once and
// they follow you, the helpless without asking and everyone else through an
// Offer. db/lib/escort.js is the one authority now, and the party rack on
// /chat is the surface. See docs/systemdocs/MAP.md §3a.

// --- Binding and freeing -------------------------------------------------

// Nothing else grants `bound`, and it's the one incapacitating state a
// player can inflict on purpose. Two doors (db/lib/bind.js): someone who
// can't stop you — dead, or already helpless — is bound on the spot; anyone
// else has to agree, so the target gets a DM with Accept / Decline and the
// request fires only on Accept (docs/systemdocs/LESSONS.md).
export async function bindCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The picker posts a KEY, not an id: somebody in a mask is listed by HMAC token, because
  // /api/avatar/<id> would draw the face the mask is for (db/lib/targetKey.js). Resolving it here
  // keeps every check below working on a real id, and it answers null for anybody not standing
  // here — which is what stops a token being a way to ask after somebody who has already left.
  // allowDead to match the isHere() below — a body still wearing its mask is a
  // hood the resolver has to be willing to name, or tying one up refuses.
  const targetId = await resolveTargetKey(prisma, character, targetCharacterId, { allowDead: true });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetId === character.id)
    throw new UserError("You can't bind yourself.");

  // resolveHereTarget (web/lib/hereTarget.js) rather than a fourth copy of the
  // same four lines: it also blanks the refusal for a hood key, so a target who
  // walked off between the two queries is never refused BY NAME — which is the
  // one thing a mask is bought to prevent.
  const target = await resolveHereTarget(character, targetCharacterId, {
    allowDead: true,
    select: BIND_SELECT,
  });
  if (isBoundTarget(target))
    throw new UserError(`${await seenName(character, target.id)} is already bound.`);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const actor = {
    id: character.id,
    name: character.name,
    discordUserId: session.discordUserId,
  };

  if (!needsNoConsent(target)) {
    const offer = await createBindOffer(prisma, {
      actor,
      target,
      turn: openTurn,
    });
    if (!offer.ok) throw new UserError(offer.reason);
    after(() =>
      sendDm(offer.dm.discordUserId, offer.dm.content, {
        components: offer.dm.components,
        meta: offer.dm.meta,
        source: "player_event",
      }).catch((err) =>
        console.error(`Bind offer DM to ${target.id} failed:`, err),
      ),
    );
    await logAudit(prisma, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bind_offer",
      targetCharacterId: target.id,
      details: { offerId: offer.offer.id, targetName: target.name },
    });
    revalidateAll();
    return { pending: true, name: await seenName(character, target.id) };
  }

  await applyBind(prisma, { actor, target, turn: openTurn });
  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  // Only the binder hears it. The bound person is told in words (notifyCharacter above);
  // a sound would have to reach their tab through the feed, and the bind writes no line
  // into the place — deliberately, since a room does not announce who was tied up.
  return { sfx: SFX.BIND };
}

// The rescue half — anyone standing there may cut someone loose.
export async function freeCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/captives.js's, shared with Discord's /captive free.
  const result = await freeCharacter(prisma, {
    character,
    discordUserId: session.discordUserId,
    targetKey: targetCharacterId,
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidateAll();
  return {};
}

// --- Break Restraints -------------------------------------------------------

// A Bound character's own struggle against the knots (LESSONS.md §3c). No
// `needs` on requireCharacter — `bound` blocks ACT (db/lib/incapacitation.js),
// so gating on it would make this button unreachable for the one character
// who needs it. Instant and no dialog (web/components/actions/index.js's
// INSTANT table) — the tooltip already says what it does.
//
// Filed as a ROUTINE already PASSED (fileAutoRoutine), the same shape Torture
// uses and for the same reason: it resolves the instant it's pressed, so a
// GAMBIT row would have the turn-end push announce the same die a second
// time. It spends the Move either way, success or not.
//
// A success doesn't free them yet: `bound` stays until the turn closes, so
// they can still be looted, moved or hurt this turn. Free (a rescuer) is
// still instant.
export async function breakRestraintsRequestImpl() {
  const { session, character } = await requireCharacter();
  // The rule is db/lib/verbs/self.js's, shared with Discord's /captive escape.
  const result = await breakRestraints(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return { sfx: SFX.UNBIND, success: result.success, line: result.line };
}

// --- Crucifixion -----------------------------------------------------------


// Nailing someone to the cross. Three gates and no consent: the actor is a
// Fundamentalist, a COMPLETE Cross stands where they are (a half-built or
// damaged one is not a cross), and the target is standing there too. Free
// like Bind — it spends no Move — and it kills on a clock rather than on the
// spot: `crucified` becomes Dying at the close of this turn, and the Dying
// pass kills at the next (docs/tags.yaml, db/lib/dyingDeathPass.js). A GM
// Undo within the turn takes them down; after the close there is only Dying
// left to heal, and Undo says so.
//
// The ambient line names the VICTIM and never the actor. notifyCharacter's
// no-attribution rule is about not telling a helpless target who did it; a
// crucifixion is a public example, and an anonymous one is scenery about
// nothing.
export async function crucifyCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/captives.js's, shared with Discord's /captive crucify.
  const result = await crucifyCharacter(prisma, {
    character,
    discordUserId: session.discordUserId,
    targetKey: targetCharacterId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  if (result.speak?.length) after(() => speakAtPlaces(prisma, result.speak).catch((err) => console.error("Scene line failed:", err)));
  revalidateAll();
  return { name: result.name };
}

// --- Shackling (Dungeons) --------------------------------------------------


// Turning someone's ropes into shackles. Two gates and no consent: COMPLETE
// Dungeons stand where the actor is, and the target is standing there, Bound.
// Anyone may do it, and it spends no Move — Bind's shape. `bound` comes off and
// `shackled` goes on with no expiry, and the escape clock restarts, since only
// an Escape Artist can work shackles loose (db/lib/breakRestraints.js). Free
// still cuts them off.
export async function shackleCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/captives.js's, shared with Discord's /captive shackle.
  const result = await shackleCharacter(prisma, {
    character,
    discordUserId: session.discordUserId,
    targetKey: targetCharacterId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidateAll();
  return { name: result.name };
}

// --- Torture (docs/systemdocs/TORTURE.md) ----------------------------------

// A Torturer works on somebody who is already Bound and standing here. One die,
// resolved on the spot: a break DMs the torturer everything on the sheet that
// isn't a wound or a passing status, plus the last three Desires fulfilled,
// and the Depressed tag lands on the victim. Either way the victim takes the
// TORTURED mood hit and the torturer's Move is spent. The die and its
// arithmetic live in db/lib/torture.js; this file only loads rows and writes.
//
// Filed as a ROUTINE already PASSED (fileAutoRoutine) rather than a Gambit:
// the torturer is told immediately, and a Gambit row would have the turn-end
// push announce the same die a second time (stagedPush.js#gambitRollNotices).
const DEPRESSED_SLUG = "depressed";
const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";

export async function tortureCharacterRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The picker posts a KEY, not an id: somebody in a mask is listed by HMAC token, because
  // /api/avatar/<id> would draw the face the mask is for (db/lib/targetKey.js). Resolving it here
  // keeps every check below working on a real id, and it answers null for anybody not standing
  // here — which is what stops a token being a way to ask after somebody who has already left.
  const targetId = await resolveTargetKey(prisma, character, targetCharacterId);

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetId === character.id)
    throw new UserError("You can't torture yourself.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const torturerSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!torturerSlugs.includes(TORTURER_SLUG))
    throw new UserError("You don't know how.");

  const target = await prisma.character.findFirst({
    where: { id: targetId ?? "", status: "ALIVE" },
    select: {
      ...EXAMINE_SUBJECT_SELECT,
      status: true,
      locationId: true,
      discordUserId: true,
      tags: {
        select: {
          ...EXAMINE_SUBJECT_SELECT.tags.select,
          tagId: true,
          tag: { select: { ...EXAMINE_SUBJECT_SELECT.tags.select.tag.select, slug: true } },
        },
      },
    },
  });
  if (!target || !isHere(character, target, { allowConcealed: true }))
    // refusalFor, not notHereMessage: a hood key is refused in the blank form,
    // because a refusal that prints the name is the unmasking itself.
    throw new UserError(refusalFor(targetCharacterId, target));
  // What the torturer calls them. A break tells them the name (the embed
  // below); nothing before it does.
  const seenMid = await seenById(prisma, character.id, target.id);
  const seen = capitalizeFirst(seenMid);
  if (!isBoundTarget(target))
    throw new UserError(`${seen} isn't tied up.`);
  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  // Imperturbable: there is nothing in there to break.
  //
  // BELOW requireFreeMove on purpose, so the attempt costs the torturer their
  // Move. Above it, this was a free probe: anyone could test a bound target for
  // a hidden tag (`visible: false`) at no cost at all and read the answer off
  // the refusal. Spending the Move matches pain-immunity, which lets the
  // torturer roll and waste it. The target's mood and the −40 are still spared.
  if (target.tags.some((ct) => ct.tag.slug === IMPERTURBABLE_SLUG))
    throw new UserError(
      `${seen} looks back at you, entirely unbothered. There is nothing here to break.`,
    );

  const equipmentInReach = await hasEquipmentInReach(
    prisma,
    character,
    TORTURING_EQUIPMENT_SLUG,
  );
  const targetSlugs = target.tags.map((ct) => ct.tag.slug);
  // The TORTURER's die, so it is the torturer's Lucky that bends it — the same
  // side gambitMods below are computed for. Both dice are carried through, so
  // the roll line can show the one that was thrown away.
  // Lucky or Inspired keeps the better of two dice (db/lib/advantage.js);
  // Inspired is spent the instant it wins one, in the transaction below.
  const tortureRoll = rollWithAdvantage(character.tags, 6);
  const result = resolveTorture({
    die: tortureRoll.die,
    rolls: tortureRoll.rolls,
    torturerSlugs,
    targetSlugs,
    equipmentInReach,
    // Hungry, Starving, Afraid and Panicking count here as on any Gambit.
    gambitMods: gambitModifiers(character.tags, { mood: character.mood }),
  });
  const rollLine = formatTortureRoll(result);

  // Everything a break gives up, gathered before the write so the transaction
  // stays short. None of it is needed on a hold.
  let reveal = null;
  let depressed = null;
  if (result.success) {
    depressed = await prisma.tag.findUnique({
      where: { slug: DEPRESSED_SLUG },
      select: { id: true, stackable: true },
    });
    const [desires, thanati] = await Promise.all([
      prisma.desire.findMany({
        where: { characterId: target.id, status: "FULFILLED" },
        orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
        take: 3,
        select: { text: true, points: true },
      }),
      targetSlugs.includes(THANATI_LEADER_SLUG)
        ? prisma.character.findMany({
            where: {
              status: "ALIVE",
              id: { not: target.id },
              tags: { some: { tag: { slug: THANATI_SLUG } } },
            },
            orderBy: { name: "asc" },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    const readout = tortureReadout({ subject: target, openTurnNumber: openTurn.number });
    reveal = {
      ...readout,
      desires,
      thanatiNames: thanati ? thanati.map((c) => c.name) : null,
    };
  }

  const outcome = result.success ? "they broke" : "they held out";
  await prisma.$transaction(async (tx) => {
    // −40, or nothing under Pain Immunity / an Opium High, which are ×0 multipliers
    // (MOOD.md §6, TORTURE.md §4). Lands on a failed torture too — being worked over
    // and holding out still costs you.
    await applyMood(tx, target.id, { kind: "TORTURED" });
    if (result.success && depressed) {
      // An EVENT grant, so Depressed's conflictsWith (a purchase-time check)
      // does not stop it — the same door a GM grant walks through.
      await addToStack(tx, target.id, depressed.id, 1, {
        source: "EVENT",
        stackable: depressed.stackable,
      });
    }
    await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Tortured ${reveal ? target.name : seenMid}: ${rollLine} — ${outcome}.`,
      "auto:torture",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_torture_character",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      details: {
        targetName: target.name,
        die: result.die,
        total: result.total,
        threshold: result.threshold,
        success: result.success,
        modifiers: result.modifiers,
        equipmentInReach,
        ...(reveal
          ? {
              revealedTagNames: reveal.tags.map((t) => t.name),
              desires: reveal.desires.map((d) => d.text),
              thanatiNames: reveal.thanatiNames,
              depressedTagId: depressed?.id ?? null,
            }
          : {}),
      },
    });
  });

  await afterInventoryChange(target.id);
  if (reveal) {
    notifyCharacter(
      character,
      `${rollLine}.`,
      {
        embeds: [
          buildTortureEmbed({
            name: reveal.name,
            avatarUrl: `${CANONICAL_ORIGIN}${reveal.avatarPath}`,
            tags: reveal.tags,
            desires: reveal.desires,
            thanatiNames: reveal.thanatiNames,
          }),
        ],
        meta: { embed: true },
      },
    );
    notifyCharacter(
      target,
      "You were tortured and failed to conceal your secrets. The torturer now knows everything about you.",
    );
  } else {
    notifyCharacter(character, `${rollLine}. They held out.`);
    notifyCharacter(target, "You were tortured, but held out. It won't be long, now...");
  }
  revalidateAll();
  return { name: reveal ? target.name : seen, success: result.success, die: result.die };
}

// --- Putting on a face that isn't yours ------------------------------------

// The Disguise Kit's one verb. Three turns under a name the player types, and
// the kit is NOT used up — a disguise kit you can use once is a costume, not a
// kit.
//
// The whole effect is a MINTED tag row carrying Tag.forcedName
// (db/lib/disguiseMint.js). Nothing on the Character row changes, so every
// surface that resolves an identity picks it up through the forced branch of
// presentedIdentity() that Apex Form already uses, and the ordinary expiry
// sweep takes it off again with no catch-up pass to write.
//
// Two things the player is told up front by the tag's own description, because
// both fall straight out of riding forcedName: they post under a letter plaque
// rather than their portrait, and /conceal refuses while it is on.
// `honorific`/`firstName`/`lastName` are the dialog's three fields; `name` is one
// typed string from a page loaded before they existed. `job` is a Role slug, or
// empty for none.
export async function disguiseSelfRequestImpl({ name: typedName, honorific, firstName, lastName, job } = {}) {
  const rawName = typeof firstName === "string" ? { honorific, firstName, lastName } : typedName;
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/self.js's, shared with Discord's /disguise.
  const result = await disguiseSelf(prisma, {
    character,
    discordUserId: session.discordUserId,
    name: rawName,
    job: typeof job === "string" ? job : null,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  const { name } = result;

  // The mention token follows the false name (PROXYING.md §6), and this is the
  // one moment a player is watching for it — a disguise that only takes hold
  // at the next turn roll is a disguise that did not work when it was put on.
  // Taking it OFF can wait for the reconcile in advanceTurn
  // (db/lib/characterRoleNames.js), which is what covers every other way a
  // forcedName tag can arrive or leave.
  //
  // Best-effort and outside the transaction, the rule for every Discord call
  // (ARCHITECTURE.md §5): the disguise is the tag, not the role, and a Discord
  // hiccup must not cost somebody their kit.
  await ensureCharacterRole(character).catch(() => {});

  await afterInventoryChange(character.id);
  revalidateAll();
  return { name, job: result.job ?? null };
}

// --- Harming someone already helpless -------------------------------------

// Wounding and finishing off in one request, since they're one act. Either
// half alone is valid, but not neither. The target must ALREADY be helpless
// — fighting back is a Gambit for a GM. Finishing them ends their game on
// submit (REQUESTS.md §5a); the gate that makes that safe is
// FINISHABLE_SLUGS (Dying or Bound — deliberately not Catatonic, an absent
// player rather than a helpless one).
export async function harmCharacterRequestImpl({
  targetCharacterId,
  tagId,
  lethal: rawLethal,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // A KEY, not an id (db/lib/targetKey.js). Finishing off a man face-down on the floor does not
  // require knowing his name, and harmTargets lists him by token when he is masked.
  const targetId = await resolveTargetKey(prisma, character, targetCharacterId);

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetId === character.id)
    throw new UserError("Pick someone else.");

  const lethal = Boolean(rawLethal);
  const wantsTag = Boolean(tagId);
  if (!wantsTag && !lethal)
    throw new UserError("Pick an injury, tick Finish them, or both.");

  const target = await prisma.character.findFirst({
    where: { id: targetId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: { select: { slug: true } } } } },
  });
  if (!target || !isHere(character, target, { allowConcealed: true }))
    // refusalFor, not notHereMessage: a hood key is refused in the blank form,
    // because a refusal that prints the name is the unmasking itself.
    throw new UserError(refusalFor(targetCharacterId, target));

  const heldSlugs = new Set(target.tags.map((ct) => ct.tag.slug));
  if (![...heldSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
    throw new UserError(
      "They can still defend themselves — that's a Gambit, not a request.",
    );
  }
  if (lethal && ![...heldSlugs].some((slug) => FINISHABLE_SLUGS.has(slug))) {
    throw new UserError("You can only finish off someone Dying or Bound.");
  }

  let tag = null;
  if (wantsTag) {
    tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        custom: true,
        group: { select: { slug: true } },
        stackable: true,
        defaultDurationTurns: true,
      },
    });
    if (!tag) throw new UserError("Unknown injury.");
    if (!isInflictable(tag)) throw new UserError("That isn't an injury.");
    if (target.tags.some((ct) => ct.tagId === tag.id)) {
      throw new UserError(`${await seenName(character, target.id)} already has ${tag.name}.`);
    }
  }

  const openTurn = await getOpenTurn();
  const expiresTurn = tag
    ? await expiryForGrant(prisma, tag, openTurn, {
        characterId: target.id,
        where: "harmCharacter",
      })
    : null;

  let killed = false;
  await prisma.$transaction(async (tx) => {
    if (tag) {
      await addToStack(tx, target.id, tag.id, 1, {
        source: "EVENT",
        expiresTurn,
        stackable: tag.stackable,
      });
    }
    // Conditional `status: ALIVE` where-clause, same as every other death
    // path (db/lib/characterDeath.js), so two finishers can't both claim it.
    if (lethal) {
      const claim = await tx.character.updateMany({
        where: { id: target.id, status: "ALIVE" },
        data: { status: "DEAD" },
      });
      killed = claim.count > 0;
    }
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: tag?.id ?? null,
      tagName: tag?.name ?? null,
      expiresTurn,
      lethal,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_harm_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // killCharacter's applyDeathToRow runs with expectStatus DEAD (the shape
  // of the claim above) and revokes access itself.
  if (killed) {
    await killCharacter(target, "Someone finished you off.").catch((err) =>
      console.error(`killCharacter failed after finishing ${target.id}:`, err),
    );
    revalidatePath("/gm/players", "layout");
  } else {
    if (tag) {
      await afterInventoryChange(target.id);
    }
    notifyCharacter(target, "Someone hurt you.");
  }
  revalidateAll();
  return { killed, sfx: SFX.HARM };
}

// --- Branding someone bound or incapacitated -------------------------------


// The Branding Iron's whole gate (TORTURE.md §8) is holding the tag — no
// separate skill, unlike Torture's `torturer`. Free: no Move, no ⬢, no turn,
// and the iron is never consumed. The target class is INCAPACITATING_SLUGS
// (bound OR any other helpless state), the same broader gate Harm/Loot/Poison
// use — wider than Torture and Mutilate's "must hold `bound`" — because a
// brand doesn't need the victim to be able to struggle for it to work.
export async function brandCharacterRequestImpl({ targetCharacterId, description: rawDescription }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/captives.js's, shared with Discord's /captive brand.
  const result = await brandCharacter(prisma, {
    character,
    discordUserId: session.discordUserId,
    targetKey: targetCharacterId,
    description: rawDescription,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  // Unattributed, like every other request that acts on somebody else.
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidateAll();
  return { name: result.name };
}

// The one generic rejection text a hidden Desire and a nonexistent/retired
// one both answer with, so the wording itself can't be an oracle (DESIRES §5).
const DESIRE_NOT_AVAILABLE = "That Desire isn't available to you.";
// How they pulled it off, required on every player claim (DESIRES.md §8).
// The cap is MAX_REASON_LENGTH rather than a second 500 sitting here: the
// dialog's textarea is capped by the same constant, and a server limit that
// drifted below the one the box lets you type would truncate mid-sentence.
// --- Desires ----------------------------------------------------------

// ONE action: claim a Desire — a retroactive claim on something the
// character already did. A GM reviews it afterwards like every other
// request; the anti-loop rule (DESIRES.md §8) is GM-adjudicated from the
// reason field, since no gate here can tell a real evening from a made-up one.
export async function claimDesireImpl({
  slotIndex: rawSlotIndex,
  slug: rawSlug,
  reason: rawReason,
}) {
  const { session, character } = await requireCharacter();

  const slug = rawSlug?.toString().trim();
  if (!slug) throw new UserError(DESIRE_NOT_AVAILABLE);

  const reason = rawReason?.toString().trim().slice(0, MAX_REASON_LENGTH);
  if (!reason) throw new UserError("Say how you pulled it off.");

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      desireSlots: true,
      desireSlotLockTurns: true,
      autoRejectUnprovenDesires: true,
    },
  });
  const desireSlots = config?.desireSlots ?? 2;
  const lockTurns = config?.desireSlotLockTurns ?? 2;

  const slotIndex = parseCount(rawSlotIndex, { min: 0, max: desireSlots - 1 });
  if (slotIndex == null) throw new UserError("That Desire slot doesn't exist.");

  const template = await prisma.desireTemplate.findUnique({
    where: { slug },
    include: {
      requiresAnyTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });
  if (!template || template.retired) throw new UserError(DESIRE_NOT_AVAILABLE);

  const roleBySlugForDesire = await loadRoleBySlugForTemplates(prisma, [
    template,
  ]);
  const projectedTemplate = projectDesireTemplateForGates(
    roleBySlugForDesire,
    template,
  );

  const heldTags = character.tags.map((ct) => ct.tag);
  const heldTagIds = new Set(heldTags.map((t) => t.id));
  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldTagIds);
  const roleSlug = character.role?.slug ?? null;

  const openTurn = await getOpenTurn();
  const openTurnNumber = openTurn?.number ?? 0;

  // The same pure checks the picker ran. Called once outside the transaction
  // as a cheap pre-check, then again inside it on a fresh read taken after
  // the row lock, to close the TOCTOU window between the two.
  function assertAvailable(history) {
    const { visible, hidden } = evaluateDesireCatalog({
      templates: [projectedTemplate],
      heldTags,
      hiddenTagIds,
      roleSlug,
      history,
      openTurnNumber,
      desireSlots,
      characterId: character.id,
    });
    if (hidden.length > 0) throw new UserError(DESIRE_NOT_AVAILABLE);
    const evaluated = visible[0];
    if (!evaluated || evaluated.state !== "available")
      throw new UserError(DESIRE_NOT_AVAILABLE);

    const slotLock = evaluated.slotLocks?.[slotIndex];
    if (slotLock) throw new UserError(`${slotLock} in that slot.`);

    const slots = slotStates({
      history,
      openTurnNumber,
      desireSlots,
      lockTurns,
      // Manic: the slot never shuts. Same helper the three display surfaces
      // call, so what the sheet offers is what this accepts.
      noLock: desireSlotsNeverLock(character.tags),
    });
    const slot = slots[slotIndex];
    if (slot?.lockedUntilTurn != null) {
      throw new UserError(
        `That slot is locked for ${slot.lockedTurnsLeft} more turn${slot.lockedTurnsLeft === 1 ? "" : "s"}.`,
      );
    }
  }

  const historySelect = {
    id: true,
    templateId: true,
    slotIndex: true,
    status: true,
    endedTurnNumber: true,
  };
  const historyPreCheck = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: historySelect,
  });
  assertAvailable(historyPreCheck);

  // Row lock so two simultaneous claims can't both see "available" and land.
  const desire = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const historyInTx = await tx.desire.findMany({
      where: { characterId: character.id },
      select: historySelect,
    });
    assertAvailable(historyInTx);

    // A claim whose proof is already in the game — the act in the audit log
    // this turn, or the thing on their person — skips the GM queue
    // (DESIRES.md §6b). Under the row lock above, so two claims landing
    // together can't both cite the same act. No proof leaves it waiting for a
    // GM, unless the GM switch rejects it (§6c) — but a matcher that throws
    // always waits, since a bug in a rule must never cost a player their
    // claim. (A failed QUERY still aborts the transaction; Postgres allows
    // nothing after one.)
    let checkFailed = false;
    const auto = await findAutoEvidence(tx, {
      rule: template.autoVerify,
      character,
      discordUserId: session.discordUserId,
      openTurn,
    }).catch((err) => {
      console.error(`Auto-confirm check failed for ${template.slug}:`, err);
      checkFailed = true;
      return null;
    });
    const now = new Date();
    const outcome = autoClaimOutcome({
      rule: template.autoVerify,
      openTurn,
      evidence: auto,
      checkFailed,
      rejectUnproven: config?.autoRejectUnprovenDesires === true,
    });

    if (outcome === "reject") {
      // Born rejected: the same CANCELLED shape a GM Reject leaves
      // (revokeDesireCore), with endedTurnNumber null so neither the slot lock
      // nor the Desire's cooldown counts it. Nothing was paid, so there is
      // nothing to take back and no mood to lift.
      const row = await tx.desire.create({
        data: {
          characterId: character.id,
          templateId: template.id,
          slotIndex,
          text: template.name,
          points: template.tier,
          status: "CANCELLED",
          setTurnNumber: openTurn?.number ?? null,
          endedTurnNumber: null,
          reason,
          autoRejectedAt: now,
          reviewedAt: now,
          reviewedBy: null,
        },
      });
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "desire_auto_rejected",
        targetCharacterId: character.id,
        details: {
          desireId: row.id,
          desireName: row.text,
          slug: template.slug,
          slotIndex,
          reason,
          check: template.autoVerify.check,
        },
      });
      return row;
    }

    // Born ended: the claim IS the fulfilment.
    const row = await tx.desire.create({
      data: {
        characterId: character.id,
        templateId: template.id,
        slotIndex,
        text: template.name,
        points: template.tier,
        status: "FULFILLED",
        setTurnNumber: openTurn?.number ?? null,
        endedTurnNumber: openTurn?.number ?? null,
        reason,
        ...(auto
          ? {
              autoVerifiedAt: now,
              autoVerifiedAuditIds: auto.auditLogIds,
              autoVerifiedNote: auto.note,
              reviewedAt: now,
              reviewedBy: null,
            }
          : {}),
      },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { tagPoints: { increment: row.points } },
    });
    // Getting what you wanted settles the nerves, 10 a point (MOOD.md).
    await applyMood(tx, character.id, { kind: "DESIRE", base: DESIRE_RELIEF_PER_POINT * row.points });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      details: {
        desireId: row.id,
        pointsAwarded: row.points,
        slug: template.slug,
        slotIndex,
        reason,
        ...(auto ? { autoVerified: { auditLogIds: auto.auditLogIds, note: auto.note } } : {}),
      },
    });
    return row;
  });

  if (desire.autoRejectedAt) {
    // The same NOTICE a GM Reject sends (web/app/(desk)/gm/turns/actions.js),
    // so a rejection reads the same whoever made it.
    await sendDm(session.discordUserId, "Your desire was rejected.").catch((err) =>
      console.error("Desire rejection DM failed:", err),
    );
    revalidateAll();
    return { rejected: true };
  }

  await recordArchiveEvent({
    kind: "DESIRE_FULFILLED",
    character,
    zoneId: character.zoneId ?? null,
    turn: openTurn,
    content: `${character.name} fulfilled a Desire: ${desire.text}`,
  });

  revalidateAll();
  return {};
}

// --- Name ---------------------------------------------------------------

// The one player-facing rename: all four parts of a name, applying the same
// caps and dynasty lock every other writer of Character.name uses. See
// docs/systemdocs/CHARACTERS.md §1b.
// Renaming costs a Mulligan Potion, drunk from the tag's own tooltip. The gate
// is the whole point of the item — "a new name and appearance to those with
// honest regrets" is what its catalog text has always promised — and without
// it a name is free to change as often as a player likes, which makes every
// other identity rule (the personal Discord role, a wanted poster, a Disguise
// that is supposed to be temporary) mean less than it should. A Disguise is
// the temporary answer; this is the permanent one. See CHARACTERS.md.
//
// A new name is a new face, too. Every Friends entry anybody else held for
// the drinker is unlinked, so they read as a stranger to the whole town, and
// their seat is no longer anybody's to learn (Character.roleUnteachable,
// MEMORIES.md §2e). The entries stay on their owners' pages as loose notes.
const MULLIGAN_SLUG = "mulligan-potion";

export async function changeNameRequestImpl({
  honorific: rawHonorific,
  firstName: rawFirstName,
  title: rawTitle,
  lastName: rawLastName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Re-checked here and not merely in the UI: a server action is a public
  // endpoint and page.js's predicate is only a hint.
  const potion = character.tags.find((ct) => ct.tag.slug === MULLIGAN_SLUG);
  // Read here beside the potion, dropped inside the transaction below.
  const warrant = character.tags.find((ct) => ct.tag.slug === WANTED_SLUG);
  if (!potion) {
    throw new UserError(
      "You need a Mulligan Potion to take a new name.",
    );
  }

  // Free text here, unlike creation: what a bottle sells is the whole
  // identity, prefix and quoted title included, so this path deliberately
  // does NOT run normalizeEarnedHonorific. A prefix a character drank is no
  // longer proof they earned anything — which is a thing other characters can
  // find out the hard way. Capped, though; every writer of `name` is.
  const honorific =
    rawHonorific?.toString().trim().slice(0, NAME_LIMITS.honorific) || null;
  // The one player-facing writer of `title`, the part that renders in quotes.
  const title = rawTitle?.toString().trim().slice(0, NAME_LIMITS.title) || null;
  const firstName =
    rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) || null;
  if (!firstName) throw new UserError("A character needs a first name.");

  // A dynasty member wears the head's last name — never read from the post.
  const dynastyMember = isDynastyMember(character.role?.slug);
  const lastName = dynastyMember
    ? character.lastName
    : rawLastName?.toString().trim().slice(0, NAME_LIMITS.lastName) || null;

  const previous = {
    honorific: character.honorific,
    firstName: character.firstName,
    title: character.title,
    lastName: character.lastName,
    name: character.name,
  };
  const next = {
    honorific,
    firstName,
    title,
    lastName,
    name: formatCharacterName({
      honorific,
      firstName,
      title,
      lastName,
    }),
  };

  if (next.name === previous.name)
    throw new UserError("That's already your name.");

  const openTurn = await getOpenTurn();

  let updated;
  await prisma.$transaction(async (tx) => {
    // The potion was read outside this transaction, so lock the row before
    // spending it: two submits in flight would both see one bottle, and
    // dropCharacterTag no-ops silently on the second — one potion, two names.
    // Craft and Heal in this file take the same lock for the same reason.
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
    const stillHeld = await tx.characterTag.findFirst({
      where: { characterId: character.id, tagId: potion.tagId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (!stillHeld) throw new UserError("You need a Mulligan Potion to take a new name.");
    updated = await tx.character.update({
      where: { id: character.id },
      data: { ...next, roleUnteachable: true },
    });
    // Nobody recognises the new face. An entry stays where its owner wrote
    // it, name, role and notes and all, but tied to nobody, the shape a
    // hand-written MANUAL entry has. A disguise's entry is already tied to
    // nobody, and the drinker's own entries about other people stay linked.
    const { count: unlinkedFriends } = await tx.acquaintance.updateMany({
      where: { subjectId: character.id },
      data: { subjectId: null, source: "MANUAL" },
    });
    // Drunk, not merely held — one name per bottle.
    await dropCharacterTag(tx, character.id, potion.tagId, 1);
    // And the warrant goes with the old name. A Wanted man who buys a whole
    // new identity has bought his way off the list — that is what the bottle
    // is FOR, and leaving the tag on would mean the Cerberon still read him
    // as wanted under a name their own book has never heard of.
    if (warrant) await dropCharacterTag(tx, character.id, warrant.tagId);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_change_name",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: {
        previousName: previous.name,
        name: next.name,
        previousTitle: previous.title,
        title: next.title,
        potionTagId: potion.tagId,
        unlinkedFriends,
        ...(warrant ? { clearedWanted: true } : {}),
      },
    });
  });

  // Best-effort Discord fan-out, outside the transaction (ARCHITECTURE.md §5
  // — no network call inside one). The role wears the REAL bare name on
  // purpose, disguise or not (PROXYING.md §6).
  await ensureCharacterRole(updated).catch(() => {});
  await afterInventoryChange(character.id);
  if (
    isDynastyHead(character.role?.slug) &&
    next.lastName !== previous.lastName
  ) {
    await propagateDynastyLastName(next.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  revalidateAll();
  return { name: next.name };
}

// --- The Godard Factory -----------------------------------------------

// Cutting Godflesh out of the marsh. Rolls a d6, and on a 1 rolls again on a
// table that Armored Gloves dominate — db/lib/godflesh.js holds all of that,
// and this only writes the result down.
//
// It costs NO Move. It used to spend the Routine through fileAutoRoutine, which
// is where its "once per turn" came from for free; now it carries its own
// once-a-turn claim instead (Character.extractTurnKey, FACTORY.md §3). Nothing
// here touches the Action table or the move lock any more — cutting and working
// your day are two separate things.
//
// Every gate is re-checked here. The button greys itself for a blade and hides
// itself off a marsh tile, but a server action is a public endpoint and the
// client's menus are advisory (REQUESTS.md §3).
export async function extractGodfleshRequestImpl() {
  const { session, character } = await requireCharacter();
  // The rule is db/lib/verbs/work.js's, shared with Discord's /work harvest.
  const result = await extractGodflesh(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  // The die is the point of the whole button, so it is DM'd whatever it said.
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidateAll();
  // The DM above carries the same facts with Discord's formatting; this is
  // the one-line version the page's notice shows.
  return { die: result.die, quantity: result.quantity, injury: result.injury, line: result.line };
}

// Packing goods into a crate that weighs half what is in it.
//
// The crate is a runtime Tag, exactly the shape db/lib/depotCrates.js mints
// for a Depot shipment — `custom: true` and a `custom-` slug, so db:prune-tags
// leaves it alone and no docs/tags.yaml sync can upsert over it. It is an
// ordinary CONSUMABLE, which is what makes unpacking free: the Consume button
// already on the sheet opens it. A Depot crate now uses the same button, via
// openCrateRequestImpl above — it just needs its own road, because its
// contents are runtime tag IDs rather than catalog slugs.
export async function packageItemsRequestImpl({
  lines: rawLines,
  label: rawLabel,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const label = String(rawLabel ?? "")
    .trim()
    .slice(0, PACKAGE_LABEL_MAX);

  // The line is OPTIONAL — a blank crate is a perfectly ordinary thing to
  // pack. But writing one is writing, so a packer who cannot read is offered
  // no field at all (actions/PackageDialog.js) and refused one here. Letters
  // AND eyes, the same readBlock the paper actions use, and the same single
  // sentence whichever of the two stopped them.
  if (label) {
    const labelTurn = await getOpenTurn();
    const where = {
      daylight: isDaylight(),
      indoors: character.location?.indoors ?? true,
    };
    if (readBlock(character.tags, where)) throw new UserError(CANNOT_READ);
  }

  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((l) => ({
      tagId: String(l?.tagId ?? ""),
      quantity: Math.max(1, Math.trunc(Number(l?.quantity) || 1)),
    }))
    .filter((l) => l.tagId);
  if (lines.length === 0) throw new UserError("Nothing selected.");

  // Not on the Railway's floor (Depot Overhaul.docx): a crate is packed
  // somewhere else and carried to the train.
  if (
    !(await hasEquipmentInReach(prisma, character, PACKAGING_EQUIPMENT_SLUG, {
      excludeRoomSlugs: [RAILYARD_ROOM_SLUG],
    }))
  ) {
    throw new UserError("There's no packaging equipment here.");
  }

  // Resolved against what they ACTUALLY hold, never against what was posted.
  const held = character.tags.filter((ct) =>
    lines.some((l) => l.tagId === ct.tagId),
  );
  const contents = lines.map((line) => {
    const row = held.find((ct) => ct.tagId === line.tagId);
    if (!row) throw new UserError("You aren't carrying that.");
    // Untradeable, a crate, ⬢ or a mount: the one list, db/lib/crates.js,
    // shared with the picker (web/lib/tagRequests.js#packableTags) and with the
    // train, which ships what can't be crated loose.
    const refusal = packRefusal(row.tag);
    if (refusal) throw new UserError(refusal);
    const quantity = Math.min(line.quantity, row.quantity);
    return {
      tagId: row.tagId,
      slug: row.tag.slug,
      name: row.tag.name,
      quantity,
      weightLbs: row.tag.weightLbs ?? 0,
      sellablePrice: row.tag.sellable ? (row.tag.sellablePrice ?? 0) : 0,
    };
  });

  const innerLbs = contents.reduce(
    (sum, c) => sum + c.weightLbs * c.quantity,
    0,
  );
  if (innerLbs > PACKAGE_MAX_LBS) {
    throw new UserError(
      `A crate holds ${PACKAGE_MAX_LBS} lb. That's ${Math.round(innerLbs)}.`,
    );
  }
  // A second cap, on COUNT rather than weight, because the weight cap does not
  // bound the weightless: `consumesInto` repeats a slug per unit, so a crate of
  // obols (0 lb, stackable, no ceiling) would write an array as long as the
  // pile. The number is generous enough that nobody packing real cargo will
  // ever see it.
  const units = contents.reduce((sum, c) => sum + c.quantity, 0);
  if (units > PACKAGE_MAX_UNITS) {
    throw new UserError(
      `A crate holds ${PACKAGE_MAX_UNITS} things. That's ${units}.`,
    );
  }

  // One crate on your back, three with a Cart on (db/lib/mounts.js): the
  // new crate lands in your hands.
  const tooMany = holdLimitRefusal(character.tags, [{ slug: "custom-crate-new", quantity: 1 }]);
  if (tooMany) throw new UserError(tooMany);

  const weightByTagId = new Map(contents.map((c) => [c.tagId, c.weightLbs]));
  // Worth what is in it (Depot Overhaul.docx): what the train pays for it.
  const value = crateValue(contents, new Map(contents.map((c) => [c.tagId, c.sellablePrice])));
  const group = await prisma.tagGroup.findUnique({
    where: { slug: "items-gear" },
  });
  const openTurn = await getOpenTurn();

  // The "custom-" prefix every runtime tag uses, plus enough entropy that two
  // people packing in the same tick cannot collide on the unique slug.
  const slug = `custom-crate-${character.id.slice(-6)}-${Date.now().toString(36)}`;

  let crate;
  await prisma.$transaction(async (tx) => {
    // Single-actor lock (fix round M4b, fix 3 sibling check): packing is
    // always the actor's own stacks, so there's no cross-character deadlock
    // order to reason about — just the same "two tabs packing at once"
    // shape the loot lock above guards against, on one row instead of two.
    await lockCharacter(tx, character.id);

    // Laundering fix (M4): drop the contents FIRST and capture what actually
    // left as poisoned — dropCharacterTag's own return, previously discarded
    // here, which is exactly how packing a poisoned item into a crate used
    // to launder it clean. Per-entry, carried on the manifest below, so
    // openCrateRequestImpl re-applies it on the unpack side rather than
    // silently dropping it a second time. One road now: the Depot's own
    // opener is gone and a crate is cracked through Consume wherever it is
    // carried.
    const poisonedContents = [];
    for (const c of contents) {
      const { poisonedTaken, poisonPayload } = await dropCharacterTag(
        tx,
        character.id,
        c.tagId,
        c.quantity,
      );
      poisonedContents.push({
        ...c,
        poisonedCount: poisonedTaken,
        poisonPayload: poisonedTaken > 0 ? poisonPayload : null,
      });
    }

    crate = await tx.tag.create({
      data: {
        slug,
        name: "Crate",
        // No line on the side means no description at all, rather than an
        // empty `[CONTAINS]:` that would read as a bug.
        description: label ? `[CONTAINS]: ${label}` : null,
        custom: true,
        // Game state, not catalog — a Restart Game sweeps it up (TAGS.md §5d).
        ephemeral: true,
        category: TAG_CATEGORY.ITEMS,
        groupId: group?.id ?? null,
        pointCost: 0,
        tradeable: true,
        stackable: false,
        // The COLUMN is inspectVisibility; `visible:` is only the name
        // docs/tags.yaml uses, and passing it here throws an unknown-argument
        // error whose message points at `groupId` rather than at the real
        // culprit. A crate is a box somebody is visibly hauling.
        inspectVisibility: "ALWAYS",
        weightLbs: crateWeight(contents, weightByTagId),
        ...crateSaleFields(value),
        // An item like any other, so it gets the Destroy button the category
        // rule gives the rest of them (db/lib/syncTags.js).
        removable: true,
        consumable: true,
        // Repeated per unit — that is how consumesInto expresses a quantity
        // (docs/tags.yaml header), and every packable thing worth crating in
        // bulk is stackable. Left in place for the crate's printed
        // description and as a fallback; the actual unpack (below) reads
        // crateContents instead so the poison state on each line survives —
        // grantTagSlugs (what consumesInto ultimately resolves through)
        // knows nothing about poison at all.
        consumesInto: contents.flatMap((c) => Array(c.quantity).fill(c.slug)),
        // Carried too, for parity with a Depot crate, so anything that reads
        // one manifest reads both. `poisonedCount`/`poisonPayload` per line
        // (M4) — omitted (not written as 0/null) for a clean line, so an
        // ordinary crate's manifest looks exactly as it always has.
        crateContents: poisonedContents.map((c) => ({
          tagId: c.tagId,
          name: c.name,
          quantity: c.quantity,
          ...(c.poisonedCount > 0
            ? { poisonedCount: c.poisonedCount, poisonPayload: c.poisonPayload }
            : {}),
        })),
      },
    });

    await addToStack(tx, character.id, crate.id, 1, {
      source: "EVENT",
      stackable: false,
    });
    // The packed crate lands in the packer's own hands: a crate picked up (db/lib/crateHaul.js).
    await chargeCrateHaul(tx, character, { moved: 1, pickedUp: 1, turn: openTurn });

    const effect = {
      crateTagId: crate.id,
      crateName: crate.name,
      label,
      weightLbs: crate.weightLbs,
      innerLbs,
      contents,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_package_items",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: crate.name, weightLbs: crate.weightLbs, innerLbs };
}

// --- The Bird -------------------------------------------------------------
//
// One letter a day, to a named person in a GUESSED zone. See BIRD.md.
//
// The letter resolves INSTANTLY on a hit and SILENTLY on a miss — a wrong
// guess looks exactly like a successful send here; the sender isn't told
// until db/lib/birdPass.js reports it at turn close. That delay is the
// entire anti-scouting measure: answering "not delivered" now would hand
// every Bird-holder a free probe for whether someone is alive in a zone.
export async function birdMessageRequestImpl({
  recipientId,
  guessedZoneId,
  tagId: rawTagId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!holdsBirdAndLetters(character.tags)) {
    throw new UserError("You need a bird, and you need to be able to write.");
  }

  // The bird carries an OBJECT now. Resolved against what they actually hold,
  // never against what was posted. See docs/systemdocs/PAPERWORK.md.
  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held) throw new UserError("You aren't holding that.");
  const kind = held.tag.paperKind;
  if (kind !== "PAPER" && kind !== "SEALED") {
    throw new UserError("A bird carries letters, not that.");
  }
  if (kind === "PAPER" && !(held.tag.paperText ?? "").trim()) {
    throw new UserError("There's nothing written on it.");
  }

  // A snapshot for the GM desk, so a letter that is later resealed, torn up or
  // wiped still has a record of what went. Null on a sealed one: the bird did
  // not open it and neither does this.
  const body = kind === "SEALED" ? null : held.tag.paperText.trim();

  // The only Request with no reason box — the letter IS the record, clipped
  // to what the Request/AuditLog reason columns hold.
  const reason = (body ?? `Sealed: ${held.tag.name}`).slice(
    0,
    MAX_REASON_LENGTH,
  );

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is currently open.");

  // No bird will fly into or out of the deep caves.
  if (!character.zoneId)
    throw new UserError("You aren't anywhere a bird could leave from.");
  const fromZone = await prisma.zone.findUnique({
    where: { id: character.zoneId },
  });
  if (!isBirdReachableZone(fromZone)) {
    throw new UserError("No bird will fly down here.");
  }

  const guessedZone = await prisma.zone.findUnique({
    where: { id: guessedZoneId ?? "" },
  });
  if (!guessedZone) throw new UserError("Unknown destination.");
  if (!isBirdReachableZone(guessedZone)) {
    throw new UserError("No bird will fly down there.");
  }

  if (!recipientId || recipientId === character.id) {
    throw new UserError("Pick someone other than yourself.");
  }
  // Deliberately NOT filtered to the living — narrowing here would make a
  // rejection a working test for whether someone has died.
  const recipient = await prisma.character.findUnique({
    where: { id: recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!recipient) throw new UserError("Nobody by that name.");

  const delivered =
    recipient.status === "ALIVE" && recipient.zoneId === guessedZone.id;
  // Only whether they can WRITE BACK. Reading the letter is no longer this
  // action's business — the paper is the letter, and whether they can read it
  // is answered every time they look at it (db/lib/paper.js).
  const recipientIsLiterate = canReadLetters(recipient.tags);

  // In-game DAY, not a turn id — two turns run per day, and keying on the
  // turn would hand out two letters a day. (The mount's claim shared this trap
  // until it became a per-turn allowance — CARRY.md §2a.)
  const dayKey = String(describeTurn(openTurn).day);

  // A Rookery standing where they are raises the day's allowance and puts a
  // three-minute clock between flights (db/lib/rookery.js). No literacy check
  // here: canSendBird above already requires it, so an illiterate character
  // never reaches this line at all.
  const allowance = birdAllowanceFrom(
    await structuresAt(prisma, character.locationId, { statuses: WORKING_STATUSES }),
  );
  // A bird that changed hands today won't fly until tomorrow, so one bird is
  // one letter a day however it's passed round (db/lib/bird.js#birdRestingToday).
  // A Rookery's flights are the building's birds, so it doesn't apply there.
  if (allowance <= BASE_BIRD_SENDS_PER_DAY) {
    const bird = character.tags.find((ct) => ct.tag.slug === BIRD_SLUG);
    const dayStart = await prisma.turn.findFirst({
      where: { dayNumber: openTurn.dayNumber },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });
    if (birdRestingToday(bird?.acquiredAt, dayStart?.startedAt, character.createdAt)) {
      throw new UserError(BIRD_RESTING);
    }
  }
  // Only consulted when a building is doing something. The ordinary
  // once-a-day bird needs no cooldown — the day IS the cooldown.
  if (allowance > BASE_BIRD_SENDS_PER_DAY) {
    const cooling = rookeryCooldown(character.birdLastSentAt);
    if (!cooling.ok) {
      throw new UserError(`Try again <t:${cooling.readyAt}:R>.`);
    }
  }

  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    // The claim, in the shape it has always had: a conditional updateMany
    // whose WHERE is the check, so two tabs racing cannot both spend the last
    // flight. It is two writes now rather than one because the day has a
    // COUNT against it — the first resets a stale day, the second spends
    // inside a live one, and exactly one of them can match.
    const opened = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ birdTurnId: null }, { birdTurnId: { not: dayKey } }],
      },
      data: { birdTurnId: dayKey, birdDaySends: 1, birdLastSentAt: new Date() },
    });
    if (opened.count === 0) {
      const spent = await tx.character.updateMany({
        where: {
          id: character.id,
          birdTurnId: dayKey,
          birdDaySends: { lt: allowance },
        },
        data: { birdDaySends: { increment: 1 }, birdLastSentAt: new Date() },
      });
      if (spent.count === 0) {
        throw new UserError(
          allowance > BASE_BIRD_SENDS_PER_DAY
            ? "The birds have all flown today."
            : "Your bird has already flown today.",
        );
      }
    }

    const row = await tx.birdMessage.create({
      data: {
        senderId: character.id,
        senderName: character.name,
        senderDiscordUserId: character.discordUserId ?? null,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientDiscordUserId: recipient.discordUserId ?? null,
        guessedZoneId: guessedZone.id,
        guessedZoneName: guessedZone.name,
        tagId: held.tagId,
        tagName: held.tag.name,
        body,
        delivered,
        arrivalTurnId: delivered ? openTurn.id : null,
        // Arrival turn PLUS ONE, so a letter sent minutes before turn close
        // is still answerable.
        replyDeadlineTurn: delivered ? openTurn.number + 1 : null,
      },
    });
    birdMessageId = row.id;

    // THE LETTER ONLY LEAVES YOUR HANDS IF IT ARRIVES. A wrong guess means the
    // bird comes back with it still tied on, and the sender is told a turn
    // later like always. Burning a player's letter as the price of a bad guess
    // would be a second punishment nobody was warned about — and the guess
    // already costs them the day's send.
    if (delivered) {
      await dropCharacterTag(tx, character.id, held.tagId, 1);
      await addToStack(tx, recipient.id, held.tagId, 1, {});
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bird_message",
      targetCharacterId: recipient.id,
      details: {
        recipientId: recipient.id,
        guessedZoneId: guessedZone.id,
        delivered,
        birdMessageId: row.id,
      },
    });
  });

  // Post-commit — a DM must not hold up or undo the write (ARCHITECTURE.md §5).
  notifyCharacter(
    character,
    sentReceiptDm({
      recipientName: recipient.name,
      zoneName: guessedZone.name,
      letterName: held.tag.name,
    }),
    { source: "bird" },
  );
  if (delivered) {
    notifyCharacter(
      recipient,
      deliveryDm({ letterName: held.tag.name }),
      {
        // No Reply button for someone who can't write one — birdReply.js
        // re-checks, since a GM can strip the tag inside the window.
        components: recipientIsLiterate
          ? replyButtonRow(birdMessageId)
          : undefined,
        // `kind: "bird"` is a meta field of the Bird's own, not the column
        // and not a DM_ACTION; the descriptor spread in beside it is what
        // makes the letter answerable on the web (db/lib/dmActions.js).
        meta: {
          kind: "bird",
          birdMessageId,
          letterName: held.tag.name,
          ...(recipientIsLiterate ? dmAction(DM_ACTION.BIRD_REPLY, birdMessageId) : {}),
        },
        source: "bird",
      },
    );
    await afterInventoryChange([character.id, recipient.id]);
  }

  revalidateAll();
  return { ok: true };
}

// Answering one. The Discord twin is the Reply button on the letter's own DM
// (bot/src/lib/birdReply.js); every rule the two share — the window, literacy,
// the one-reply claim, what a sealed answer shows — is db/lib/birdReply.js, so
// the two faces cannot refuse different things, and an answer given on one
// leaves the other with nothing to answer.
//
// A server action is a public endpoint, so the replier comes from the SESSION
// and is handed to the core as `actingCharacterId`. The bot may omit that
// because its button only ever exists on the recipient's own DM; here anybody
// could post anybody's birdMessageId.
export async function birdReplyRequestImpl({ birdMessageId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const result = await sendBirdReply(prisma, birdMessageId, tagId, {
    actingCharacterId: character.id,
  });
  if (!result.ok) throw new UserError(result.reason);

  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_bird_reply",
    details: { birdMessageId: String(birdMessageId ?? "") },
  });

  // Returned by the core rather than sent by it (ARCHITECTURE.md §5), and null
  // for a GM letter, which has no sender Character to write to — the core files
  // that one as a conversation row on the desk instead.
  if (result.dm) {
    after(() =>
      sendDm(result.dm.discordUserId, result.dm.content, result.dm.opts).catch((err) =>
        console.error(`Bird reply DM to ${result.dm.discordUserId} failed:`, err),
      ),
    );
  }

  // Both sheets: the paper left the replier's hands and landed on the
  // sender's. A GM letter names only the replier — the core says which.
  await afterInventoryChange(result.characterIds);
  revalidateAll();
  return { ok: true, line: result.line };
}

// ---- The Stepstone -------------------------------------------------------
//
// A raw relocation, the shape the Dev Panel's Teleport already uses: no Move
// cost, no adjacency, no cooldown, immediate. It reaches anywhere on the
// SURFACE, known or not — the fog behind /map no longer narrows it. The one
// standing limit is the underground: a CAVE_LEVEL zone is never a target, so
// the stone cannot drop somebody past the caving gate into the dark.
const STEPSTONE_SLUG = "stepstone";

export async function stepstoneRequestImpl({ locationId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // The rule is db/lib/verbs/self.js's, shared with Discord's /stepstone.
  const result = await stepstone(prisma, {
    character,
    discordUserId: session.discordUserId,
    locationId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  const { fromLocationId, toLocationId, location } = result.moved;

  // Post-commit and out of band: this is the one hook every writer of
  // locationId owes — the map row, the channel overwrite, the zone role, the
  // carry settle, the corpses being carried, the poke at every open /chat.
  // Discord must never be touched from inside a transaction.
  after(async () => {
    try {
      await applyLocationMoveSideEffects(prisma, {
        characterId: character.id,
        fromLocationId,
        toLocationId,
      });
    } catch (err) {
      console.error("Stepstone: location side effects failed:", err);
    }
    // Walking is what wakes the dark, and stepping counts as arriving.
    try {
      const moved = await prisma.character.findUnique({ where: { id: character.id } });
      const cavingDm = await rollCavingOnArrival(prisma, moved, location);
      if (cavingDm) {
        await sendDm(cavingDm.discordUserId, cavingDm.content, { components: cavingDm.components, meta: cavingDm.meta }).catch((err) =>
          console.error("Stepstone: caving arrival DM failed:", err),
        );
      }
    } catch (err) {
      console.error("Stepstone: caving roll failed:", err);
    }
  });

  revalidateAll();
  return { ok: true, locationName: result.locationName, zoneName: result.zoneName };
}

// The Pointer Device Kit's own button. Not named usePointer* — ESLint's
// rules-of-hooks reads any exported useX as a React hook — and not a DM: this is a mundane toy, not a secret plot device, so
// the answer goes straight into the same bottom-right toast every other
// instant action uses.
export async function readPointerDeviceImpl() {
  const { character } = await requireCharacter();
  // The rule is db/lib/verbs/self.js's, shared with Discord's /item pointer.
  const result = await readPointerDevice(prisma, { character });
  if (!result.ok) throw new UserError(result.error);
  return { ok: true, line: result.line };
}



// ---------------------------------------------------------------------------
// The bomb collar (docs/systemdocs/COLLAR.md)
//
// Four actions: three verbs and the remote's readout. Each re-checks the tag
// its BUTTON was hidden on: a hidden button is a hint, and a server action is a
// public endpoint.
//
// Apply and Unlock never filter their roster on who is already collared, and
// neither does the refusal shortcut past a real lookup — the whole point is
// that you learn one person's answer per click and never the room's. The
// remote is the one exception, and only because it answers to one seat: the
// Exactor put those collars on (§4).

// Everything Apply and Unlock share: resolve the posted key, refuse anywhere
// you can't act, and hand back the actor shape db/lib/collar.js wants.
async function collarActorAndTarget(session, character, targetCharacterId, { allowSelf = false, allowDead = false } = {}) {
  const targetId = await resolveTargetKey(prisma, character, targetCharacterId);
  if (!character.locationId) throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetId ?? "", status: allowDead ? { in: ["ALIVE", "DEAD"] } : "ALIVE" },
    select: COLLAR_SELECT,
  });
  if (!target || !isHere(character, target, { allowDead, allowConcealed: true }))
    throw new UserError(notHereMessage(target));
  if (!allowSelf && target.id === character.id) throw new UserError("Pick somebody else.");

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  return { target, openTurn, actor: collarActor(session, character) };
}

function collarActor(session, character) {
  return {
    id: character.id,
    name: character.name,
    discordUserId: session.discordUserId,
    locationId: character.locationId,
    zoneId: character.zoneId,
  };
}

// The remote's gate, shared by the readout and the trigger: the remote in hand
// and the Exactor's ring on the finger, both re-read here. Anybody else holding
// one gets the same refusal the device would give them.
async function requireRemote() {
  const { session, character } = await requireCharacter({ needs: ACT });
  const refusal = await remoteRefusal(prisma, character.id);
  if (refusal) throw new UserError(refusal);
  return { session, character };
}

// Two doors, exactly as Bind has them: anybody who could refuse is asked;
// somebody helpless, or yourself, is collared on the spot. `collarSlug` picks
// which collar when there is more than one in hand — a marked one keeps its
// glyph onto the new neck, which is what the Apply dialog offers the choice for.
export async function applyCollarRequestImpl({ targetCharacterId, collarSlug = null }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const { target, actor, openTurn } = await collarActorAndTarget(session, character, targetCharacterId, {
    allowSelf: true,
    allowDead: true,
  });

  const collar = await pickLooseCollar(prisma, character.id, {
    slug: typeof collarSlug === "string" && collarSlug ? collarSlug : null,
  });
  if (!collar) throw new UserError(collarSlug ? "You don't have that collar." : "You don't have a collar.");
  const self = target.id === character.id;
  if (wearsCollar(target)) {
    throw new UserError(self ? "You already have a collar on." : `${await seenName(character, target.id)} already has a collar on.`);
  }

  if (!self && !collarNeedsNoConsent(target)) {
    const offer = await createCollarOffer(prisma, { actor, target, turn: openTurn, collar });
    if (!offer.ok) throw new UserError(offer.reason);
    after(() =>
      sendDm(offer.dm.discordUserId, offer.dm.content, {
        components: offer.dm.components,
        meta: offer.dm.meta,
        source: "player_event",
      }).catch((err) => console.error(`Collar offer DM to ${target.id} failed:`, err)),
    );
    await logAudit(prisma, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_collar_offer",
      targetCharacterId: target.id,
      details: { offerId: offer.offer.id, targetName: target.name },
    });
    revalidateAll();
    return { pending: true, name: await seenName(character, target.id) };
  }

  const applied = await applyCollar(prisma, { actor, target, turn: openTurn, collar });
  if (!applied.ok) throw new UserError(applied.reason);
  await afterInventoryChange(self ? [character.id] : [character.id, target.id]);
  if (!self) notifyCharacter(target, "Someone put a collar on you.");
  revalidateAll();
  return { name: self ? target.name : await seenName(character, target.id), glyph: applied.glyph };
}

// The unlocking ring — the Exactor's or the Pusher's, worn, re-read here rather
// than trusted off the page. No consent and no offer — a collar coming OFF
// needs nobody's leave.
export async function unlockCollarRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const { target, actor, openTurn } = await collarActorAndTarget(session, character, targetCharacterId, {
    allowDead: true,
  });

  const refusal = await unlockRefusal(prisma, character.id);
  if (refusal) throw new UserError(refusal);
  if (!wearsCollar(target)) throw new UserError(`${await seenName(character, target.id)} doesn't have a collar on.`);

  const unlocked = await unlockCollar(prisma, { actor, target, turn: openTurn });
  if (!unlocked.ok) throw new UserError(unlocked.reason);
  await afterInventoryChange([character.id, target.id]);
  notifyCharacter(target, "Someone took your collar off.");
  revalidateAll();
  return { name: await seenName(character, target.id), glyph: unlocked.glyph };
}

// What the remote shows: every collar in the game, by glyph. A name goes beside a
// glyph only for somebody standing in front of the Exactor, where he can read
// the clasp for himself — and it is the name HE holds for them, so a hood
// stays a hood (web/lib/peopleHere.js#rosterHere strips the real one).
// What the Disguise dialog offers: the title words in the form this character's
// own gender wears them (a disguise never changes who is under it), and the game's
// own jobs, by estate, to suggest: any other job may be typed. A read, so it asks for
// no kit: the verb does.
export async function loadDisguiseImpl() {
  const { character } = await requireCharacter();
  return { titles: titleWordsFor(character.gender), jobs: await disguiseJobChoices(prisma) };
}

export async function readRemoteRequestImpl() {
  const { session, character } = await requireRemote();
  const collars = await remoteReading(prisma, collarActor(session, character));
  if (collars.length === 0) return { collars: [] };

  const { named, hooded } = await rosterHere(character, {
    select: { id: true, name: true, tags: { select: { tag: { select: { slug: true } } } } },
  });
  const wornHere = new Map();
  for (const row of [...named, ...hooded]) {
    for (const ct of row.tags ?? []) {
      if (isLockedCollarSlug(ct.tag.slug)) wornHere.set(ct.tag.slug, pickerName(row));
    }
  }
  return {
    collars: collars.map((c) => ({ slug: c.slug, glyph: c.glyph, wornBy: wornHere.get(c.slug) ?? null })),
  };
}

// The trigger, by glyph. Any collar in any zone; see
// db/lib/collar.js#detonateCollar for why the body stays.
export async function detonateCollarRequestImpl({ collarSlug }) {
  const { session, character } = await requireRemote();
  if (typeof collarSlug !== "string" || !collarSlug) throw new UserError("Pick a collar.");

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const result = await detonateCollar(prisma, {
    actor: collarActor(session, character),
    collarSlug,
    turn: openTurn,
  });
  // Every refusal comes back from db/lib/collar.js rather than being decided
  // here, so the sentence lives beside the rule it enforces.
  if (!result.ok) throw new UserError(result.reason);

  await afterInventoryChange([result.targetId]);
  revalidateAll();
  // A click for the hand on the detonator; the bang belongs to the Location the
  // collar went off in, and db/lib/collar.js puts it there (Bascinet's call).
  // The glyph and nothing else — never the name, which the Exactor may not know.
  return {
    glyph: result.glyph,
    line: `Collar ${result.glyph} went off.`,
    sfx: SFX.OK_QUIET,
  };
}
