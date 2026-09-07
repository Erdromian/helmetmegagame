import { redirect } from "next/navigation";
import { loadPeoplePools, loadStashRooms } from "@/lib/peoplePools";
import {
  LESSON_CATALOG_SELECT,
  teachableSkills,
  isTeacher,
} from "@lifeweb/db/lib/lessons";
import {
  prisma,
  roleCapacity,
  isDynastyMember,
  presentedIdentity,
  startingTagNames,
  normalizeAntagonistSlugs,
} from "@lifeweb/db";
import {
  accessibleRooms,
  guestRoomIds as roomGuestIds,
} from "@lifeweb/db/lib/roomAccess";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import {
  BUTCHER_SLUG,
  WORKSHOP_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  GUILT_RIDDEN_SLUG,
} from "@lifeweb/db/lib/constants";
import {
  hasAttribute,
  GODFLESH_ATTRIBUTE,
} from "@lifeweb/db/lib/locationAttributes";
import { extractToolFor } from "@lifeweb/db/lib/godflesh";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { isPaper, paperDescription } from "@lifeweb/db/lib/paper";
import { canDetectPoison } from "@lifeweb/db/lib/poison";
import {
  freeMovesLeft,
  freeZoneMovesReason,
} from "@lifeweb/db/lib/locationTravel";
import { takenCounts } from "@lifeweb/db/lib/roleReservation";
import { groupRoles } from "@lifeweb/db/lib/roleGroups";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen, readGameState, effectivePlayerCount } from "@lifeweb/db/lib/gameState";
import { deployVersion } from "@/lib/deployVersion";
import { auth } from "@/lib/auth";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import { loadDesireView, loadLettersView } from "@/lib/selfPools";
import { craftFreeUnits } from "@/lib/requests";
import { summarizeCraftBudget } from "@/lib/craftBudget";
import {
  getGuildMember,
  isApprovedPlayer,
  isCursed,
  isGm,
  isPlaytester,
  isLeaderWhitelisted,
} from "@/lib/discordGuild";
import {
  isSpawnOnly,
  isRoleSelectable,
  DEFAULT_MAX_DRAWBACK_TAGS,
  DEFAULT_MAX_DRAWBACK_POINTS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { findOpenTurnAction } from "@/lib/moveEconomy";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { computeKnownRecipeIds } from "@/lib/tagRequests";
import { canBuildHere, structuresAt } from "@lifeweb/db/lib/structures";
import { parseSelection } from "@/lib/portrait/catalog";
import CharacterSheet from "../../components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";
import Lobby from "./lobby/Lobby";

// Everything the creation wizard needs, shaped as the Zone -> Faction -> Role
// tree it renders. Seat counts are computed here, not the client, so the
// numbers aren't stale-rendered from a cached page.
async function loadCreationData(discordUserId) {
  const [zones, tags, config, state, member, dynastyName, preference] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      include: {
        factions: {
          orderBy: { sortOrder: "asc" },
          include: {
            roles: {
              orderBy: { sortOrder: "asc" },
              include: { startingLocation: { include: { zone: true } } },
            },
          },
        },
      },
    }),
    loadPointBuyCatalog([], { includeRoleStartingTags: true }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    // At most a minute old: a role handed out in Discord shows up on the next
    // reload, and the lobby refreshes itself every 30 s anyway.
    getGuildMember(discordUserId, 60_000),
    dynastyLastName(),
    prisma.playerPreference.findUnique({ where: { discordUserId }, select: { antagonistOptIns: true } }),
  ]);

  // Seated (ALIVE, plus DEAD on a seat that never reopens) plus anyone
  // else's live wizard-in-progress hold; excludes the viewer's own hold.
  const roleRows = zones.flatMap((zone) =>
    zone.factions.flatMap((faction) => faction.roles),
  );
  const takenByRole = await takenCounts(prisma, roleRows, discordUserId);

  const cursed = isCursed(member);
  // Presentation only; the server action re-checks regardless. Creation is
  // open while the game runs (Ended locks only the clock — LOBBY.md §1), and
  // to a GM during the lobby, which is the Skip button.
  const superadmin = isSuperadmin(discordUserId);
  const phase = state?.phase ?? "CLOSED";
  // A GM or a playtester may skip the lobby in any phase, and a playtester is
  // on the roster without the Player role (db/lib/roleIds.js).
  const skipper = isGm(member) || isPlaytester(member);
  const gate = {
    phase,
    open: superadmin || phase === "RUNNING" || phase === "ENDED" || skipper,
    approved: superadmin || isApprovedPlayer(member) || isPlaytester(member),
    superadmin,
    gm: skipper,
  };
  // `=== false`, not falsy: no config row means the gate stays enforced.
  const leaderWhitelisted =
    superadmin ||
    config?.leaderWhitelistEnabled === false ||
    isLeaderWhitelisted(member);
  const playerCount = effectivePlayerCount(config, state);

  return {
    gate,
    cursed,
    dynastyName,
    whitelisted: leaderWhitelisted,
    initialAntagonists: normalizeAntagonistSlugs(preference?.antagonistOptIns ?? [], {
      whitelisted: leaderWhitelisted,
    }),
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    maxDrawbackTags: config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS,
    maxDrawbackPoints: config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS,
    tags,
    // Seven social buckets, not five zones — db/lib/roleGroups.js says which
    // faction lands where (and which single role overrides its faction), and
    // the zone a role starts in is printed on its own card instead of being a
    // heading over it.
    groups: groupRoles(
      zones.flatMap((zone) =>
        zone.factions.map((f) => ({ ...f, zoneName: zone.name })),
      ),
    )
      .map((group) => ({
        slug: group.slug,
        name: group.name,
        // Spawn-only seats are withheld outright, not greyed — see
        // characterCreation.js#isSpawnOnly.
        roles: group.roles.filter((role) => !isSpawnOnly(role)).map((role) => {
          const { faction } = role;
          const cap = roleCapacity(role, playerCount);
          return {
            id: role.id,
            name: role.name,
            intro: role.intro,
            slug: role.slug,
            // Null for ordinary seats; set on the four dynasty roles.
            lockedGender: role.lockedGender,
            difficulty: role.difficulty,
            // Printed on the card itself, now that the faction is no longer
            // a heading over it.
            factionName: faction.name,
            startingLocationName: role.startingLocation?.name ?? null,
            startingZoneName: role.startingLocation?.zone?.name ?? null,
            startingResources: role.startingResources,
            extraStartingPoints: role.extraStartingPoints,
            // Parsed, because the wizard matches these against catalog tag names
            // and an entry may carry a count ("Obol x5").
            startingTagNames: startingTagNames(role.startingTagSlugs),
            grantsLeader: role.grantsLeader,
            // Drives the "Whitelist only" hover on a greyed card. Separate
            // from grantsLeader, which now only means faction Leader.
            requiresWhitelist: role.requiresWhitelist,
            whitelistBlocked: role.requiresWhitelist && !leaderWhitelisted,
            // Infinity doesn't serialize; uncapped roles cross as null -> "∞".
            cap: cap === Infinity ? null : cap,
            taken: takenByRole.get(role.id) ?? 0,
            selectable: isRoleSelectable({ role, cursed, leaderWhitelisted }),
            // Resolved server-side so a client component never drags
            // PrismaClient into the browser bundle.
            lastNameLocked: isDynastyMember(role.slug),
          };
        }),
      }))
      .filter((g) => g.roles.length > 0),
  };
}

