import { redirect } from "next/navigation";
import { loadPeoplePools, loadStashRooms } from "@/lib/peoplePools";
import { pickerKey, pickerName } from "@/lib/peopleHere";
import { HEAL_SKILL_SELECT } from "@/lib/healRequests";
import {
  LESSON_CATALOG_SELECT,
  learnableSkills,
  knownTeachableSkills,
  teachesFree,
} from "@lifeweb/db/lib/lessons";
import { cultureForRole } from "@lifeweb/db/lib/nameCorpus";
import {
  prisma,
  roleCapacity,
  isDynastyMember,
  presentedIdentity,
  concealmentFrom,
  rosterName,
  startingTagSlugs,
  normalizeAntagonistSlugs,
} from "@lifeweb/db";
import {
  accessibleRooms,
  guestRoomIds as roomGuestIds,
  questAllowedRoomIds,
} from "@lifeweb/db/lib/roomAccess";
import { mayCustomize } from "@/lib/customCraft";
import { corpsesInReach, livestockInReach } from "@lifeweb/db/lib/corpses";
import { isPlayerCursed } from "@lifeweb/db/lib/curse";
import {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  THANATI_WARES,
  OBOL_SLUG,
  hideoutRoom,
} from "@lifeweb/db/lib/thanati";
import { CERBERON_SLUG, WARRANT_BADGE_SLUGS } from "@lifeweb/db/lib/wanted";
import { accessSlugsOf, isRing, RING_SLUG, FORGED_SEAL_SLUG } from "@lifeweb/db/lib/rings";
import { RING_TEXT } from "@lifeweb/db/lib/ringText";
import {
  BISHOP_SLUG,
  excommunicationCap,
  listExcommunications,
} from "@lifeweb/db/lib/excommunication";
import { itemPools } from "@/lib/itemPools";
import { APPRAISAL_SLUG } from "@lifeweb/db/lib/appraisal";
import {
  WORKSHOP_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  GUILT_RIDDEN_SLUG,
} from "@lifeweb/db/lib/constants";
import {
  hasAttribute,
  GODFLESH_ATTRIBUTE,
  SOILERY_ATTRIBUTE,
  KITCHEN_ATTRIBUTE,
} from "@lifeweb/db/lib/locationAttributes";
import { extractToolFor, extractedThisTurn } from "@lifeweb/db/lib/godflesh";
import { farmRefusalFor } from "@lifeweb/db/lib/soilery";
import { breakInRefusalFor } from "@lifeweb/db/lib/arelitz";
import {
  isRefinery,
  refineryInput,
  refineFatigueRefusal,
  refinersThisTurn,
  REFINERY_MAX_WORKERS,
  REFINERY_FULL_MESSAGE,
} from "@lifeweb/db/lib/refinery";
import { resolveMiningRate } from "@lifeweb/db/lib/mining";
import { workVerbFor } from "@lifeweb/db/lib/gathering";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { resourcesOf, readRoomResources } from "@lifeweb/db/lib/resourceStack";
import { isPaper, paperDescription, paperView } from "@lifeweb/db/lib/paper";
import { canDetectPoison } from "@lifeweb/db/lib/poison";
import { hungerOf } from "@/lib/descriptors";
import {
  freeMovesLeft,
  freeMovesBreakdown,
  travelSentence,
  freeZoneMovesReason,
} from "@lifeweb/db/lib/locationTravel";
import { takenCounts } from "@lifeweb/db/lib/roleReservation";
import { seatsAllocated } from "@lifeweb/db/lib/lobby";
import { groupRoles } from "@lifeweb/db/lib/roleGroups";
import {
  LATE_JOIN_GROUP,
  LATE_JOIN_ROLE_SLUGS,
  loadLateJoinRoles,
  openLateJoinRows,
} from "@lifeweb/db/lib/lateJoin";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockStatus, readGameState, effectivePlayerCount } from "@lifeweb/db/lib/gameState";
import { isDaylight, isDayLongTurn } from "@lifeweb/db/lib/turnClock";
import { deployVersion } from "@/lib/deployVersion";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import { myMove } from "../chat/actions";
import { loadDesireView, loadLettersView } from "@/lib/selfPools";
import { loadVampireBlood } from "@/lib/vampireBloodView";
import { VAMPIRE_SLUG } from "@lifeweb/db/lib/constants";
import { craftFreeUnits } from "@/lib/requests";
import { summarizeCraftBudget } from "@/lib/craftBudget";
import {
  getGmSession,
  getGuildMember,
  isGm,
  isLeaderWhitelisted,
  onRoster,
  playtestRosterClosed,
} from "@/lib/discordGuild";
import {
  isSpawnOnly,
  isRoleSelectable,
  DEFAULT_MAX_DRAWBACK_TAGS,
  DEFAULT_MAX_DRAWBACK_POINTS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { cookedTasteOnly } from "@/lib/referenceData";
import { eatLimitsFor } from "@/lib/eatLimits";
import { appraise } from "@/lib/appraisal";
import { findOpenTurnAction } from "@/lib/moveEconomy";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { computeKnownRecipeIds } from "@/lib/tagRequests";
import { canBuildHere, structuresAt } from "@lifeweb/db/lib/structures";
// For the SEARCH offers' presented faces only — see pendingOffers below.
import { seenByMany, IDENTITY_SELECT } from "@lifeweb/db/lib/intercept";
import { capitalizeFirst } from "@lifeweb/db/lib/concealedIdentity";
import { parseSelection } from "@/lib/portrait/catalog";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import CharacterView from "./CharacterView";
import Loading from "./Skeleton";

// Who may do what with no living character: the phase, the roster, the
// whitelist. Split out of loadCreationData so the lobby — which every open tab
// refreshes every 30 s — answers without loading the whole wizard behind it.
async function loadCreationGate(discordUserId) {
  const [config, state, member] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    // At most a minute old: a role handed out in Discord shows up on the next
    // reload, and the lobby refreshes itself every 30 s anyway.
    getGuildMember(discordUserId, 60_000),
  ]);
  // Presentation only; the server action re-checks regardless.
  const superadmin = isSuperadmin(discordUserId);
  const phase = state?.phase ?? "CLOSED";
  // Only a GM skips the lobby — a playtester rehearses like everybody else (db/lib/roleIds.js).
  const skipper = isGm(member);
  // A closed playtest narrows the roster to the build crew (LOBBY.md §2). Server-side gates re-check it regardless.
  const playtestMode = playtestRosterClosed(config);
  const approved = superadmin || onRoster(member, { playtestMode });
  const gate = {
    phase,
    open: superadmin || phase === "RUNNING" || phase === "ENDED" || skipper,
    approved,
    superadmin,
    gm: skipper,
    // Turned away by playtest mode, not a missing Player role — shows "not open yet" rather than "not on the roster".
    masked: playtestMode && !approved,
  };
  const leaderWhitelisted = superadmin || isLeaderWhitelisted(member);
  return { gate, config, state, leaderWhitelisted };
}

