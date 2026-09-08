"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember, canOpenCrate } from "@lifeweb/db";
import { resolveParty as dbResolveParty } from "@lifeweb/db/lib/parties";
import { linkBetween, crossingCheck } from "@lifeweb/db/lib/locationGraph";
import { blocksOnFoot, equippedSlugs } from "@lifeweb/db/lib/mounts";
import { applyHiddenCures } from "@lifeweb/db/lib/hiddenCures";
import {
  applyTransfer,
  InsufficientResourcesError,
} from "@lifeweb/db/lib/resourceTransfer";
import {
  canSendBird as holdsBirdAndLetters,
  isBirdReachableZone,
  deliveryDm,
  sentReceiptDm,
  replyButtonRow,
  canReadLetters,
} from "@lifeweb/db/lib/bird";
import { auth, CANONICAL_ORIGIN } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { INDESTRUCTIBLE_SLUGS } from "@lifeweb/db/lib/nuke";
import {
  logAudit,
  MAX_REASON_LENGTH,
  craftAllowance,
  unitsOfTagThisTurn,
  deadSimpleUnitsThisTurn,
  MEDICAL_TIER_CAPS,
} from "@/lib/requests";
import {
  WHOLE_MOVE,
  addFractions,
  craftFamilyLabel,
  craftMoveCost,
  fitsInRemaining,
  formatMoveFraction,
  ledgerRemaining,
  ledgerUsed,
} from "@/lib/craftBudget";
import { UserError, guarded } from "@/lib/actionResult";
import { describeTurn } from "@/lib/turnFormat";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import {
  DISGUISE_KIT_SLUG,
  DISGUISE_TURNS,
  normalizeDisguiseName,
  mintDisguise,
  activeDisguise,
} from "@lifeweb/db/lib/disguiseMint";
import {
  isTradeable,
  isCrate,
  addRequirementSatisfied,
  craftFamily,
  needsWorkshop,
} from "@/lib/tagRequests";
import {
  tagsById as buildTagsById,
  exclusiveConflict,
  conflictingTag,
  chainSiblingsToRemove,
  heldHigherTiers,
} from "@/lib/characterCreation";
import {
  addToStack,
  creditResources,
  debitResources,
  dropCharacterTag,
  grantTagSlugs,
  moveResources,
  takeTagFrom,
  giveTagTo,
} from "@/lib/tagEffects";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  countsAgainstHealCap,
  healCapFor,
  healCost,
  isGambitHeal,
  isHealable,
  isInflictable,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import {
  canReachParty,
  outOfReachMessage,
  isOwnFactionSilo,
} from "@/lib/transferReach";
import { isHere, notHereMessage } from "@/lib/peopleHere";
import { resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import {
  applyBind,
  createBindOffer,
  needsNoConsent,
  isBound as isBoundTarget,
  requireBoundTag,
  BIND_SELECT,
} from "@lifeweb/db/lib/bind";
import { createLessonOffer } from "@lifeweb/db/lib/lessons";
import { createConfessionOffer } from "@lifeweb/db/lib/confession";
import { resolveConsumeGrants, heldSlugsOf } from "@/lib/consumeGrants";
import { recordArchiveEvent } from "@/lib/archive";
import {
  syncCharacterNarrowcastAccess,
  syncCharacterNickname,
  ensureCharacterRole,
  removeCursedRole,
  sendDm,
  killCharacter,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { breakSeal } from "@lifeweb/db/lib/paperMint";
import { CAMERA_SLUG, attachPhoto, createBlankPhotoRow } from "@lifeweb/db/lib/photoMint";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import { partFor, resolveMutilation } from "@lifeweb/db/lib/mutilate";
import { mintHeadstone } from "@lifeweb/db/lib/headstone";
import { dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import {
  BUTCHER_SLUG,
  ENGRAVE_RESOURCE_COST,
  WORKSHOP_EQUIPMENT_SLUG,
  SURGICAL_EQUIPMENT_SLUG,
  TORTURING_EQUIPMENT_SLUG,
  TORTURER_SLUG,
  MUTILATE_GATE_SLUGS,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
} from "@lifeweb/db/lib/constants";
import {
  resolveTorture,
  formatTortureRoll,
  buildTortureEmbed,
} from "@lifeweb/db/lib/torture";
import { EXAMINE_SUBJECT_SELECT, tortureReadout } from "@lifeweb/db/lib/examine";
import {
  hasAttribute,
  GODFLESH_ATTRIBUTE,
} from "@lifeweb/db/lib/locationAttributes";
import { crateWeight } from "@lifeweb/db/lib/depotCrates";
import {
  GODFLESH_SLUG,
  extractToolFor,
  rollExtraction,
  extractionDm,
} from "@lifeweb/db/lib/godflesh";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { carryAdmits, rowWeight } from "@lifeweb/db/lib/carry";
import { rollDie } from "@lifeweb/db/lib/moveEffects";
import { gambitModifierTotal, gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import { createWithRetry } from "@lifeweb/db/lib/paperMint";
import {
  CUSTOM_SURCHARGE,
  INSCRIPTION_MAX,
  cleanCustomText,
  customCraftFields,
  customCraftName,
} from "@/lib/customCraft";
import { formatManifest, formatStack } from "@lifeweb/db/lib/roomStash";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import {
  placementOf,
  structuresAt,
  canBuildHere,
  PRESENT_STATUSES,
  siteOpenedLine,
  siteAdvancedLine,
  siteCompletedLine,
  siteCancelledLine,
  stakeholderCharacterIds,
} from "@lifeweb/db/lib/structures";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { evaluateDesireCatalog, slotStates } from "@lifeweb/db/lib/desireGates";
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
  SPEAK,
} from "@lifeweb/db/lib/incapacitation";
import { applyFear, consumeReliefFor, woundFearFor, DESIRE_RELIEF_PER_POINT } from "@lifeweb/db/lib/fear";
import {
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
} from "@/lib/characterName";
import { propagateDynastyLastName } from "@/lib/dynasty";

// Every player-initiated change that applies immediately and is reviewed
// afterwards. Each action: authenticate, re-validate everything the client
// sent (a server action is a public endpoint), then apply the effect and
// write the Request + AuditLog rows in ONE transaction.

// The one generic rejection text a hidden Desire and a nonexistent/retired
// one both answer with, so the wording itself can't be an oracle (DESIRES §5).
const DESIRE_NOT_AVAILABLE = "That Desire isn't available to you.";

// `needs` is a capability from db/lib/incapacitation.js — pass ACT and the
// action refuses for anyone Bound, Dying, Paralyzed, Catatonic, mid-Seizure
// or out cold, naming the tag that stopped them. Hung here rather than
// re-written at each call site because this function already loads every held
// tag with its catalog row, so the gate costs no extra query, and because the
// inline copies it replaces had drifted: some actions checked, most didn't.
//
// Omit it for the handful that shouldn't care. Reading your own sheet is not
// an act, and neither is paperwork.
async function requireCharacter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // The held tags carry their GROUP as well as themselves: resolveRecipeItems
    // matches a recipe's `{ group: … }` ingredient against it, and
    // db/lib/corpses.js#isCorpseTag is a group check too.
    include: {
      tags: {
        include: { tag: { include: { group: { select: { slug: true } } } } },
      },
      role: { select: { slug: true } },
    },
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) {
      throw new UserError(
        needs === SPEAK
          ? `You can't speak right now — you're ${blocker.name}.`
          : `You can't do that right now. You're ${blocker.name}.`,
      );
    }
  }
  return { session, character };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

function parseCount(raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- Parties ------------------------------------------------------------

// "character:<id>" / "room:<id>" on both ends. Lives in db/lib/parties.js
// beside applyTransfer, so every transfer surface resolves the same key;
// re-exported here (prisma bound).
function resolveParty(key, opts) {
  return dbResolveParty(prisma, key, opts);
}

// --- Tags -------------------------------------------------------------

// The two per-turn craft counters — `unitsOfTagThisTurn` and
// `deadSimpleUnitsThisTurn` — now live in web/lib/requests.js beside
// `craftAllowance`, because character/page.js has to read the same numbers to
// tell the Craft dialog how many free units are left.

// Routine cures already worked this turn, against MEDICAL_TIER_CAPS.
//
// Counts REQUESTS, not units — one heal is one patient — and only the ones
// that cost a turn of work: a 0-turn cure is a free action (healRequests.js).
// A gambit heal is never in here, because it files a Move instead and the
// Action unique constraint rations those on its own.
// Keyed on the MEDIC — actorDiscordUserId — and NOT on targetCharacterId,
// which is the patient the row is about. Counting the patient's axis caps the
// wrong person: a medic treating other people would never be counted at all,
// and someone who had been treated four times could not treat anybody.
async function routineHealsThisTurn(db, discordUserId, turnId) {
  if (!turnId || !discordUserId) return 0;
  const filed = await db.auditLog.findMany({
    where: { actorDiscordUserId: discordUserId, actionType: "request_heal_character", turnId },
    select: { details: true },
  });
  return filed.filter(
    (r) => !r.details?.gambit && (r.details?.requirement?.turns ?? 0) > 0,
  ).length;
}

// --- Craft (docs/systemdocs/CRAFTING.md) ------------------------------

// The recipe, with everything the gates read.
async function loadRecipe(tagId) {
  const tag = await prisma.tag.findUnique({
    where: { id: tagId ?? "" },
    include: {
      group: { select: { requiredTagId: true } },
      requirementSkills: { select: { id: true, slug: true, name: true } },
    },
  });
  // requirementItems rides along on the full row `include` gives us — see
  // resolveRecipeItems below. Nothing to add here; noted because a narrower
  // `select` on this query would silently disable ingredient checking.
  if (!tag) throw new UserError("Unknown tag.");
  // Re-checked here because the client's filtered list is only advisory.
  if (!tag.craftable)
    throw new UserError("That isn't something you can make.");
  return tag;
}

// Every recipe skill, or a higher tier of it, held by the crafter.
async function requireRecipeSkills(character, tag) {
  if (!tag.requirementSkills.length) return;
  const catalog = await prisma.tag.findMany({
    select: { id: true, slug: true, parentTagId: true },
  });
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    buildSkillAncestry(catalog),
  );
  const missing = tag.requirementSkills.filter(
    (skill) => !satisfied.has(skill.id),
  );
  if (missing.length) {
    throw new UserError(
      `Making that needs ${missing.map((t) => t.name).join(" and ")}.`,
    );
  }
}

// Smithing and building need a forge; ordinary crafting needs your hands.
//
// The rule is read off the recipe's own skills rather than a per-tag flag, so
// a new sword is gated the moment it names a smithing skill and nobody has to
// remember a second field. Reach is "hold it, or stand somewhere one is set
// up" (db/lib/equipmentReach.js) — which is what makes the Factory floor and
// the Keep's forge worth walking to. See docs/systemdocs/SMITHING.md.
async function requireWorkshop(character, tag) {
  if (!needsWorkshop(tag)) return;
  if (await hasEquipmentInReach(prisma, character, WORKSHOP_EQUIPMENT_SLUG))
    return;
  throw new UserError(
    `Making that is smith's work: hold Workshop Equipment, or stand somewhere a set is already put up.`,
  );
}

// The recipe's INGREDIENTS (Tag.requirementItems), resolved against what the
// crafter is holding. Runs OUTSIDE the transaction, so somebody who can't make
// it is told before a single ⬢ moves.
//
// Most ingredients are SPENT, `quantity` units per craft — three molotovs take
// three Alcohol, the same way they take three lots of ⬢. An entry may also
// carry its own `count`, which multiplies: a blank book takes ten sheets, and
// three of them take thirty. An entry marked
// `keep` is the old hold-check instead: a body has its own lifecycle, so
// bottling a second Miasma over the same corpse is still allowed. A `group`
// entry is always kept, and is the only thing that can name a corpse written
// at death (that tag is not in docs/tags.yaml, so no authored slug could ever
// have named it). An `anyOf` entry is a spend the PLAYER picks — the Craft
// dialog posts `ingredientChoice`, and the membership check here is what makes
// that dialog a hint rather than a lock.
//
// Your OWN sheet only — never a room stash you could reach. Spending happens
// once, when the work STARTS: a multi-turn project pays its ingredients up
// front, the rule its ⬢ already lived under, so a continue re-checks nothing
// about them.
function resolveRecipeItems(character, tag, quantity, ingredientChoice) {
  const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : [];
  const plan = { spend: [], hold: [] };
  if (!items.length) return plan;
  const held = character.tags.filter((ct) => ct.tag);
  const bySlug = new Map(held.map((ct) => [ct.tag.slug, ct]));
  for (const item of items) {
    if (item.kind === "group") {
      if (!held.some((ct) => ct.tag.group?.slug === item.slug)) {
        throw new UserError(`Making that needs ${item.label}.`);
      }
      plan.hold.push({ kind: "group", slug: item.slug, label: item.label });
      continue;
    }
    let slug = item.slug;
    if (item.kind === "anyOf") {
      const choice =
        typeof ingredientChoice === "string" ? ingredientChoice.trim() : "";
      if (!choice || !item.slugs.includes(choice)) {
        throw new UserError(`Choose which of ${item.label} goes into it.`);
      }
      slug = choice;
    }
    const ct = bySlug.get(slug);
    const name = ct?.tag?.name ?? item.label;
    if (item.keep) {
      if (!ct) throw new UserError(`Making that needs ${item.label}.`);
      plan.hold.push({ kind: "tag", slug, label: item.label });
      continue;
    }
    const needed = quantity * (item.count ?? 1);
    if (!ct || ct.quantity < needed) {
      throw new UserError(
        needed > 1
          ? `Making ${quantity > 1 ? `${quantity} of those` : "that"} takes ${needed} × ${name}, and you have ${ct?.quantity ?? 0}.`
          : `Making that needs ${name}.`,
      );
    }
    plan.spend.push({ tagId: ct.tagId, tagName: name, quantity: needed });
  }
  return plan;
}

// The serializer every craft that touches a ration or a stack takes first.
// Postgres holds it to the end of the transaction, so two tabs submitting at
// once queue up instead of both reading the same count.
function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// Spends what resolveRecipeItems planned, inside the SAME transaction as the
// payment and under the row lock above.
//
// **The write is the check.** A conditional `updateMany` matches only while
// the stack still covers the draw, and a count of 0 refuses the craft.
// `dropCharacterTag` is deliberately not used here: it silently deletes the
// row on an overdraw rather than refusing (db/lib/tagWrites.js), which would
// turn "make 3 off a stack of 2" into a free third one.
//
// Returns the `replaced`-shaped snapshot the audit row records as
// `details.consumed` — the one record of the spend a GM repairs from.
async function consumeRecipeItems(tx, characterId, plan) {
  for (const item of plan.hold) {
    const still = await tx.characterTag.count({
      where: {
        characterId,
        tag:
          item.kind === "group"
            ? { group: { slug: item.slug } }
            : { slug: item.slug },
      },
    });
    if (!still) throw new UserError(`Making that needs ${item.label}.`);
  }
  const consumed = [];
  for (const { tagId, tagName, quantity } of plan.spend) {
    const row = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId } },
    });
    const short = () =>
      new UserError(`You don't have enough ${tagName} left for that.`);
    if (!row || row.quantity < quantity) throw short();
    if (row.quantity === quantity) {
      const { count } = await tx.characterTag.deleteMany({
        where: { id: row.id, quantity },
      });
      if (count === 0) throw short();
    } else {
      const { count } = await tx.characterTag.updateMany({
        where: { characterId, tagId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (count === 0) throw short();
    }
    consumed.push({
      tagId,
      tagName,
      quantity,
      source: row.source,
      expiresTurn: row.expiresTurn,
    });
  }
  return consumed;
}

// Prerequisite chain, exclusivity, tier replacement, duplicates — the same
// checks a purchase runs (web/lib/characterCreation.js). Returns the held
// lower tiers a grant would replace, snapshotted for Undo.
//
// `db` defaults to prisma for the fast fail outside the transaction; the
// grant paths run it AGAIN inside the tx via recheckGrantsUnderLock below,
// because a turn can now hold several Move-costing crafts and two of them
// racing could otherwise both pass an exclusivity or duplicate check that
// was true when each one read the sheet.
async function craftGrantChecks(character, tag, db = prisma) {
  // The whole catalog comes down so a chain walk never dead-ends on an
  // ancestor the character doesn't hold.
  const chainRows = await db.tag.findMany({
    select: {
      id: true,
      name: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const chainById = buildTagsById(
    chainRows.map((t) => ({
      ...t,
      conflictsWithIds: t.conflictsWith.map((c) => c.id),
    })),
  );
  const heldIds = character.tags.map((ct) => ct.tagId);
  if (!addRequirementSatisfied(tag, chainById, heldIds)) {
    throw new UserError("You're missing a prerequisite for that tag.");
  }
  const conflict = exclusiveConflict(tag, heldIds, chainById);
  if (conflict) {
    throw new UserError(`${tag.name} can't be held with ${conflict.name}.`);
  }
  const namedConflict = conflictingTag(
    chainById.get(tag.id) ?? tag,
    heldIds,
    chainById,
  );
  if (namedConflict)
    throw new UserError(`${tag.name} conflicts with ${namedConflict.name}.`);
  // A chain replaces upward and never re-opens downward.
  if (heldHigherTiers(tag, chainById, heldIds).length > 0) {
    throw new UserError(
      `You already hold a higher tier of ${tag.name}'s chain.`,
    );
  }
  if (!tag.stackable && character.tags.some((ct) => ct.tagId === tag.id)) {
    throw new UserError("You already have that tag.");
  }
  return character.tags
    .filter((ct) =>
      chainSiblingsToRemove(tag, chainById, heldIds).includes(ct.tagId),
    )
    .map((ct) => ({
      tagId: ct.tagId,
      tagName: ct.tag?.name ?? null,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: ct.quantity,
    }));
}

// The in-tx re-run, under the Character row lock, against the sheet as it is
// NOW rather than as it was when the fast fail read it. Stackable recipes
// skip it — a racing grant there only adds units to a stack, which nothing
// in craftGrantChecks refuses — so the everyday brews never pay for it.
// Returns the fresh `replaced` snapshot, which is the one the grant uses.
async function recheckGrantsUnderLock(tx, character, tag) {
  if (tag.stackable) return null;
  const fresh = await tx.characterTag.findMany({
    where: { characterId: character.id },
    include: { tag: { select: { name: true } } },
  });
  return craftGrantChecks({ ...character, tags: fresh }, tag, tx);
}

// Who pays: you, a room here, or a person here. Defaults to you.
async function resolveCraftPayer(character, payerKey, cost) {
  const key = payerKey || `character:${character.id}`;
  const payer = await resolveParty(key);
  if (!payer) throw new UserError("That payer isn't here any more — pick another.");
  if (!(await canReachParty(character, payer)))
    throw new UserError(outOfReachMessage(payer));
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);
  return payer;
}

// requireFreeMove and fileAutoRoutine moved to web/lib/moveSpend.js so the
// Thanati's Recover Equipment (thanatiActions.js) spends a Move by the same
// two rules as Bury, Engrave and Extract.

function craftLabel(tag, quantity) {
  return quantity > 1 ? `${quantity}× ${tag.name}` : tag.name;
}

// --- The craft Move budget (docs/systemdocs/CRAFTING.md §2a) -----------
//
// A craft that costs less than a whole Move files the same auto:craft Action
// every craft with turns files, and writes a LEDGER on it
// (`Action.craftBudget`): the family of work the Routine is committed to, how
// much of the Move is spent, and what was made. The next craft that turn reads
// that ledger back — same family, and enough left, or it is refused.
//
// Nothing is derived and nothing is cached: the row IS the record, which is
// why a GM Reject hands the whole turn back with one delete
// (web/lib/moveEconomy.js#deleteActionRestoringTurn needs no knowledge of any
// of this). There is no per-craft Undo; a GM reversing one craft by hand
// gets no budget back either — Reject is the full reset.

const MOVE_SPENT = "You've already used your Move this turn.";

// The Action's description, rebuilt from the ledger every time an entry lands,
// so a GM reading the desk sees the whole turn's work in one line rather than
// only the first thing made.
function craftLedgerDescription(entries) {
  const made = entries.map((e) => (e.qty > 1 ? `${e.qty}× ${e.name}` : e.name));
  return `Crafting this turn: ${made.join(", ")}.`;
}

function craftLedgerEntry(tag, cost) {
  return {
    tagId: tag.id,
    name: tag.name,
    // The free half of a straddling order is derivable: qty - num billed.
    qty: cost.freeQty + cost.billedQty,
    num: cost.num,
    den: cost.den,
  };
}

// Reads the turn's Action against what this craft needs. Returns the ledger to
// extend — null when there is no Action yet and this craft will file one — or
// throws the refusal.
//
// Called TWICE for every budget craft: once outside the transaction, so
// somebody who cannot act is told before a single ⬢ moves, and again inside it
// under the Character row lock, where the answer is the one that counts.
function checkCraftMove(action, need) {
  // Asked for more than a turn holds — 20 work knives is five Moves' worth of
  // spill — which an empty turn would otherwise wave through, since there is
  // no ledger yet to fail against.
  if (!fitsInRemaining(need, WHOLE_MOVE)) {
    throw new UserError(
      "That's more than a turn's work — make fewer at once.",
    );
  }
  if (!action) return null;
  // A recipe with no craft family can neither lock a Routine nor share one, in
  // either direction — so anything already filed stops it.
  if (!need.family) throw new UserError(MOVE_SPENT);
  // `includes`, not equality: other machinery APPENDS to gmNotes (the staged
  // push does, on Actions it claims), and an appended note must not strand a
  // half-spent ledger behind "Move already used".
  if (!(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    throw new UserError(MOVE_SPENT);
  const ledger = action.craftBudget;
  if (ledger.family !== need.family) {
    throw new UserError(
      `Your Routine this turn is ${craftFamilyLabel(ledger.family)} work, and that isn't.`,
    );
  }
  const left = ledgerRemaining(ledger);
  if (!fitsInRemaining(need, left)) {
    const asks =
      need.num >= need.den
        ? "a whole Move"
        : `${formatMoveFraction(need.num, need.den)} of a Move`;
    throw new UserError(
      left.num > 0
        ? `That takes ${asks}, and you have ${formatMoveFraction(left.num, left.den)} of this turn's Routine left.`
        : `That takes ${asks}, and this turn's Routine is spent.`,
    );
  }
  return ledger;
}

// The fast fail, outside the transaction. Replaces requireFreeMove on the
// craft path only — Bury, Engrave, Extract and the build sites still take a
// whole clean Move and keep it.
async function resolveCraftMove(character, openTurn, need) {
  if (!openTurn) throw new UserError("No turn is open.");
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { autoTurnAdvanceDisabled: true },
  });
  const { locked } = moveWindow(openTurn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  if (locked) throw new UserError("Moves are locked for this turn.");
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  checkCraftMove(action, need);
}

// Claims the Move — or the slice of it — this craft needs, inside the caller's
// transaction. Everything checkCraftMove looked at outside is read again here
// under the Character row lock, because two tabs can both have passed the
// cheap check a moment ago. The `@@unique([characterId, turnId])` P2002 catch
// in fileAutoRoutine stays the backstop underneath even that.
//
// `description` is what the Action says when this craft is the one that files
// it. A project turn passes its own "(2/3)" line and keeps it — a project
// never shares a turn, so nothing rebuilds it. A fractional craft passes none,
// and gets the running list of everything made this turn instead.
async function spendCraftMove(
  tx,
  { character, openTurn, need, entry, description = null },
) {
  await lockCharacter(tx, character.id);
  const existing = await tx.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true, gmNotes: true, craftBudget: true },
  });
  const ledger = checkCraftMove(existing, need);
  // No family, no ledger: the craft takes the whole Move the way it always
  // has, and the next one that turn is refused by the Action's own existence.
  if (!need.family) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        description,
        "auto:craft",
      ),
      budget: null,
    };
  }
  const entries = [...(ledger?.entries ?? []), entry];
  const used = addFractions(ledgerUsed(ledger), need);
  const budget = {
    family: need.family,
    usedNum: used.num,
    usedDen: used.den,
    entries,
  };
  const line = description ?? craftLedgerDescription(entries);
  if (!existing) {
    return {
      action: await fileAutoRoutine(
        tx,
        character,
        openTurn,
        line,
        "auto:craft",
        budget,
      ),
      budget,
    };
  }
  // `updateMany` + count, not `update`: a GM Reject deletes the Action row
  // without taking the Character lock, and racing it should read as "your
  // turn was just reset", not as a raw P2025.
  const { count } = await tx.action.updateMany({
    where: { id: existing.id },
    data: { craftBudget: budget, description: line },
  });
  if (count === 0)
    throw new UserError("A GM just reset your turn — try again.");
  return { action: existing, budget };
}

