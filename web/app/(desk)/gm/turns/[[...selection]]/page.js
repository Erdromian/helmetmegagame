import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import TurnsView from "./TurnsView";
import Loading from "../Skeleton";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { turnEndsAt } from "@lifeweb/db/lib/turnClock";
import { avatarReviewWhere } from "@lifeweb/db/lib/avatarReview";
import { placementOf } from "@lifeweb/db/lib/structures";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import { deployVersion } from "@/lib/deployVersion";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  ATTACK_INCLUDE,
  INTERCEPT_HIT_INCLUDE,
  AVATAR_REVIEW_SELECT,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  attackRow,
  interceptHitRow,
  avatarReviewRow,
  tagsByIdFor,
} from "@/lib/moveRows";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves — under staged arbitration a resolved turn's Moves are already
// pushed, so nothing here can still be done to them — plus the newest
// Requests, which keep their own review lifecycle. A past turn is readable
// through the History lens, but it fetches itself (actions.js#getMoveHistory);
// all this file ships for it is the picker's list of resolved turns.


function turnLabel(turn) {
  if (!turn) return "—";
  return `${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}`;
}



// An optional catch-all rather than a [moveId] child route, for two reasons.
// The desk selects a Move OR a Caving roll, so the URL has to carry
// both halves of Workspace's { type, id }. And a child route would force this
// file to become a layout, putting the client Workspace above `children` —
// which cannot then hand tagsById/roster/zones/stagedByMove down to a server
// child, so every desk would have to reload its own DTOs and loading.js would
// flash on each queue click.
//
// The route also has to exist, not just be tolerated: Workspace polls
// router.refresh() every 45s against the CURRENT url, so a GM parked on
// /gm/turns/move/abc would 404 on the first poll without it.
//
// `history` is the fourth type: a Move on a RESOLVED turn, opened read-only.
// It never overlaps `move` — the open turn's Move is always `move`, and a
// history URL naming one is redirected below.
function parseSelection(segments) {
  if (!segments || segments.length !== 2) return null;
  const [type, id] = segments;
  if (!["move", "caving", "history"].includes(type)) return null;
  return { type, id };
}

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshTurnsWorkspace in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function TurnsWorkspacePage({ params }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { selection } = await params;
  return (
    <SnapshotPage scope={`gm-turns:${(selection ?? []).join("/")}`} userId={session.discordUserId} render={TurnsView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshTurnsWorkspace params={params} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshTurnsWorkspace({ params, userId }) {
  const { selection } = await params;
  const parsedSelection = parseSelection(selection);
  // Only the turn's END is derived here now, for the push countdown below — the
  // Move cutoff moved into the header chip every page wears (LockChip.js), which
  // reads it from the root layout. turnEndsAt does not care whether the clock is
  // frozen, so this no longer needs clockFrozen() alongside it. The big batch
  // below still waits on openTurn — it filters by turn id.
  const openTurn = await getOpenTurn();
  const endsAt = openTurn ? turnEndsAt(openTurn) : null;

  const [
    actions,
    cavingRolls,
    attacks,
    interceptHits,
    avatarsToReview,
    stagedEffects,
    stagedMessages,
    roster,
    presenceZones,
    stagingLocations,
    tagCatalog,
    members,
    visibleZones,
    selectableZones,
    gmProfiles,
    resolvedTurns,
    catatonicTagRows,
  ] = await Promise.all([
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: MOVE_INCLUDE,
        })
      : [],
    // The Caving lens — every roll on the open turn. See
    // docs/systemdocs/CAVING.md. No "strays from earlier turns" clause
    // like stagedEffects/stagedMessages below: a CavingRoll is never
    // "unapplied", it just sits resolved or not.
    openTurn
      ? prisma.cavingRoll.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: CAVING_ROLL_INCLUDE,
        })
      : [],
    // The Other lens — everything holding somebody in place this turn
    // (docs/systemdocs/ATTACK.md). Turn-scoped like the Caving lens above, and
    // cancelled rows ride along rather than being filtered out: a fight
    // somebody started and called off is still something a GM may need to know
    // happened.
    openTurn
      ? prisma.attack.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: ATTACK_INCLUDE,
        })
      : [],
    // Its intercept half. An AMBUSH files an Attack above, so what is left
    // here is the two-minute Safe stops.
    openTurn
      ? prisma.interceptHit.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: INTERCEPT_HIT_INCLUDE,
        })
      : [],
    // Uploaded portraits nobody has looked at yet (PORTRAITS.md §1a). NOT
    // scoped to the open turn, unlike everything above it: a picture is not a
    // thing that happened this turn, it is a thing that is still true — and a
    // queue that emptied itself at every turn end would be a review surface
    // that reviewed nothing.
    prisma.character.findMany({
      where: avatarReviewWhere(prisma),
      orderBy: { avatarSetAt: "desc" },
      select: AVATAR_REVIEW_SELECT,
    }),
    // Open-turn staging plus every unapplied stray from earlier turns —
    // the strays feed the missed-push banner.
    prisma.stagedEffect.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { appliedAt: null }] } : { appliedAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_EFFECT_INCLUDE,
    }),
    prisma.stagedMessage.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { sentAt: null }] } : { sentAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_MESSAGE_INCLUDE,
    }),
    // Recipient and mass-apply pickers. Living characters only — a staged
    // message to someone who dies mid-turn keeps its recipient row anyway.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        discordUserId: true,
        faction: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    // The public-declaration composer picks a ZONE, because #summary belongs
    // to the zone: PRESENCE zones only, never the abstract Caves group row.
    prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    // The staged "Relocate to" picker's options, grouped by zone in
    // docs/zones.yaml order.
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    // The effect composer's search space: the whole catalog. TAG_CHIP_FIELDS
    // is what TagChip/ChipLabel need to render coloured with a working
    // tooltip (group, category, description, …) — this used to be a lean,
    // bespoke select missing all of that, which is why chips here rendered
    // uncoloured with an empty tooltip. See referenceData.js's own comment;
    // this is the second time that regression happened.
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: {
        ...TAG_CHIP_FIELDS,
        stackable: true,
        equippable: true,
      },
    }),
    listGuildMembers(),
    getVisibleZones(),
    listSelectableZones(),
    getGmProfiles(),
    // The History lens's turn picker. Just the labels — a resolved turn's
    // Moves are fetched on demand by getMoveHistory when a GM actually
    // opens the lens, so the open turn's desk never pays for history it
    // isn't looking at (and neither does the 45s router.refresh()).
    prisma.turn.findMany({
      where: { status: "RESOLVED" },
      orderBy: { number: "desc" },
      select: { id: true, number: true, phase: true },
    }),
    // Who's AFK right now, for the queue rows' avatar badge — one indexed
    // read rather than a tags include bolted onto the request and caving
    // queries above. (Moves don't need it: MOVE_INCLUDE already carries the
    // held tags, and moveRow reads the slug straight off them.)
    prisma.characterTag.findMany({
      where: { tag: { slug: CATATONIC_SLUG }, character: { status: "ALIVE" } },
      select: { characterId: true },
    }),
  ]);

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const nameFor = (c) => usernameById.get(c.discordUserId) ?? c.discordUserId;
  const now = new Date();
  const gmProfilesById = Object.fromEntries(gmProfiles.map((p) => [p.discordUserId, { username: p.username, avatarUrl: p.avatarUrl }]));

  const catatonicIds = new Set(catatonicTagRows.map((row) => row.characterId));

  const tagsById = tagsByIdFor(actions);

  // Every structure standing at a Move filer's Location, loaded in ONE bulk
  // query rather than one per row (mirrors db/lib/structures.js#structuresAt's
  // two-query-joined-in-JS shape, just widened to every locationId on the
  // queue at once), then grouped so moveRow can hand each row its own slice.
  const moveLocationIds = [...new Set(actions.map((a) => a.character.locationId).filter(Boolean))];
  const structureRows = moveLocationIds.length
    ? await prisma.structure.findMany({
        where: { locationId: { in: moveLocationIds } },
        // The id tiebreaker keeps two same-instant rows in one stable order,
        // matching structuresAt.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  const structureTypeSlugs = [...new Set(structureRows.map((s) => s.typeSlug))];
  const structureTypes = structureTypeSlugs.length
    ? await prisma.tag.findMany({
        where: { slug: { in: structureTypeSlugs } },
        select: { slug: true, placement: true },
      })
    : [];
  const structureTypeBySlug = new Map(structureTypes.map((t) => [t.slug, t]));
  const structuresByLocationId = new Map();
  for (const row of structureRows) {
    const type = structureTypeBySlug.get(row.typeSlug) ?? null;
    const list = structuresByLocationId.get(row.locationId) ?? [];
    list.push({ ...row, placement: type ? placementOf(type) : null });
    structuresByLocationId.set(row.locationId, list);
  }

  const moves = actions.map((a) => moveRow(a, { usernameById, now, structuresByLocationId }));


  const cavingRows = cavingRolls.map((c) => cavingRollRow(c, { usernameById, catatonicIds }));

  // The Other lens's one merged list. An Ambush is already an Attack row, so
  // the two halves never name the same event twice.
  const otherRows = [
    ...attacks.map((a) => attackRow(a, { usernameById, catatonicIds })),
    ...interceptHits.map((h) => interceptHitRow(h, { usernameById, catatonicIds })),
    ...avatarsToReview.map((c) => avatarReviewRow(c, { usernameById, catatonicIds })),
  ];

  const locationRows = stagingLocations.map((l) => ({
    id: l.id,
    name: l.name,
    zoneId: l.zoneId,
    zoneName: l.zone?.name ?? null,
  }));
  const locationNameById = new Map(locationRows.map((l) => [l.id, l.name]));

  const effectCtx = { usernameById, locationNameById, openTurn };
  const messageCtx = { usernameById, openTurn };
  const effects = stagedEffects.map((e) => stagedEffectRow(e, effectCtx));
  const messages = stagedMessages.map((m) => stagedMessageRow(m, messageCtx));

  // A /gm/turns/history/<id> deep link, so one GM can send another the exact
  // past Move and have it open on arrival. The lens fetches the rest of that
  // turn on its own; this is only the one row the URL names. A row that turns
  // out to be on the OPEN turn isn't history at all — it is still live work,
  // so the URL corrects itself to /gm/turns/move/<id>.
  let initialHistory = null;
  // The Caving twin of the deep link above: a /gm/turns/caving/<id> link naming
  // a roll on a RESOLVED turn (the open turn's rolls are already in cavingRows,
  // so this only fires for a past one). Preloads the one row and its staged
  // work so the History lens opens straight to it, the same one-shot as
  // initialHistory — Workspace flips the lens to History · Caving on arrival.
  let initialCaving = null;
  if (parsedSelection?.type === "history") {
    const past = await prisma.action.findUnique({
      where: { id: parsedSelection.id },
      include: MOVE_INCLUDE,
    });
    if (past && openTurn && past.turnId === openTurn.id) redirect(`/gm/turns/move/${past.id}`);
    if (past) {
      const [pastEffects, pastMessages] = await Promise.all([
        prisma.stagedEffect.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_EFFECT_INCLUDE,
        }),
        prisma.stagedMessage.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_MESSAGE_INCLUDE,
        }),
      ]);
      initialHistory = {
        turnId: past.turnId,
        // No structuresByLocationId, deliberately: a past Move under today's
        // ground would lie, and the history desk shows no Standing-here line.
        move: moveRow(past, { usernameById, now }),
        effects: pastEffects.map((e) => stagedEffectRow(e, effectCtx)),
        messages: pastMessages.map((m) => stagedMessageRow(m, messageCtx)),
        tagsById: tagsByIdFor([past]),
      };
    }
  }

  if (parsedSelection?.type === "caving" && !cavingRows.some((c) => c.id === parsedSelection.id)) {
    const roll = await prisma.cavingRoll.findUnique({
      where: { id: parsedSelection.id },
      include: CAVING_ROLL_INCLUDE,
    });
    if (roll) {
      const [rollEffects, rollMessages] = await Promise.all([
        prisma.stagedEffect.findMany({
          where: { cavingRollId: roll.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_EFFECT_INCLUDE,
        }),
        prisma.stagedMessage.findMany({
          where: { cavingRollId: roll.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_MESSAGE_INCLUDE,
        }),
      ]);
      initialCaving = {
        turnId: roll.turnId,
        roll: cavingRollRow(roll, { usernameById, catatonicIds }),
        effects: rollEffects.map((e) => stagedEffectRow(e, effectCtx)),
        messages: rollMessages.map((m) => stagedMessageRow(m, messageCtx)),
      };
    }
  }

  // `label` is built by the same turnLabel() the resolved turns are, so the
  // History lens can list the open turn in its Turn dropdown alongside them
  // with no second formatting rule to keep in sync (Workspace.js only appends
  // the "· open" suffix).
  // `endsAtMs` rides along so the desk's push countdown can tick against the
  // same turnClock derivation everything else uses, instead of the header
  // re-deriving the cron's boundary hours in the browser (it did, and held the
  // old two-a-day rule). Present even when there is no Move lock — a short
  // manual turn still ends at a real time.
  const openTurnDto = openTurn
    ? {
        id: openTurn.id,
        number: openTurn.number,
        phase: openTurn.phase,
        label: turnLabel(openTurn),
        endsAtMs: endsAt ? endsAt.getTime() : null,
      }
    : null;

  return (
    <SnapshotFresh
      scope={`gm-turns:${(selection ?? []).join("/")}`}
      userId={userId}
      data={{
        initialSelection: parsedSelection,
        initialHistory: initialHistory,
        initialCaving: initialCaving,
        resolvedTurns: resolvedTurns.map((t) => ({ id: t.id, number: t.number, label: turnLabel(t) })),
        openTurn: openTurnDto,
        selectableZones: selectableZones,
        visibleZoneIds: visibleZones?.map((z) => z.id) ?? [],
        visibleZoneNames: visibleZones?.map((z) => z.name) ?? null,
        tagsById: tagsById,
        tagCatalog: tagCatalog,
        roster: roster.map((c) => ({
        id: c.id,
        name: c.name,
        factionName: c.faction?.name ?? "",
        roleTitle: c.roleTitle ?? "",
        zoneName: c.zone?.name ?? "",
        discordUserId: c.discordUserId,
        username: usernameById.get(c.discordUserId) ?? "",
      })),
        presenceZones: presenceZones,
        stagingLocations: locationRows,
        moves: moves,
        cavingRolls: cavingRows,
        otherRows: otherRows,
        stagedEffects: effects,
        stagedMessages: messages,
        gmProfiles: gmProfilesById,
        deployVersion: deployVersion(),
      }}
    />
  );
}