// The lobby's own load: the pickable roles, bucketed, and this player's row.
// Never tags, seat counts or anything the wizard needs — only what Lobby.js draws.
async function loadLobbyData(discordUserId, { leaderWhitelisted }) {
  const [roleRows, preference, entry, readyCount] = await Promise.all([
    prisma.role.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        intro: true,
        groupSlug: true,
        requiresWhitelist: true,
        startingLocation: { select: { zone: { select: { name: true } } } },
      },
    }),
    prisma.playerPreference.findUnique({ where: { discordUserId } }),
    prisma.lobbyEntry.findUnique({ where: { discordUserId } }),
    prisma.lobbyEntry.count({ where: { status: "READY" } }),
  ]);
  return {
    groups: groupRoles(roleRows)
      .map((group) => ({
        slug: group.slug,
        name: group.name,
        roles: group.roles
          .filter((role) => !isSpawnOnly(role))
          .map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            intro: r.intro,
            startingZoneName: r.startingLocation?.zone?.name ?? null,
            requiresWhitelist: r.requiresWhitelist,
            whitelistBlocked: r.requiresWhitelist && !leaderWhitelisted,
          })),
      }))
      .filter((g) => g.roles.length > 0),
    initial: {
      rolePriorities: preference?.rolePriorities ?? {},
      antagonistOptIns: normalizeAntagonistSlugs(preference?.antagonistOptIns ?? [], {
        whitelisted: leaderWhitelisted,
      }),
      joblessRole: preference?.joblessRole ?? "MIGRANT",
    },
    entry: entry?.status === "READY" ? { readyAt: entry.readyAt.toISOString() } : null,
    readyCount,
    whitelisted: leaderWhitelisted,
  };
}

// Everything the creation wizard needs, as the flat role list groupRoles()
// buckets into the picker's social groups. Seat counts are computed here, not
// the client, so the numbers aren't stale-rendered from a cached page. Takes
// loadCreationGate's answer rather than reading the same three rows again.
async function loadCreationData(discordUserId, { config, state, leaderWhitelisted }) {
  const [roleRows, tags, dynastyName, preference] = await Promise.all([
    prisma.role.findMany({
      orderBy: { sortOrder: "asc" },
      include: { startingLocation: { include: { zone: true } } },
    }),
    loadPointBuyCatalog([], { includeRoleStartingTags: true }),
    dynastyLastName(),
    prisma.playerPreference.findUnique({ where: { discordUserId }, select: { antagonistOptIns: true } }),
  ]);

  // Seated (ALIVE, plus DEAD on every seat but Bum and Migrant) plus anyone
  // else's live wizard-in-progress hold; excludes the viewer's own hold.
  // Before Start Game holds don't count, so a GM skipping ahead sees only real characters (db/lib/lobby.js#seatsAllocated).
  const takenByRole = await takenCounts(prisma, roleRows, discordUserId, {
    countReservations: seatsAllocated(state?.phase),
  });

  // LATE JOINS (db/lib/lateJoin.js): the seats a GM has opened, drawn in their
  // own "Special" section above the social buckets. `slots` is the cap here
  // rather than roleCapacity() — a late join is a door somebody opened by hand,
  // so the number of chairs is the GM's answer, not a function of the roster.
  // `taken` still comes from takenCounts, so a live wizard hold counts against
  // the seat exactly as it does on every other card.
  const lateJoin = await loadLateJoinRoles(prisma, { roles: roleRows.filter((r) => LATE_JOIN_ROLE_SLUGS.includes(r.slug)) });

  const cursed = await isPlayerCursed(prisma, discordUserId);
  const playerCount = effectivePlayerCount(config, state);
  const roleCard = makeRoleCard({ leaderWhitelisted, takenByRole });

  return {
    cursed,
    dynastyName,
    whitelisted: leaderWhitelisted,
    initialAntagonists: normalizeAntagonistSlugs(preference?.antagonistOptIns ?? [], {
      whitelisted: leaderWhitelisted,
    }),
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    playPanelEnabled: config?.playPanelEnabled ?? true, // same gate the Bio card's switch uses (AvatarField.js)
    maxDrawbackTags: config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS,
    maxDrawbackPoints: config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS,
    tags,
    // Seven social buckets, not five zones — each role names its own in
    // docs/roles.yaml and db/lib/roleGroups.js holds the order and the labels.
    groups: groupRoles(roleRows)
      .map((group) => ({
        slug: group.slug,
        name: group.name,
        // Spawn-only seats are withheld outright, not greyed — see
        // characterCreation.js#isSpawnOnly.
        roles: group.roles
          .filter((role) => !isSpawnOnly(role))
          .map((role) => roleCard(role, roleCapacity(role, playerCount))),
      }))
      .filter((g) => g.roles.length > 0),
    // The late-join seats a GM has opened, above the buckets. Empty is the
    // normal case, and the wizard draws no heading for an empty one.
    specialGroup: {
      slug: LATE_JOIN_GROUP.slug,
      name: LATE_JOIN_GROUP.name,
      roles: openLateJoinRows(lateJoin).map((row) => roleCard(row.role, row.slots)),
    },
  };
}

// One role card, shared by the social buckets and the Special section so the
// two can never disagree about what a seat looks like. `cap` is passed in
// because the two answer it differently: a bucket seat scales with the roster
// (roleCapacity), a late join is however many chairs the GM opened.
function makeRoleCard({ leaderWhitelisted, takenByRole }) {
  return function roleCard(role, cap) {
    return {
      id: role.id,
      name: role.name,
      intro: role.intro,
      slug: role.slug,
      // Null for ordinary seats; set on the four dynasty roles.
      lockedGender: role.lockedGender,
      difficulty: role.difficulty,
      startingLocationName: role.startingLocation?.name ?? null,
      startingZoneName: role.startingLocation?.zone?.name ?? null,
      extraStartingPoints: role.extraStartingPoints,
      // Parsed, because the wizard matches these against catalog tag
      // slugs and an entry may carry a count ("obol x5").
      startingTagSlugs: startingTagSlugs(role.startingTagSlugs),
      // Drives the "Whitelist only" hover on a greyed card, and the ★
      // beside the name: a reserved seat, vouched players only.
      requiresWhitelist: role.requiresWhitelist,
      whitelistBlocked: role.requiresWhitelist && !leaderWhitelisted,
      // Infinity doesn't serialize; uncapped roles cross as null -> "∞".
      cap: cap === Infinity ? null : cap,
      taken: takenByRole.get(role.id) ?? 0,
      selectable: isRoleSelectable({ role, leaderWhitelisted }),
      // Resolved server-side so a client component never drags
      // PrismaClient into the browser bundle.
      lastNameLocked: isDynastyMember(role.slug),
    };
  };
}