// The finished thing lands on the sheet: the replaced tiers come off, the
// tag goes on with its clock, and the ADD_TAG request records all of it.
// The FIFTH runtime authoring door onto the tag catalog (db/lib/paperMint.js
// lists the other four): a `customizable` recipe crafted with player words
// mints a clone of the base row — custom + ephemeral, `craftable: false` so
// it is an ITEM and never a recipe — and the craft grants THAT row. Runs
// OUTSIDE the craft transaction, deliberately: createWithRetry's P2002 retry
// is unusable inside one (paperMint.js documents the 25P02 trap), and the
// composed name collides ROUTINELY — the same cook naming the same dish
// twice is the normal case, not the freak one. Two answers, in order: an
// identical existing mint (same name, same words) is REUSED, so the second
// batch of "Steak Dinner (Lavish Meal)" stacks onto the first; a same-name,
// different-words mint picks up a "(2)" via the retry. The caller deletes a
// freshly minted row if the transaction it fed then fails.
//
// What is deliberately NOT copied: the requirement block (an item has no
// recipe to advertise), depotPrice (the Depot's book must never list a
// player's words — its query also filters `ephemeral` as a second lock),
// and catalogVisibility (the GM default keeps a mint out of the public
// catalog; referenceData ships an ephemeral row only to who holds it).
async function mintCustomCraft(db, baseTag, { name, description, literal = false }) {
  // `literal` is the Death Mask's door: the name arrives finished ("Death
  // Mask of Ada" — stamped from the corpse, never typed) and must not gain
  // the "(Death Mask)" suffix a player-worded custom wears, because the base
  // identity is already the first two words.
  const composedName = literal ? name : customCraftName(baseTag.name, name);
  const composedDescription = description || baseTag.description;
  const existing = await db.tag.findFirst({
    where: {
      custom: true,
      ephemeral: true,
      name: composedName,
      description: composedDescription,
    },
  });
  if (existing) return { tag: existing, minted: false };
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  const tag = await createWithRetry(db, (attempt) => ({
    slug: `custom-craft-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`,
    name: attempt ? `${composedName} (${attempt + 1})` : composedName,
    description: composedDescription,
    custom: true,
    ephemeral: true,
    craftable: false,
    customizable: false,
    pointCost: 0,
    category: baseTag.category,
    groupId: baseTag.groupId ?? null,
    tradeable: baseTag.tradeable,
    weightLbs: baseTag.weightLbs,
    stackable: baseTag.stackable,
    inspectVisibility: baseTag.inspectVisibility,
    equippable: baseTag.equippable,
    equipSlot: baseTag.equipSlot,
    equipLayer: baseTag.equipLayer,
    removable: baseTag.removable,
    consumable: baseTag.consumable,
    consumesInto: baseTag.consumesInto,
    consumesIntoOneOf: baseTag.consumesIntoOneOf ?? undefined,
    consumesIntoUnless: baseTag.consumesIntoUnless ?? undefined,
    consumesIntoDurations: baseTag.consumesIntoDurations ?? undefined,
    consumesIntoResources: baseTag.consumesIntoResources,
    sellable: baseTag.sellable,
    sellablePrice: baseTag.sellablePrice,
    defaultDurationTurns: baseTag.defaultDurationTurns,
    expiresInto: baseTag.expiresInto ?? undefined,
  }));
  if (!tag)
    throw new UserError("Couldn't find a free name for that — try different words.");
  return { tag, minted: true };
}

// Best-effort undo of a mint whose craft transaction failed: the guard on
// `custom` means this can never touch a catalog row, and a row somebody
// already holds is FK-pinned and simply survives (prune's problem, not
// ours). Failures are swallowed — the craft's own error is the one to show.
async function unmintCustomCraft(db, grant) {
  if (!grant?.minted) return;
  await db.tag
    .deleteMany({ where: { id: grant.tag.id, custom: true, ephemeral: true } })
    .catch(() => {});
}

async function grantCrafted(
  tx,
  {
    session,
    character,
    tag,
    quantity,
    openTurn,
    replaced,
    payer,
    cost,
    project = null,
    action = null,
    consumed = [],
    // The base RECIPE when `tag` is a minted custom row — what the ration
    // counters bill this grant against (web/lib/requests.js reads
    // details.baseTagId), and what a GM reading the audit row sees it was.
    baseTag = null,
    // Recipe-specific extras for the audit row (the Death Mask records its
    // source corpse here).
    extraDetails = {},
  },
) {
  for (const snapshot of replaced)
    await dropCharacterTag(tx, character.id, snapshot.tagId);
  await addToStack(tx, character.id, tag.id, quantity, {
    source: "CRAFT",
    // Must arrive already stamped or it never expires — resolveNeeds()'s
    // sweep matches on expiresTurn and nothing backfills it.
    expiresTurn: await expiryForGrant(tx, tag, openTurn, {
      characterId: character.id,
      where: "craftRequest",
    }),
    stackable: tag.stackable,
  });
  const payerParty = { kind: payer.kind, id: payer.id, name: payer.name };
  return logAudit(tx, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_craft_tag",
    targetCharacterId: character.id,
    // The ration counters below read this back; without it they cannot tell
    // this turn's work from last turn's.
    turnId: openTurn?.id ?? null,
    details: {
      tagId: tag.id,
      tagName: tag.name,
      quantity,
      resourcesSpent: cost,
      payer: payerParty,
      projectId: project?.id ?? null,
      // The base RECIPE behind a minted custom row — the ration counters in
      // web/lib/requests.js bill by it, so a custom Lavish Meal obeys the
      // plain one's per-turn cap.
      ...(baseTag ? { baseTagId: baseTag.id, baseTagName: baseTag.name } : {}),
      ...(project ? { turnsNeeded: project.turnsNeeded } : {}),
      ...(action ? { actionId: action.id } : {}),
      ...(replaced.length ? { replaced } : {}),
      // What the ingredients cost, in the `replaced` shape. This row is the
      // ONLY record of the spend now — a GM repairing a craft by hand reads
      // it here. A multi-turn project spent these when it STARTED and
      // carried the snapshot on CraftProject.consumed until now.
      ...(consumed?.length ? { consumed } : {}),
      ...extraDetails,
    },
  });
}

// --- The Death Mask (docs/tags.yaml `death-mask`) -------------------------
//
// The one recipe whose OUTPUT is named by an ingredient: the finished item is
// stamped with the dead character's name ("Death Mask of Ada"), read off the
// corpse it was cast over. The corpse is a group ingredient and so KEPT — but
// a face can only be cut once, so the craft marks the corpse's own
// description and refuses one already marked. The marker doubles as the
// fiction: Examine says the face is gone.
const DEATH_MASK_SLUG = "death-mask";
const FACE_TAKEN_SENTENCE = "The face has been taken.";

