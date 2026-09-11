// SERVER ONLY — it imports the Prisma barrel through moveRows.js.
//
// The adjudication desk reads its rows from two places: the page (a whole
// payload, once per render) and a server action (a patch, once per mutation).
// moveRows.js already keeps the two from drifting on the SHAPE of a row; this
// file keeps them from drifting on the CONTEXT a row is built with — the
// Discord usernames, who is Catatonic, the Location names and the open turn.
//
// The database's own clock belongs with them and is deliberately NOT read
// here — see deskRowContext. Every row goes into the client's desk store
// stamped with it and the store keeps the newer of two copies (deskStore.js),
// so both WHERE it comes from and WHEN it is taken matter: the web container's
// Date.now() would let a GM's own Solve lose to a page payload already in
// flight, and a clock read alongside the rows rather than after them would let
// a payload built before that Solve out-rank it.
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
// NO CLOCK HERE, deliberately. `asOfMs` is read by the caller AFTER its own row
// queries have resolved — see page.js and deskPatchFor below — because a clock
// taken alongside the rows is a clock taken BEFORE the rows were finished
// being read, and the desk store's newer-wins rule (deskStore.js) then hands a
// stale payload the authority of a fresh one.
export async function deskRowContext({ openTurn } = {}) {
  const [members, catatonicTagRows, locations, fetchedTurn] = await Promise.all([
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
  };
}

// The patch a mutation hands back to the desk: the rows it touched, re-read
// and mapped through the very same DTO mappers the page uses.
//
// An id that was asked for and did not come back is REMOVED, not missing —
// that is what makes Delete and Reject cost one call instead of two, and it
// means a row somebody else deleted a second earlier is reported honestly
// rather than lingering on the asking GM's screen.
//
// `onDeskOnly` is the LIVE CHANNEL's flag and nothing else uses it. A mutation
// only ever asks about rows the GM was already looking at, so it needs no such
// test. The stream does: it is handed whatever ids Postgres announced, and the
// turn-end push stamps `appliedEffects` on every Action in the game
// (db/lib/stagedPush.js). Without this, closing a turn would deal a hundred
// LAST turn's Moves onto every open desk's queue as live work — the desk store
// holds rows, not queries, so nothing downstream would have caught it. The
// predicate below is page.js's own membership rule, copied deliberately rather
// than shared: they are two reads of the same question, and if page.js's ever
// moves this one has to be changed to match on purpose.
export async function deskPatchFor({
  moveIds = [],
  cavingRollIds = [],
  stagedEffectIds = [],
  stagedMessageIds = [],
  removed = {},
  onDeskOnly = false,
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

  // Off the desk is not the same as gone — the row exists, this desk is
  // simply not the place it belongs — so a dropped id is reported as neither a
  // row nor a removal, and the client keeps whatever it holds.
  const openTurnId = ctx.openTurn?.id ?? null;
  const onDesk = (rows, predicate) => (onDeskOnly ? rows.filter(predicate) : rows);
  const ofOpenTurn = (r) => openTurnId != null && r.turnId === openTurnId;
  const liveActions = onDesk(actions, ofOpenTurn);
  const liveRolls = onDesk(rolls, ofOpenTurn);
  const liveEffects = onDesk(effects, (e) => ofOpenTurn(e) || e.appliedAt == null);
  const liveMessages = onDesk(messages, (m) => ofOpenTurn(m) || m.sentAt == null);

  const structuresByLocationId = await structuresByLocation(
    liveActions.map((a) => a.character.locationId),
  );

  // THE CLOCK IS READ LAST, and the order is load-bearing. Every row in this
  // patch is stamped with `asOfMs` and the desk store keeps the newer of two
  // copies of a row (deskStore.js). Read the clock alongside the rows — which
  // is what deskRowContext used to do — and a payload whose rows were read
  // BEFORE somebody's Solve can still carry a stamp from after it, out-ranking
  // the Solve's own patch and putting the Move back in the queue. Read after
  // every query has resolved and the stamp can only ever under-claim: the rows
  // are at least as fresh as the clock says they are, which is the direction
  // the newer-wins rule is safe in.
  const asOfMs = await pgNowMs();

  // Only an id that came back and was then dropped as off-desk is excused; an
  // id that did not come back at all is genuinely gone whatever this flag says.
  const gone = (asked, found) => {
    const here = new Set(found.map((r) => r.id));
    return asked.filter((id) => !here.has(id));
  };

  return {
    asOfMs,
    // Which turn the desk this patch is for was showing. applyDeskPatch drops
    // a patch that does not match: a mutation asks about rows by id, so a
    // Solve landing across the turn-end push would otherwise deal a row from
    // the closed turn into the new turn's queue.
    turnId: openTurnId,
    moves: liveActions.map((a) => moveRow(a, { ...ctx, structuresByLocationId })),
    cavingRolls: liveRolls.map((c) => cavingRollRow(c, ctx)),
    stagedEffects: liveEffects.map((e) => stagedEffectRow(e, ctx)),
    stagedMessages: liveMessages.map((m) => stagedMessageRow(m, ctx)),
    removed: {
      moveIds: [...(removed.moveIds ?? []), ...gone(moveIds, actions)],
      cavingRollIds: [...(removed.cavingRollIds ?? []), ...gone(cavingRollIds, rolls)],
      stagedEffectIds: [...(removed.stagedEffectIds ?? []), ...gone(stagedEffectIds, effects)],
      stagedMessageIds: [...(removed.stagedMessageIds ?? []), ...gone(stagedMessageIds, messages)],
    },
  };
}
