// SERVER ONLY — imports the Prisma barrel through moveRows.js. The desk reads rows from the page and a
// server action; moveRows.js keeps the two from drifting on row SHAPE, this file on CONTEXT.
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { placementOf } from "@lifeweb/db/lib/structures";
import { listGuildMembers } from "./discordGuild";
import { pgNowMs } from "./pgClock";
import { loadLooks } from "@lifeweb/db/lib/gmPresentation";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  CAVING_STANDING_CHARACTER_SELECT,
  CAVING_STAND_SELECT,
  COMBAT_INCLUDE,
  moveRow,
  moveLocationId,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  cavingStandingRow,
  combatRow,
} from "./moveRows";

// Every caver's standing on one turn (moveRows.js#cavingStandingRow): the characters with a Caving roll or
// a stand on it, or just `characterIds` when a patch names them. Raw rows, so a caller can feed the stands'
// stamps to deskLooks before mapping; `cavingStandingRows` below maps them.
export async function loadCavingStandings({ turnId, characterIds = null } = {}) {
  if (!turnId) return { characters: [], stands: [] };
  let ids = characterIds;
  if (!ids) {
    const [rolls, stands] = await Promise.all([
      prisma.cavingRoll.findMany({ where: { turnId }, distinct: ["characterId"], select: { characterId: true } }),
      prisma.cavingStand.findMany({ where: { turnId }, select: { characterId: true } }),
    ]);
    ids = [...rolls, ...stands].map((r) => r.characterId);
  }
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return { characters: [], stands: [] };
  const [characters, stands] = await Promise.all([
    prisma.character.findMany({ where: { id: { in: ids } }, select: CAVING_STANDING_CHARACTER_SELECT }),
    prisma.cavingStand.findMany({ where: { turnId, characterId: { in: ids } }, select: CAVING_STAND_SELECT }),
  ]);
  return { characters, stands };
}

export function cavingStandingRows({ characters, stands }, ctx) {
  const standOf = new Map(stands.map((s) => [s.characterId, s]));
  return characters.map((c) => cavingStandingRow(c, standOf.get(c.id) ?? null, ctx));
}