function maskNameFor(corpseName) {
  // "Ada's Corpse" → "Ada"; "Ada's Corpse (2)" → "Ada (2)"; the authored
  // monster corpses ("Graga Corpse") lose the bare word instead.
  const who = corpseName.replace(/'s Corpse\b/, "").replace(/ Corpse\b/, "").trim();
  return `Death Mask of ${who || "Nobody"}`;
}

// Which held corpse the mask is taken from. `ingredientChoice` carries the
// corpse tag's SLUG (the same channel an anyOf pick uses — a recipe has at
// most one of the two, so they cannot collide); a single unmarked corpse is
// taken as chosen, the dialog's one-option convention.
function resolveDeathMaskSource(character, ingredientChoice) {
  const corpses = character.tags.filter(
    (ct) => ct.tag?.group?.slug === "items-corpse",
  );
  if (!corpses.length) throw new UserError("Making that needs a corpse to hand.");
  const untaken = corpses.filter(
    (ct) => !(ct.tag.description ?? "").includes(FACE_TAKEN_SENTENCE),
  );
  if (!untaken.length)
    throw new UserError("Every face here has already been taken.");
  const choice = typeof ingredientChoice === "string" ? ingredientChoice.trim() : "";
  const picked = choice
    ? untaken.find((ct) => ct.tag.slug === choice)
    : untaken.length === 1
      ? untaken[0]
      : null;
  if (!picked) throw new UserError("Choose whose face the mask is taken from.");
  return { tagId: picked.tagId, name: picked.tag.name };
}

// Marks the corpse inside the craft transaction. Compare-and-swap on the
// exact description text, so two artists racing over one body cannot both
// take the face — the loser's write matches nothing and the craft refuses.
async function takeFace(tx, source) {
  const row = await tx.tag.findUnique({
    where: { id: source.tagId },
    select: { description: true },
  });
  const current = row?.description ?? "";
  if (current.includes(FACE_TAKEN_SENTENCE))
    throw new UserError("That face has already been taken.");
  const next = `${current.replace(/\s*‡\s*$/, "")} ${FACE_TAKEN_SENTENCE} ‡`.trim();
  const { count } = await tx.tag.updateMany({
    where: { id: source.tagId, description: current },
    data: { description: next },
  });
  if (!count) throw new UserError("That face has already been taken.");
}

function payerNotice(character, payer, cost, tag) {
  if (payer.kind !== "character" || payer.id === character.id || !cost) return;
  notifyCharacter(
    payer,
    `${character.name} paid ${cost} ⬢ from your purse toward ${tag.name}.`,
  );
}

async function craftRequestImpl({
  tagId,
  quantity: rawQuantity,
  payerKey,
  // Which member of an `anyOf` ingredient goes in — a slug the dialog posts,
  // re-checked for membership and possession like everything else a client
  // sends.
  ingredientChoice,
  // The custom-item fields (CRAFTING.md), honored only on a `customizable`
  // recipe. cleanCustomText decides what survives — the same shared helper
  // the dialog priced the +1 ⬢ with, so client and server cannot disagree
  // about whether a whitespace-only name counts.
  customName,
  customDescription,
  // The builder's line, honored only where placement.inscribable says so.
  inscription,
  // How many units the dialog TOLD the player would bill against their Move
  // (0 when it showed the craft as free). The server refuses to bill more
  // than was acknowledged: a stale tab whose free allowance ran out
  // elsewhere gets a retry, not a silent Move charge. "Declining crafts
  // nothing" is enforced here, not just in the confirm dialog.
  billedSeen: rawBilledSeen,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const tag = await loadRecipe(tagId);
  await requireRecipeSkills(character, tag);
  // Fieldwork is the one exemption from the forge: a recipe naming builder-*
  // skills otherwise demands Workshop Equipment in reach, which is right for
  // heavy works and wrong for stakes and drying racks.
  const placement = placementOf(tag);
  if (!placement?.fieldwork) await requireWorkshop(character, tag);
  // A `placement:` recipe is BUILT ON SITE and never lands on a sheet, so the
  // tag-tier gates below — prerequisites, exclusivity, tier replacement,
  // stacks — have nothing to say about it. It never carries ingredients
  // either; the sync refuses that pairing (db/lib/tagShapes.js).
  if (placement)
    return openBuildSiteImpl(character, session, tag, {
      payerKey,
      inscription,
    });
  const replaced = await craftGrantChecks(character, tag);

  const quantity = tag.stackable
    ? (parseCount(rawQuantity, { min: 1, max: 99 }) ?? 1)
    : 1;
  // Resolved once the count is known, since a spend scales with it.
  const itemPlan = resolveRecipeItems(
    character,
    tag,
    quantity,
    ingredientChoice,
  );
  // The Death Mask binds a SPECIFIC corpse (the group entry above only
  // proved one is held) — resolved out here for the fast fail, marked
  // inside the transaction by takeFace.
  const deathMask =
    tag.slug === DEATH_MASK_SLUG
      ? resolveDeathMaskSource(character, ingredientChoice)
      : null;
  // Customizing is +CUSTOM_SURCHARGE ⬢ a unit, like every other per-unit
  // cost. Fields posted against a non-customizable recipe are ignored, not
  // refused — the same posture as quantity on a non-stackable.
  const custom = tag.customizable
    ? customCraftFields({ customName, customDescription })
    : { name: "", description: "", active: false };
  const turns = tag.requirementTurns ?? 1;
  const cost =
    ((tag.requirementResources ?? 0) + (custom.active ? CUSTOM_SURCHARGE : 0)) *
    quantity;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();

  // No Move of its own, but rationed per turn (docs/systemdocs/SMITHING.md §2):
  // a recipe's own `perTurn`, or the shared Dead Simple pool. Units PAST the
  // allowance are no longer refused — for a recipe with a craft family they
  // spill into the Move at 1/allowance each (CRAFTING.md §2a), which is what
  // makes a fifth work knife cost something rather than be impossible.
  //
  // Priced twice: here for a fast fail, and again inside the transaction under
  // the row lock, since two simultaneous requests would otherwise both read
  // the same count and pass.
  const perTurn = tag.requirementPerTurn ?? null;
  if (turns === 0) {
    const allowance = openTurn ? craftAllowance(tag) : null;
    const priceCraft = async (db) => {
      const already =
        allowance == null
          ? 0
          : perTurn != null
            ? await unitsOfTagThisTurn(db, character.id, openTurn.id, tag.id)
            : await deadSimpleUnitsThisTurn(db, character.id, openTurn.id);
      const priced = craftMoveCost(tag, {
        quantity,
        allowance,
        freeLeft: allowance == null ? null : allowance - already,
      });
      // No family to bill the overflow to (bone-mask is gated on `butcher`
      // alone), so the ration is still a wall.
      if (priced.kind === "capped") {
        throw new UserError(
          `You can only make ${allowance} ${tag.name} per turn (${already} already this turn).`,
        );
      }
      return priced;
    };
    const billedSeen = parseCount(rawBilledSeen, { min: 0, max: 99 }) ?? 0;
    // The player is never billed more than the dialog showed them. Priced
    // here for the fast fail, and AGAIN inside the transaction, where a
    // concurrent craft may have eaten the free allowance between the two —
    // the in-tx copy is what actually holds.
    const acknowledgeBill = (priced) => {
      if (priced.billedQty > billedSeen) {
        throw new UserError(
          "Your free allowance changed since this page loaded — reload to see the new cost.",
        );
      }
    };
    const moveCost = await priceCraft(prisma);
    acknowledgeBill(moveCost);
    if (moveCost.kind === "spill")
      await resolveCraftMove(character, openTurn, moveCost);
    // Minted before the transaction (see mintCustomCraft for why), unwound
    // after it only if the transaction fails and the row was fresh.
    const grant = custom.active ? await mintCustomCraft(prisma, tag, custom) : null;
    try {
    await prisma.$transaction(async (tx) => {
      // One lock for all the racy things: the ration counts, the ingredient
      // stacks, the grant re-check, and the Move ledger (spendCraftMove takes
      // it again, which costs nothing once this transaction holds it).
      if (allowance != null || itemPlan.spend.length || !tag.stackable) {
        await lockCharacter(tx, character.id);
      }
      const spend = await priceCraft(tx);
      acknowledgeBill(spend);
      let action = null;
      let budget = null;
      if (spend.kind === "spill") {
        // The fast fail only ran resolveCraftMove when the OUTSIDE price
        // already spilled, so a spill first seen here re-checks the Move
        // window itself — a craft submitted after Moves lock must not write
        // a ledger no matter how the race fell.
        if (moveCost.kind !== "spill") {
          const config = await tx.gameConfig.findUnique({
            where: { id: 1 },
            select: { autoTurnAdvanceDisabled: true },
          });
          const { locked } = moveWindow(openTurn, {
            autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
          });
          if (locked)
            throw new UserError("Moves are locked for this turn.");
        }
        ({ action, budget } = await spendCraftMove(tx, {
          character,
          openTurn,
          need: spend,
          entry: craftLedgerEntry(tag, spend),
        }));
      }
      const replacedNow =
        (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
      const consumed = await consumeRecipeItems(tx, character.id, itemPlan);
      if (cost) await moveResources(tx, payer, -cost);
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost,
        action,
        consumed,
      });
    });
    } catch (err) {
      await unmintCustomCraft(prisma, grant);
      throw err;
    }
    await afterInventoryChange([
      character.id,
      payer.kind === "character" ? payer.id : null,
    ]);
    payerNotice(character, payer, cost, tag);
    revalidateAll();
    return { made: craftLabel(grant?.tag ?? tag, quantity) };
  }

  // Real work: this turn's Move, and a project if it takes more than one.
  //
  // Quantity is limited by WORK ARITHMETIC and nothing else (Chris
  // 2026-09-06): a unit costs its `turnsCost` of the Move — a whole turn,
  // or the 1/N a fractional recipe authors — so a brewer's Routine holds
  // three ⅓-turn Alcohol and a smith's holds ONE broadsword, and a spare
  // half-turn takes more same-family work or none. A project takes the Move
  // whole every turn it runs, so it can never share one — and it makes ONE
  // unit, its turns being per piece; wanting two means starting it twice.
  if (turns > 1 && quantity > 1) {
    throw new UserError(
      `That's ${turns} turns of work apiece — make them one at a time.`,
    );
  }
  const moveCost = craftMoveCost(tag, { quantity });
  // The cross-submission count — for a fractional recipe, `perTurn` holds
  // its work denominator, so this and the budget agree by construction.
  const ration = async (db) => {
    if (perTurn == null || !openTurn) return;
    const already = await unitsOfTagThisTurn(
      db,
      character.id,
      openTurn.id,
      tag.id,
    );
    if (already + quantity > perTurn) {
      throw new UserError(
        `You can only make ${perTurn} ${tag.name} per turn (${already} already this turn).`,
      );
    }
  };
  await ration(prisma);
  await resolveCraftMove(character, openTurn, moveCost);
  const finishes = turns === 1;
  let done = false;
  // A finishing craft mints now (outside the tx — mintCustomCraft says why);
  // a longer project carries the words on CraftProject.custom instead, and
  // continueCraftImpl mints them on the finishing turn. The Death Mask's
  // stamped name rides the same machinery in literal mode.
  const grant = finishes
    ? deathMask
      ? await mintCustomCraft(prisma, tag, {
          name: maskNameFor(deathMask.name),
          description: "",
          literal: true,
        })
      : custom.active
        ? await mintCustomCraft(prisma, tag, custom)
        : null
    : null;
  try {
  await prisma.$transaction(async (tx) => {
    // Ingredients go in when the work starts, the same moment the ⬢ do — and
    // like the ⬢ they never come back if the project is abandoned. A project
    // longer than a turn carries the snapshot on itself until it finishes.
    await lockCharacter(tx, character.id);
    await ration(tx);
    // The Move is claimed first: it is the contended thing, and a refusal
    // here rolls back everything below it.
    const { action, budget } = await spendCraftMove(tx, {
      character,
      openTurn,
      need: moveCost,
      entry: craftLedgerEntry(tag, moveCost),
      // A batch craft lets the Action's description be rebuilt from the
      // ledger; everything else keeps the line it has always written.
      description:
        moveCost.kind === "share"
          ? null
          : finishes
            ? `Crafted ${craftLabel(tag, quantity)}.`
            : `Crafting ${craftLabel(tag, quantity)} (1/${turns}).`,
    });
    const replacedNow =
      (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
    const consumed = await consumeRecipeItems(tx, character.id, itemPlan);
    // The face comes off when the work starts, like every other ingredient
    // cost — an abandoned mask still ruined the face, and no second cast
    // can ever be taken from this body.
    if (deathMask) await takeFace(tx, deathMask);
    if (cost) await moveResources(tx, payer, -cost);
    const project = await tx.craftProject.create({
      data: {
        characterId: character.id,
        tagId: tag.id,
        quantity,
        turnsNeeded: turns,
        turnsDone: 1,
        resourcesCost: cost,
        consumed: consumed.length ? consumed : undefined,
        custom:
          deathMask && !finishes
            ? {
                deathMask: {
                  name: maskNameFor(deathMask.name),
                  sourceCorpseTagId: deathMask.tagId,
                  sourceCorpseName: deathMask.name,
                },
              }
            : custom.active && !finishes
              ? { name: custom.name, description: custom.description }
              : undefined,
        payerKey: `${payer.kind}:${payer.id}`,
        payerName: payer.name,
        startedTurnId: openTurn.id,
        lastTurnId: openTurn.id,
      },
    });
    done = finishes;
    if (done) {
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost,
        project,
        action,
        consumed,
        extraDetails: deathMask
          ? { sourceCorpseTagId: deathMask.tagId, sourceCorpseName: deathMask.name }
          : {},
      });
      await tx.craftProject.update({
        where: { id: project.id },
        data: { status: "DONE" },
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_started",
        targetCharacterId: character.id,
        details: {
          projectId: project.id,
          tagId: tag.id,
          tagName: tag.name,
          quantity,
          turnsNeeded: turns,
          resourcesCost: cost,
          payer: { kind: payer.kind, id: payer.id, name: payer.name },
          actionId: action.id,
        },
      });
    }
  });
  } catch (err) {
    await unmintCustomCraft(prisma, grant);
    throw err;
  }
  await afterInventoryChange([
    character.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  payerNotice(character, payer, cost, tag);
  revalidateAll();
  return done
    ? { made: craftLabel(grant?.tag ?? tag, quantity) }
    : { started: craftLabel(tag, quantity), turns };
}

async function loadOwnProject(character, projectId) {
  const project = await prisma.craftProject.findFirst({
    where: { id: projectId ?? "", characterId: character.id, status: "ACTIVE" },
    include: {
      tag: {
        include: {
          group: { select: { requiredTagId: true } },
          requirementSkills: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });
  if (!project)
    throw new UserError("That project isn't yours, or it's finished.");
  return project;
}

// Another turn on a project. The recipe's gates are re-run: a skill lost
// since the start stops the work where it stands.
//
// The INGREDIENTS are not re-checked, and must not be — they were spent when
// the work started, so an honest continue would fail its own check on turn 2.
async function continueCraftImpl({ projectId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const project = await loadOwnProject(character, projectId);
  const tag = project.tag;
  await requireRecipeSkills(character, tag);
  await requireWorkshop(character, tag);
  const openTurn = await getOpenTurn();
  // A turn on a project is the whole Move, so it demands a clean one: any
  // fraction already spent on a batch craft blocks it, and it blocks
  // everything after it (docs/systemdocs/CRAFTING.md §2a).
  const moveCost = { family: craftFamily(tag), num: 1, den: 1 };
  await resolveCraftMove(character, openTurn, moveCost);
  if (project.lastTurnId === openTurn.id)
    throw new UserError("You've already worked on that this turn.");

  const payerKeyParts = (project.payerKey ?? "").split(":");
  const payer = {
    kind: payerKeyParts[0] || "character",
    id: payerKeyParts[1] || character.id,
    name: project.payerName ?? character.name,
  };
  const next = project.turnsDone + 1;
  const done = next >= project.turnsNeeded;
  const replaced = done ? await craftGrantChecks(character, tag) : [];
  // The words stored when the work began (already cleaned then; cleaned
  // again here because re-sanitizing is free and stored JSON is still
  // input). Minted outside the tx — mintCustomCraft says why — and unwound
  // if the transaction fails.
  const pendingCustom =
    done && project.custom && typeof project.custom === "object"
      ? customCraftFields({
          customName: project.custom.name,
          customDescription: project.custom.description,
        })
      : { active: false };
  // A Death Mask project stamped its name (and source corpse) at start —
  // stored under its own key so customCraftFields above ignores it.
  const pendingMask =
    done && project.custom && typeof project.custom === "object" && project.custom.deathMask
      ? project.custom.deathMask
      : null;
  const grant = pendingMask
    ? await mintCustomCraft(prisma, tag, {
        name: pendingMask.name,
        description: "",
        literal: true,
      })
    : pendingCustom.active
      ? await mintCustomCraft(prisma, tag, pendingCustom)
      : null;
  try {
  await prisma.$transaction(async (tx) => {
    const claim = await tx.craftProject.updateMany({
      where: { id: project.id, status: "ACTIVE", turnsDone: project.turnsDone },
      data: { turnsDone: next, lastTurnId: openTurn.id },
    });
    if (claim.count === 0)
      throw new UserError("That project moved on without you — reload.");
    const { action, budget } = await spendCraftMove(tx, {
      character,
      openTurn,
      need: moveCost,
      entry: {
        tagId: tag.id,
        name: tag.name,
        qty: project.quantity,
        num: 1,
        den: 1,
      },
      description: done
        ? `Crafted ${craftLabel(tag, project.quantity)}.`
        : `Crafting ${craftLabel(tag, project.quantity)} (${next}/${project.turnsNeeded}).`,
    });
    if (done) {
      const replacedNow =
        (await recheckGrantsUnderLock(tx, character, tag)) ?? replaced;
      await grantCrafted(tx, {
        session,
        character,
        tag: grant?.tag ?? tag,
        baseTag: grant ? tag : null,
        quantity: project.quantity,
        openTurn,
        replaced: replacedNow,
        payer,
        cost: project.resourcesCost,
        project,
        action,
        // Spent back when the work began; carried here so the audit row
        // records the full price of the finished thing.
        consumed: Array.isArray(project.consumed) ? project.consumed : [],
        extraDetails: pendingMask
          ? {
              sourceCorpseTagId: pendingMask.sourceCorpseTagId,
              sourceCorpseName: pendingMask.sourceCorpseName,
            }
          : {},
      });
      await tx.craftProject.update({
        where: { id: project.id },
        data: { status: "DONE" },
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "craft_continued",
        targetCharacterId: character.id,
        details: {
          projectId: project.id,
          tagId: tag.id,
          tagName: tag.name,
          turnsDone: next,
          turnsNeeded: project.turnsNeeded,
          actionId: action.id,
        },
      });
    }
  });
  } catch (err) {
    await unmintCustomCraft(prisma, grant);
    throw err;
  }
  if (done) await afterInventoryChange(character.id);
  revalidateAll();
  return done
    ? { made: craftLabel(grant?.tag ?? tag, project.quantity) }
    : {
        continued: craftLabel(tag, project.quantity),
        turnsDone: next,
        turns: project.turnsNeeded,
      };
}

// Stopping keeps nothing: the ⬢ AND the ingredients went into materials when
// the work began, and neither comes back.
async function cancelCraftImpl({ projectId }) {
  const { session, character } = await requireCharacter();
  const project = await loadOwnProject(character, projectId);
  await prisma.$transaction(async (tx) => {
    await tx.craftProject.update({
      where: { id: project.id },
      data: { status: "CANCELLED" },
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "craft_cancelled",
      targetCharacterId: character.id,
      details: {
        projectId: project.id,
        tagId: project.tagId,
        tagName: project.tag.name,
        turnsDone: project.turnsDone,
        turnsNeeded: project.turnsNeeded,
        resourcesCost: project.resourcesCost,
      },
    });
  });
  revalidateAll();
  return { cancelled: project.tag.name };
}

// --- Building (db/lib/structures.js) ----------------------------------
//
// A craftable whose Tag.placement is non-null is raised ON SITE instead of
// landing in a pocket. Costs are CREW-TURNS: `turnsCost` is the total number
// of person-turns, and anyone standing at the site can spend their daily Move
// advancing it. The recipe's skills gate OPENING a site, never joining one —
// a mason lays out the work, the labour is anybody's. The opener pays the
// whole resourceCost up front and never gets it back, the CraftProject rule.

// The ground, with everything canBuildHere() judges plus the channel the
// site speaks into.
async function loadBuildGround(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      indoors: true,
      attributes: true,
      discordChannelId: true,
      zone: { select: { kind: true } },
    },
  });
}

// Scenery into the Location's own channel, post-commit and catch-logged: a
// Discord outage must never roll back work that really happened
// (ARCHITECTURE.md §5).
function speakAtSite(channelId, line) {
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ambient line failed:", err),
    ),
  );
}

// A structure has no owner, but everyone whose turns raised it hears when it
// changes state. db/lib/structures.js returns characterIds only, so the DM
// addresses are looked up here.
async function notifyStakeholders(
  structureId,
  { except = null, payerKey = null },
  text,
) {
  const ids = await stakeholderCharacterIds(prisma, structureId, {
    except,
    payerKey,
  });
  if (!ids.length) return;
  const people = await prisma.character.findMany({
    where: { id: { in: ids }, status: "ALIVE" },
    select: { id: true, discordUserId: true },
  });
  for (const person of people) notifyCharacter(person, text);
}

// The finish, recorded inside the SAME transaction that claimed the last
// crew-turn. The claim is the caller's conditional updateMany — nothing here
// may re-read status to decide, or there would be two winners.
async function finishStructure(
  tx,
  { session, character, site, location, openTurn, action },
) {
  const contributors = await tx.structureWork.findMany({
    where: { structureId: site.id },
    select: { characterId: true, characterName: true },
  });
  const payerParts = String(site.payerKey ?? "").split(":");
  const payer = {
    kind: payerParts[0] || "character",
    id: payerParts[1] || null,
    name: site.payerName ?? null,
  };
  const effect = {
    structureId: site.id,
    typeSlug: site.typeSlug,
    typeName: site.typeName,
    locationId: site.locationId,
    locationName: location?.name ?? null,
    turnsNeeded: site.turnsNeeded,
    resourcesSpent: site.resourcesCost ?? 0,
    payer,
    contributors: contributors.map((w) => ({
      characterId: w.characterId,
      name: w.characterName,
    })),
    builderName: site.builderName ?? null,
    actionId: action?.id ?? null,
  };
  await logAudit(tx, {
    actorDiscordUserId: session.discordUserId,
    actionType: "build_completed",
    targetCharacterId: character.id,
    details: {
      structureId: site.id,
      typeSlug: site.typeSlug,
      typeName: site.typeName,
      locationId: site.locationId,
      turnsNeeded: site.turnsNeeded,
      resourcesSpent: site.resourcesCost ?? 0,
      payer,
      actionId: action?.id ?? null,
    },
  });
}

// The one-per-place rule. The wreck statuses (RUINED, ABANDONED) are
// deliberately absent from the list: clearing a wreck and raising a new one
// on the same ground is what they are for. Runs twice per open, the Dead
// Simple pattern: once before the transaction for a fast fail, and again
// inside it under the Location row lock, since two tabs would otherwise
// both read the same ground and both pass.
async function refuseSameTypeHere(db, location, tag, placement) {
  const standing = await structuresAt(db, location.id, {
    statuses: PRESENT_STATUSES,
  });
  const sameType = standing.filter((s) => s.typeSlug === tag.slug);
  if (sameType.some((s) => s.status === "UNDER_CONSTRUCTION")) {
    throw new UserError(
      `A ${tag.name} is already going up here — lend a hand to that one instead.`,
    );
  }
  if (placement.unique && sameType.length) {
    throw new UserError(`There is already a ${tag.name} here.`);
  }
}

// Opening a site: the gates the recipe carries have already run in
// craftRequestImpl. What is left is the GROUND, the one-per-place rule, and
// the charge.
async function openBuildSiteImpl(
  character,
  session,
  tag,
  { payerKey, inscription },
) {
  const placement = placementOf(tag);
  // The builder's line, only where the type invites one (the wayside
  // shrine's placement.inscribable). Cleaned by the shared helper — no rich
  // tokens, no ‡, no @ — and it prints in Examine in place of the stock
  // examine fragment (db/lib/locationAttributes.js#structureLines).
  const inscribed = placement?.inscribable
    ? cleanCustomText(inscription, INSCRIPTION_MAX)
    : "";
  const location = await loadBuildGround(character.locationId);
  const ground = canBuildHere(location);
  if (!ground.ok) throw new UserError(ground.reason);

  await refuseSameTypeHere(prisma, location, tag, placement);

  // Always one. A structure is a place, not a stack.
  const cost = tag.requirementResources ?? 0;
  const turns = tag.requirementTurns ?? 1;
  const payer = await resolveCraftPayer(character, payerKey, cost);
  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const done = turns <= 1;
  let structureId = null;
  await prisma.$transaction(async (tx) => {
    // The ground was judged outside this transaction, so two tabs can both
    // have passed. The Location row is the lock — every open here serialises
    // on it — and the re-check against tx sees whatever the winner committed.
    await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${location.id} FOR UPDATE`;
    await refuseSameTypeHere(tx, location, tag, placement);
    if (cost) await moveResources(tx, payer, -cost);
    // A one-turn build is born finished: the row is created inside this
    // transaction, so nobody else can be racing for its completion and the
    // conditional claim join uses would have nothing to guard.
    const site = await tx.structure.create({
      data: {
        locationId: location.id,
        typeSlug: tag.slug,
        typeName: tag.name,
        status: done ? "COMPLETE" : "UNDER_CONSTRUCTION",
        turnsNeeded: turns,
        turnsDone: 1,
        resourcesCost: cost,
        payerKey: `${payer.kind}:${payer.id}`,
        payerName: payer.name,
        builderCharacterId: character.id,
        builderName: character.name,
        startedTurnId: openTurn.id,
        inscription: inscribed || null,
      },
    });
    structureId = site.id;
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done
        ? `Raised a ${tag.name}.`
        : `Raising a ${tag.name} (1/${turns}).`,
      "auto:build",
    );
    await tx.structureWork.create({
      data: {
        structureId: site.id,
        characterId: character.id,
        characterName: character.name,
        turnId: openTurn.id,
        actionId: action.id,
      },
    });
    if (done) {
      await finishStructure(tx, {
        session,
        character,
        site,
        location,
        openTurn,
        action,
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "build_started",
        targetCharacterId: character.id,
        details: {
          structureId: site.id,
          tagId: tag.id,
          tagName: tag.name,
          turnsNeeded: turns,
          resourcesCost: cost,
          payer: { kind: payer.kind, id: payer.id, name: payer.name },
          actionId: action.id,
        },
      });
    }
  });

  await afterInventoryChange([
    character.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  payerNotice(character, payer, cost, tag);
  const spoken = { typeName: tag.name, turnsNeeded: turns };
  speakAtSite(
    location.discordChannelId,
    done ? siteCompletedLine(spoken) : siteOpenedLine(spoken),
  );
  if (done) {
    await notifyStakeholders(
      structureId,
      { except: character.id, payerKey: `${payer.kind}:${payer.id}` },
      `The ${tag.name} at ${location.name} stands finished.`,
    );
  }
  revalidateAll();
  // The craft return shape, since the same dialog files both.
  return done ? { made: tag.name } : { started: tag.name, turns };
}

// Another crew-turn on somebody's site. No skill check and no payer: the
// recipe gated the opening, and the ⬢ were all spent then.
async function joinBuildSiteImpl({ structureId }) {
  const { session, character } = await requireCharacter();

  // Read fresh, and matched against the character's OWN locationId rather
  // than anything posted — a server action is a public endpoint.
  const site = await prisma.structure.findFirst({
    where: {
      id: structureId ?? "",
      status: "UNDER_CONSTRUCTION",
      locationId: character.locationId ?? "",
    },
  });
  if (!site) throw new UserError("That site isn't here.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const location = await prisma.location.findUnique({
    where: { id: site.locationId },
    select: { name: true, discordChannelId: true },
  });

  const next = site.turnsDone + 1;
  const done = next >= site.turnsNeeded;

  await prisma.$transaction(async (tx) => {
    let work;
    try {
      work = await tx.structureWork.create({
        data: {
          structureId: site.id,
          characterId: character.id,
          characterName: character.name,
          turnId: openTurn.id,
        },
      });
    } catch (err) {
      if (err?.code === "P2002")
        throw new UserError("You've already worked on that this turn.");
      throw err;
    }
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      done
        ? `Raised a ${site.typeName}.`
        : `Raising a ${site.typeName} (${next}/${site.turnsNeeded}).`,
      "auto:build",
    );
    await tx.structureWork.update({
      where: { id: work.id },
      data: { actionId: action.id },
    });
    // The check IS the write. One conditional statement carries the advance
    // AND, on the last crew-turn, the completion, so two same-tick finishers
    // cannot both claim it.
    const claim = await tx.structure.updateMany({
      where: {
        id: site.id,
        status: "UNDER_CONSTRUCTION",
        turnsDone: site.turnsDone,
      },
      data: done
        ? { turnsDone: next, status: "COMPLETE" }
        : { turnsDone: next },
    });
    if (claim.count === 0)
      throw new UserError("The work moved on without you — reload.");
    if (done) {
      await finishStructure(tx, {
        session,
        character,
        site: { ...site, turnsDone: next },
        location,
        openTurn,
        action,
      });
    } else {
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "build_continued",
        targetCharacterId: character.id,
        details: {
          structureId: site.id,
          typeSlug: site.typeSlug,
          typeName: site.typeName,
          turnsDone: next,
          turnsNeeded: site.turnsNeeded,
          actionId: action.id,
        },
      });
    }
  });

  // No afterInventoryChange: nothing on any sheet moved. A join spends a Move
  // and nothing else, and finishing moves nothing either — a structure is
  // never a CharacterTag, and the ⬢ left the payer when the site opened.
  speakAtSite(
    location?.discordChannelId,
    done ? siteCompletedLine(site) : siteAdvancedLine(site, next),
  );
  if (done) {
    await notifyStakeholders(
      site.id,
      { except: character.id, payerKey: site.payerKey },
      `The ${site.typeName} at ${location?.name ?? "the site"} stands finished.`,
    );
  }
  revalidateAll();
  return done
    ? { made: site.typeName }
    : { continued: site.typeName, turnsDone: next, turns: site.turnsNeeded };
}

// Calling it off. The opener's alone to call, from anywhere — a builder who
// walked away can still abandon their own site — and it keeps nothing: the ⬢
// went into materials when the work began, cancelCraftImpl's rule.
//
// The plan says "opener or GM"; the GM half is deliberately not here. It
// arrives with milestone C's Damage/Destroy surface, which subsumes it — a
// GM pulling a site down is the same desk action as pulling a wall down.
async function cancelBuildSiteImpl({ structureId }) {
  const { session, character } = await requireCharacter();

  const site = await prisma.structure.findFirst({
    where: {
      id: structureId ?? "",
      status: "UNDER_CONSTRUCTION",
      builderCharacterId: character.id,
    },
  });
  if (!site)
    throw new UserError("That isn't your site, or the work is already over.");
  const location = await prisma.location.findUnique({
    where: { id: site.locationId },
    select: { name: true, discordChannelId: true },
  });

  await prisma.$transaction(async (tx) => {
    // The status flip is the claim: a site somebody finished a moment ago
    // must not be pulled down out from under them. ABANDONED, not RUINED —
    // walked-away-from groundwork and wreckage something made are different
    // events, and each status wears its own words.
    const claim = await tx.structure.updateMany({
      where: { id: site.id, status: "UNDER_CONSTRUCTION" },
      data: { status: "ABANDONED" },
    });
    if (claim.count === 0)
      throw new UserError("The work moved on without you — reload.");
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "build_cancelled",
      targetCharacterId: character.id,
      details: {
        structureId: site.id,
        typeSlug: site.typeSlug,
        typeName: site.typeName,
        locationId: site.locationId,
        turnsDone: site.turnsDone,
        turnsNeeded: site.turnsNeeded,
        resourcesCost: site.resourcesCost ?? 0,
      },
    });
  });

  speakAtSite(location?.discordChannelId, siteCancelledLine(site));
  await notifyStakeholders(
    site.id,
    { except: character.id, payerKey: site.payerKey },
    `Work on the ${site.typeName} at ${location?.name ?? "the site"} has been called off.`,
  );
  revalidateAll();
  return { cancelled: site.typeName };
}

// --- Lessons (docs/systemdocs/LESSONS.md) ------------------------------

// Learn and Teach are the same offer from opposite ends: the initiator's
// Move slot is checked now, both sides' when the other accepts. Nothing is
// filed until then — the offer row and one DM with two buttons.
async function lessonOfferImpl({ teacherId, learnerId, tagId }) {
  const { session, character } = await requireCharacter();
  const offer = await createLessonOffer(prisma, {
    initiatorId: character.id,
    teacherId,
    learnerId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      source: "player_event",
    }).catch((err) =>
      console.error(`Lesson offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_lesson_offer",
      targetCharacterId: offer.offer.responderId,
      details: { offerId: offer.offer.id, teacherId, learnerId, tagId },
    },
  });
  revalidateAll();
  return { pending: true };
}

