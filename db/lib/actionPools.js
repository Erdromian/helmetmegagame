// What one character can do right now, as the Discord bot's Actions menu and
// typed commands need to know it: every `show` and `gate` flag
// db/lib/actionCatalog.js names, plus the sharper greyed sentence where there
// is one. The web builds the same flags for its sheet and /chat Actions menu in
// web/app/(app)/character/page.js#FreshCharacter and
// web/app/components/RequestActionsProvider.js; every predicate below is the
// shared db/lib one those two call, and each block says which lines it mirrors.
//
// THE METAGAMING RULE holds here too (actionRegistry.js's header): a verb is
// hidden or greyed only for a fact about the character's OWN sheet or the
// ground they stand on — never for who is standing near them. The one
// inherited exception is Learn/Teach, which the web greys when nobody else is
// here at all; mirrored as it is, not changed on this face.
//
// Advisory, like the web's: every verb re-checks itself when it runs. Takes
// `prisma` as a parameter and stays off the @lifeweb/db barrel.

const { hasAttribute, GODFLESH_ATTRIBUTE, SOILERY_ATTRIBUTE } = require("./locationAttributes");
const { accessSlugsOf, wornRingAccess } = require("./rings");
const { isLooseCollarSlug } = require("./collarGlyphs");
const { canWorkRemote, canUnlockCollar } = require("./collar");
const { extractToolFor, extractedThisTurn } = require("./godflesh");
const { farmRefusalFor } = require("./soilery");
const { breakInRefusalFor } = require("./arelitz");
const {
  isRefinery,
  refineryInput,
  refineFatigueRefusal,
  refinersThisTurn,
  REFINERY_MAX_WORKERS,
  REFINERY_FULL_MESSAGE,
} = require("./refinery");
const { resolveMiningRate } = require("./mining");
const { workVerbFor } = require("./gathering");
const { hasEquipmentInReach } = require("./equipmentReach");
const { structuresAt, canBuildHere, WORKING_STATUSES } = require("./structures");
const {
  PACKAGING_EQUIPMENT_SLUG,
  GUILT_RIDDEN_SLUG,
  BUTCHER_SLUG,
  MUTILATE_GATE_SLUGS,
  MUSICIAN_SLUG,
  TRUMPET_SLUG,
  VAMPIRE_SLUG,
} = require("./constants");
const { isPointerDeviceSlug } = require("./pointerMint");
const { kissBlock } = require("./kiss");
const { holdsPickpocket, pickpocketSelfBlock } = require("./pickpocket");
const { caughtSecondsLeft, inFight } = require("./intercept");
const { examineBlock } = require("./examineVision");
const { isDaylight } = require("./turnClock");
const { canRead } = require("./reading");
const { PAPER_SLUG, BLANK_BOOK_SLUG, isSeal, isPaper } = require("./paper");
const { canSendBird, BIRD_SLUG, birdRestingToday } = require("./bird");
const { BASE_BIRD_SENDS_PER_DAY, birdAllowanceFrom } = require("./rookery");
const { THANATI_SLUG, THANATI_LEADER_SLUG, RECOVERABLE_SLUGS, hideoutRoom } = require("./thanati");
const { CERBERON_SLUG, WARRANT_BADGE_SLUGS } = require("./wanted");
const { SKINLESS_TAG_SLUG } = require("./skinless");
const { BISHOP_SLUG } = require("./excommunication");
const { BASTARD_TAG_SLUG, DEEP_BEAST_HORN_SLUG } = require("./lateJoin");
const { LESSON_CATALOG_SELECT, learnableSkills, knownTeachableSkills } = require("./lessons");
const {
  buildSkillAncestry,
  satisfiedSkillIds,
  HEAL_SKILL_SLUG,
  SAINT_SLUG,
  MIRACLE_PER_TURN,
} = require("./medicalVision");
const {
  tagsById,
  heldHigherTiers,
  craftableTags,
  computeKnownRecipeIds,
  placementOfferedHere,
  destroyableTags,
  consumableTags,
} = require("./craftRecipes");
const { rosterHere } = require("./peopleHere");
const { partyOf } = require("./escort");

const MULLIGAN_SLUG = "mulligan-potion";

