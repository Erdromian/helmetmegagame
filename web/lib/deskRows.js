// SERVER ONLY — it imports the Prisma barrel through moveRows.js.
//
// The adjudication desk reads its rows from two places: the page (a whole
// payload, once per render) and a server action (a patch, once per mutation).
// moveRows.js already keeps the two from drifting on the SHAPE of a row; this
// file keeps them from drifting on the CONTEXT a row is built with — the
// Discord usernames, who is Catatonic, the Location names, the open turn, and
// the database's own clock at the moment of the read.
//
// That clock is the load-bearing part. Every row goes into the client's desk
// store stamped with it, and the store keeps the newer of two copies
// (deskStore.js). Stamp a patch with the web container's Date.now() instead
// and a GM's own Solve can lose to the page payload that was already in
// flight when they pressed it.
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { placementOf } from "@lifeweb/db/lib/structures";
import { listGuildMembers } from "./discordGuild";
import { pgNowMs } from "./pgClock";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
} from "./moveRows";

// Every structure standing at a set of Locations, in ONE pair of queries
// rather than one per row (mirrors db/lib/structures.js#structuresAt's
// two-queries-joined-in-JS shape, widened to every Location on the desk at
// once), grouped so moveRow can hand each row its own slice.
export async function structuresByLocation(locationIds) {
  const ids = [...new Set((locationIds ?? []).filter(Boolean))];
  const byLocationId = new Map();
  if (!ids.length) return byLocationId;

  const rows = await prisma.structure.findMany({
    where: { locationId: { in: ids } },
    // The id tiebreaker keeps two same-instant rows in one stable order,
    // matching structuresAt.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const slugs = [...new Set(rows.map((s) => s.typeSlug))];
  const types = slugs.length
    ? await prisma.tag.findMany({ where: { slug: { in: slugs } }, select: { slug: true, placement: true } })
    : [];
  const typeBySlug = new Map(types.map((t) => [t.slug, t]));
  for (const row of rows) {
    const type = typeBySlug.get(row.typeSlug) ?? null;
    const list = byLocationId.get(row.locationId) ?? [];
    list.push({ ...row, placement: type ? placementOf(type) : null });
    byLocationId.set(row.locationId, list);
  }
  return byLocationId;
}

// `openTurn` is passed in by a caller that already has it (page.js awaits it
// before anything else, for the push countdown); anything else lets this fetch
// it. Pass `null` to mean "there genuinely is no open turn" — leaving it out
// is what asks for a read.
export async function deskRowContext({ openTurn, needStructuresFor } = {}) {
  const [members, catatonicTagRows, locations, asOfMs, fetchedTurn] = await Promise.all([
    listGuildMembers(),
    // Who is AFK right now, for the queue rows' avatar badge — one indexed
    // read rather than a tags include bolted onto every query above it.
    prisma.characterTag.findMany({
      where: { tag: { slug: CATATONIC_SLUG }, character: { status: "ALIVE" } },
      select: { characterId: true },
    }),
    // The staged "Relocate to" picker's options, grouped by zone in
    // docs/zones.yaml order — and the lookup that turns a staged locationId
    // back into a name.
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    pgNowMs(),
    openTurn === undefined
      ? prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
      : null,
  ]);

  const locationRows = locations.map((l) => ({
    id: l.id,
    name: l.name,
    zoneId: l.zoneId,
    zoneName: l.zone?.name ?? null,
  }));

  return {
    usernameById: new Map(members.map((m) => [m.id, m.username])),
    catatonicIds: new Set(catatonicTagRows.map((row) => row.characterId)),
    locationRows,
    locationNameById: new Map(locationRows.map((l) => [l.id, l.name])),
    openTurn: openTurn === undefined ? fetchedTurn : openTurn,
    now: new Date(),
    asOfMs,
    structuresByLocationId: needStructuresFor ? await structuresByLocation(needStructuresFor) : new Map(),
  };
}

// The patch a mutation hands back to the desk: the rows it touched, re-read
// and mapped through the very same DTO mappers the page uses.
//
// An id that was asked for and did not come back is REMOVED, not missing —
// that is what makes Delete and Reject cost one call instead of two, and it
// means a row somebody else deleted a second earlier is reported honestly
// rather than lingering on the asking GM's screen.
export async function deskPatchFor({
  moveIds = [],
  cavingRollIds = [],
  stagedEffectIds = [],
  stagedMessageIds = [],
  removed = {},
} = {}) {
  const ctx = await deskRowContext();

  const [actions, rolls, effects, messages] = await Promise.all([
    moveIds.length
      ? prisma.action.findMany({ where: { id: { in: moveIds } }, include: MOVE_INCLUDE })
      : [],
    cavingRollIds.length
      ? prisma.cavingRoll.findMany({ where: { id: { in: cavingRollIds } }, include: CAVING_ROLL_INCLUDE })
      : [],
    stagedEffectIds.length
      ? prisma.stagedEffect.findMany({ where: { id: { in: stagedEffectIds } }, include: STAGED_EFFECT_INCLUDE })
      : [],
    stagedMessageIds.length
      ? prisma.stagedMessage.findMany({ where: { id: { in: stagedMessageIds } }, include: STAGED_MESSAGE_INCLUDE })
      : [],
  ]);

  const structuresByLocationId = await structuresByLocation(
    actions.map((a) => a.character.locationId),
  );

  const gone = (asked, found) => {
    const here = new Set(found.map((r) => r.id));
    return asked.filter((id) => !here.has(id));
  };

  return {
    asOfMs: ctx.asOfMs,
    moves: actions.map((a) => moveRow(a, { ...ctx, structuresByLocationId })),
    cavingRolls: rolls.map((c) => cavingRollRow(c, ctx)),
    stagedEffects: effects.map((e) => stagedEffectRow(e, ctx)),
    stagedMessages: messages.map((m) => stagedMessageRow(m, ctx)),
    removed: {
      moveIds: [...(removed.moveIds ?? []), ...gone(moveIds, actions)],
      cavingRollIds: [...(removed.cavingRollIds ?? []), ...gone(cavingRollIds, rolls)],
      stagedEffectIds: [...(removed.stagedEffectIds ?? []), ...gone(stagedEffectIds, effects)],
      stagedMessageIds: [...(removed.stagedMessageIds ?? []), ...gone(stagedMessageIds, messages)],
    },
  };
}
