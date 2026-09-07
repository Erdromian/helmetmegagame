import "server-only";
import { prisma } from "@lifeweb/db";
import { travelOptions } from "@lifeweb/db/lib/locationGraph";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { examineBlock } from "@lifeweb/db/lib/examineVision";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { peopleHere } from "@/lib/peopleHere";
import { isTradeable } from "@/lib/tagRequests";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { MEDICAL_TIER_CAPS } from "@/lib/requests";
import {
  HEALABLE_CATEGORY,
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  isInflictable,
  isGambitHeal,
  countsAgainstHealCap,
  healCapFor,
  satisfiedSkillIds,
} from "@/lib/healRequests";

// Everything the PEOPLE dialogs need — Look at, Heal, Transfer's recipient
// list, Loot, Bind, Free, Harm, Move Player — built once for whichever
// surface is asking.
//
// It lived inside web/app/(app)/character/page.js until phase 3, which was
// fine while the sheet was the only place you could act on somebody standing
// near you. The Hall's people column is the second, and a second copy of
// "who is helpless" would have been a second answer.
//
// The metagaming rule the sheet's grid follows applies to what a CALLER does
// with these, not to the lists themselves: every roster here is already
// narrowed to who is standing at this Location and hasn't hidden their face
// (web/lib/peopleHere.js), and every server action re-checks the same
// predicate on the id it is posted.
export async function loadPeoplePools(character, { discordUserId, openTurn } = {}) {
  // The people a sheet can act on: standing at this Location, alive and
  // unconcealed. One roster for every picker, so the menus can't disagree —
  // and the server re-checks the same predicate. `here` carries what Heal and
  // Learn need; `zoneRoster` is the roster for the actions that also work on
  // a corpse.
  const [here, zoneRoster, tierRows] = await Promise.all([
    peopleHere(character, {
      select: {
        id: true,
        name: true,
        // No `resources` — a balance is nobody else's business.
        tags: {
          select: {
            tagId: true,
            tag: {
              select: {
                id: true,
                name: true,
                slug: true,
                healable: true,
                requirementTurns: true,
                requirementResources: true,
                requirementGambit: true,
                requirementSkills: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
    // ONE roster for every action on somebody standing here (Loot, Move,
    // Bind, Free, Harm), including the unburied dead.
    peopleHere(character, {
      includeDead: true,
      select: {
        id: true,
        name: true,
        status: true,
        resources: true,
        tags: {
          select: {
            tagId: true,
            quantity: true,
            tag: {
              select: {
                name: true,
                slug: true,
                category: true,
                stackable: true,
                tradeable: true,
              },
            },
          },
        },
      },
    }),
    prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
  ]);

  const selfEntry = { id: character.id, name: character.name };
  const peopleParties = [selfEntry, ...here.map(({ id, name }) => ({ id, name }))];

  // Whether their eyes are good enough to look anybody over — Nearsighted
  // without spectacles on, Sun Sensitivity in daylight. Resolved server-side
  // so the sentence a button shows and the one examineActions.js refuses with
  // are the same sentence.
  const examineBlocked = examineBlock(character.tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });

  // Healing. The medical gate is resolved here, server-side, so no tier-chain
  // math reaches the client bundle.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // Patients: yourself and everyone here, filtered to treatable tags HERE,
  // not the client, so nobody else's full sheet crosses the wire. Skipped for
  // the majority who aren't medics.
  const selfAsPatient = {
    id: character.id,
    name: character.name,
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  const healTargets = (canHeal ? [selfAsPatient, ...here] : [])
    .map((t) => ({
      id: t.id,
      name: t.name,
      healable: t.tags
        .map((ct) => ct.tag)
        .filter(isHealable)
        .map((tag) => ({
          tagId: tag.id,
          tagName: tag.name,
          // Lets the Heal dialog match this row against the medic's own held
          // items' `cures` lists (medical pass, TAGS.md §5c) for the "or use:
          // …" affordance — Tag.cures names slugs, not ids.
          slug: tag.slug,
          cost: healCost(tag),
          requirementLabel: formatTagRequirement(tag),
          // Above your tier, or the ladder's top rung, and it's a roll rather
          // than a refusal — so the picker offers it, labelled, instead of
          // greying it out (docs/systemdocs/TAGS.md §5c).
          gambit: isGambitHeal(tag, satisfied),
          // A 0-turn cure is a free action and never counts against the day's
          // allowance (web/lib/requests.js MEDICAL_TIER_CAPS).
          counts: countsAgainstHealCap(tag),
        })),
    }))
    .filter((t) => t.healable.length > 0);

  // Routine cures left in the medic's day (web/lib/requests.js
  // MEDICAL_TIER_CAPS). The predicate MUST match routineHealsThisTurn in
  // requestActions.js exactly — a first-aid cure and a Gambit both cost
  // nothing here, and a number that disagreed with the one the action
  // enforces would grey out a treatment the server would have accepted.
  // Resolved server-side; the action re-checks under a row lock either way.
  const heldSlugSet = new Set(character.tags.map((ct) => ct.tag.slug));
  const healsLeft = canHeal
    ? Math.max(
        0,
        healCapFor(heldSlugSet, MEDICAL_TIER_CAPS) -
          (openTurn && discordUserId
            ? (
                await prisma.auditLog.findMany({
                  where: {
                    // The MEDIC's axis, matching routineHealsThisTurn exactly.
                    // targetCharacterId here is the patient.
                    actorDiscordUserId: discordUserId,
                    actionType: "request_heal_character",
                    turnId: openTurn.id,
                  },
                  select: { details: true },
                })
              ).filter((r) => !r.details?.gambit && (r.details?.requirement?.turns ?? 0) > 0).length
            : 0),
      )
    : 0;

  // The catalog name of whichever incapacitating tag they hold.
  function conditionOf(c) {
    return c.tags.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))?.tag.name ?? null;
  }
  const helpless = zoneRoster.filter((c) => c.status === "DEAD" || conditionOf(c));

  // A body, or anyone who can't stop you. Only `tradeable` tags come off.
  const lootTargets = helpless.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    condition: conditionOf(c),
    resources: c.resources,
    tags: c.tags
      .filter((ct) => isTradeable(ct.tag))
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        stackable: ct.tag.stackable,
        quantity: ct.quantity ?? 1,
      })),
  }));

  // Everyone here, not just who you may move: the server's own gate says who
  // follows, and a menu that narrowed to the bound would announce them.
  const moveTargets = zoneRoster.map(({ id, name, status }) => ({ id, name, status }));

  // Where you may walk someone: the neighbours of YOUR OWN location, the same
  // edge an ordinary walk uses, gated the same way. travelOptions drops the
  // hidden ways this character holds no key to, and `passable` drops the
  // locked and the shut — a walk-someone dialog has no room to explain a
  // refusal, so it only ever offers a hop that will actually work. Each
  // option carries its zone so the dialog can warn that the hop crosses one.
  const moveLocations = character.locationId
    ? (await travelOptions(prisma, character, character.locationId))
        .filter((row) => row.passable)
        .map((row) => ({
          id: row.location.id,
          name: row.location.name,
          zoneName: row.location.zone?.name ?? null,
          // The UI says "crosses into Fortress" only for an edge that leaves
          // the zone you're standing in.
          crossesZone: row.crossesZone,
        }))
    : [];

  // Bind and Free split this one list on `bound`; Crucify on `crucified`.
  const bindTargets = zoneRoster
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      bound: c.tags.some((ct) => ct.tag.slug === "bound"),
      crucified: c.tags.some((ct) => ct.tag.slug === "crucified"),
    }));

  // `finishable` is the narrower Dying-or-Bound gate on the lethal half.
  const harmTargets = helpless
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      condition: conditionOf(c),
      finishable: c.tags.some((ct) => FINISHABLE_SLUGS.has(ct.tag.slug)),
    }));

  // Not the whole Health category (TAGS.md §5c) — isInflictable narrows it to
  // wounds and maiming. Filtered in JS so this and the server action's
  // re-check share the same predicate.
  const harmTags = (
    await prisma.tag.findMany({
      where: { category: HEALABLE_CATEGORY, custom: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        category: true,
        custom: true,
        pointCost: true,
        stackable: true,
        group: { select: { slug: true, name: true, color: true } },
      },
    })
  ).filter(isInflictable);

  return {
    here,
    zoneRoster,
    peopleParties,
    examineBlocked,
    satisfied,
    canHeal,
    healTargets,
    healsLeft,
    lootTargets,
    moveTargets,
    moveLocations,
    bindTargets,
    harmTargets,
    harmTags,
  };
}