async function learnRequestImpl({ teacherId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId, learnerId: character.id, tagId });
}

async function teachRequestImpl({ learnerId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId: character.id, learnerId, tagId });
}

// --- Confession (docs/systemdocs/CONFESSION.md) --------------------------

// Only the penitent has a door. The acting character is always the one
// confessing — taken from the session, never from the posted body — so there
// is no way to file a confession on somebody else's behalf, and no chaplain
// half of this to write. `chaplainId` and `tagId` are re-validated inside
// createConfessionOffer against the penitent's own row.
async function confessRequestImpl({ chaplainId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const offer = await createConfessionOffer(prisma, {
    penitentId: character.id,
    chaplainId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      source: "player_event",
    }).catch((err) =>
      console.error(`Confession offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  // The audit row DOES name the tag. A GM has to be able to see what was
  // asked for; the chaplain is the one kept in the dark, not the host.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_confession_offer",
      targetCharacterId: offer.offer.responderId,
      details: {
        offerId: offer.offer.id,
        chaplainId,
        penitentId: character.id,
        tagId,
      },
    },
  });
  revalidateAll();
  return { pending: true };
}

// --- Destroy -------------------------------------------------------------

// Drops an item you hold (`Tag.removable`, derived from the category in
// db/lib/syncTags.js). No refund and no ⬢ field: destroying is
// throwing away, and a cure is Heal's job (docs/systemdocs/TAGS.md §5).
async function destroyTagRequestImpl({
  tagId,
  quantity: rawQuantity,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.removable)
    throw new UserError("That isn't something you can destroy.");

  const quantity = held.tag.stackable
    ? (parseCount(rawQuantity, { min: 1, max: held.quantity }) ?? 1)
    : held.quantity;

  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity,
  };

  // Aftermath (Tag.removesInto) rolled up front so the transaction commits
  // exactly what the snapshot records. Fires once regardless of quantity.
  const aftermathSlugs = rollTagChain(held.tag.removesInto);

  let granted = [];
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, quantity);
    granted = await grantTagSlugs(
      tx,
      character.id,
      aftermathSlugs,
      openTurn?.number ?? null,
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_destroy_tag",
      targetCharacterId: character.id,
      details: {
        tagId,
        tagName: held.tag.name,
        quantity,
        granted: granted.map((g) => g.tagName),
        // The details blob is the only record now, so it carries what a GM
        // needs to put the tag back AS IT WAS rather than as a fresh grant.
        restore,
      },
    });
  });
  await afterInventoryChange(character.id);
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
  return { ok: true, name: opened.paper.name };
}

// Pointing the camera at nothing. The other thing you can do with an Instant
// Camera — 📸-reacting somebody's message is the real one, and that one is
// free (bot/src/events/messageReactionAdd.js). This path spends the camera and
// hands back a print of nobody.
//
// It takes its own road out of consumeTagRequestImpl for breakSeal's reason:
// the ordinary path reads `consumesInto`, which names CATALOG slugs, and a
// photo is a runtime row no slug in docs/tags.yaml can ever name.
async function photographNothingImpl({ session, character, held }) {
  const openTurn = await getOpenTurn();

  // The row is created BEFORE the transaction, because its name-collision
  // retry cannot survive inside one — Postgres aborts a transaction on the
  // first failed statement (db/lib/photoMint.js#createWithRetry). If the
  // transaction below then rolls back, the print is left in nobody's hands,
  // which reaches no browser and gets swept at the next Restart Game.
  const photo = await createBlankPhotoRow(prisma, character.id);

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, held.tagId, 1);
    await attachPhoto(tx, character.id, photo);

    const effect = {
      tagId: held.tagId,
      tagName: held.tag.name,
      // Enough for an Undo to put the camera back and find the print again.
      restore: {
        tagId: held.tagId,
        source: held.source,
        expiresTurn: held.expiresTurn,
        quantity: 1,
      },
      photoTagId: photo.id,
      // The shape every other consumable files, so the GM desk's "Became" line
      // carries the print, and the
      // shared CONSUME_TAG undo takes it back out of their hands. `photoTagId`
      // above only tells that undo to delete the ROW as well, which is the one
      // thing a runtime print needs that a catalog grant does not.
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { ok: true, name: photo.name };
}

// Cracking a Depot crate. It used to be a button on /depot; it is a Consume
// now, which is both one verb fewer to learn and the only thing that made
// sense once a crate walked out of the landing pad and got carried somewhere
// else entirely. See docs/systemdocs/DEPOT.md §0e.
//
// A SEALED crate still wants the keycard, checked here rather than trusted
// from whatever surface offered the button.
async function openCrateRequestImpl({ session, character, held }) {
  const crate = held.tag;
  const contents = Array.isArray(crate.crateContents) ? crate.crateContents : null;
  if (!contents) throw new UserError("That isn't a crate.");

  if (!canOpenCrate(crate, heldSlugsOf(character.tags))) {
    throw new UserError("It's sealed, and the lock wants a Depot Keycard.");
  }

  const openTurn = await getOpenTurn();
  const inner = await prisma.tag.findMany({ where: { id: { in: contents.map((c) => c.tagId) } } });
  const byId = new Map(inner.map((t) => [t.id, t]));

  // ⬢ ride the crate in the field the ordinary consume path already grants,
  // so nothing here has to know how the shipment was packed.
  const resourcesGranted = crate.consumesIntoResources ?? 0;

  const granted = [];
  // Contents that could not land — a non-stackable ware already held. Recorded
  // on the effect so the Ledger and a GM can see what the crate really gave.
  const skipped = [];
  await prisma.$transaction(async (tx) => {
    for (const line of contents) {
      const tag = byId.get(line.tagId);
      // A ware pruned out of the catalog between landing and opening is gone.
      // Skipping it beats throwing: the rest of the crate should still open.
      if (!tag) continue;
      // addToStack returns the existing row untouched for a non-stackable tag
      // already held, so what the Ledger records has to be what actually
      // landed — not what the crate said it held. Otherwise a Merchant who
      // already owns an ML-23 opens a crate, receives nothing, and is told he
      // received a pistol.
      const before = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
      });
      await addToStack(tx, character.id, tag.id, line.quantity, {
        source: "EVENT",
        stackable: tag.stackable,
        expiresTurn: await expiryForGrant(tx, tag, openTurn, {
          characterId: character.id,
          where: "openCrate",
        }),
      });
      const landed = tag.stackable ? line.quantity : before ? 0 : 1;
      if (landed > 0) granted.push({ tagId: tag.id, name: tag.name, quantity: landed });
      else skipped.push({ tagId: tag.id, name: tag.name, reason: "already held, and only one can be carried" });
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
      skipped,
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

  await afterInventoryChange(character.id);
  revalidateAll();
  return { granted, skipped, resourcesGranted };
}

async function consumeTagRequestImpl({ tagId }) {
  const { session, character } = await requireCharacter();

  const held = character.tags.find((ct) => ct.tagId === tagId);
  if (!held) throw new UserError("You don't have that tag.");
  if (!held.tag.consumable) throw new UserError("That tag can't be consumed.");

  // Breaking a seal takes its own road out of here. The ordinary consume path
  // below reads `consumesInto`, which names CATALOG SLUGS — and the letter
  // inside a sealed one is a runtime row that no slug in docs/tags.yaml can
  // ever name. See docs/systemdocs/PAPERWORK.md.
  if (held.tag.paperKind === "SEALED") {
    return breakSealRequestImpl({ session, character, held });
  }

  // Same reasoning, same road: an Instant Camera consumes into a runtime Photo
  // row rather than into anything the catalog can name.
  if (held.tag.slug === CAMERA_SLUG) {
    return photographNothingImpl({ session, character, held });
  }

  // And a Depot crate, for the same reason again: what falls out of one is a
  // list of tag IDs printed on the crate at landing, not catalog slugs. It
  // also has a lock the ordinary path knows nothing about.
  if (Array.isArray(held.tag.crateContents)) {
    return openCrateRequestImpl({ session, character, held });
  }

  // The Mulligan Potion is the one consumable that cannot be drunk from here:
  // it needs a name typed into it, so its road out is changeNameRequestImpl,
  // opened from the tag's own tooltip. Without this the generic path would
  // spend the bottle on nothing at all — it has no `consumesInto`.
  // MULLIGAN_SLUG is declared beside that function, further down this file.
  if (held.tag.slug === MULLIGAN_SLUG) {
    throw new UserError("Drink this one from the tag itself — it needs a name first. ‡");
  }

  const openTurn = await getOpenTurn();
  const restore = {
    tagId: held.tagId,
    source: held.source,
    expiresTurn: held.expiresTurn,
    quantity: 1,
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

  const {
    slugs: grantSlugs,
    removes: climbedFrom,
    durations: grantDurations,
    resources: resourcesGranted,
  } = resolveConsumeGrants(held.tag, heldSlugsOf(character.tags), ladder);

  // The rungs the climb clears — Tipsy coming off as Wasted goes on.
  // Snapshotted the same way `cleared` below is, so an Undo puts the drinker
  // back exactly where they were rather than leaving them Wasted with no
  // Tipsy underneath.
  const climbed = climbedFrom
    .map((slug) => character.tags.find((ct) => ct.tag.slug === slug))
    .filter(Boolean)
    .map((ct) => ({
      tagId: ct.tagId,
      tagName: ct.tag.name,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: 1,
    }));

  // What this eases (docs/systemdocs/FEAR.md): a drink or a drug by the state
  // it lands you in, a lavish meal, tea or a cigarette by what it is. The
  // largest single figure, never a sum — Bliss is one drink. A fine meal
  // feeds a noble and calms nobody, on purpose.
  const fearRelief = consumeReliefFor(held.tag.slug, grantSlugs);

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, tagId, 1);
    for (const rung of climbed) await dropCharacterTag(tx, character.id, rung.tagId, 1);
    const granted = await grantTagSlugs(
      tx,
      character.id,
      grantSlugs,
      openTurn?.number ?? null,
      grantDurations,
    );
    // The Resources half — Purse and Supply Kit (CAVING.md). Most
    // consumables grant none, so this is usually a no-op.
    if (resourcesGranted) {
      await creditResources(
        tx,
        { kind: "character", id: character.id, name: character.name },
        resourcesGranted,
      );
    }
    // db/lib/hiddenCures.js. Runs after the ordinary grants and records
    // nothing on the request, on purpose.
    await applyHiddenCures(tx, character.id, held.tag.slug);
    if (fearRelief) await applyFear(tx, character.id, { kind: "DRINK", base: -fearRelief });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_consume_tag",
      targetCharacterId: character.id,
      details: {
        tagId,
        tagName: held.tag.name,
        granted: granted.map((g) => g.tagName),
        resourcesGranted,
        fearRelief: fearRelief || undefined,
        climbed: climbed.map((c) => c.tagName),
      },
    });
  });
  await afterInventoryChange(character.id);
  revalidateAll();
  return {};
}

// --- Transfer (the merged dialog) -------------------------------------

// One act that moves any number of tag lines and a ⬢ amount between two
// parties: yourself, a person standing here, or a Room stash at your
// Location (docs/systemdocs/CARRY.md). Files one TRANSFER_TAG per tag line
// and one TRANSFER_RESOURCES for the ⬢, all in one transaction, so a GM can
// still undo any single piece from /gm/turns.
//
// Things and ⬢ leave YOU, a room, or a HELPLESS person — bound, dying,
// paralyzed, catatonic, or a body (REQUESTS.md §5b). That last case is Loot
// wearing Transfer's clothes, and it is handed to lootCharacterRequestImpl
// rather than reimplemented here. An upright person is still refused: listing
// what is in their pockets would show their hidden tags.

// "hood:<token>" -> "character:<id>", or the key untouched. Null when the
// token names nobody standing here, which resolveParty then refuses as an
// unknown party — the same answer a made-up id gets.
async function hoodedKey(character, key) {
  const raw = String(key ?? "");
  if (!raw.startsWith("hood:")) return raw;
  const id = await resolveHoodToken(prisma, character, raw.slice("hood:".length));
  return id ? `character:${id}` : "";
}

async function transferRequestImpl({
  fromKey,
  toKey,
  tags: rawTags,
  amount: rawAmount,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const amount =
    rawAmount == null || rawAmount === ""
      ? 0
      : parseCount(rawAmount, { min: 0 });
  if (amount == null) throw new UserError("Amount must be a whole number.");
  const lines = Array.isArray(rawTags)
    ? rawTags.map((t) => ({
        tagId: String(t?.tagId ?? ""),
        quantity: parseCount(t?.quantity ?? 1, { min: 1 }),
      }))
    : [];
  if (lines.some((l) => !l.tagId || l.quantity == null)) {
    throw new UserError("Each line needs a tag and a whole number.");
  }
  if (new Set(lines.map((l) => l.tagId)).size !== lines.length)
    throw new UserError("A tag is listed twice.");
  if (amount === 0 && lines.length === 0)
    throw new UserError("Nothing to move.");

  // A "hood:<token>" key names a concealed person by an opaque handle rather
  // than an id, so the browser is never told who is under the mask
  // (db/lib/whosHere.js). resolveHoodToken re-checks co-presence itself and
  // answers null for a token minted in a room this character has since left.
  const [fromResolved, toResolved] = await Promise.all([
    hoodedKey(character, fromKey),
    hoodedKey(character, toKey),
  ]);
  // `allowDead` on the SOURCE only: taking things off a corpse is the whole
  // point of a loot-shaped transfer, while handing something TO a body is not
  // a thing. Loot resolves its target the same way.
  const [from, to] = await Promise.all([
    resolveParty(fromResolved, { allowDead: true }),
    resolveParty(toResolved),
  ]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id)
    throw new UserError("Source and recipient are the same.");

  // Taking from another person IS Loot, and it stays Loot: this hands the
  // whole job to lootCharacterRequestImpl rather than growing a second
  // implementation beside it. That is what keeps the helpless gate
  // (INCAPACITATING_SLUGS — Bound, Dying, Paralyzed, Catatonic, or a body),
  // the ROBBED fear hit and the "your body was searched" notification from
  // depending on which button was pressed.
  //
  // It has to land in YOUR hands, the same rule Loot has always had — there is
  // no verb for going through somebody's pockets straight into a cupboard.
  if (from.kind === "character" && from.id !== character.id) {
    if (!(to.kind === "character" && to.id === character.id)) {
      throw new UserError("Taking from a person puts it in your own hands.");
    }
    return lootCharacterRequestImpl({
      targetCharacterId: from.id,
      tagPicks: lines.map((l) => ({ tagId: l.tagId, quantity: l.quantity })),
      amount,
    });
  }
  // Both ends have to be where you stand — re-checked here on the posted
  // key, the same predicate that built the menu (web/lib/peopleHere.js). A
  // room adds "and its door opens for you".
  //
  // The one asymmetry: `direction` lets a member DEPOSIT into their own
  // faction's silo from anywhere in that room's zone, while taking anything
  // back out keeps the strict rule (web/lib/transferReach.js).
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  for (const [direction, party] of [
    ["from", from],
    ["to", to],
  ]) {
    if (!(await canReachParty(character, party, { heldSlugs, direction, allowConcealed: true }))) {
      // Only to pick which of the two out-of-reach sentences to write —
      // the same predicate the gate itself used, not a second one.
      const isSilo =
        party.kind === "room" && (await isOwnFactionSilo(character, party));
      throw new UserError(outOfReachMessage(party, { isSilo }));
    }
  }
  if (amount > from.balance)
    throw new UserError(`${from.name} only has ${from.balance} ⬢.`);

  // Resolve every tag line against the SOURCE's holdings, snapshotting what
  // Undo will need to put back.
  const lineIds = lines.map((l) => l.tagId);
  let holdings = [];
  if (lines.length && from.kind === "room") {
    holdings = await prisma.roomTag.findMany({
      where: { roomId: from.id, tagId: { in: lineIds } },
      select: {
        tagId: true,
        quantity: true,
        expiresTurn: true,
        tag: { select: { name: true, stackable: true, tradeable: true } },
      },
    });
  } else if (lines.length) {
    holdings = character.tags
      .filter((ct) => lineIds.includes(ct.tagId))
      .map((ct) => ({
        tagId: ct.tagId,
        quantity: ct.quantity,
        expiresTurn: ct.expiresTurn,
        source: ct.source,
        tag: ct.tag,
      }));
  }
  // A non-stackable tag pins at one per character (tagWrites.js#addToStack),
  // so a pull out of a room is clamped to 1 here — silently moving 1 while
  // the request says 2 would make Undo take 2 back. Someone who already
  // holds one can't take a second at all.
  const recipientHeld =
    lines.length && to.kind === "character"
      ? new Set(
          (
            await prisma.characterTag.findMany({
              where: { characterId: to.id, tagId: { in: lineIds } },
              select: { tagId: true },
            })
          ).map((ct) => ct.tagId),
        )
      : new Set();
  const moves = lines.map((line) => {
    const held = holdings.find((h) => h.tagId === line.tagId);
    if (!held) {
      throw new UserError(
        from.kind === "room"
          ? "That isn't there any more."
          : "You don't have that tag.",
      );
    }
    if (!isTradeable(held.tag))
      throw new UserError("That isn't something that can change hands.");
    let max = held.quantity;
    if (!held.tag.stackable && to.kind === "character") {
      if (recipientHeld.has(line.tagId))
        throw new UserError(`${to.name} already has ${held.tag.name}.`);
      max = 1;
    }
    const quantity = Math.min(line.quantity, max);
    return { tagId: line.tagId, quantity, held };
  });

  // The ceiling (docs/systemdocs/CARRY.md §2). A deliberate hand-over is
  // REFUSED past 1.5× the recipient's cap rather than landing and being partly
  // scattered on the floor — otherwise handing someone 300 lb would shed a
  // random slice of what they were already carrying into a public room.
  // Checked only for a character on the receiving end; a Room stash is
  // bottomless.
  if (to.kind === "character") {
    const recipient = await prisma.character.findUnique({
      where: { id: to.id },
      select: {
        resources: true,
        tags: { select: { quantity: true, equipped: true, tag: true } },
      },
    });
    const config = await prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true, carryResourceCap: true },
    });
    const addedLbs = moves.reduce(
      (sum, m) => sum + rowWeight({ ...m.held, quantity: m.quantity }),
      0,
    );
    const verdict = carryAdmits(recipient, config, {
      weightLbs: addedLbs,
      resources: amount,
    });
    if (!verdict.ok) {
      throw new UserError(
        to.id === character.id
          ? verdict.reason
          : `${to.name} couldn't carry that. ${verdict.reason}`,
      );
    }
  }

  const openTurn = await getOpenTurn();
  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: null,
  };
  const fromParty = { kind: from.kind, id: from.id, name: from.name };
  const toParty = { kind: to.kind, id: to.id, name: to.name };
  // The Spillway (Room.destroysContents). Nothing is written on the receiving
  // end — giveTagTo and moveParty both refuse — so the effect has to say so,
  // or a GM repairing this by hand goes looking for goods never stored.
  // ...but not everything the trough is handed goes over the edge. The nuclear
  // device and its datacard settle at the bottom intact (db/lib/nuke.js), so a
  // transfer of nothing but those is NOT a destruction, and neither the audit
  // row nor the line the room hears may claim it was.
  const survives = moves.filter((m) => INDESTRUCTIBLE_SLUGS.has(m.held?.tag?.slug));
  const destroyed = to.destroysContents === true && survives.length < moves.length;
  const nothingDestroyed = to.destroysContents === true && survives.length === moves.length;
  const fromCharacterId = from.kind === "character" ? from.id : null;
  const toCharacterId = to.kind === "character" ? to.id : null;

  await prisma.$transaction(async (tx) => {
    for (const move of moves) {
      const { tagId, quantity, held } = move;
      const restore = {
        source: held.source ?? "EVENT",
        expiresTurn: held.expiresTurn ?? null,
        quantity,
      };
      await takeTagFrom(tx, from, tagId, quantity);
      await giveTagTo(tx, to, {
        tagId,
        quantity,
        expiresTurn: held.expiresTurn ?? null,
        source: "EVENT",
      });
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_tag",
        targetCharacterId: toCharacterId ?? fromCharacterId,
        details: {
          tagId,
          tagName: held.tag.name,
          quantity,
          from: fromParty,
          to: toParty,
          direction: "SEND",
          restore,
        },
      });
    }

    if (amount > 0) {
      try {
        await applyTransfer(tx, { from, to, amount, ledger });
      } catch (err) {
        if (!(err instanceof InsufficientResourcesError)) throw err;
        throw new UserError(err.message);
      }
      const effect = {
        amount,
        from: fromParty,
        to: toParty,
        direction: "SEND",
        destroyed,
      };
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_resources",
        targetCharacterId: toCharacterId ?? fromCharacterId ?? character.id,
        details: effect,
      });
    }
  });

  await afterInventoryChange([fromCharacterId, toCharacterId]);

  const goods = formatManifest(
    moves.map((m) => ({ tagName: m.held.tag.name, quantity: m.quantity })),
    amount,
  );
  if (toCharacterId && toCharacterId !== character.id) {
    notifyCharacter(
      { id: to.id, discordUserId: to.discordUserId },
      `You were handed ${goods}.`,
    );
  }
  // The room hears about it, aliased (CARRY.md): leaving something is public
  // by nature, and so is walking off with it.
  if (to.kind === "room") {
    // "Leaves it here" would be a lie about the Spillway — the trough is the
    // point of the room, and anyone watching sees it go over the edge.
    after(() =>
      announceInRoom(
        to,
        character,
        destroyed
          ? `tips ${goods} into the trough. It is gone.`
          : nothingDestroyed
            ? `tips ${goods} into the trough. It settles at the bottom, intact.`
            : `leaves ${goods} here.`,
      ),
    );
  }
  if (from.kind === "room")
    after(() => announceInRoom(from, character, `takes ${goods}.`));

  revalidateAll();
  return {};
}