// The character as the pools read it — the FreshCharacter load (page.js
// 347–377), narrowed to what a flag reads. Whole tag rows, because kissBlock
// and the capability table read flags off them.
const POOL_CHARACTER_INCLUDE = {
  location: {
    include: {
      zone: { select: { kind: true, slug: true } },
      mining: { select: { current: true } },
    },
  },
  tags: {
    include: {
      tag: {
        include: {
          group: true,
          requirementSkills: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  },
};

function loadPoolCharacter(prisma, where) {
  return prisma.character.findFirst({ where: { status: "ALIVE", ...where }, include: POOL_CHARACTER_INCLUDE });
}

// The in-game day a turn belongs to (web/lib/turnFormat.js#describeTurn).
function turnDay(turn) {
  return turn ? turn.dayNumber ?? Math.ceil(turn.number / 2) : null;
}

// canCraft (RequestActionsProvider.js 310–320, 516–519; page.js 770–921): a
// recipe you could make here, a project of your own still open, or a site
// going up where you stand.
async function craftFlags(prisma, character, { heldIds, satisfied, sites }) {
  const catalog = await prisma.tag.findMany({
    where: { OR: [{ purchasable: true }, { craftable: true }] },
    select: {
      id: true,
      slug: true,
      craftable: true,
      stackable: true,
      catalogVisibility: true,
      recipePublic: true,
      placement: true,
      parentTagId: true,
      requirementItems: true,
      requirementSkills: { select: { id: true, catalogVisibility: true } },
    },
  });
  const restrictedTagSlugs = new Set();
  const restrictedGroupSlugs = new Set();
  for (const t of catalog) {
    if (!t.craftable) continue;
    for (const item of t.requirementItems ?? []) {
      if (item.kind === "group") restrictedGroupSlugs.add(item.slug);
      else if (item.kind === "anyOf") item.slugs.forEach((s) => restrictedTagSlugs.add(s));
      else restrictedTagSlugs.add(item.slug);
    }
  }
  const visibilityRows =
    restrictedTagSlugs.size || restrictedGroupSlugs.size
      ? await prisma.tag.findMany({
          where: {
            OR: [
              restrictedTagSlugs.size ? { slug: { in: [...restrictedTagSlugs] } } : null,
              restrictedGroupSlugs.size ? { group: { slug: { in: [...restrictedGroupSlugs] } } } : null,
            ].filter(Boolean),
          },
          select: { slug: true, catalogVisibility: true, group: { select: { slug: true } } },
        })
      : [];
  const visibilityBySlug = new Map(visibilityRows.map((r) => [r.slug, r.catalogVisibility]));
  const nonAllGroupSlugs = new Set(
    visibilityRows.filter((r) => r.group && r.catalogVisibility !== "ALL").map((r) => r.group.slug),
  );
  const knownRecipeIds = computeKnownRecipeIds(catalog, satisfied, character.tags, {
    visibilityBySlug,
    nonAllGroupSlugs,
  });
  const gateById = tagsById([...catalog, ...character.tags.map((ct) => ct.tag).filter(Boolean)]);
  const buildable = canBuildHere(character.location).ok;
  const locationSlug = character.location?.slug ?? null;
  const craftable = craftableTags(catalog, heldIds, knownRecipeIds)
    .filter((t) => heldHigherTiers(t, gateById, heldIds).length === 0)
    .filter((t) => placementOfferedHere(t, { buildable, sites, locationSlug }));
  if (craftable.length > 0) return true;
  if (sites.some((s) => s.status === "UNDER_CONSTRUCTION")) return true;
  const projects = await prisma.craftProject.count({ where: { characterId: character.id, status: "ACTIVE" } });
  return projects > 0;
}

// The Godard Factory, the fields, the stable and the seam (page.js 659–746).
async function workFlags(prisma, character, { openTurn, currentAction }) {
  const tags = character.tags ?? [];
  const location = character.location;
  const gateReason = {};

  const canSeeExtract = hasAttribute(location, GODFLESH_ATTRIBUTE);
  const extractTool = canSeeExtract ? extractToolFor(tags) : null;
  const cutAlready = canSeeExtract && extractedThisTurn(character, openTurn);
  gateReason.extract = !canSeeExtract
    ? null
    : cutAlready
      ? "You already harvested Godflesh this turn."
      : !extractTool
        ? "You need a hatchet, a battle-axe or a chainsaw in your hands."
        : null;

  const canSeeFarm = hasAttribute(location, SOILERY_ATTRIBUTE);
  gateReason.farm = canSeeFarm ? farmRefusalFor(tags, Boolean(currentAction)) : null;

  const canSeeBreakIn = character.locationId
    ? Boolean(
        await prisma.room.findFirst({
          where: { locationId: character.locationId, stable: true },
          select: { id: true },
        }),
      )
    : false;
  gateReason.breakin = canSeeBreakIn ? breakInRefusalFor(tags, Boolean(currentAction)) : null;

  const canSeeRefine = isRefinery(location);
  if (canSeeRefine) {
    const input = await refineryInput(prisma, { id: character.id, locationId: character.locationId });
    const full = openTurn ? (await refinersThisTurn(prisma, openTurn.id)) >= REFINERY_MAX_WORKERS : false;
    const tired = refineFatigueRefusal(tags.map((ct) => ct.tag?.slug).filter(Boolean));
    gateReason.refine = !input
      ? "There's no Godflesh here to refine."
      : currentAction
        ? "You already have an action this turn."
        : tired
          ? tired
          : full
            ? REFINERY_FULL_MESSAGE
            : null;
  }

  const mineRate = await resolveMiningRate(prisma, character.id);
  gateReason.mine = !mineRate.ok
    ? mineRate.reason
    : currentAction
      ? "You already have an action this turn."
      : null;
  const workVerb = mineRate.ok ? mineRate.verb : workVerbFor(location?.zone?.slug).key;

  return {
    flags: {
      canSeeExtract,
      canExtract: canSeeExtract && !gateReason.extract,
      canSeeFarm,
      canFarm: canSeeFarm && !gateReason.farm,
      canSeeBreakIn,
      canBreakIn: canSeeBreakIn && !gateReason.breakin,
      canSeeRefine,
      canRefine: canSeeRefine && !gateReason.refine,
      canSeeMine: true,
      canMine: !gateReason.mine,
      canSeePackage: await hasEquipmentInReach(prisma, character, PACKAGING_EQUIPMENT_SLUG),
    },
    gateReason,
    workVerb,
  };
}

// Letters, seals and the bird (web/lib/selfPools.js#loadLettersView).
async function paperFlags(prisma, character, { openTurn, canReadNow }) {
  const tags = character.tags ?? [];
  const hasBird = canSendBird(tags);
  const writables = tags.filter(
    (ct) => ct.tag.slug === PAPER_SLUG || ct.tag.slug === BLANK_BOOK_SLUG || ct.tag.paperKind === "PAPER",
  );
  const hasSeal = tags.some((ct) => isSeal(ct.tag));
  const sealables = tags.filter((ct) => ct.tag.paperKind === "PAPER" && (ct.tag.paperText ?? "").trim());
  const letters = tags.filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED");

  let birdSentToday = false;
  if (hasBird) {
    const allowance = birdAllowanceFrom(await structuresAt(prisma, character.locationId, { statuses: WORKING_STATUSES }));
    const sameDay = Boolean(openTurn) && character.birdTurnId === String(turnDay(openTurn));
    const resting =
      Boolean(openTurn) && allowance <= BASE_BIRD_SENDS_PER_DAY
        ? birdRestingToday(
            tags.find((ct) => ct.tag.slug === BIRD_SLUG)?.acquiredAt,
            (
              await prisma.turn.findFirst({
                where: { dayNumber: openTurn.dayNumber },
                orderBy: { startedAt: "asc" },
                select: { startedAt: true },
              })
            )?.startedAt,
          )
        : false;
    birdSentToday = resting || (sameDay && (character.birdDaySends ?? 0) >= allowance);
  }

  const hasBirdReply =
    canReadNow && letters.length > 0
      ? Boolean(
          await prisma.birdMessage.findFirst({
            where: {
              recipientId: character.id,
              delivered: true,
              repliedAt: null,
              ...(openTurn ? { replyDeadlineTurn: { gte: openTurn.number } } : { replyDeadlineTurn: { not: null } }),
            },
            select: { id: true },
          }),
        )
      : false;

  return {
    hasBird,
    canSendBirdToday: !birdSentToday,
    canRead: canReadNow,
    canWrite: canReadNow && writables.length > 0,
    hasSeal,
    canSeal: hasSeal && sealables.length > 0,
    hasBirdReply,
    hasPaper: tags.some((ct) => isPaper(ct.tag)),
  };
}

// Every flag for one living character. `openTurn` and `currentAction` may be
// passed by a caller that already read them; `discordUserId` is what Miracle's
// count keys on (page.js reads it off the session).
async function actionPoolsFor(prisma, character, { openTurn: givenTurn, currentAction: givenAction } = {}) {
  const tags = character.tags ?? [];
  const heldIds = tags.map((ct) => ct.tagId);
  // Held slugs plus the worn ring's doors, so a ring carries the Censor's warrant badge (docs/systemdocs/RINGS.md).
  const heldSlugs = accessSlugsOf(tags);
  const has = (slug) => heldSlugs.has(slug);

  const openTurn =
    givenTurn !== undefined
      ? givenTurn
      : await prisma.turn.findFirst({
          where: { status: "OPEN" },
          select: { id: true, number: true, dayNumber: true, turnLengthHours: true },
        });
  const currentAction =
    givenAction !== undefined
      ? givenAction
      : openTurn
        ? await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } })
        : null;

  const [tierRows, sitesRaw, roster] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
    structuresAt(prisma, character.locationId),
    rosterHere(prisma, character, { select: { id: true } }),
  ]);
  const sites = sitesRaw.map((s) => ({ typeSlug: s.typeSlug, status: s.status }));
  const satisfied = satisfiedSkillIds(heldIds, buildSkillAncestry(tierRows));
  const anyoneHere = roster.named.length + roster.hooded.length > 0;
  const where = { daylight: isDaylight(), indoors: character.location?.indoors ?? true };
  const canReadNow = canRead(tags, where);

  const [work, paper, canCraft] = await Promise.all([
    workFlags(prisma, character, { openTurn, currentAction }),
    paperFlags(prisma, character, { openTurn, canReadNow }),
    craftFlags(prisma, character, { heldIds, satisfied, sites }),
  ]);
  const gateReason = { ...work.gateReason };

  // Look at and Kiss: your own eyes, your own mouth (peoplePools.js 231–243).
  gateReason.examine = examineBlock(tags);
  gateReason.kiss = kissBlock(character, { self: true });

  // Pickpocket: only somebody holding the tag pays for the query, and only
  // they are told why (peoplePools.js 250–261; RequestActionsProvider 541).
  const holdsPocket = holdsPickpocket(tags);
  const pocketBlocked = holdsPocket
    ? pickpocketSelfBlock({
        caughtSeconds: caughtSecondsLeft(character),
        fighting: inFight(character),
        attempts: openTurn
          ? await prisma.pickpocketAttempt.findMany({
              where: { thiefId: character.id, turnId: openTurn.id },
              select: { outcome: true, spentLbs: true },
            })
          : [],
      })
    : null;
  if (holdsPocket) gateReason.pickpocket = pocketBlocked;

  // Heal and Miracle (peoplePools.js 265–271, 414–427).
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const isSaint = has(SAINT_SLUG);
  const miraclesUsed =
    isSaint && openTurn && character.discordUserId
      ? await prisma.auditLog.count({
          where: {
            actorDiscordUserId: character.discordUserId,
            actionType: "request_perform_miracle",
            turnId: openTurn.id,
          },
        })
      : 0;

  // Lessons and Confession (page.js 1082–1121).
  const lessonCatalog = await prisma.tag.findMany({ select: LESSON_CATALOG_SELECT });
  const me = { id: character.id, tags: tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })) };
  const canLearn = anyoneHere && learnableSkills(me, lessonCatalog).length > 0;
  const canTeach = anyoneHere && knownTeachableSkills(me, lessonCatalog).length > 0;
  const canConfess = !has(GUILT_RIDDEN_SLUG) && tags.some((ct) => ct.tag?.psychological);

  // Instruments (RequestActionsProvider.js 352–364).
  const instruments = tags.filter((ct) => ct.tag?.instrument && (ct.quantity ?? 1) > 0);
  const instrumentInHand = instruments.some((ct) => (ct.equippedQuantity ?? 0) > 0 || ct.equipped);

  // Roles and where they stand (page.js 924–963).
  const isThanati = has(THANATI_SLUG);
  const hideout = isThanati ? await hideoutRoom(prisma) : null;

  const consumable = consumableTags(tags);
  const [performing, intercepting, party] = await Promise.all([
    prisma.performance.findFirst({ where: { characterId: character.id, stoppedAt: null }, select: { id: true } }),
    prisma.interceptWatch.findUnique({ where: { characterId: character.id }, select: { id: true } }),
    partyOf(prisma, character.id),
  ]);

  const flags = {
    ...work.flags,
    ...paper,
    canCraft,
    canDestroy: destroyableTags(tags).length > 0,
    canConsume: consumable.length > 0,
    canPoison: consumable.some((t) => t.poison),
    canEquip: tags.some((ct) => ct.tag?.equippable && (ct.equippedQuantity ?? 0) < (ct.quantity ?? 1)),
    canUnequip: tags.some((ct) => (ct.equippedQuantity ?? 0) > 0 || ct.equipped),
    canSeePlay: instruments.length > 0 || has(MUSICIAN_SLUG),
    canPlay: instrumentInHand,
    isPerforming: Boolean(performing),
    hasTrumpet: has(TRUMPET_SLUG),
    hasHorn: has(DEEP_BEAST_HORN_SLUG),
    canDisguise: has("disguise-kit") && !has(SKINLESS_TAG_SLUG), // a Skinless can't pass for anybody
    canLearn,
    canTeach,
    canConfess,
    canBreakRestraints: has("bound") || (has("shackled") && has("escape-artist")),
    hasStepstone: has("stepstone"),
    hasOpenTurn: Boolean(openTurn),
    hasMulligan: has(MULLIGAN_SLUG),
    isVampire: has(VAMPIRE_SLUG),
    canExamine: !gateReason.examine,
    canKiss: !gateReason.kiss,
    isIntercepting: Boolean(intercepting),
    hasParty: party.length > 0,
    canHeal: Boolean(healSkillId && satisfied.has(healSkillId)),
    canMiracle: isSaint,
    canMiracleNow: isSaint && miraclesUsed < MIRACLE_PER_TURN,
    canCrucify: has("fundamentalist") && sites.some((s) => s.typeSlug === "crucifix" && s.status === "COMPLETE"),
    canShackle: sites.some((s) => s.typeSlug === "dungeons" && s.status === "COMPLETE"),
    canTorture: has("torturer"),
    canMutilate: MUTILATE_GATE_SLUGS.some(has),
    canBrand: has("branding-iron"),
    canPickpocket: holdsPocket && !pocketBlocked,
    // A collar somebody has already marked is its own minted slug (COLLAR.md).
    canApplyCollar: [...heldSlugs].some(isLooseCollarSlug),
    // The Exactor's or the Pusher's ring, worn. There is no Collar Key item.
    canUnlockCollar: canUnlockCollar(wornRingAccess(tags)),
    // The remote in hand AND the Exactor's ring worn — never a held token.
    canDetonateCollar: canWorkRemote(heldSlugs, wornRingAccess(tags)),
    canButcher: has(BUTCHER_SLUG),
    hasPointerDevice: [...heldSlugs].some(isPointerDeviceSlug),
    isThanati,
    isThanatiLeader: has(THANATI_LEADER_SLUG),
    canRecover: RECOVERABLE_SLUGS.some((slug) => !has(slug)),
    atHideout: Boolean(hideout && hideout.locationId === character.locationId),
    canWarrant: WARRANT_BADGE_SLUGS.some(has),
    isCerberon: has(CERBERON_SLUG),
    isSkinless: has(SKINLESS_TAG_SLUG),
    isBishop: has(BISHOP_SLUG),
    isBastard: has(BASTARD_TAG_SLUG),
  };

  return { ...flags, gateReason, workVerb: work.workVerb, openTurn };
}

module.exports = { actionPoolsFor, loadPoolCharacter, POOL_CHARACTER_INCLUDE, turnDay };