export default async function CharacterPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      faction: true,
      zone: true,
      // The Location's own zone kind rides along so canBuildHere() can judge
      // this ground without a second round-trip (db/lib/structures.js) — the
      // character's own `zone` above is their presence zone, not the
      // Location's, and building is a fact about the ground.
      location: { include: { zone: { select: { kind: true } } } },
      // Where they are WALKING, if a paid crossing is still on the road
      // (MAP.md §3). Name only — the sheet just says so in a line.
      travelTo: { select: { name: true } },
      role: { select: { slug: true } },
      // requirementSkills must be named explicitly: `include` doesn't pull
      // unnamed relations, and formatTagRequirement's `?.length` guard would
      // silently drop it rather than fail.
      tags: {
        include: {
          tag: {
            include: {
              group: true,
              requirementSkills: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // No living character — this is the lobby, the wizard, or a closed door,
  // depending on the phase (docs/systemdocs/LOBBY.md §1).
  if (!character) {
    const { gate, ...creation } = await loadCreationData(session.discordUserId);
    const { create } = (await searchParams) ?? {};
    const skipping = create === "1" && (gate.gm || gate.superadmin);
    if (gate.phase === "LOBBY" && !skipping) {
      if (!gate.approved) return <CreationClosed open />;
      const [preference, entry, readyCount] = await Promise.all([
        prisma.playerPreference.findUnique({ where: { discordUserId: session.discordUserId } }),
        prisma.lobbyEntry.findUnique({ where: { discordUserId: session.discordUserId } }),
        prisma.lobbyEntry.count({ where: { status: "READY" } }),
      ]);
      // Six fields per role, not the wizard's whole card — the lobby shows
      // names, factions and pitches; never tags, seat counts, or where a seat
      // starts (Bascinet's call: a starting area is not lobby information).
      const lobbyGroups = creation.groups.map((g) => ({
        slug: g.slug,
        name: g.name,
        roles: g.roles.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          intro: r.intro,
          factionName: r.factionName,
          grantsLeader: r.grantsLeader,
          whitelistBlocked: r.whitelistBlocked,
        })),
      }));
      return (
        <Lobby
          groups={lobbyGroups}
          initial={{
            rolePriorities: preference?.rolePriorities ?? {},
            antagonistOptIns: creation.initialAntagonists,
            joblessRole: preference?.joblessRole ?? "COMMONER",
          }}
          entry={entry?.status === "READY" ? { readyAt: entry.readyAt.toISOString() } : null}
          readyCount={readyCount}
          whitelisted={creation.whitelisted}
          canSkip={gate.gm || gate.superadmin}
        />
      );
    }
    if (!gate.open || !gate.approved) return <CreationClosed open={gate.open} />;
    // A seat from the roll, still inside its window: the wizard opens on the
    // Tags step with the role fixed. createCharacter enforces the same lock.
    const assigned = await prisma.lobbyEntry.findFirst({
      where: { discordUserId: session.discordUserId, status: "ASSIGNED", expiresAt: { gt: new Date() } },
      select: { assignedRoleId: true, expiresAt: true },
    });
    const lockedRole =
      assigned?.assignedRoleId &&
      creation.groups.some((g) => g.roles.some((r) => r.id === assigned.assignedRoleId))
        ? { id: assigned.assignedRoleId, expiresAt: assigned.expiresAt.toISOString() }
        : null;
    return <CreateCharacterWizard {...creation} lockedRole={lockedRole} />;
  }

  const [
    openTurn,
    tagCatalog,
    tierRows,
    gameConfig,
    { action: currentAction },
    frozen,
    // The bomb's clock, for the Nuclear Device chip (TagChip.js). World
    // state, so every sheet shows it, not just the holder's.
    nukeState,
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
        // slug so needsWorkshop() can exempt workshop-equipment itself
        // (web/lib/tagRequests.js) — you build your first forge in the open.
        slug: true,
        description: true,
        category: true,
        pointCost: true,
        purchasable: true,
        // addableTags' purchasable branch requires this or it reads
        // undefined and drops purchasable-only tags from the Add Tag menu.
        purchasableAfterStart: true,
        craftable: true,
        // A SECRET recipe's own discovery gate (M3 review, last-breath):
        // `isNonPublicRecipe` below reads this so a secret recipe is
        // withheld on the tag's OWN say-so, not only by accident of
        // whatever its ingredient's catalog happens to be today.
        catalogVisibility: true,
        // The custom-item opt-in (CRAFTING.md): the Craft dialog shows its
        // name/description fields only when this crosses.
        customizable: true,
        // A craftable carrying `placement` is raised on the ground instead
        // of landing in a pocket (db/lib/structures.js). The whole JSON
        // crosses rather than a boolean: the menu needs `unique` too, and
        // the column is three or four small keys.
        placement: true,
        stackable: true,
        // TagChip's Weight row in the Add-tag / Craft menus — both halves,
        // since untradeable is what makes a thing weightless
        // (web/lib/formatTagWeight.js).
        weightLbs: true,
        tradeable: true,
        parentTagId: true,
        requiredTagId: true,
        requiredTag: { select: { name: true } },
        group: {
          select: {
            name: true,
            color: true,
            requiredTagId: true,
            requiredTag: { select: { name: true } },
          },
        },
        // Craft enforces recipe skills (CRAFTING.md); `knownRecipeIds`
        // below is the server's verdict per recipe.
        requirementSkills: { select: { id: true, name: true, slug: true } },
        requirementTurns: true,
        requirementResources: true,
        requirementPerTurn: true,
        // The ingredients, so the Craft dialog can say what a recipe spends
        // and offer the picker an `anyOf` entry needs. Every surface that
        // renders a Recipe line has to select this or it silently renders none
        // (CORPSES.md §8).
        requirementItems: true,
        // So the Craft menu can say what a piece of armour is worth before
        // somebody spends two turns and 26 ⬢ finding out.
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
        equipSlots: true,
        avatarUploadsEnabled: true,
        portraitMakerEnabled: true,
        portraitFantasyPartsEnabled: true,
        desiresEnabled: true,
        desireSlots: true,
        desireSlotLockTurns: true,
        maxDrawbackTags: true,
        maxDrawbackPoints: true,
      },
    }),
    findOpenTurnAction(prisma, character.id),
    clockFrozen(prisma),
    readGameState(prisma, { nukeArmedTurn: true }),
  ]);

  // Desires: the slots, and the evaluated catalog behind the picker. Both
  // are built in web/lib/selfPools.js, which the Hall's YOU column reads too,
  // so the two surfaces cannot disagree about what is claimable.
  const {
    desireSlots,
    desireSlotLockTurns,
    slotStates: desireSlotStates,
    catalog: desireCatalog,
    families: desireFamilyList,
    familyGroups: desireFamilyGroupList,
    lockNotes: desireLockNotes,
    addiction: desireAddiction,
    desiresEnabled,
  } = await loadDesireView(character, { openTurn, gameConfig });

  // Held ids widen the store catalog so unpurchasable held tags (a
  // GM-granted item) still reach the client's byId map.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const storeTags = await loadPointBuyCatalog(heldIds);
  const heldSet = new Set(heldIds);
  const storeHeldTags = storeTags
    .filter((t) => heldSet.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  // Every people pool the sheet's dialogs act on — the roster standing here,
  // the medical gate, and the Loot / Move / Bind / Harm lists — built once in
  // web/lib/peoplePools.js so the Hall's people column (/play) and this sheet
  // cannot disagree about who is standing near you.
  const {
    here,
    zoneRoster,
    peopleParties,
    examineBlocked,
    satisfied,
    canHeal,
    healTargets,
    healsLeft,
    hasSurgicalSite,
    lootTargets,
    moveTargets,
    moveLocations,
    bindTargets,
    harmTargets,
    harmTags,
    doseTargets,
  } = await loadPeoplePools(character, {
    discordUserId: session.discordUserId,
    openTurn,
  });

  // Plus every Room stash at this Location the character can get into
  // (CARRY.md) — with its contents, since pulling out of one means seeing
  // what's there. A room you can't enter isn't listed: it's a locked door.
  const heldSlugsForRooms = new Set(character.tags.map((ct) => ct.tag.slug));
  // Rooms somebody let this character into by hand — the other half of the
  // door, and the reason this page and the Transfer gate agree (CARRY.md).
  const guestRoomIds = await roomGuestIds(prisma, character.id);
  const roomsHere = character.locationId
    ? await prisma.room.findMany({
        where: { locationId: character.locationId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          accessTagSlugs: true,
          resources: true,
          tags: {
            where: { quantity: { gt: 0 } },
            select: {
              tagId: true,
              quantity: true,
              // weightLbs/category ride along so the Transfer dialog can
              // project what pulling a stash out would do to your load.
              tag: {
                select: {
                  name: true,
                  stackable: true,
                  weightLbs: true,
                  category: true,
                },
              },
            },
          },
        },
      })
    : [];
  // The Transfer dialog's far side, from the shared helper rather than a
  // second copy of the same map — /play builds the identical list off it, and
  // two answers to "which doors are open to you" is exactly what
  // web/lib/peoplePools.js exists to stop. `roomsHere` above is still this
  // page's own, because corpsesInReach below needs the ROWS and not the shape.
  const rooms = await loadStashRooms(character);
  // Every body in reach, for Butcher and Bury (docs/systemdocs/CORPSES.md).
  // Handed the ALREADY-FILTERED room list so it costs no second round-trip and
  // — more importantly — so the menu is built from exactly the rooms the
  // server-side re-check will use. A locked door is not a scouting target.
  const corpses = await corpsesInReach(prisma, character, {
    rooms: accessibleRooms(roomsHere, heldSlugsForRooms, guestRoomIds),
  });
  // A fact about your own sheet, so the button may grey on it. Resolved here
  // rather than in the client so no slug matching reaches the browser.
  const canButcher = character.tags.some((ct) => ct.tag.slug === BUTCHER_SLUG);
  // A fact about your own sheet, so the Change name button may grey on it.
  // changeNameRequestImpl re-checks it under the same predicate.
  const hasMulligan = character.tags.some((ct) => ct.tag.slug === "mulligan-potion");

  // From is you or a room; To is anyone here or a room (TransferDialog.js).
  const transferParties = { characters: peopleParties, rooms };
  // Your faction's silo, if it has one and you are standing in its zone: a
  // deposit-only destination pinned above the rooms here (FACTIONS.md). The
  // `here` flag says whether it is already in `rooms` above, so the dialog
  // doesn't list the same room twice; `canOpen` is what decides whether the
  // dialog warns that this is a one-way trip.
  const siloFaction = character.factionId
    ? await prisma.faction.findFirst({
        where: { id: character.factionId, siloRoomId: { not: null } },
        select: {
          siloRoom: {
            select: {
              id: true,
              name: true,
              kind: true,
              accessTagSlugs: true,
              locationId: true,
              location: { select: { name: true, zoneId: true } },
            },
          },
        },
      })
    : null;
  const siloRoom = siloFaction?.siloRoom ?? null;
  const transferSilo =
    siloRoom &&
    character.zoneId &&
    siloRoom.location.zoneId === character.zoneId
      ? {
          id: siloRoom.id,
          name: siloRoom.name,
          locationName: siloRoom.location.name,
          here: siloRoom.locationId === character.locationId,
          canOpen:
            accessibleRooms(
              [
                {
                  id: siloRoom.id,
                  kind: siloRoom.kind,
                  accessTagSlugs: siloRoom.accessTagSlugs,
                },
              ],
              heldSlugsForRooms,
              guestRoomIds,
            ).length === 1,
        }
      : null;
  // Is a forge within reach? Resolved server-side so the Craft dialog can say
  // so before a player commits, and re-checked by craftRequest either way.
  const hasWorkshop = await hasEquipmentInReach(
    prisma,
    character,
    WORKSHOP_EQUIPMENT_SLUG,
  );
  // The Godard Factory's two buttons (docs/systemdocs/FACTORY.md). Both HIDE
  // where the place is wrong rather than greying — a fact about where this
  // character is standing, which is theirs already, so nothing about the room
  // leaks the way the metagaming rule in actionRegistry.js guards against.
  const canSeeExtract = hasAttribute(character.location, GODFLESH_ATTRIBUTE);
  const extractTool = canSeeExtract ? extractToolFor(character.tags) : null;
  const canExtract = Boolean(extractTool);
  const extractBlocked =
    canSeeExtract && !canExtract
      ? "You need a hatchet, a battle-axe or a chainsaw in your hands. ‡"
      : null;
  const canSeePackage = await hasEquipmentInReach(
    prisma,
    character,
    PACKAGING_EQUIPMENT_SLUG,
  );
  const carry = carryStatus(character, gameConfig);
  // Free zone crossings left this turn (CARRY.md §2). Resolved server-side so
  // no allowance math reaches the client bundle.
  const zoneMoves = freeMovesLeft(character, gameConfig, openTurn);
  const zoneMovesReason = freeZoneMovesReason(character);
  // Craft (CRAFTING.md): the recipes whose every skill this character holds
  // (or a higher tier of), decided here and re-checked by craftRequest. The
  // client filters its picker to these ids and nothing else.
  //
  // Ingredient hiding started as menu hygiene and is now also half of the
  // secrecy story: the Recipes tab drops a recipe naming an ingredient the
  // reader was not sent (web/lib/recipeCatalog.js), and hidden-recipe tag
  // descriptions no longer name their ingredients. Here it keeps a recipe you
  // have no path to yet out of the picker, so a fresh crafter isn't offered
  // Miasma before they've ever seen a corpse. An ingredient tag's own
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
  // A group entry (miasma/bone-mask's corpse) is non-public the moment ANY
  // tag currently wearing that group is non-ALL — which for `items-corpse`
  // is every row: the authored monster corpses are `catalog: secret`, and a
  // corpse minted at death (db/lib/corpseMint.js) is never in docs/tags.yaml
  // at all, so it carries the schema default (`GM`).
  const nonAllGroupSlugs = new Set(
    ingredientVisibilityRows
      .filter((r) => r.group && r.catalogVisibility !== "ALL")
      .map((r) => r.group.slug),
  );
  // The Death Mask's corpse picker (CraftDialog via RequestActionsProvider):
  // which held corpses still have their face. Server-computed here so the
  // list and its face-taken filter can never drift from the craft's own
  // verdict (requestActions.js#resolveDeathMaskSource).
  const deathMaskCorpses = character.tags
    .filter(
      (ct) =>
        ct.tag.group?.slug === "items-corpse" &&
        !(ct.tag.description ?? "").includes("The face has been taken."),
    )
    .map((ct) => ({ slug: ct.tag.slug, name: ct.tag.name }));
  // computeKnownRecipeIds is the shared, pure verdict (web/lib/tagRequests.js)
  // — last-breath's "medical-expert AND holds an aberrant-heart" discovery
  // gate lives there, directly testable, rather than inlined here.
  const knownRecipeIds = computeKnownRecipeIds(tagCatalog, satisfied, character.tags, {
    visibilityBySlug,
    nonAllGroupSlugs,
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
    // Whether ingredients went in at the start — the give-up note names them.
    spentIngredients: Array.isArray(p.consumed) && p.consumed.length > 0,
    payerName: p.payerName,
    // Advanced this turn already — Continue greys until the next one.
    workedThisTurn: Boolean(openTurn && p.lastTurnId === openTurn.id),
  }));

  // The turn's craft ledger, and how much of each ration is still free
  // (docs/systemdocs/CRAFTING.md §2a). Both are the SERVER's arithmetic: the
  // Craft dialog quotes these numbers and clamps its quantity field to them,
  // but craftRequest re-reads the same rows under a row lock and refuses
  // regardless, so a stale page can mislead nobody into a craft that lands.
  const craftBudget = summarizeCraftBudget(currentAction);
  const craftAllowances = await craftFreeUnits(
    prisma,
    character.id,
    openTurn?.id ?? null,
    tagCatalog,
  );

  // Building (db/lib/structures.js). EVERY status comes down: the standing-
  // here panel lists a ruin as readily as a finished wall, and the Craft
  // dialog narrows to UNDER_CONSTRUCTION itself. Projected rather than passed
  // whole — the Prisma row carries Dates and a payer key that no client
  // surface has any business with.
  const sitesHere = (await structuresAt(prisma, character.locationId)).map(
    (s) => ({
      id: s.id,
      typeSlug: s.typeSlug,
      typeName: s.typeName,
      status: s.status,
      turnsDone: s.turnsDone,
      turnsNeeded: s.turnsNeeded,
      // Only the opener may call a site off, and cancelBuildSite re-checks it.
      mine: s.builderCharacterId === character.id,
    }),
  );
  // Whether this ground takes a structure at all, so the Craft menu can drop
  // the placements rather than offer a refusal. craftRequest judges the same
  // ground again with the same function.
  const buildable = canBuildHere(character.location).ok;

  // A fact about your own sheet, so this one may grey the button out.
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  // Crucify shows only for a Fundamentalist standing at a finished Cross —
  // your tag and your ground, nothing about who else is here.
  // crucifyCharacterRequest re-checks both.
  const canCrucify =
    heldSlugs.has("fundamentalist") &&
    sitesHere.some((s) => s.typeSlug === "crucifix" && s.status === "COMPLETE");
  // Disguise shows only while you are carrying the kit — your own sheet, so
  // it leaks nothing. disguiseSelfRequest re-checks it, since a hidden button
  // is a hint and not a lock.
  const canDisguise = heldSlugs.has("disguise-kit");
  // Torture shows for a Torturer and nobody else — again your own sheet.
  // tortureCharacterRequest re-checks the tag and that the target is Bound.
  const canTorture = heldSlugs.has("torturer");
  // The bomb's two halves. Both read off your own sheet and nothing else, so
  // neither leaks anything about the room; nukeActions.js re-checks both,
  // since a hidden button is a hint and not a lock.
  const hasDatacard = heldSlugs.has("nuclear-datacard");
  const hasDevice = heldSlugs.has("nuclear-device");
  // Paperwork, seals, books and the Bird (docs/systemdocs/PAPERWORK.md). Every
  // gate and every option list is built in web/lib/selfPools.js, because the
  // Hall's composer opens the same four dialogs and two copies of these rules
  // would be two answers to "can this character write".
  // Spread into CharacterSheet below: hasBird, canRead, canWrite, hasSeal,
  // canSeal, paperOptions, letterOptions, sealOptions, canBindBook,
  // bindBlocked, bookOptions, birdSentToday, birdTargets, birdZones — the
  // loader names them as the props RequestActionsProvider takes, so the sheet
  // and the Hall hand the dialogs one list.
  const letters = await loadLettersView(character, { openTurn });

  // The sheet itself goes to a client component, so the raw text of every
  // paper on it would otherwise sit in the page source — readable straight out
  // of DevTools by a holder who is blind, drunk or illiterate, which is the
  // one thing this whole system exists to prevent. Strip it here and compose
  // the description the same way getVisibleTags does.
  //
  // Holding a letter is not the same as being able to read it. That is the
  // entire point of an illiterate courier.
  const viewer = {
    tags: character.tags,
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  };
  // Poison state (the medical pass, M4): CharacterTag.poisonedCount/
  // poisonPayload are secret, and this loader's `tags: { include: { tag:
  // {...} } }` above has no per-field select, so Prisma hands back both
  // scalar columns on every row whether or not this character can smell a
  // thing. They must NEVER reach the client raw — this is that surface's
  // exact leak point, so the strip happens right here rather than trusting
  // every future reader of `sheetCharacter` to remember not to spread `ct`.
  // What crosses instead is `poisonMarker`, a plain yes/no — never the count,
  // never which poison — and only a "yes" for a character holding
  // poison-sense or a poison-snooper (canDetectPoison), computed ONCE for
  // this viewer looking at their OWN sheet (the only mode this page renders;
  // there is no "view someone else's held items" surface). Everyone else's
  // row is the plain row, exactly as if the columns were never selected.
  const canSmellPoison = canDetectPoison(character.tags);
  const sheetCharacter = {
    ...character,
    tags: character.tags.map((ct) => {
      const { poisonedCount, poisonPayload, ...ctRest } = ct;
      const stripped = {
        ...ctRest,
        poisonMarker: canSmellPoison && (poisonedCount ?? 0) > 0,
      };
      if (!isPaper(ct.tag)) return stripped;
      const { paperText, ...tag } = ct.tag;
      return {
        ...stripped,
        tag: { ...tag, description: paperDescription(ct.tag, viewer) },
      };
    }),
  };
  // The fear dial is hidden from players by design (docs/systemdocs/FEAR.md):
  // they see the band tag, never the number. The sheet is handed to client
  // components, so the column must not ride along in the payload.
  delete sheetCharacter.fear;
  // Who can pay: you, anyone here, or a room stash here (same as Craft).
  const healParties = { characters: peopleParties, rooms };

  // Lessons (LESSONS.md). `teachers`: everyone here who can teach, each with
  // the skills they could teach ME — computed server-side so only skills I
  // could learn cross the wire, never their sheet. `learners`: when I hold
  // Teaching, everyone here with what I could teach them. Both empty lists
  // otherwise. `pendingOffers`: the handshakes I'm part of this turn.
  const lessonCatalog = await prisma.tag.findMany({
    select: LESSON_CATALOG_SELECT,
  });
  const meForLessons = {
    id: character.id,
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  const hereForLessons = here.map((c) => ({
    id: c.id,
    name: c.name,
    tags: c.tags,
  }));
  const teachers = hereForLessons
    .filter((c) => isTeacher(c))
    .map((c) => ({
      id: c.id,
      name: c.name,
      skills: teachableSkills(c, meForLessons, lessonCatalog).map((t) => ({
        id: t.id,
        name: t.name,
      })),
    }))
    .filter((c) => c.skills.length > 0);
  const canTeach = isTeacher(meForLessons);
  const learners = canTeach
    ? hereForLessons
        .map((c) => ({
          id: c.id,
          name: c.name,
          skills: teachableSkills(meForLessons, c, lessonCatalog).map((t) => ({
            id: t.id,
            name: t.name,
          })),
        }))
        .filter((c) => c.skills.length > 0)
    : [];
  // Confession (CONFESSION.md). Only the penitent gets a menu: `confessors`
  // is everyone here holding the Chaplain tag, `mySins` my own psychological
  // tags. There is deliberately NO list built for a chaplain — one would show
  // them everybody's addictions before they had agreed to hear a word.
  const confessors = here
    .filter((c) => c.tags.some((ct) => ct.tag.slug === "chaplain"))
    .map((c) => ({ id: c.id, name: c.name }));
  // Guilt Ridden can't bring themself to confess at all — see
  // db/lib/confession.js#confessableTags, mirrored here so the Confess
  // button hides itself instead of failing on click.
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

  const pendingOffers = openTurn
    ? (
        await prisma.offer.findMany({
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
      ).map((o) => {
        const otherId =
          o.initiatorId === character.id ? o.responderId : o.initiatorId;
        const other = [...here, ...zoneRoster].find((c) => c.id === otherId);
        return {
          id: o.id,
          kind: o.kind,
          mine: o.initiatorId === character.id,
          otherName: other?.name ?? "someone",
          // A chaplain waiting on a confession is not told what it is about,
          // here or anywhere else. The penitent sees their own.
          tagName:
            o.kind === "CONFESSION" && o.responderId === character.id
              ? null
              : (o.tag?.name ?? null),
        };
      })
    : [];

  // A forced identity (Tag.forcedName — Apex Form's "Beast") shows the player
  // what the room sees: the forced name's letter plaque, not their own face.
  const forcedTag = character.tags.find((ct) => ct.tag.forcedName)?.tag ?? null;
  const forcedIdentity = forcedTag
    ? { name: forcedTag.forcedName, tagName: forcedTag.name }
    : null;
  // And what is over their face, which decides whether the conceal switch is
  // usable at all (PROXYING.md §5). Named here rather than in AvatarField so
  // the refusal can say WHICH thing is doing it.
  const concealingTag =
    character.tags
      .filter((ct) => ct.equipped && ct.tag.concealsIdentity)
      .sort((a, b) => (b.tag.equipLayer ?? 0) - (a.tag.equipLayer ?? 0))[0]
      ?.tag ?? null;
  const concealGear = concealingTag
    ? {
        tagName: concealingTag.name,
        forced: Boolean(concealingTag.forcesConceal),
      }
    : null;
  const avatarSrc = forcedIdentity
    ? presentedIdentity(character, { forcedName: forcedIdentity.name })
        .avatarPath
    : `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;

  // The Move cutoff for StatusPanel's "This turn" row.
  const openTurnWithWindow = openTurn
    ? {
        ...openTurn,
        moveWindow: moveWindow(openTurn, { clockFrozen: frozen }),
      }
    : openTurn;

  // A Gambit's die is rolled at submit but revealed only in the turn-end DM;
  // stripped here since currentAction crosses into a client component.
  const sheetAction = currentAction
    ? { ...currentAction, diceRoll: null, diceModifier: null }
    : currentAction;

  return (
    <CharacterSheet
      character={sheetCharacter}
      mode="self"
      openTurn={openTurnWithWindow}
      currentAction={sheetAction}
      avatarSrc={avatarSrc}
      forcedIdentity={forcedIdentity}
      concealGear={concealGear}
      transferParties={transferParties}
      transferSilo={transferSilo}
      carry={carry}
      zoneMoves={zoneMoves}
      zoneMovesReason={zoneMovesReason}
      travellingTo={character.travelTo?.name ?? null}
      examineBlocked={examineBlocked}
      hasWorkshop={hasWorkshop}
      tagCatalog={tagCatalog}
      desireSlots={desireSlots}
      desireSlotLockTurns={desireSlotLockTurns}
      desireAddiction={desireAddiction}
      desireSlotStates={desireSlotStates}
      desireCatalog={desireCatalog}
      desireFamilies={desireFamilyList}
      desireFamilyGroups={desireFamilyGroupList}
      desireLockNotes={desireLockNotes}
      desiresEnabled={desiresEnabled}
      canHeal={canHeal}
      healsLeft={healsLeft}
      hasSurgicalSite={hasSurgicalSite}
      hasMoved={Boolean(currentAction)}
      canTeach={canTeach}
      knownRecipeIds={knownRecipeIds}
      deathMaskCorpses={deathMaskCorpses}
      craftProjects={craftProjects}
      craftBudget={craftBudget}
      craftAllowances={craftAllowances}
      sitesHere={sitesHere}
      buildable={buildable}
      teachers={teachers}
      learners={learners}
      confessors={confessors}
      mySins={mySins}
      pendingOffers={pendingOffers}
      {...letters}
      equipSlots={gameConfig?.equipSlots ?? 10}
      avatarUploadsEnabled={gameConfig?.avatarUploadsEnabled ?? false}
      portraitMakerEnabled={gameConfig?.portraitMakerEnabled ?? false}
      portraitFantasyPartsEnabled={
        gameConfig?.portraitFantasyPartsEnabled ?? false
      }
      // Re-validated here: a stored index can outlive a catalog change.
      portraitSelection={parseSelection(character.portrait, {
        allowFantasy: gameConfig?.portraitFantasyPartsEnabled ?? false,
      })}
      hasCustomAvatar={Boolean(character.avatarMimeType)}
      healTargets={healTargets}
      healParties={healParties}
      corpses={corpses}
      canButcher={canButcher}
      hasMulligan={hasMulligan}
      canSeeExtract={canSeeExtract}
      canExtract={canExtract}
      extractBlocked={extractBlocked}
      canSeePackage={canSeePackage}
      lootTargets={lootTargets}
      moveTargets={moveTargets}
      moveLocations={moveLocations}
      bindTargets={bindTargets}
      canCrucify={canCrucify}
      canDisguise={canDisguise}
      canTorture={canTorture}
      hasDatacard={hasDatacard}
      hasDevice={hasDevice}
      nukeArmedTurn={nukeState?.nukeArmedTurn ?? null}
      deployVersion={deployVersion()}
      harmTargets={harmTargets}
      harmTags={harmTags}
      doseTargets={doseTargets}
      lastNameLocked={isDynastyMember(character.role?.slug)}
      storeTags={storeTags}
      storeHeldTags={storeHeldTags}
      storeRoleSlug={character.role?.slug ?? null}
    />
  );
}