// --- Healing ----------------------------------------------------------

// Treating someone else's affliction — the only request whose subject isn't
// the filer, so most ids below are the TARGET's. Three gates, all
// re-checked here: the medic holds a Medical skill, the patient is standing
// here (web/lib/peopleHere.js), and the affliction's own requirementSkills
// are satisfied. The PAYER is ungated beyond being here, same bet as Craft.
async function healCharacterRequestImpl({
  targetCharacterId,
  tagId,
  payerKey,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId) {
    throw new UserError("You aren't anywhere you could treat someone.");
  }

  // The flat catalog, so holding a higher tier still satisfies a requirement
  // written against the base skill.
  const catalog = await prisma.tag.findMany({
    select: { id: true, slug: true, parentTagId: true },
  });
  const ancestry = buildSkillAncestry(catalog);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = catalog.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  if (!healSkillId || !satisfied.has(healSkillId)) {
    throw new UserError("You need Medical (Basic) to treat anyone.");
  }

  // No `id: { not: character.id }` — treating yourself is the ordinary case.
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: {
      tags: { include: { tag: { include: { requirementSkills: true } } } },
    },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const held = target.tags.find((ct) => ct.tagId === tagId);
  if (!held || !isHealable(held.tag))
    throw new UserError("That isn't something you can treat.");

  // Above your tier, or the top rung of the ladder, and it is a GAMBIT rather
  // than a refusal (docs/systemdocs/TAGS.md §5c). Nothing is out of reach any
  // more; what changes is whether you roll for it.
  const gambit = isGambitHeal(held.tag, satisfied);
  // +1 on the die for a set of instruments in reach — held, or standing in a
  // room that has one (db/lib/equipmentReach.js). Only ever asked for a
  // Gambit, since a routine cure never rolls.
  const surgical = gambit
    ? await hasEquipmentInReach(prisma, character, SURGICAL_EQUIPMENT_SLUG)
    : false;

  const openTurn = await getOpenTurn();
  if (gambit) {
    // A roll costs the Move, and Action's @@unique([characterId, turnId]) is
    // what makes it one gambit heal a turn — no separate check needed.
    await requireFreeMove(character, openTurn);
  } else if (openTurn && countsAgainstHealCap(held.tag)) {
    // A doctor's day has a ceiling. Checked here for a fast fail and again
    // inside the transaction under a row lock, since two simultaneous
    // requests would otherwise both read the same count and pass — the same
    // shape the Dead Simple cap uses.
    const heldSlugs = new Set(
      character.tags.map((ct) => ct.tag?.slug).filter(Boolean),
    );
    const allowance = healCapFor(heldSlugs, MEDICAL_TIER_CAPS);
    const already = await routineHealsThisTurn(
      prisma,
      session.discordUserId,
      openTurn.id,
    );
    if (already >= allowance) {
      throw new UserError(
        `You've treated ${already} ${already === 1 ? "case" : "cases"} this turn, which is all you can manage. First aid still costs you nothing.`,
      );
    }
  }

  const payer = await resolveParty(payerKey);
  if (!payer) throw new UserError("Unknown payer.");
  if (!(await canReachParty(character, payer)))
    throw new UserError(outOfReachMessage(payer));

  // Straight off the tag, never off the client.
  const cost = healCost(held.tag);
  if (cost > payer.balance)
    throw new UserError(`${payer.name} only has ${payer.balance} ⬢.`);

  const ledger = {
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: character.id,
    actorName: character.name,
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: null,
  };

  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    selfHeal: target.id === character.id,
    tagId: held.tagId,
    tagName: held.tag.name,
    restore: {
      tagId: held.tagId,
      source: held.source,
      expiresTurn: held.expiresTurn,
      quantity: held.quantity ?? 1,
    },
    resourcesSpent: cost,
    payer: { kind: payer.kind, id: payer.id, name: payer.name },
    // A gambit heal is an ATTEMPT: the die is rolled at turn close and the GM
    // applies the outcome from /gm/turns, so nothing has left the patient yet.
    // `pending` is what tells Undo that no tag came off, and it is never
    // cleared — it stays true because it stays TRUE. The request charged a fee
    // and filed a Move, and that is all it ever did; whatever the GM writes
    // afterwards is their own edit, with its own audit row and its own undo.
    gambit,
    pending: gambit,
    surgical,
    // What the catalog charged at the time, so a later review sees the
    // price actually quoted rather than today's tags.yaml.
    requirement: {
      turns: held.tag.requirementTurns,
      resources: held.tag.requirementResources,
      gambit: held.tag.requirementGambit,
      skills: held.tag.requirementSkills.map((t) => t.name),
    },
  };

  // Only a routine cure has an aftermath now — a Gambit's outcome, Stitched Up
  // included, is the GM's to write once the die has been read.
  const aftermathSlugs = gambit ? [] : rollTagChain(held.tag.removesInto);

  await prisma.$transaction(async (tx) => {
    // Re-check the day's allowance under a row lock. Two tabs would otherwise
    // both read the same count and both pass (requestActions.js's Dead Simple
    // cap has the same pair of checks for the same reason).
    if (!gambit && openTurn && countsAgainstHealCap(held.tag)) {
      await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${character.id} FOR UPDATE`;
      const heldSlugs = new Set(
        character.tags.map((ct) => ct.tag?.slug).filter(Boolean),
      );
      const allowance = healCapFor(heldSlugs, MEDICAL_TIER_CAPS);
      const already = await routineHealsThisTurn(tx, session.discordUserId, openTurn.id);
      if (already >= allowance) {
        throw new UserError(
          "You've treated all the cases you can manage this turn.",
        );
      }
    }

    await debitResources(tx, payer, cost);

    if (gambit) {
      // The Move that carries the roll. Same shape as a learner's Lesson
      // Gambit (db/lib/lessons.js) — filed CONFIRMED with the die already
      // rolled, left OPEN for the GM, revealed to the player at turn close by
      // the staged push. The patient's tag is untouched: a roll that has not
      // been read cannot have cured anything, and a failed one can leave them
      // worse (docs/systemdocs/TAGS.md §5c).
      // requireFreeMove() ran above, but the P2002 catch is what actually
      // holds — @@unique([characterId, turnId]) is the real gate, and two tabs
      // submitting at once get past a check that read the table a moment ago.
      // It is also what rations gambit heals to one a turn without a second
      // count. Same posture as fileAutoRoutine().
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
            moveReviewStatus: "OPEN",
            description: `Treating ${target.id === character.id ? "their own" : `${target.name}'s`} ${held.tag.name}.`,
            diceRoll: rollDie(),
            diceModifier:
              gambitModifierTotal(character.tags, {
                hungerStreak: character.hungerStreak,
              }) + (surgical ? 1 : 0),
            zoneId: character.zoneId ?? null,
            gmNotes: "auto:heal_gambit",
          },
        });
      } catch (err) {
        if (err?.code === "P2002")
          throw new UserError("You've already used your Move this turn.");
        throw err;
      }
      effect.actionId = action.id;
    } else {
      await dropCharacterTag(tx, target.id, held.tagId);
      effect.granted = await grantTagSlugs(
        tx,
        target.id,
        aftermathSlugs,
        openTurn?.number ?? null,
      );
      // Being treated eases half of what the wound cost the nerves (FEAR.md).
      // Only a routine cure — a gambit heal leaves the affliction on them. The
      // held row's tag was loaded without its group, which the rung needs, so
      // it is re-read here rather than trusted.
      const woundTag = await tx.tag.findUnique({
        where: { id: held.tagId },
        select: { slug: true, requirementResources: true, requirementTurns: true, requirementGambit: true, group: { select: { slug: true } } },
      });
      const relief = woundFearFor(woundTag) / 2;
      if (relief > 0) await applyFear(tx, target.id, { kind: "HEALED", base: -relief });
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_heal_character",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange([
    target.id,
    payer.kind === "character" ? payer.id : null,
  ]);
  if (target.id !== character.id) {
    notifyCharacter(
      target,
      gambit
        ? `${character.name} is working on your ${held.tag.name}. You'll know how it went at the end of the turn.`
        : `Your ${held.tag.name} was treated.`,
    );
  }
  if (payer.kind === "character" && payer.id !== character.id && cost > 0) {
    notifyCharacter(
      payer,
      `${character.name} paid ${cost} ⬢ from your purse to treat ${target.id === character.id ? "themselves" : target.name}.`,
    );
  }
  revalidateAll();
  return {
    targetName: target.name,
    tagName: held.tag.name,
    cost,
    gambit,
    surgical,
  };
}