// Every structure standing at a set of Locations, in ONE pair of queries (mirrors db/lib/structures.js#structuresAt).
export async function structuresByLocation(locationIds) {
  const ids = [...new Set((locationIds ?? []).filter(Boolean))];
  const byLocationId = new Map();
  if (!ids.length) return byLocationId;

  const rows = await prisma.structure.findMany({
    where: { locationId: { in: ids } },
    // id tiebreaker keeps two same-instant rows in one stable order, matching structuresAt.
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

// What the room sees of everybody on these raw rows, frozen and live, for the row builders' `looks`
// (db/lib/gmPresentation.js). Takes the rows as Prisma returned them (the *_INCLUDE shapes), so a stamp
// is read straight off its column; `characterIds` adds anybody else the payload names. Two or three
// queries for a whole desk, however many rows.
export async function deskLooks({
  actions = [],
  cavingRolls = [],
  cavingStands = [],
  combats = [],
  effects = [],
  messages = [],
  characterIds = [],
} = {}) {
  const ids = [...characterIds];
  const stamps = [];
  for (const s of cavingStands) {
    ids.push(s.characterId);
    stamps.push(s.presentedAs);
  }
  for (const a of actions) {
    ids.push(a.characterId);
    stamps.push(a.presentedAs);
  }
  for (const c of cavingRolls) {
    ids.push(c.characterId);
    stamps.push(c.presentedAs);
  }
  for (const fight of combats) {
    for (const p of fight.participants ?? []) {
      ids.push(p.characterId);
      stamps.push(p.presentedAs);
    }
  }
  for (const e of effects) if (e.targetCharacterId) ids.push(e.targetCharacterId);
  for (const m of messages) for (const r of m.recipients ?? []) if (r.character?.id) ids.push(r.character.id);
  return loadLooks(prisma, { ids, stamps: stamps.filter(Boolean) });
}

// `openTurn` is passed by a caller that already has it; pass `null` for "genuinely no open turn". NO CLOCK HERE (see deskPatchFor).
export async function deskRowContext({ openTurn } = {}) {
  const [members, catatonicTagRows, locations, fetchedTurn] = await Promise.all([
    listGuildMembers(),
    // Who is AFK right now, for the queue rows' avatar badge.
    prisma.characterTag.findMany({
      where: { tag: { slug: CATATONIC_SLUG }, character: { status: "ALIVE" } },
      select: { characterId: true },
    }),
    // The staged "Relocate to" picker's options, grouped by zone (docs/zones.yaml order).
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

// The patch a mutation hands back: rows it touched, re-read through the same DTO mappers the page uses.
// An id asked for and not returned is REMOVED, not missing. `onDeskOnly` is the LIVE CHANNEL's flag,
// since the stream (unlike a mutation) gets whatever ids Postgres announced, including last turn's.
export async function deskPatchFor({
  moveIds = [],
  cavingRollIds = [],
  // Character ids whose Caving standing changed — a stand written at the lock (the CavingStand_notify trigger).
  // The standings of every patched roll's caver ride along too, so a walk keeps "where they are now" fresh.
  cavingStandingIds = [],
  combatIds = [],
  stagedEffectIds = [],
  stagedMessageIds = [],
  removed = {},
  onDeskOnly = false,
} = {}) {
  const ctx = await deskRowContext();

  const [actions, rolls, combats, effects, messages] = await Promise.all([
    moveIds.length
      ? prisma.action.findMany({ where: { id: { in: moveIds } }, include: MOVE_INCLUDE })
      : [],
    cavingRollIds.length
      ? prisma.cavingRoll.findMany({ where: { id: { in: cavingRollIds } }, include: CAVING_ROLL_INCLUDE })
      : [],
    combatIds.length
      ? prisma.combat.findMany({ where: { id: { in: combatIds } }, include: COMBAT_INCLUDE })
      : [],
    stagedEffectIds.length
      ? prisma.stagedEffect.findMany({ where: { id: { in: stagedEffectIds } }, include: STAGED_EFFECT_INCLUDE })
      : [],
    stagedMessageIds.length
      ? prisma.stagedMessage.findMany({ where: { id: { in: stagedMessageIds } }, include: STAGED_MESSAGE_INCLUDE })
      : [],
  ]);

  // Off the desk is not the same as gone: a dropped id is reported as neither a row nor a removal.
  const openTurnId = ctx.openTurn?.id ?? null;
  const onDesk = (rows, predicate) => (onDeskOnly ? rows.filter(predicate) : rows);
  const ofOpenTurn = (r) => openTurnId != null && r.turnId === openTurnId;
  const liveActions = onDesk(actions, ofOpenTurn);
  const liveRolls = onDesk(rolls, ofOpenTurn);
  const liveCombats = onDesk(combats, ofOpenTurn);
  const liveEffects = onDesk(effects, (e) => ofOpenTurn(e) || e.appliedAt == null);
  const liveMessages = onDesk(messages, (m) => ofOpenTurn(m) || m.sentAt == null);

  // Only ever the open turn's: a past turn's standings come with History (actions.js#getMoveHistory).
  const standingIds = [...new Set([...cavingStandingIds, ...liveRolls.map((r) => r.characterId)])];
  const standings =
    openTurnId && standingIds.length
      ? await loadCavingStandings({ turnId: openTurnId, characterIds: standingIds })
      : { characters: [], stands: [] };

  const [structuresByLocationId, looks] = await Promise.all([
    structuresByLocation(liveActions.map(moveLocationId)),
    deskLooks({
      actions: liveActions,
      cavingRolls: liveRolls,
      cavingStands: standings.stands,
      combats: liveCombats,
      effects: liveEffects,
      messages: liveMessages,
    }),
  ]);
  const rowCtx = { ...ctx, looks };

  // THE CLOCK IS READ LAST, load-bearing: read after every query resolves, so `asOfMs` can only under-claim freshness (deskStore.js).
  const asOfMs = await pgNowMs();

  // Only an id that came back and was dropped as off-desk is excused; one that never came back is genuinely gone.
  const gone = (asked, found) => {
    const here = new Set(found.map((r) => r.id));
    return asked.filter((id) => !here.has(id));
  };

  return {
    asOfMs,
    // Which turn this patch was showing; applyDeskPatch drops a mismatched patch.
    turnId: openTurnId,
    moves: liveActions.map((a) => moveRow(a, { ...rowCtx, structuresByLocationId })),
    cavingRolls: liveRolls.map((c) => cavingRollRow(c, rowCtx)),
    cavingStandings: cavingStandingRows(standings, rowCtx),
    combats: liveCombats.map((c) => combatRow(c, rowCtx)),
    stagedEffects: liveEffects.map((e) => stagedEffectRow(e, rowCtx)),
    stagedMessages: liveMessages.map((m) => stagedMessageRow(m, rowCtx)),
    removed: {
      moveIds: [...(removed.moveIds ?? []), ...gone(moveIds, actions)],
      cavingRollIds: [...(removed.cavingRollIds ?? []), ...gone(cavingRollIds, rolls)],
      // A character deleted since (the stand's cascade) is gone from the lens with them.
      cavingStandingIds: openTurnId ? gone(cavingStandingIds, standings.characters) : [],
      combatIds: [...(removed.combatIds ?? []), ...gone(combatIds, combats)],
      stagedEffectIds: [...(removed.stagedEffectIds ?? []), ...gone(stagedEffectIds, effects)],
      stagedMessageIds: [...(removed.stagedMessageIds ?? []), ...gone(stagedMessageIds, messages)],
    },
  };
}