// The rooms a Transfer can hand things to or take things from: every room at
// this Location the character can actually get into, with its stash.
//
// The same shape web/app/(app)/character/page.js builds for the sheet's own
// Transfer dialog, including the Assets-weigh-nothing rule (CARRY.md §1) the
// projection under the dialog reads. It lives here rather than being a second
// query in the Hall's page: two answers to "which doors are open to you" is
// exactly what web/lib/peoplePools.js exists to stop.
export async function loadStashRooms(character) {
  if (!character?.locationId) return [];
  const [rows, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: character.locationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        accessTagSlugs: true,
        resources: true,
        tags: {
          where: { quantity: { gt: 0 } },
          select: {
            tagId: true,
            quantity: true,
            tag: { select: { name: true, stackable: true, weightLbs: true, category: true } },
          },
        },
      },
    }),
    roomAccessKeys(prisma, character.id),
  ]);

  return accessibleRooms(rows, keys.heldSlugs, keys.guestRoomIds).map((room) => ({
    id: room.id,
    name: room.name,
    resources: room.resources,
    tags: room.tags.map((rt) => ({
      tagId: rt.tagId,
      name: rt.tag.name,
      quantity: rt.quantity,
      stackable: rt.tag.stackable,
      weightLbs: rt.tag.category === "Assets" ? 0 : (rt.tag.weightLbs ?? 0),
    })),
  }));
}