// --- Looting a living, incapacitated target ----------------------------

// A helpless target (dying/catatonic/paralyzed/bound) is lootable the same
// way a corpse is; this handles both in one request, tags AND ⬢ together.
// The older TRANSFER_TAG/TRANSFER_RESOURCES LOOT direction still exists so
// old Request rows undo correctly, but nothing files one any more.
async function lootCharacterRequestImpl({
  targetCharacterId,
  tagPicks: rawTagPicks,
  amount: rawAmount,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    include: {
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
  if (target?.buriedAt) throw new UserError("They're already in the ground.");
  if (!target || !isHere(character, target, { allowDead: true }))
    throw new UserError(notHereMessage(target));

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
    const quantity = held.tag.stackable
      ? (parseCount(pick.quantity, { min: 1, max: held.quantity }) ?? null)
      : held.quantity;
    if (quantity == null)
      throw new UserError(`Bad quantity for ${held.tag.name}.`);
    takenTags.push({
      tagId: held.tagId,
      tagName: held.tag.name,
      quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
      stackable: held.tag.stackable,
    });
  }

  if (amount > target.resources)
    throw new UserError(`${target.name} only has ${target.resources} ⬢.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    for (const t of takenTags) {
      await dropCharacterTag(tx, target.id, t.tagId, t.quantity);
      await addToStack(tx, character.id, t.tagId, t.quantity, {
        source: "EVENT",
        expiresTurn: t.expiresTurn,
        stackable: t.stackable,
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
    // Waking up robbed is frightening; a corpse minds nothing (FEAR.md).
    if (target.status === "ALIVE") await applyFear(tx, target.id, { kind: "ROBBED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_loot_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // The looter's carry caps and doors, and the target's if they're alive (a
  // corpse holds nothing that needs settling).
  await afterInventoryChange([
    character.id,
    target.status === "ALIVE" ? target.id : null,
  ]);

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
  return {};
}

// --- Moving another character: GONE ------------------------------------
//
// MOVE_CHARACTER shoved one person one hop for free, with no consent and no
// record beyond an audit row, and it duplicated the drag picker's predicate
// word for word. Both are replaced by escorting: you attach somebody once and
// they follow you, the helpless without asking and everyone else through an
// Offer. db/lib/escort.js is the one authority now, and the party rack on
// /play is the surface. See docs/systemdocs/MAP.md §3a.

// --- Binding and freeing -------------------------------------------------

// Nothing else grants `bound`, and it's the one incapacitating state a
// player can inflict on purpose. Two doors (db/lib/bind.js): someone who
// can't stop you — dead, or already helpless — is bound on the spot; anyone
// else has to agree, so the target gets a DM with Accept / Decline and the
// request fires only on Accept (docs/systemdocs/LESSONS.md).
async function bindCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't bind yourself.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: { in: ["ALIVE", "DEAD"] } },
    select: BIND_SELECT,
  });
  if (!target || !isHere(character, target, { allowDead: true }))
    throw new UserError(notHereMessage(target));
  if (isBoundTarget(target))
    throw new UserError(`${target.name} is already bound.`);

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
        source: "player_event",
      }).catch((err) =>
        console.error(`Bind offer DM to ${target.id} failed:`, err),
      ),
    );
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_bind_offer",
        targetCharacterId: target.id,
        details: { offerId: offer.offer.id, targetName: target.name },
      },
    });
    revalidateAll();
    return { pending: true, name: target.name };
  }

  await applyBind(prisma, { actor, target, turn: openTurn });
  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone bound you.");
  revalidateAll();
  return {};
}

// The rescue half — anyone standing there may cut someone loose.
async function freeCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");

  const bound = await requireBoundTag(prisma);
  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { where: { tagId: bound.id } } },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

  const held = target.tags[0];
  if (!held) throw new UserError(`${target.name} isn't bound.`);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, target.id, bound.id);
    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tagId: bound.id,
      tagName: bound.name,
      quantity: held.quantity,
      source: held.source,
      expiresTurn: held.expiresTurn,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_free_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  await afterInventoryChange(target.id);
  notifyCharacter(target, "Someone freed you.");
  revalidateAll();
  return {};
}

// --- Crucifixion -----------------------------------------------------------

const CRUCIFIX_SLUG = "crucifix";
const CRUCIFIED_SLUG = "crucified";
const FUNDAMENTALIST_SLUG = "fundamentalist";

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
async function crucifyCharacterRequestImpl({
  targetCharacterId,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't crucify yourself.");
  if (!character.tags.some((ct) => ct.tag.slug === FUNDAMENTALIST_SLUG))
    throw new UserError("Only a Fundamentalist would.");

  const location = await loadBuildGround(character.locationId);
  const standing = await structuresAt(prisma, character.locationId, {
    statuses: ["COMPLETE"],
  });
  const cross = standing.find((s) => s.typeSlug === CRUCIFIX_SLUG) ?? null;
  if (!cross) throw new UserError("There is no cross standing here.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
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
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));
  if (target.tags.some((ct) => ct.tag.slug === CRUCIFIED_SLUG))
    throw new UserError(`${target.name} is already on the cross.`);

  const crucified = await prisma.tag.findUnique({
    where: { slug: CRUCIFIED_SLUG },
  });
  if (!crucified)
    throw new UserError("The Crucified tag is missing from the catalog — tell a GM.");

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");
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
    await addToStack(tx, target.id, crucified.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: crucified.stackable,
    });
    // The single most frightening thing that can happen to a person (FEAR.md).
    await applyFear(tx, target.id, { kind: "CRUCIFIED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_crucify_character",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  await afterInventoryChange(target.id);
  notifyCharacter(target, "You've been put on the cross.");
  speakAtSite(
    location?.discordChannelId,
    ambientLine(`${target.name} hangs on the cross.`),
  );
  revalidateAll();
  return { name: target.name };
}

// --- Torture (docs/systemdocs/TORTURE.md) ----------------------------------

// A Torturer works on somebody who is already Bound and standing here. One die,
// resolved on the spot: a break DMs the torturer everything on the sheet that
// isn't a wound or a passing status, plus the last three Desires fulfilled,
// and the Depressed tag lands on the victim. Either way the victim takes the
// TORTURED fear hit and the torturer's Move is spent. The die and its
// arithmetic live in db/lib/torture.js; this file only loads rows and writes.
//
// Filed as a ROUTINE already PASSED (fileAutoRoutine) rather than a Gambit:
// the torturer is told immediately, and a Gambit row would have the turn-end
// push announce the same die a second time (stagedPush.js#gambitRollNotices).
const DEPRESSED_SLUG = "depressed";
const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";

async function tortureCharacterRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("You can't torture yourself.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const torturerSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!torturerSlugs.includes(TORTURER_SLUG))
    throw new UserError("You don't know how.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
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
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));
  if (!isBoundTarget(target))
    throw new UserError(`${target.name} isn't tied up.`);

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const equipmentInReach = await hasEquipmentInReach(
    prisma,
    character,
    TORTURING_EQUIPMENT_SLUG,
  );
  const targetSlugs = target.tags.map((ct) => ct.tag.slug);
  const result = resolveTorture({
    die: rollDie(),
    torturerSlugs,
    targetSlugs,
    equipmentInReach,
    // Hungry, Afraid and Panic count here as on any Gambit.
    gambitMods: gambitModifiers(character.tags, {
      hungerStreak: character.hungerStreak,
    }),
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
    // +40, or nothing under Pain Immunity / an Opium High (FEAR.md §6).
    await applyFear(tx, target.id, { kind: "TORTURED" });
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
      `Tortured ${target.name}: ${rollLine} — ${outcome}.`,
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
  return { name: target.name, success: result.success, die: result.die };
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
async function disguiseSelfRequestImpl({ name: rawName }) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Re-checked here and not merely in the UI: a server action is a public
  // endpoint, and page.js's predicate is a hint.
  if (!character.tags.some((ct) => ct.tag.slug === DISGUISE_KIT_SLUG))
    throw new UserError("You have no disguise kit.");

  const name = normalizeDisguiseName(rawName);
  if (!name) throw new UserError("Pick a name to go by.");
  if (name === character.name)
    throw new UserError("That is already your name.");

  // One at a time. Two forcedName rows would race, and forcedNameFrom takes
  // whichever comes back first.
  const already = await activeDisguise(prisma, character.id);
  if (already)
    throw new UserError(
      `You are already going by ${already.tag.forcedName}. Wait for it to wear off.`,
    );

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // Minted OUTSIDE the transaction, on purpose: the retry loop it uses cannot
  // run inside one, because Postgres aborts the whole transaction on the first
  // failed statement (see db/lib/paperMint.js). Two players picking the same
  // false name is exactly the collision it retries past.
  const tag = await mintDisguise(prisma, character.id, name, openTurn);
  if (!tag) throw new UserError("Couldn't put that name on. Try another.");

  const effect = {
    tagId: tag.id,
    tagName: tag.name,
    disguiseName: name,
    turns: DISGUISE_TURNS,
  };
  await prisma.$transaction(async (tx) => {
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_disguise_self",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { name };
}

// --- Harming someone already helpless -------------------------------------

// Wounding and finishing off in one request, since they're one act. Either
// half alone is valid, but not neither. The target must ALREADY be helpless
// — fighting back is a Gambit for a GM. Finishing them ends their game on
// submit (REQUESTS.md §5a); the gate that makes that safe is
// FINISHABLE_SLUGS (Dying or Bound — deliberately not Catatonic, an absent
// player rather than a helpless one).
async function harmCharacterRequestImpl({
  targetCharacterId,
  tagId,
  lethal: rawLethal,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  if (targetCharacterId === character.id)
    throw new UserError("Pick someone else.");

  const lethal = Boolean(rawLethal);
  const wantsTag = Boolean(tagId);
  if (!wantsTag && !lethal)
    throw new UserError("Pick an injury, tick Finish them, or both.");

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: { select: { slug: true } } } } },
  });
  if (!target || !isHere(character, target))
    throw new UserError(notHereMessage(target));

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
      throw new UserError(`${target.name} already has ${tag.name}.`);
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
  return { killed };
}

// --- Desires ----------------------------------------------------------

// ONE action: claim a Desire — a retroactive claim on something the
// character already did. A GM reviews it afterwards like every other
// request; the anti-loop rule (DESIRES.md §8) is GM-adjudicated from the
// reason field, since no gate here can tell a real evening from a made-up one.
async function claimDesireImpl({
  slotIndex: rawSlotIndex,
  slug: rawSlug,
}) {
  const { session, character } = await requireCharacter();

  const slug = rawSlug?.toString().trim();
  if (!slug) throw new UserError(DESIRE_NOT_AVAILABLE);

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      desireSlots: true,
      desireSlotLockTurns: true,
    },
  });
  const desireSlots = config?.desireSlots ?? 2;
  const lockTurns = config?.desireSlotLockTurns ?? 1;

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
    });
    const slot = slots[slotIndex];
    if (slot?.lockedUntilTurn != null) {
      throw new UserError(
        `That slot is locked for ${slot.lockedTurnsLeft} more turn${slot.lockedTurnsLeft === 1 ? "" : "s"}. ‡`,
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
      },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { tagPoints: { increment: row.points } },
    });
    // Getting what you wanted settles the nerves, 10 a point (FEAR.md).
    await applyFear(tx, character.id, { kind: "DESIRE", base: -DESIRE_RELIEF_PER_POINT * row.points });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_fulfill_desire",
      targetCharacterId: character.id,
      details: {
        desireId: row.id,
        pointsAwarded: row.points,
        slug: template.slug,
        slotIndex,
      },
    });
    return row;
  });

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
const MULLIGAN_SLUG = "mulligan-potion";