// Snapshotted (web/lib/snapshot, CHAT.md §5c): reads the session, mounts the
// shell, streams FreshCharacter in behind it.
export default async function CharacterPage({ searchParams }) {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  return (
    <SnapshotPage scope="character" userId={session.discordUserId} render={CharacterView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshCharacter userId={session.discordUserId} searchParams={searchParams} />
      </Suspense>
    </SnapshotPage>
  );
}

// The whole load. Four outcomes — a closed door, the lobby, the wizard, the
// sheet — each a `kind` in the one object CharacterView draws. `scope` is the
// snapshot bucket the result is written into (web/lib/snapshot) — keeps a second surface from painting /character's stored copy.
//
// `raw` hands back the object itself instead of the snapshot element that
// carries it. /chat's Actions menu (chat/actionSheet.js) loads the sheet that
// way on demand, so the verbs it offers are gated by this one load and never
// by a second copy of it.
export async function FreshCharacter({ userId, searchParams, scope = "character", raw = false }) {
  const session = { discordUserId: userId };
  const fresh = raw ? (data) => data : (data) => <SnapshotFresh scope={scope} userId={userId} data={data} />;

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      zone: true,
      // The Location's own zone kind rides along so canBuildHere() can judge
      // this ground without a second round-trip (db/lib/structures.js) —
      // building is a fact about the ground, not the presence `zone`.
      location: {
        include: {
          zone: { select: { kind: true, slug: true } },
          // The Mine button's gate: the row IS the gate (db/lib/mining.js), so its
          // absence is what hides the button.
          mining: { select: { current: true } },
        },
      },
      role: { select: { slug: true } },
      // requirementSkills must be named explicitly — `include` doesn't pull
      // unnamed relations. HEAL_SKILL_SELECT, not `name` alone: these rows
      // are the SELF patient in loadPeoplePools' heal roster.
      tags: {
        include: {
          tag: {
            include: {
              group: true,
              requirementSkills: { select: HEAL_SKILL_SELECT },
            },
          },
        },
      },
    },
  });

  // No living character — this is the lobby, the wizard, or a closed door,
  // depending on the phase (docs/systemdocs/LOBBY.md §1).
  if (!character) {
    const gateData = await loadCreationGate(session.discordUserId);
    const { gate } = gateData;
    const { create } = (await searchParams) ?? {};
    const skipping = create === "1" && (gate.gm || gate.superadmin);
    if (gate.phase === "LOBBY" && !skipping) {
      if (!gate.approved) return fresh({ kind: "closed", open: !gate.masked, phase: gate.phase });
      // Six fields per role, not the wizard's whole card — never tags or seat counts.
      const lobby = await loadLobbyData(session.discordUserId, gateData);
      return fresh({ kind: "lobby", lobby: { ...lobby, canSkip: gate.gm || gate.superadmin } });
    }
    if (!gate.open || !gate.approved)
      return fresh({ kind: "closed", open: gate.masked ? false : gate.open, phase: gate.phase });
    const creation = await loadCreationData(session.discordUserId, gateData);
    // An unburied body stops creation dead (db/lib/curse.js). Shown here so a
    // player isn't handed a wizard that refuses on Confirm; createActions.js
    // re-checks it, since a server action is a public endpoint.
    // A LATE JOIN IS THE ONE WAY PAST IT (db/lib/lateJoin.js): an unburied body
    // costs you your place in Ravenheart, and a late-join seat is somebody
    // arriving from outside it — so where a GM has opened one, the wizard opens
    // too, narrowed to the Special section. createCharacter enforces the same
    // narrowing, since a server action is a public endpoint.
    const cursedToSpecial = creation.cursed && !gate.superadmin;
    if (cursedToSpecial && creation.specialGroup.roles.length === 0) {
      return fresh({ kind: "cursed" });
    }
    // A seat from the roll, still inside its window — wizard opens on Tags with the role fixed. createCharacter enforces the same lock.
    const assigned = await prisma.lobbyEntry.findFirst({
      where: { discordUserId: session.discordUserId, status: "ASSIGNED", expiresAt: { gt: new Date() } },
      select: { assignedRoleId: true, expiresAt: true },
    });
    const lockedRole =
      assigned?.assignedRoleId &&
      creation.groups.some((g) => g.roles.some((r) => r.id === assigned.assignedRoleId))
        ? { id: assigned.assignedRoleId, expiresAt: assigned.expiresAt.toISOString() }
        : null;
    return fresh({ kind: "wizard", wizard: { ...creation, lockedRole, cursedToSpecial } });
  }

  const [
    openTurn,
    tagCatalog,
    tierRows,
    gameConfig,
    { action: currentAction },
    frozen,
    nukeState, // the bomb's clock (TagChip.js) — world state, every sheet shows it
    mine, // same server action Chat's YOU column polls, so the two never disagree
  ] = await Promise.all([
    getOpenTurn(),
    // getVisibleTags doesn't select purchasable/craftable, so this comes
    // down as its own props, same as the creation wizard.
    prisma.tag.findMany({
      where: { OR: [{ purchasable: true }, { craftable: true }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true, // needsWorkshop() exempts workshop-equipment itself (web/lib/tagRequests.js)
        description: true,
        category: true,
        pointCost: true,
        purchasable: true,
        purchasableAfterStart: true, // addableTags' purchasable branch requires this or drops purchasable-only tags
        mastery: true, // ChipLabel's mastery star
        sprite: true, // TagIcon's item art; null falls back to the group glyph
        craftable: true,
        catalogVisibility: true, // a SECRET recipe's own discovery gate (M3 review, cybernetic-arm)
        recipePublic: true, // Maggot Milk's escape hatch — see schema.prisma#Tag.recipePublic
        // The custom-item opt-in (CRAFTING.md): shows its name/description
        // fields only when this crosses, resolved against the rung below.
        customizable: true,
        customizableSkillSlug: true,
        placement: true, // whole JSON, not a boolean — the menu needs `unique` too (db/lib/structures.js)
        stackable: true,
        weightLbs: true, // TagChip's Weight row; untradeable is what makes a thing weightless
        tradeable: true,
        parentTagId: true,
        requiredTagId: true,
        requiredTag: { select: { name: true } },
        group: {
          select: {
            slug: true, // the group icon (web/lib/tagIcons.js) — without it every chip falls back to its category glyph
            name: true,
            requiredTagId: true,
            requiredTag: { select: { name: true } },
          },
        },
        // Craft enforces recipe skills; `catalogVisibility` is dropped before
        // this list reaches the browser — see clientTagCatalog below.
        requirementSkills: { select: { id: true, name: true, slug: true, catalogVisibility: true } },
        requirementTurns: true,
        requirementResources: true,
        requirementPerTurn: true,
        requirementItems: true, // every Recipe-line surface must select this or renders none (CORPSES.md §8)
        requirementIngredientSlots: true, // cooking's slot count (COOKING.md)
        mealClass: true, // a meal template's class: naming, symbols, the kitchen gate (COOKING.md)
        customCost: true,
        customDescribable: true,
        meleeArmor: true,
        ballisticArmor: true,
        conflictsWith: { select: { id: true } },
      },
    }),
    // id -> parentTagId for the whole catalog, to resolve a held tier back
    // down its chain to its gate.
    prisma.tag.findMany({
      select: { id: true, slug: true, parentTagId: true },
    }),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: {
        avatarUploadsEnabled: true,
        playPanelEnabled: true,
        desireSlots: true,
        desireSlotLockTurns: true,
        maxDrawbackTags: true,
        maxDrawbackPoints: true,
        craftYieldTiming: true,
      },
    }),
    findOpenTurnAction(prisma, character.id),
    clockStatus(prisma),
    readGameState(prisma, { nukeArmedTurn: true }),
    // The turn card in the sheet's band paints from this, so it is read on
    // every load rather than gated on a scope.
    myMove(),
  ]);

  // Desires: slots and evaluated catalog, built in web/lib/selfPools.js, which Chat's YOU column reads too.
  const {
    desireSlots,
    desireSlotLockTurns,
    slotStates: desireSlotStates,
    catalog: desireCatalog,
    families: desireFamilyList,
    familyGroups: desireFamilyGroupList,
    lockNotes: desireLockNotes,
    addiction: desireAddiction,
  } = await loadDesireView(character, { openTurn, gameConfig });

  // Widens the store catalog so unpurchasable held tags (a GM grant) still reach the client's byId map.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const canAppraise = character.tags.some((ct) => ct.tag.slug === APPRAISAL_SLUG); // appraisal readout (web/lib/appraisal.js)
  const storeTags = await loadPointBuyCatalog(heldIds, { canAppraise });
  const heldSet = new Set(heldIds);
  const storeHeldTags = storeTags
    .filter((t) => heldSet.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  // Every people pool the sheet's dialogs act on, built once in
  // web/lib/peoplePools.js so Chat's people column (/chat) and this sheet
  // cannot disagree about who is standing near you.
  const {
    here,
    hereAll,
    zoneRoster,
    peopleParties,
    transferParties,
    examineBlocked,
    satisfied,
    canHeal,
    healTargets,
    healsLeft,
    hasSurgicalSite,
    surgicalSitePenalty,
    canMiracle,
    miracleTargets,
    miraclesLeft,
    lootTargets,
    consumeTargets,
    bindTargets,
    harmTargets,
    harmTags,
    doseTargets,
    kissTargets,
    searchParties,
    kissBlocked,
    pickpocketBlocked,
  } = await loadPeoplePools(character, {
    discordUserId: session.discordUserId,
    openTurn,
  });

  // The Blood menu (docs/systemdocs/VAMPIRE.md §6) — FreshCharacter is
  // always the viewer's OWN sheet (`mode: "self"` below, unconditional), so
  // the only gate left is holding the seat tag itself. `here` is already
  // loaded above (loadPeoplePools), so Enthral/Nourish's target lists cost
  // no extra query, the same roster bindTargets/kissTargets already read.
  const vampireBlood = character.tags.some((ct) => ct.tag.slug === VAMPIRE_SLUG)
    ? await loadVampireBlood(character, { here, openTurn })
    : null;

  // Every Room stash at this Location reachable, with contents — CARRY.md; a room you can't enter isn't listed.
  // Held slugs plus the worn ring's doors (docs/systemdocs/RINGS.md).
  const heldSlugsForRooms = accessSlugsOf(character.tags);
  // Rooms somebody let this character into by hand — the reason this page and the Transfer gate agree.
  const guestRoomIds = await roomGuestIds(prisma, character.id);
  const questRoomIds = await questAllowedRoomIds(prisma, character.id);
  const roomRowsHere = character.locationId
    ? await prisma.room.findMany({
        where: { locationId: character.locationId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          accessTagSlugs: true,
          tags: {
            where: { quantity: { gt: 0 } },
            select: {
              tagId: true,
              quantity: true,
              // weightLbs/category ride along for Transfer's load projection;
              // slug is what resourcesOf picks the ⬢ stack out by, below.
              tag: {
                select: {
                  name: true,
                  slug: true,
                  stackable: true,
                  weightLbs: true,
                  category: true,
                  sprite: true,
                },
              },
            },
          },
        },
      })
    : [];
  // A room's ⬢ ride in its tags now, like every other item it holds. The
  // number is still handed down as `resources` because that is what the
  // Transfer dialog reads — the storage moved, the prop didn't.
  const roomsHere = roomRowsHere.map((r) => ({ ...r, resources: resourcesOf(r) }));
  // The Transfer dialog's far side, from the shared helper — /chat builds
  // the identical list off it. `roomsHere` above stays this page's own, since corpsesInReach needs the ROWS, not the shape.
  const rooms = await loadStashRooms(character);
  // Every body in reach, for Butcher and Bury (CORPSES.md). Handed the
  // ALREADY-FILTERED room list, matching exactly what the server re-check uses.
  // Livestock (ARELITZ.md §5) concatenates onto the same list — both row
  // shapes carry `livestock`/`yields` now, so BodyDialog.js never has to
  // tell the two apart.
  const reachableRoomsForBodies = accessibleRooms(roomsHere, heldSlugsForRooms, guestRoomIds, questRoomIds);
  const [corpsesHere, livestockHere] = await Promise.all([
    corpsesInReach(prisma, character, { rooms: reachableRoomsForBodies }),
    livestockInReach(prisma, character, { rooms: reachableRoomsForBodies }),
  ]);
  const corpses = [...corpsesHere, ...livestockHere];
  // The Mulligan Potion — drinking it is the one player-facing rename, so
  // its tooltip opens the identity dialog instead of consuming it.
  // changeNameRequestImpl re-checks the potion under the same predicate.
  const mulligan = character.tags.find((ct) => ct.tag.slug === "mulligan-potion");
  const identity = mulligan
    ? {
        tagId: mulligan.tag.id,
        honorific: character.honorific,
        firstName: character.firstName,
        title: character.title,
        lastName: character.lastName,
        lastNameLocked: isDynastyMember(character.role?.slug),
        // Keeps a rename inside the party's own registers.
        culture: cultureForRole(character.role?.slug),
        gender: character.gender,
      }
    : null;

  // From is you or a room; To is anyone here or a room (actions/MoveThingsDialog.js).
  const transferPartyList = { characters: transferParties, rooms };
  // Is a forge within reach? Resolved server-side so the Craft dialog can say so before a player commits.
  const hasWorkshop = await hasEquipmentInReach(
    prisma,
    character,
    WORKSHOP_EQUIPMENT_SLUG,
  );
  // A kitchen where you stand: a Lavish meal needs one (COOKING.md). craftRequest re-checks it.
  const atKitchen = hasAttribute(character.location, KITCHEN_ATTRIBUTE);
  // The Consume slider's top end per item (web/lib/eatLimits.js): counts only, never the meter.
  const eatMax = await eatLimitsFor(prisma, character);
  // The Godard Factory's two buttons (FACTORY.md) — both HIDE where the
  // place is wrong rather than greying, a fact about their own location.
  const canSeeExtract = hasAttribute(character.location, GODFLESH_ATTRIBUTE);
  const extractTool = canSeeExtract ? extractToolFor(character.tags) : null;
  // Harvest Godflesh's cooldown is its own — once a turn (Character.extractTurnKey, FACTORY.md §3). Greyed with the reason, not hidden.
  const cutAlready = canSeeExtract && extractedThisTurn(character, openTurn);
  const canExtract = Boolean(extractTool) && !cutAlready;
  const extractBlocked = !canSeeExtract
    ? null
    : cutAlready
      ? "You already harvested Godflesh this turn."
      : !extractTool
        ? "You need a hatchet, a battle-axe or a chainsaw in your hands."
        : null;
  // The Farms placeholder (db/lib/soilery.js): same HIDE-not-grey posture as
  // Extract just above — whether this ground is a Soilery is a fact about
  // where you're standing. farmRefusalFor reads the SAME function the Sow
  // button's server action re-checks (soilery.js#farmRequestImpl), so the
  // tooltip and a bypassed request can never disagree. `Boolean(currentAction)`
  // is the same "already filed a Move this turn" fact `hasMoved` below reads.
  const canSeeFarm = hasAttribute(character.location, SOILERY_ATTRIBUTE);
  const farmBlocked = !canSeeFarm
    ? null
    : farmRefusalFor(character.tags, Boolean(currentAction));
  const canFarm = canSeeFarm && !farmBlocked;
  // Breaking in an unruly arelitz (ARELITZ.md §6): same HIDE-not-grey
  // posture, but the gate is a `stable: true` Room rather than a Location
  // attribute — any stable Room in this Location counts, matching how
  // Butcher/corpsesInReach read "reachable" at Location grain.
  const canSeeBreakIn = character.locationId
    ? Boolean(
        await prisma.room.findFirst({
          where: { locationId: character.locationId, stable: true },
          select: { id: true },
        }),
      )
    : false;
  const breakInBlocked = !canSeeBreakIn
    ? null
    : breakInRefusalFor(character.tags, Boolean(currentAction));
  const canBreakIn = canSeeBreakIn && !breakInBlocked;
  // Refine (FACTORY.md): the Factory floor's other verb, and the one that
  // spends the whole day. `refineryInput` is the SAME function the server
  // action re-checks, so an empty floor greys the button and refuses a
  // bypassed request with the same sentence.
  const canSeeRefine = isRefinery(character.location);
  const refineInput = canSeeRefine
    ? await refineryInput(prisma, { id: character.id, locationId: character.locationId })
    : null;
  // Same sentences, same order, as refineRequestImpl: no Godflesh, a Move already spent,
  // Exhausted, and a full floor. The count is only asked where the button exists.
  const refineFloorFull =
    canSeeRefine && openTurn ? (await refinersThisTurn(prisma, openTurn.id)) >= REFINERY_MAX_WORKERS : false;
  const refineTired = canSeeRefine
    ? refineFatigueRefusal((character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean))
    : null;
  const refineBlocked = !canSeeRefine
    ? null
    : !refineInput
      ? "There's no Godflesh here to refine."
      : currentAction
        ? "You already have an action this turn."
        : refineTired
          ? refineTired
          : refineFloorFull
            ? REFINERY_FULL_MESSAGE
            : null;
  const canRefine = canSeeRefine && !refineBlocked;
  // Mine (MINING.md). The button shows to EVERYONE, always: anybody can shift
  // rock, and Prospecting decides how much it is worth rather than whether you
  // may try (2026-09-18). Standing where there is no seam, the Exhausted
  // lockout and the once-a-turn Move rule are all greys.
  //
  // There is no zone check here on purpose. The LocationMining row IS the gate
  // (db/lib/mining.js's header), and resolveMiningRate already says "There's
  // nothing to mine here." for a place without one. The `zone.slug === "caves"`
  // test that used to sit here was also wrong: it shut the Depths and the
  // Black Hills out of a system whose coefficients they both carry.
  const canSeeMine = true;
  const mineRate = await resolveMiningRate(prisma, character.id);
  const mineBlocked = !mineRate.ok
    ? mineRate.reason
    : currentAction
      ? "You already have an action this turn."
      : null;
  const canMine = !mineBlocked;
  // Which word the button wears — Mine underground, Gather in the Black Hills.
  // The rate resolved it off the zone (db/lib/gathering.js); a refusal carries
  // no verb, so fall back to the zone directly rather than to "mine".
  const workVerb = mineRate.ok ? mineRate.verb : workVerbFor(character.location?.zone?.slug).key;
  const canSeePackage = await hasEquipmentInReach(
    prisma,
    character,
    PACKAGING_EQUIPMENT_SLUG,
  );
  const carry = carryStatus(character, gameConfig);
  // Free zone crossings left this turn (CARRY.md §2). Resolved server-side so no allowance math reaches the client bundle.
  const zoneMoves = freeMovesLeft(character, gameConfig, openTurn);
  const zoneMovesReason = freeZoneMovesReason(character, 0, { config: gameConfig, openTurn });
  // The same count in two halves, and the sentence for it, so the tile can say
  // which of the two a mount is buying (MAP.md §3a). Built here: LedgerBand is
  // a client component.
  const zoneMovesBreakdown = { ...freeMovesBreakdown(character, gameConfig, openTurn), line: null };
  zoneMovesBreakdown.line = travelSentence(zoneMovesBreakdown);
  // Craft (CRAFTING.md): the recipes whose every skill this character holds
  // (or a higher tier of), decided here and re-checked by craftRequest. The
  // client filters its picker to these ids and nothing else.
  //
  // Ingredient hiding started as menu hygiene and is now also half of the
  // secrecy story: the Recipes tab drops a recipe naming an ingredient the
  // reader was not sent (web/lib/recipeCatalog.js), and hidden-recipe tag
  // descriptions no longer name their ingredients. Here it keeps a recipe you
  // have no path to yet out of the picker, so a fresh crafter isn't offered
  // Bone Mask before they've ever seen a corpse. An ingredient tag's own
  // catalogVisibility isn't on the tagCatalog query above (it usually isn't
  // craftable/purchasable itself), so the slugs and groups a craftable
  // recipe's requirementItems name are resolved with one more targeted
  // query.
  const restrictedTagSlugs = new Set();
  const restrictedGroupSlugs = new Set();
  for (const t of tagCatalog) {
    if (!t.craftable) continue;
    for (const item of t.requirementItems ?? []) {
      if (item.kind === "group") restrictedGroupSlugs.add(item.slug);
      else if (item.kind === "anyOf")
        item.slugs.forEach((s) => restrictedTagSlugs.add(s));
      else restrictedTagSlugs.add(item.slug);
    }
  }
  const ingredientVisibilityRows =
    restrictedTagSlugs.size || restrictedGroupSlugs.size
      ? await prisma.tag.findMany({
          where: {
            OR: [
              restrictedTagSlugs.size
                ? { slug: { in: [...restrictedTagSlugs] } }
                : null,
              restrictedGroupSlugs.size
                ? { group: { slug: { in: [...restrictedGroupSlugs] } } }
                : null,
            ].filter(Boolean),
          },
          select: {
            slug: true,
            catalogVisibility: true,
            group: { select: { slug: true } },
          },
        })
      : [];
  const visibilityBySlug = new Map(
    ingredientVisibilityRows.map((r) => [r.slug, r.catalogVisibility]),
  );
  // A group entry (bone-mask's corpse) is non-public the moment ANY tag wearing that group is non-ALL.
  const nonAllGroupSlugs = new Set(
    ingredientVisibilityRows
      .filter((r) => r.group && r.catalogVisibility !== "ALL")
      .map((r) => r.group.slug),
  );
  // The Death Mask's corpse picker: held corpses still with a face, server-computed so it can't drift from requestActions.js#resolveDeathMaskSource.
  const deathMaskCorpses = character.tags
    .filter(
      (ct) =>
        ct.tag.group?.slug === "items-corpse" &&
        !(ct.tag.description ?? "").includes("The face has been taken."),
    )
    .map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name }));
  // The two ring recipes' pickers (docs/systemdocs/RINGS.md), server-computed so
  // they can't drift from actions/crafting.js#resolveRingTarget and
  // #resolveForgeSource. A ring is engraved for yourself or somebody you know by
  // a real person; a wax seal is pressed from an office ring you're holding.
  const knownPeople = await prisma.acquaintance.findMany({
    where: { ownerId: character.id, subjectId: { not: null }, subject: { status: "ALIVE" } },
    select: { subjectId: true, name: true },
    orderBy: { name: "asc" },
  });
  const recipePicks = {
    [RING_SLUG]: {
      label: RING_TEXT.craftTargetLabel,
      empty: RING_TEXT.craftTargetNone,
      options: [
        { slug: character.id, name: character.name },
        ...knownPeople.filter((p) => p.subjectId !== character.id).map((p) => ({ slug: p.subjectId, name: p.name })),
      ],
    },
    [FORGED_SEAL_SLUG]: {
      label: RING_TEXT.forgePickLabel,
      empty: RING_TEXT.forgeNoRing,
      options: character.tags
        .filter((ct) => isRing(ct.tag) && ct.tag.sealMark)
        .map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name })),
    },
  };
  // computeKnownRecipeIds is the shared, pure verdict (web/lib/tagRequests.js).
  const knownRecipeIds = computeKnownRecipeIds(tagCatalog, satisfied, character.tags, {
    visibilityBySlug,
    nonAllGroupSlugs,
  });

  // What the Add-tag and Craft menus may PRINT, as opposed to what the
  // server reasons with. A recipe gated on a hidden trade is stripped —
  // e.g. a "Recipe: Forger · 1 turn · 2 ⬢" line on a seal chip would give
  // away that seals get forged. The tag itself stays, name/description/price
  // intact. Same rule as web/lib/recipeCatalog.js. `customizable` crosses
  // RESOLVED, not as authored — the dialog reads it as "you may put your
  // name on this", decided against Tag.customizableSkillSlug.
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  const clientTagCatalog = tagCatalog.map((t) => {
    const skills = t.requirementSkills ?? [];
    const customizable = mayCustomize(t, heldSlugs);
    const hidden = skills.some(
      (skill) => skill.catalogVisibility !== "ALL" && !satisfied.has(skill.id),
    );
    const requirementSkills = hidden
      ? []
      : skills.map(({ id, name, slug }) => ({ id, name, slug }));
    return hidden
      ? {
          ...t,
          customizable,
          craftable: false,
          requirementSkills,
          requirementItems: null,
          requirementTurns: null,
          requirementResources: null,
          requirementPerTurn: null,
          requirementGambit: false,
        }
      : { ...t, customizable, requirementSkills };
  });
  const craftProjects = (
    await prisma.craftProject.findMany({
      where: { characterId: character.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        quantity: true,
        turnsNeeded: true,
        turnsDone: true,
        resourcesCost: true,
        consumed: true,
        payerName: true,
        lastTurnId: true,
        tag: { select: { id: true, name: true } },
      },
    })
  ).map((p) => ({
    id: p.id,
    tagId: p.tag.id,
    tagName: p.tag.name,
    quantity: p.quantity,
    turnsNeeded: p.turnsNeeded,
    turnsDone: p.turnsDone,
    resourcesCost: p.resourcesCost,
    spentIngredients: Array.isArray(p.consumed) && p.consumed.length > 0, // the give-up note names them
    payerName: p.payerName,
    workedThisTurn: Boolean(openTurn && p.lastTurnId === openTurn.id), // Continue greys until next turn
    // Worked off and never handed over (continueCraftImpl's `due`): Continue takes it now, Move or no Move.
    due: p.turnsDone >= p.turnsNeeded,
  }));
  // Crafts made on the press but staged for the turn push (CRAFTING.md §3a): not on the sheet yet, so the forecast says they're coming.
  const stagedCraftYields = (
    await prisma.stagedEffect.findMany({
      where: {
        targetCharacterId: character.id,
        appliedAt: null,
        payload: { path: ["craftYield"], equals: true },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, payload: true },
    })
  ).map((e) => ({ id: e.id, label: e.payload?.craftLabel ?? "Something you made" }));

  // The turn's craft ledger and each ration's free amount (CRAFTING.md §2a)
  // — the SERVER's arithmetic; craftRequest re-reads under a row lock regardless.
  const craftBudget = summarizeCraftBudget(currentAction);
  const craftAllowances = await craftFreeUnits(
    prisma,
    character.id,
    openTurn?.id ?? null,
    tagCatalog,
  );

  // Building (db/lib/structures.js). EVERY status comes down, including a
  // ruin. Projected rather than passed whole — Prisma carries Dates and a payer key no client surface needs.
  const sitesHere = (await structuresAt(prisma, character.locationId)).map(
    (s) => ({
      id: s.id,
      typeSlug: s.typeSlug,
      typeName: s.typeName,
      status: s.status,
      turnsDone: s.turnsDone,
      turnsNeeded: s.turnsNeeded,
      mine: s.builderCharacterId === character.id, // only the opener may call a site off; cancelBuildSite re-checks it
    }),
  );
  const buildable = canBuildHere(character.location).ok; // craftRequest judges the same ground again with the same function

  // Crucify: a Fundamentalist at a finished Cross — your tag, your ground. crucifyCharacterRequest re-checks both.
  const canCrucify =
    heldSlugs.has("fundamentalist") &&
    sitesHere.some((s) => s.typeSlug === "crucifix" && s.status === "COMPLETE");
  // Everything in your pockets that lights a verb (web/lib/itemPools.js) —
  // /chat reads the same helper, so an item's verb is lit on the same facts in
  // both places. Each is re-checked by its server action.
  const {
    canButcher,
    canDisguise,
    canPickpocket,
    canTorture,
    canMutilate,
    canBrand,
    canApplyCollar,
    canUnlockCollar,
    canDetonateCollar,
    canBreakRestraints,
    hasDatacard,
    hasDevice,
    hasPointerDevice,
    hasStepstone,
    stepstoneTargets,
  } = await itemPools(prisma, character, heldSlugs);
  // Shackle: anyone standing at finished Dungeons — your ground. shackleCharacterRequest re-checks it and that the target is Bound.
  const canShackle = sitesHere.some((s) => s.typeSlug === "dungeons" && s.status === "COMPLETE");
  // THE THANATI (THANATI.md). Whether you are one/lead is your own sheet's
  // facts. thanatiActions.js re-checks every one of these.
  const isThanati = heldSlugs.has(THANATI_SLUG);
  const isThanatiLeader = heldSlugs.has(THANATI_LEADER_SLUG);
  const isCerberon = heldSlugs.has(CERBERON_SLUG); // cerberonActions.js re-checks both
  // The Censor's ring is a warrant badge too (docs/systemdocs/RINGS.md).
  const canWarrant = WARRANT_BADGE_SLUGS.some((slug) => heldSlugsForRooms.has(slug));
  // THE BISHOP (docs/systemdocs/CHARACTERS.md). The office is a tag, the
  // same move Chaplain is — bishopActions.js re-checks it. The list and the
  // cap are only read for the Bishop: nobody else has a dialog to show them
  // in, and it is a query for every other sheet in the game otherwise.
  const isBishop = heldSlugs.has(BISHOP_SLUG);
  const excommunications = isBishop ? await listExcommunications(prisma, character.id) : [];
  const excommunicationSeats = isBishop ? excommunicationCap(heldSlugs) : 0;
  const hideout = isThanati ? await hideoutRoom(prisma) : null;
  const atHideout = Boolean(hideout && hideout.locationId === character.locationId);
  // Set Hideout's picker: rooms at this Location the leader can get into.
  const hideoutRooms = isThanatiLeader
    ? accessibleRooms(roomsHere, heldSlugsForRooms, guestRoomIds, questRoomIds).map((r) => ({
        id: r.id,
        name: r.name,
        current: r.id === hideout?.id,
      }))
    : [];
  // Purchase Gear's shelf and the four purses it draws on — an obol is one ⬢ (DEPOT.md), the shelf spends both together.
  const [thanatiWares, hideoutObols, myObols, hideoutResources] = atHideout
    ? await Promise.all([
        prisma.tag
          .findMany({
            where: { slug: { in: THANATI_WARES.map((w) => w.slug) } },
            select: { id: true, slug: true, name: true },
          })
          .then((tags) =>
            THANATI_WARES.map((w) => {
              const tag = tags.find((t) => t.slug === w.slug);
              return tag ? { tagId: tag.id, name: tag.name, price: w.price } : null;
            }).filter(Boolean),
          ),
        prisma.roomTag.findFirst({
          where: { roomId: hideout.id, tag: { slug: OBOL_SLUG } },
          select: { quantity: true },
        }),
        prisma.characterTag.findFirst({
          where: { characterId: character.id, tag: { slug: OBOL_SLUG } },
          select: { quantity: true },
        }),
        // The hideout's ⬢, read here rather than off the room row — a ⬢
        // balance is a stack row now, and hideoutRoom() doesn't load tags.
        readRoomResources(prisma, hideout.id),
      ])
    : [[], null, null, 0];
  const hideoutStock = atHideout
    ? {
        room: { resources: hideoutResources, obols: hideoutObols?.quantity ?? 0 },
        self: { resources: resourcesOf(character), obols: myObols?.quantity ?? 0 },
      }
    : null;
  // Paperwork, seals, books and the Bird (PAPERWORK.md) — every gate and
  // option list is built in web/lib/selfPools.js, since Chat's composer
  // opens the same four dialogs. Spread into CharacterSheet below: hasBird,
  // canRead, canWrite, hasSeal, canSeal, paperOptions, letterOptions,
  // sealOptions, birdSentToday, birdTargets, birdZones.
  const letters = await loadLettersView(character, { openTurn });

  // The sheet goes to a client component, so the raw text of every paper
  // would otherwise sit readable in DevTools by a holder who is blind,
  // drunk or illiterate — strip it here. Holding a letter is not the same
  // as being able to read it, the entire point of an illiterate courier.
  const viewer = {
    tags: character.tags,
    daylight: isDaylight(),
    indoors: character.location?.indoors ?? true,
  };
  // Poison state (medical pass, M4): CharacterTag.poisonedCount/
  // poisonPayload are secret, and this loader's bare `include` has no
  // per-field select, so Prisma hands both back on every row regardless.
  // They must NEVER reach the client raw — stripped here rather than
  // trusting every future reader of `sheetCharacter`. `poisonMarker`
  // crosses instead: a plain yes/no, only "yes" for a poison-sense/-snooper
  // holder (canDetectPoison), computed ONCE for the viewer's OWN sheet.
  const canSmellPoison = canDetectPoison(character.tags);

  // The 0-100 hunger meter (db/lib/hunger.js): same posture as poisonedCount
  // above — hungerValue must NEVER reach the client raw (the doc's own rule:
  // no number, ever), so it is read here, turned into the descriptor's word,
  // and dropped from `sheetCharacter` below rather than trusted to every
  // future reader. Nothing forecasts next turn's hunger any more (the doc).
  const hunger = hungerOf(character);

  // The mood dial rides along as a number (MOOD.md) — the sheet needs it for
  // the Mood box's word and the Gambit tile's modifier, both computed client-side.
  //
  // COOKING (COOKING.md): held tags come down with a bare `include`, so
  // `cooked` is cut to its taste and `cookedFrom` dropped HERE — a cook is
  // told what an ingredient tastes of and nothing else, or it's one dev-tools inspection away.
  const { hungerValue: _hungerValue, starvingSinceTurn: _starvingSinceTurn, ...characterWithoutHunger } = character;
  const sheetCharacter = {
    ...characterWithoutHunger,
    tags: character.tags.map((ct) => {
      const { poisonedCount, poisonPayload, ...ctRest } = ct;
      // Cooking's cut runs first: `cooked` narrowed to its taste,
      // `cookedFrom` dropped. Appraisal's readout (web/lib/appraisal.js)
      // strips sellablePrice, replacing it with valueObols for an appraiser.
      const tagRow = appraise(cookedTasteOnly(ctRest.tag), canAppraise);
      // Crate-manifest leak (fix round M4b, fix 1): `ct.tag.crateContents`
      // carries the SAME two secret columns per line item, for a crate a
      // player packed themselves — the outer strip above only touches the
      // CharacterTag row, never the nested Tag one. Stripped whole, not just
      // its poisoned half — the rest of the manifest is server-only bookkeeping too.
      const { crateContents, ...ctTagRest } = tagRow ?? {};
      const stripped = {
        ...ctRest,
        // WHETHER this is a crate has to survive the strip — Consume and
        // Package both ask on the client.
        tag: ctRest.tag ? { ...ctTagRest, crate: Boolean(crateContents) } : ctRest.tag,
        poisonMarker: canSmellPoison && (poisonedCount ?? 0) > 0,
      };
      if (!isPaper(ct.tag)) return stripped;
      const { paperText, ...tag } = stripped.tag;
      return {
        ...stripped,
        tag: { ...tag, description: paperDescription(ct.tag, viewer), paper: paperView(ct.tag, viewer) },
      };
    }),
  };
  // Who can pay: you, anyone here, or a room stash here (same as Craft).
  const healParties = { characters: peopleParties, rooms };

  // Lessons (LESSONS.md). Nobody's skills are read off their sheet for this:
  // `teachers` is everyone here, each offered what *I* could learn, and
  // `learners` is everyone here, each offered what *I* know. Whether the pair
  // actually works is found out by asking (db/lib/lessons.js#acceptLesson).
  // No threshold either — it named the teacher's Teaching and Drill Instructor.
  // `pendingOffers`: the handshakes I'm part of this turn.
  const lessonCatalog = await prisma.tag.findMany({
    select: LESSON_CATALOG_SELECT,
  });
  const meForLessons = {
    id: character.id,
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  // Both halves, keyed. A lesson is a thing two people do standing next to each
  // other, and there is nothing about a mask that stops somebody being shown how
  // to sharpen a blade — the offer handshake means they consent either way, and
  // db/lib/lessons.js never reads the far sheet (LESSONS.md §4).
  //
  // pickerName, not c.name — a forced name is what an offer addresses, and a
  // hood is addressed by its alias (web/lib/peopleHere.js).
  const hereForLessons = hereAll.map((c) => ({ id: pickerKey(c), name: pickerName(c) }));
  const skillChip = (t) => ({ id: t.id, name: t.name });
  const learnable = learnableSkills(meForLessons, lessonCatalog).map(skillChip);
  const myTeachable = knownTeachableSkills(meForLessons, lessonCatalog).map(skillChip);
  const teachers = learnable.length ? hereForLessons.map((c) => ({ ...c, skills: learnable })) : [];
  const learners = myTeachable.length ? hereForLessons.map((c) => ({ ...c, skills: myTeachable })) : [];
  // Teaching is free for a tag holder and a whole Routine for everybody else.
  const teachCostsMove = !teachesFree(meForLessons);
  // Confession (CONFESSION.md). Only the penitent gets a menu — no list is
  // built for a chaplain, which would show everybody's addictions unasked.
  // A hooded chaplain still hears a confession — a confessional is a box built
  // so neither side sees the other, so a hood is if anything the point.
  const confessors = hereAll
    .filter((c) => c.tags.some((ct) => ct.tag.slug === "chaplain"))
    .map((c) => ({ id: pickerKey(c), name: pickerName(c) }));
  // Guilt Ridden can't bring themself to confess at all — mirrors db/lib/confession.js#confessableTags so the button hides, not fails.
  const mySins = heldSlugs.has(GUILT_RIDDEN_SLUG)
    ? []
    : (
        await prisma.characterTag.findMany({
          where: { characterId: character.id, tag: { psychological: true } },
          select: { tag: { select: { id: true, name: true } } },
        })
      )
        .map((ct) => ct.tag)
        .sort((a, b) => a.name.localeCompare(b.name));

  const openOffers = openTurn
    ? await prisma.offer.findMany({
        where: {
          turnId: openTurn.id,
          status: "PENDING",
          OR: [{ initiatorId: character.id }, { responderId: character.id }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          initiatorId: true,
          responderId: true,
          tag: { select: { name: true } },
        },
      })
    : [];

  // Presented faces for the SEARCH offers below — one query, and only when
  // there are any, since every other kind reads off the two rosters already
  // loaded above.
  const searchFaces = new Map();
  const searchOtherIds = openOffers
    .filter((o) => o.kind === "SEARCH")
    .map((o) => (o.initiatorId === character.id ? o.responderId : o.initiatorId));
  if (searchOtherIds.length > 0) {
    const faces = await prisma.character.findMany({
      where: { id: { in: [...new Set(searchOtherIds)] } },
      select: IDENTITY_SELECT,
    });
    // As this character would name them: a stranger is "a young man" (STRANGERS.md).
    const names = await seenByMany(prisma, character.id, faces);
    faces.forEach((row, i) => searchFaces.set(row.id, capitalizeFirst(names[i])));
  }

  const pendingOffers = openTurn
    ? openOffers.map((o) => {
        const otherId =
          o.initiatorId === character.id ? o.responderId : o.initiatorId;
        const other = [...here, ...zoneRoster].find((c) => c.id === otherId);
        return {
          id: o.id,
          kind: o.kind,
          mine: o.initiatorId === character.id,
          // SEARCH is the one kind either end of which may be hooded, and
          // neither list above is safe for it: `here` drops concealed rows
          // entirely, and rosterName() honours a forced name but NOT a hood, so
          // zoneRoster would print the real one. Showing it here would put the
          // hood's own secret in the other player's to-do list — the unmasking
          // INTERCEPT.md §2 exists to stop. Resolved presented below instead.
          // CONVERSION resolves to null, and that is a rule about the PAYLOAD,
          // not about the string. Nobody is ever named on either side of a
          // conversion (docs/systemdocs/THANATI.md), and letting the roster
          // lookup answer here would ship the cultist's name to the browser
          // even though SheetTurn.js never prints it.
          otherName:
            o.kind === "CONVERSION"
              ? null
              : o.kind === "SEARCH"
                ? (searchFaces.get(otherId) ?? "somebody")
                : (other?.name ?? "someone"),
          // A chaplain waiting on a confession is never told what it's about; the penitent sees their own.
          tagName:
            o.kind === "CONFESSION" && o.responderId === character.id
              ? null
              : (o.tag?.name ?? null),
        };
      })
    : [];

  // A forced identity (Tag.forcedName — Apex Form's "Beast") shows the player what the room sees, not their own face.
  const forcedTag = character.tags.find((ct) => ct.tag.forcedName)?.tag ?? null;
  const forcedIdentity = forcedTag
    ? { name: forcedTag.forcedName, tagName: forcedTag.name }
    : null;
  // What's over their face decides whether the conceal switch is usable (PROXYING.md §5). Only `forced` is read now.
  const concealment = concealmentFrom(character.tags);
  const concealGear = concealment ? { forced: concealment.forced } : null;
  // The face the room sees is the face the sheet shows — one resolver decides it for every surface.
  const avatarSrc = presentedIdentity(character, {
    forcedName: forcedIdentity?.name ?? null,
    concealment,
  }).avatarPath;

  // The Move cutoff for the band's "This turn" box. `shut` rides beside it because the window alone cannot say the game is
  // closed — out of session `locked` is false, since freezing removes the deadline (db/lib/turnGate.js).
  const openTurnWithWindow = openTurn
    ? {
        ...openTurn,
        moveWindow: {
          ...moveWindow(openTurn, { clockFrozen: frozen.frozen }),
          shut: !frozen.inSession,
          shutReason: frozen.inSession ? null : "The game isn't in session.",
        },
      }
    : openTurn;

  // A Gambit's die is rolled at submit but revealed only in the turn-end DM; stripped here.
  const sheetAction = currentAction
    ? { ...currentAction, diceRoll: null, diceModifier: null }
    : currentAction;

  return fresh({
    kind: "sheet",
    sheet: {
      character: sheetCharacter,
      hunger: hunger,
      mode: "self",
      openTurn: openTurnWithWindow,
      currentAction: sheetAction,
      // Same server action Chat's YOU column reads (play/actions.js#myMove).
      moveState: mine.ok
        ? { turn: mine.turn, move: mine.move, characterId: mine.characterId }
        : { turn: null, move: null, characterId: null },
      avatarSrc: avatarSrc,
      forcedIdentity: forcedIdentity,
      concealGear: concealGear,
      transferParties: transferPartyList,
      carry: carry,
      zoneMoves: zoneMoves,
      zoneMovesReason: zoneMovesReason,
      zoneMovesBreakdown: zoneMovesBreakdown,
      examineBlocked: examineBlocked,
      hasWorkshop: hasWorkshop,
      atKitchen: atKitchen,
      eatMax: eatMax,
      tagCatalog: clientTagCatalog,
      desireSlots: desireSlots,
      desireSlotLockTurns: desireSlotLockTurns,
      desireAddiction: desireAddiction,
      desireSlotStates: desireSlotStates,
      desireCatalog: desireCatalog,
      desireFamilies: desireFamilyList,
      desireFamilyGroups: desireFamilyGroupList,
      desireLockNotes: desireLockNotes,
      canHeal: canHeal,
      healsLeft: healsLeft,
      hasSurgicalSite: hasSurgicalSite,
      surgicalSitePenalty: surgicalSitePenalty,
      canMiracle: canMiracle,
      miracleTargets: miracleTargets,
      miraclesLeft: miraclesLeft,
      hasMoved: Boolean(currentAction),
      teachCostsMove: teachCostsMove,
      knownRecipeIds: knownRecipeIds,
      deathMaskCorpses: deathMaskCorpses,
      recipePicks: recipePicks,
      craftProjects: craftProjects,
      stagedCraftYields: stagedCraftYields,
      // With no open turn a craft lands at once (craftYieldStaged in actions/crafting.js), so the dialog must not promise the push.
      craftYieldStaged: gameConfig?.craftYieldTiming === "STAGED" && Boolean(openTurn),
      craftBudget: craftBudget,
      craftAllowances: craftAllowances,
      sitesHere: sitesHere,
      buildable: buildable,
      locationSlug: character.location?.slug ?? null,
      teachers: teachers,
      learners: learners,
      confessors: confessors,
      mySins: mySins,
      pendingOffers: pendingOffers,
      ...letters,
      avatarUploadsEnabled: gameConfig?.avatarUploadsEnabled ?? false,
      playPanelEnabled: gameConfig?.playPanelEnabled ?? true,
      portraitMakerEnabled: true,
      portraitFantasyPartsEnabled: false,
      // Re-validated here: a stored index can outlive a catalog change.
      portraitSelection: parseSelection(character.portrait, {
      allowFantasy: false,
      }),
      hasCustomAvatar: Boolean(character.avatarMimeType),
      healTargets: healTargets,
      healParties: healParties,
      corpses: corpses,
      canButcher: canButcher,
      identity: identity,
      canSeeExtract: canSeeExtract,
      canExtract: canExtract,
      extractBlocked: extractBlocked,
      canSeeRefine: canSeeRefine,
      canRefine: canRefine,
      refineBlocked: refineBlocked,
      canSeeMine: canSeeMine,
      canMine: canMine,
      mineBlocked: mineBlocked,
      workVerb: workVerb,
      canSeeFarm: canSeeFarm,
      canFarm: canFarm,
      farmBlocked: farmBlocked,
      dayLongTurn: isDayLongTurn(openTurn),
      canSeeBreakIn: canSeeBreakIn,
      canBreakIn: canBreakIn,
      breakInBlocked: breakInBlocked,
      canSeePackage: canSeePackage,
      lootTargets: lootTargets,
      consumeTargets: consumeTargets,
      bindTargets: bindTargets,
      canCrucify: canCrucify,
      canShackle: canShackle,
      canDisguise: canDisguise,
      canPickpocket: canPickpocket,
      canTorture: canTorture,
      canMutilate: canMutilate,
      canBrand: canBrand,
      canApplyCollar: canApplyCollar,
      canUnlockCollar: canUnlockCollar,
      canDetonateCollar: canDetonateCollar,
      canBreakRestraints: canBreakRestraints,
      isThanati: isThanati,
      isThanatiLeader: isThanatiLeader,
      isCerberon: isCerberon,
      canWarrant: canWarrant,
      isBishop: isBishop,
      excommunications: excommunications,
      excommunicationSeats: excommunicationSeats,
      atHideout: atHideout,
      hideoutRooms: hideoutRooms,
      hideoutStock: hideoutStock,
      thanatiWares: thanatiWares,
      hasDatacard: hasDatacard,
      hasPointerDevice: hasPointerDevice,
      hasStepstone: hasStepstone,
      stepstoneTargets: stepstoneTargets,
      hasDevice: hasDevice,
      nukeArmedTurn: nukeState?.nukeArmedTurn ?? null,
      deployVersion: deployVersion(),
      harmTargets: harmTargets,
      harmTags: harmTags,
      doseTargets: doseTargets,
      lastNameLocked: isDynastyMember(character.role?.slug),
      kissTargets: kissTargets,
      searchParties: searchParties,
      kissBlocked: kissBlocked,
      pickpocketBlocked: pickpocketBlocked,
      storeTags: storeTags,
      storeHeldTags: storeHeldTags,
      storeRoleSlug: character.role?.slug ?? null,
      vampireBlood: vampireBlood,
    },
  });
}