async function changeNameRequestImpl({
  honorific: rawHonorific,
  firstName: rawFirstName,
  title: rawTitle,
  lastName: rawLastName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // Re-checked here and not merely in the UI: a server action is a public
  // endpoint and page.js's predicate is only a hint.
  const potion = character.tags.find((ct) => ct.tag.slug === MULLIGAN_SLUG);
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
      data: next,
    });
    // Drunk, not merely held — one name per bottle.
    await dropCharacterTag(tx, character.id, potion.tagId, 1);
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
      },
    });
  });

  // Best-effort Discord fan-out, outside the transaction (ARCHITECTURE.md §5
  // — no network call inside one). The role and the nickname wear the REAL
  // bare name on purpose, disguise or not (PROXYING.md §6, §8).
  await ensureCharacterRole(updated).catch(() => {});
  await syncCharacterNickname(
    session.discordUserId,
    formatBareName(updated),
  ).catch(() => {});
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

// --- Bodies: Butcher, Bury, Engrave --------------------------------------
//
// All three act on a CORPSE TAG rather than on a name typed into a box, which
// is the change docs/systemdocs/CORPSES.md is really about: a body is an
// object you hold or can walk up to. Engrave is the exception, and it is the
// exception on purpose — see its own comment.

// The one reach rule the three share, and the reason they cannot disagree
// about what you can touch: a corpse in your own hands, or one lying in a Room
// at your Location you can actually get into. Location-grain, because that is
// what a room stash is (CARRY.md §5).
//
// Re-resolved server-side from the posted ids every time. The dialog's list is
// advisory; this is the gate that holds when a client posts its own ids.
async function resolveCorpseSource(character, { tagId, sourceKey }) {
  const reachable = await corpsesInReach(prisma, character);
  const found = reachable.find(
    (c) => c.tagId === tagId && c.sourceKey === sourceKey,
  );
  // One message for both "you made that up" and "someone got there first",
  // deliberately: telling them apart would say whether a body they cannot see
  // exists, which is the scouting leak the reach rule exists to prevent.
  if (!found) throw new UserError("That body isn't there any more.");
  return found;
}

// Taking the body off whatever was holding it. The conditional write IS the
// check in both branches — a room is the game's first multi-actor inventory
// (CARRY.md §5), and two of your own tabs can race just as well.
async function takeCorpse(tx, corpse) {
  if (corpse.source.kind === "room") {
    const ok = await dropRoomTag(tx, corpse.source.id, corpse.tagId, 1);
    if (!ok) throw new UserError("That body isn't there any more.");
    return;
  }
  const gone = await tx.characterTag.deleteMany({
    where: { characterId: corpse.source.id, tagId: corpse.tagId },
  });
  if (gone.count === 0)
    throw new UserError("That body isn't there any more.");
}

// Butchering. FREE — no ⬢, no Move — and it consumes the body.
//
// It deliberately does NOT free the soul: cutting someone up destroys the
// evidence without burying them, so their player stays Cursed. That is the
// hole Engrave exists to fill, and it reads as an oversight unless you know
// it was a choice.
async function butcherCorpseRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The gate, re-checked here because a disabled button is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag?.slug === BUTCHER_SLUG)) {
    throw new UserError("You don't know how to butcher.");
  }

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  const yieldTag = await prisma.tag.findUnique({
    where: { slug: corpse.yieldSlug },
  });
  // A catalog out of step with the code. Refusing is right: silently granting
  // nothing would read to the player as the button being broken.
  if (!yieldTag) throw new UserError("Nothing comes of that one. Tell a GM.");

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, yieldTag, openTurn, {
    reason: "butcher",
  });

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await addToStack(tx, character.id, yieldTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: yieldTag.stackable,
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_butcher_corpse",
      targetCharacterId: corpse.deadCharacterId ?? character.id,
      details: {
        corpse: corpse.tagName,
        made: yieldTag.name,
        source: corpse.source.kind,
      },
    });
  });

  await afterInventoryChange([character.id]);

  // The dead player is told, and never told by whom — the same posture every
  // other request that acts on someone else takes.
  if (corpse.human && corpse.deadCharacterId) {
    const dead = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
    });
    if (dead) notifyCharacter(dead, "Somebody has cut your body apart.");
  }
  // A public room's contents changing is public by nature (CARRY.md §6).
  if (corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "butchers a body here."),
    );
  }

  revalidateAll();
  return { made: yieldTag.name };
}

// Mutilating. One piece off a bound person or a corpse, and it is FREE — no ⬢,
// no Move, no turn. Press it again for the next piece; the ladder in
// db/lib/mutilate.js is what stops a third eye.
//
// It deliberately does NOT consume the body the way Butcher does. Butchering
// is the whole corpse at once; this is picking at one, and you should be able
// to come back for the other eye.
//
// The part menu is UNFILTERED on the client on purpose (see the dialog): which
// rungs a subject has left is a fact about their sheet, and offering only the
// ones they still have would answer "what are they already missing?" to anyone
// who opened it. The refusal here is where they find out.
async function mutilateRequestImpl({
  targetCharacterId,
  tagId,
  sourceKey,
  part,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const actorSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!actorSlugs.some((slug) => MUTILATE_GATE_SLUGS.includes(slug)))
    throw new UserError("You couldn't bring yourself to. ‡");

  const named = partFor(part);
  if (!named) throw new UserError("That isn't something you could take. ‡");

  // Two subjects, one action. A corpse resolves through the reach rule Butcher
  // and Bury already share; a living person through the Bound-and-here check
  // Torture already makes. Either way what comes out is ONE Character row to
  // injure, so everything below this is common.
  let corpse = null;
  let subject = null;
  if (tagId) {
    corpse = await resolveCorpseSource(character, { tagId, sourceKey });
    // A Nekker has no sheet to injure and nothing recognisable to take.
    if (!corpse.human || !corpse.deadCharacterId)
      throw new UserError("There's nothing in that one you'd want. ‡");
    subject = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject) throw new UserError("That body isn't there any more.");
  } else {
    if (targetCharacterId === character.id)
      throw new UserError("You can't do that to yourself.");
    // The WHOLE row, not a select: a lethal part hands this straight to
    // killCharacter, which reads discordRoleId and everything
    // revokeAllCharacterAccess needs. The Harm path loads it the same way and
    // for the same reason — a partial row there orphans a Discord role.
    subject = await prisma.character.findFirst({
      where: { id: targetCharacterId ?? "", status: "ALIVE" },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject || !isHere(character, subject))
      throw new UserError(notHereMessage(subject));
    if (!isBoundTarget(subject))
      throw new UserError(`${subject.name} isn't tied up.`);
  }

  const step = resolveMutilation(
    part,
    subject.tags.map((ct) => ct.tag.slug),
  );
  if (!step)
    throw new UserError(`There's no ${named.label.toLowerCase()} left to take. ‡`);

  const [grantTag, itemTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: step.grantSlug } }),
    prisma.tag.findUnique({ where: { slug: step.itemSlug } }),
  ]);
  // A catalog out of step with the code. Refusing is right: granting nothing
  // silently would read to the player as the button being broken.
  if (!grantTag || !itemTag)
    throw new UserError("Nothing comes of that one. Tell a GM.");
  const dropTag = step.dropSlug
    ? await prisma.tag.findUnique({ where: { slug: step.dropSlug } })
    : null;

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, itemTag, openTurn, {
    characterId: character.id,
    where: "mutilate",
  });
  // The organs kill, but only somebody who is still using them.
  const kills = step.lethal && subject.status === "ALIVE";

  await prisma.$transaction(async (tx) => {
    if (dropTag) await dropCharacterTag(tx, subject.id, dropTag.id);
    await addToStack(tx, subject.id, grantTag.id, 1, {
      source: "EVENT",
      stackable: grantTag.stackable,
    });
    await addToStack(tx, character.id, itemTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: itemTag.stackable,
    });
    // A corpse feels nothing. applyFear on a dead row would move a dial
    // nobody reads and show up in the fear log as a live event.
    if (subject.status === "ALIVE")
      await applyFear(tx, subject.id, { kind: "MUTILATED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_mutilate",
      targetCharacterId: subject.id,
      turnId: openTurn?.id ?? null,
      details: {
        subjectName: subject.name,
        part: step.part,
        granted: grantTag.name,
        dropped: dropTag?.name ?? null,
        item: itemTag.name,
        lethal: kills,
        source: corpse ? corpse.source.kind : "person",
        ...(corpse ? { corpse: corpse.tagName } : {}),
      },
    });
  });

  await afterInventoryChange([character.id, subject.id]);

  // Unattributed, like every other request that acts on somebody else. The
  // death DM rides on killCharacter so nothing ever sends two.
  if (kills) {
    await killCharacter(subject, `Your ${named.label.toLowerCase()} was cut out. ‡`).catch(
      (err) =>
        console.error(`Failed to kill mutilated character ${subject.id}:`, err),
    );
  } else if (corpse) {
    notifyCharacter(subject, "Somebody has been cutting pieces off your body. ‡");
  } else {
    notifyCharacter(subject, `Somebody cut off your ${named.label.toLowerCase()}. ‡`);
  }

  // A public room's contents changing is public by nature (CARRY.md §6). Said
  // vaguely on purpose — the room learns a body was cut, not what came off it.
  if (corpse && corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "cuts something off a body here. ‡"),
    );
  }

  revalidateAll();
  return { part: named.label, name: subject.name };
}

// Burying. Takes the body — you have to actually have it, or be able to reach
// it — and spends your Move.
//
// The old version matched a TYPED first name against the dead in your zone.
// That input has not gone away; it moved to Engrave, which is the one that
// still needs it.
async function buryCharacterRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter();

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  if (!corpse.human || !corpse.deadCharacterId) {
    throw new UserError("There's no soul in that one.");
  }
  const target = await prisma.character.findUnique({
    where: { id: corpse.deadCharacterId },
  });
  if (!target) throw new UserError("There's nobody left to bury.");
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Buried ${target.name}.`,
      "auto:bury",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bury_character",
      targetCharacterId: target.id,
      details: { zoneId: character.zoneId, corpse: corpse.tagName },
    });
  });

  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(
      `Bury: failed to lift the curse from ${target.discordUserId}:`,
      err,
    ),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(target, "Your body was buried. The curse has lifted.");
  if (corpse.source.kind === "room") {
    after(() => announceInRoom(corpse.source, character, "takes a body away."));
  }

  revalidateAll();
  return { name: target.name };
}

// Engraving. The answer to a body nobody can find — so it is the ONE action
// here with no corpse and no reach check at all, and it searches the whole
// game rather than your zone.
//
// This is where Bury's typed first name went, and the reasoning that kept it
// typed is unchanged and now stronger: a dropdown would answer "who is dead?"
// to anyone who opened the dialog, and the list would now be every corpse in
// Ravenheart rather than the ones at your feet.
//
// The >1-match refusal matters far more than it used to for the same reason.
// It is the only thing standing between a mourner and freeing the wrong soul.
async function engraveHeadstoneRequestImpl({
  firstName: rawFirstName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const typed =
    rawFirstName?.toString().trim().slice(0, NAME_LIMITS.firstName) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // No zone clause, on purpose (see above).
  const matches = await prisma.character.findMany({
    where: {
      status: "DEAD",
      buriedAt: null,
      firstName: { equals: typed, mode: "insensitive" },
    },
  });
  if (matches.length === 0)
    throw new UserError("Nobody by that name is dead and unburied.");
  if (matches.length > 1) {
    throw new UserError(
      "More than one dead person answers to that name. A GM will have to do it.",
    );
  }
  const target = matches[0];

  // The friendly refusal. The real check is the conditional debit below, which
  // is what actually stops the balance going negative.
  if (character.resources < ENGRAVE_RESOURCE_COST) {
    throw new UserError(`Engraving costs ${ENGRAVE_RESOURCE_COST} ⬢.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // The conditional debit, which is the check that actually holds — the
    // friendly refusal above only makes the message better.
    await debitResources(
      tx,
      { kind: "character", id: character.id, name: character.name },
      ENGRAVE_RESOURCE_COST,
    );
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const headstone = await mintHeadstone(tx, target);
    await addToStack(tx, character.id, headstone.id, 1, {
      source: "EVENT",
      expiresTurn: null,
      stackable: false,
    });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Engraved a headstone for ${target.name}.`,
      "auto:engrave",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_engrave_headstone",
      targetCharacterId: target.id,
      details: { spent: ENGRAVE_RESOURCE_COST },
    });
    return { headstone };
  });

  await removeCursedRole(target.discordUserId).catch((err) =>
    console.error(
      `Engrave: failed to lift the curse from ${target.discordUserId}:`,
      err,
    ),
  );
  await afterInventoryChange([character.id]);

  notifyCharacter(
    target,
    "Somebody carved your name in stone. The curse has lifted.",
  );

  revalidateAll();
  return { name: target.name, headstone: result.headstone.name };
}

// --- The Godard Factory -----------------------------------------------

// Cutting Godflesh out of the marsh. Spends the Routine, rolls a d6, and on a
// 1 rolls again on a table that Armored Gloves dominate — db/lib/godflesh.js
// holds all of that, and this only writes the result down.
//
// Every gate is re-checked here. The button greys itself for a blade and hides
// itself off a marsh tile, but a server action is a public endpoint and the
// client's menus are advisory (REQUESTS.md §3).
async function extractGodfleshRequestImpl() {
  const { session, character } = await requireCharacter();

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!hasAttribute(location, GODFLESH_ATTRIBUTE)) {
    throw new UserError("There's nothing to cut here.");
  }
  if (!extractToolFor(character.tags)) {
    throw new UserError(
      "You need a hatchet, a battle-axe or a chainsaw in your hands.",
    );
  }
  // Bound, Dying, Paralyzed, Catatonic — or mid-Seizure from a cube, which is
  // the one this exists for. requireFreeMove below only checks the turn and
  // the one-Action rule, so nothing else would stop a man on the floor wading
  // into the marsh with an axe.
  const floored = blockerFor(character.tags, ACT);
  if (floored) {
    throw new UserError(`You're in no state to be swinging anything — you're ${floored.name}.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  const result = rollExtraction(character.tags);
  const [godflesh, injury] = await Promise.all([
    prisma.tag.findUnique({
      where: { slug: GODFLESH_SLUG },
      select: { id: true, name: true, stackable: true },
    }),
    result.injury
      ? prisma.tag.findUnique({
          where: { slug: result.injury.tagSlug },
          select: { id: true, name: true, defaultDurationTurns: true },
        })
      : null,
  ]);
  if (!godflesh)
    throw new UserError("The catalog has no Godflesh in it. Tell a GM.");

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
    await addToStack(tx, character.id, godflesh.id, result.quantity, {
      source: "EVENT",
      stackable: godflesh.stackable,
    });
    if (injury) {
      await addToStack(tx, character.id, injury.id, 1, {
        source: "EVENT",
        expiresTurn: await expiryForGrant(tx, injury, openTurn, {
          characterId: character.id,
          where: "extractGodflesh",
        }),
      });
    }
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      "*Out in the marsh, cutting.*",
      "auto:extract",
    );
    effect.actionId = action.id;
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_extract_godflesh",
      targetCharacterId: character.id,
      details: effect,
    });
  });

  await afterInventoryChange([character.id]);
  // The die is the point of the whole button, so it is DM'd whatever it said.
  notifyCharacter(
    character,
    extractionDm(result, { locationName: location?.name ?? null }),
  );

  revalidateAll();
  return {
    die: result.die,
    quantity: result.quantity,
    injury: injury?.name ?? null,
  };
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
async function packageItemsRequestImpl({
  lines: rawLines,
  label: rawLabel,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const label = String(rawLabel ?? "")
    .trim()
    .slice(0, PACKAGE_LABEL_MAX);
  if (!label) throw new UserError("Say what's in it.");

  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((l) => ({
      tagId: String(l?.tagId ?? ""),
      quantity: Math.max(1, Math.trunc(Number(l?.quantity) || 1)),
    }))
    .filter((l) => l.tagId);
  if (lines.length === 0) throw new UserError("Nothing selected.");

  if (
    !(await hasEquipmentInReach(prisma, character, PACKAGING_EQUIPMENT_SLUG))
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
    if (!isTradeable(row.tag))
      throw new UserError("That isn't something that can be packed.");
    // A crate of crates would nest a consumesInto chain arbitrarily deep, and
    // halving twice is a free carry exploit besides.
    if (isCrate(row.tag)) throw new UserError("You can't crate a crate.");
    const quantity = Math.min(line.quantity, row.quantity);
    return {
      tagId: row.tagId,
      slug: row.tag.slug,
      name: row.tag.name,
      quantity,
      weightLbs: row.tag.weightLbs ?? 0,
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

  const weightByTagId = new Map(contents.map((c) => [c.tagId, c.weightLbs]));
  const group = await prisma.tagGroup.findUnique({
    where: { slug: "items-gear" },
  });
  const openTurn = await getOpenTurn();

  // The "custom-" prefix every runtime tag uses, plus enough entropy that two
  // people packing in the same tick cannot collide on the unique slug.
  const slug = `custom-crate-${character.id.slice(-6)}-${Date.now().toString(36)}`;

  let crate;
  await prisma.$transaction(async (tx) => {
    crate = await tx.tag.create({
      data: {
        slug,
        name: "Crate",
        description: `[CONTAINS]: ${label}`,
        custom: true,
        // Game state, not catalog — a Restart Game sweeps it up (TAGS.md §5d).
        ephemeral: true,
        category: "items",
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
        // An item like any other, so it gets the Destroy button the category
        // rule gives the rest of them (db/lib/syncTags.js).
        removable: true,
        consumable: true,
        // Repeated per unit — that is how consumesInto expresses a quantity
        // (docs/tags.yaml header), and every packable thing worth crating in
        // bulk is stackable.
        consumesInto: contents.flatMap((c) => Array(c.quantity).fill(c.slug)),
        // Carried too, for parity with a Depot crate, so anything that reads
        // one manifest reads both.
        crateContents: contents.map((c) => ({
          tagId: c.tagId,
          name: c.name,
          quantity: c.quantity,
        })),
      },
    });

    for (const c of contents)
      await dropCharacterTag(tx, character.id, c.tagId, c.quantity);
    await addToStack(tx, character.id, crate.id, 1, {
      source: "EVENT",
      stackable: false,
    });

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

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.

export async function craftRequest(input) {
  return guarded(() => craftRequestImpl(input));
}

export async function continueCraft(input) {
  return guarded(() => continueCraftImpl(input));
}

export async function cancelCraft(input) {
  return guarded(() => cancelCraftImpl(input));
}

// Opening a site has no export of its own: craftRequest() branches into it,
// because to a player raising a palisade is the same act as making a sword.
export async function joinBuildSite(input) {
  return guarded(() => joinBuildSiteImpl(input));
}

export async function cancelBuildSite(input) {
  return guarded(() => cancelBuildSiteImpl(input));
}

export async function destroyTagRequest(input) {
  return guarded(() => destroyTagRequestImpl(input));
}

export async function learnRequest(input) {
  return guarded(() => learnRequestImpl(input));
}

export async function teachRequest(input) {
  return guarded(() => teachRequestImpl(input));
}

export async function confessRequest(input) {
  return guarded(() => confessRequestImpl(input));
}

export async function transferRequest(input) {
  return guarded(() => transferRequestImpl(input));
}

export async function consumeTagRequest(input) {
  return guarded(() => consumeTagRequestImpl(input));
}

export async function healCharacterRequest(input) {
  return guarded(() => healCharacterRequestImpl(input));
}

export async function claimDesire(input) {
  return guarded(() => claimDesireImpl(input));
}

export async function changeNameRequest(input) {
  return guarded(() => changeNameRequestImpl(input));
}

export async function lootCharacterRequest(input) {
  return guarded(() => lootCharacterRequestImpl(input));
}

export async function bindCharacterRequest(input) {
  return guarded(() => bindCharacterRequestImpl(input));
}
export async function freeCharacterRequest(input) {
  return guarded(() => freeCharacterRequestImpl(input));
}
export async function crucifyCharacterRequest(input) {
  return guarded(() => crucifyCharacterRequestImpl(input));
}
export async function tortureCharacterRequest(input) {
  return guarded(() => tortureCharacterRequestImpl(input));
}
export async function disguiseSelfRequest(input) {
  return guarded(() => disguiseSelfRequestImpl(input));
}
export async function harmCharacterRequest(input) {
  return guarded(() => harmCharacterRequestImpl(input));
}

export async function buryCharacterRequest(input) {
  return guarded(() => buryCharacterRequestImpl(input));
}

export async function butcherCorpseRequest(input) {
  return guarded(() => butcherCorpseRequestImpl(input));
}

export async function mutilateRequest(input) {
  return guarded(() => mutilateRequestImpl(input));
}

export async function engraveHeadstoneRequest(input) {
  return guarded(() => engraveHeadstoneRequestImpl(input));
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
async function birdMessageRequestImpl({
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

  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.character.updateMany({
      where: {
        id: character.id,
        OR: [{ birdTurnId: null }, { birdTurnId: { not: dayKey } }],
      },
      data: { birdTurnId: dayKey },
    });
    if (claimed.count === 0)
      throw new UserError("Your bird has already flown today.");

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
      deliveryDm({ senderName: character.name, letterName: held.tag.name }),
      {
        // No Reply button for someone who can't write one — birdReply.js
        // re-checks, since a GM can strip the tag inside the window.
        components: recipientIsLiterate
          ? replyButtonRow(birdMessageId)
          : undefined,
        meta: { kind: "bird", birdMessageId, letterName: held.tag.name },
        source: "bird",
      },
    );
    await afterInventoryChange([character.id, recipient.id]);
  }

  revalidateAll();
  return { ok: true };
}

export async function extractGodfleshRequest(input) {
  return guarded(() => extractGodfleshRequestImpl(input));
}

export async function packageItemsRequest(input) {
  return guarded(() => packageItemsRequestImpl(input));
}

export async function birdMessageRequest(input) {
  return guarded(() => birdMessageRequestImpl(input));
}
