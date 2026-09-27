// Which of a DM thread's buttons are still worth drawing — a button here is a view of a pending
// row (db/lib/dmActions.js), so a thread scrolled back a month shows offers as the record they
// are, not live-looking Accept buttons. This is belt-and-braces, never the only guard: the server
// action re-validates everything.
import { prisma } from "@lifeweb/db";
import { DM_ACTION, dmActionOf } from "@lifeweb/db/lib/dmActions";
import { isHeldOpen } from "@lifeweb/db/lib/locationGraph";

function byKind(rows) {
  const out = new Map();
  for (const row of rows) {
    const action = dmActionOf(row);
    if (!action) continue;
    if (!out.has(action.kind)) out.set(action.kind, new Set());
    out.get(action.kind).add(action.id);
  }
  return out;
}

async function liveOffers(ids, viewer) {
  if (!viewer.characterId) return [];
  const rows = await prisma.offer.findMany({
    where: { id: { in: ids }, status: "PENDING", responderId: viewer.characterId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveThreatSpawns(ids, viewer) {
  const rows = await prisma.threatSpawn.findMany({
    where: { id: { in: ids }, status: "PENDING", discordUserId: viewer.discordUserId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveLobbySeats(ids, viewer) {
  // ASSIGNED, not PENDING: a CREATED seat is no longer declinable (db/lib/lobby.js#declineAssignment).
  const rows = await prisma.lobbyEntry.findMany({
    where: { id: { in: ids }, status: "ASSIGNED", discordUserId: viewer.discordUserId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveKeyedWays(ids, viewer) {
  if (!viewer.characterId) return [];
  const [links, character] = await Promise.all([
    prisma.locationLink.findMany({
      where: { id: { in: ids }, keyed: true },
      select: { id: true, openUntil: true, requiredTagSlug: true },
    }),
    prisma.character.findUnique({
      where: { id: viewer.characterId },
      select: { tags: { select: { tag: { select: { slug: true } } } } },
    }),
  ]);
  const held = new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  // Already propped open, and the question is moot; no key, and it was never theirs to answer.
  return links
    .filter((link) => !isHeldOpen(link) && (!link.requiredTagSlug || held.has(link.requiredTagSlug)))
    .map((link) => link.id);
}

// Still answerable while the window is open (docs/systemdocs/BIRD.md); authority is
// db/lib/birdReply.js#birdReplyWindow. Literacy is deliberately NOT checked here — a Reply that
// refuses out loud tells a blinded player something a silently missing link never would.
async function liveBirdReplies(ids, viewer) {
  if (!viewer.characterId) return [];
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const rows = await prisma.birdMessage.findMany({
    where: {
      id: { in: ids },
      recipientId: viewer.characterId,
      delivered: true,
      repliedAt: null,
      ...(openTurn ? { replyDeadlineTurn: { gte: openTurn.number } } : { replyDeadlineTurn: { not: null } }),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Still pickable while the rite is AWAITING and this viewer is one of the
// chanters it snapshotted (docs/systemdocs/THANATI.md §4a); authority is
// db/lib/conversionRite.js#answerConversionPick. The twelve-hour sweep in
// riteSweep.js is what finally takes an unanswered one off the thread.
async function liveConversionPicks(ids, viewer) {
  if (!viewer.characterId) return [];
  const rows = await prisma.riteAttempt.findMany({
    where: { id: { in: ids }, riteKey: "conversion", status: "AWAITING" },
    select: { id: true, participants: true },
  });
  return rows
    .filter((r) => (Array.isArray(r.participants) ? r.participants : []).some((p) => p.characterId === viewer.characterId))
    .map((r) => r.id);
}

// A fight's two DMs (docs/systemdocs/ATTACK.md). Live while the fight still holds this viewer's own
// participant row — INVITED for the Join / Decline pair, JOINED for the fight's own button. The ids are
// participant rows, and matching them to the viewer here is what keeps somebody else's from lighting up.
async function liveCombatRows(ids, viewer, status) {
  if (!viewer.characterId) return [];
  const rows = await prisma.combatParticipant.findMany({
    where: { id: { in: ids }, characterId: viewer.characterId, status, activeTurnId: { not: null } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const RESOLVERS = {
  [DM_ACTION.COMBAT_INVITE]: (ids, viewer) => liveCombatRows(ids, viewer, "INVITED"),
  [DM_ACTION.COMBAT]: (ids, viewer) => liveCombatRows(ids, viewer, "JOINED"),
  [DM_ACTION.OFFER]: liveOffers,
  [DM_ACTION.THREAT_SPAWN]: liveThreatSpawns,
  [DM_ACTION.LOBBY_SEAT]: liveLobbySeats,
  [DM_ACTION.KEYED_WAY]: liveKeyedWays,
  [DM_ACTION.BIRD_REPLY]: liveBirdReplies,
  [DM_ACTION.RITE_TARGET]: liveConversionPicks,
};

// Stamps `actionable: true` on rows whose descriptor still names something this viewer can
// answer. `viewer` is { discordUserId, characterId } resolved from the SESSION — never from anything the client posted.
export async function resolveDmActions(rows, viewer) {
  const groups = byKind(rows);
  if (groups.size === 0) return rows;

  const live = new Set();
  for (const [kind, ids] of groups) {
    const resolver = RESOLVERS[kind];
    if (!resolver) continue;
    try {
      for (const id of await resolver([...ids], viewer)) live.add(`${kind}:${id}`);
    } catch (err) {
      console.error(`Resolving ${kind} DM actions failed:`, err);
    }
  }

  return rows.map((row) => {
    const action = dmActionOf(row);
    if (!action) return row;
    return { ...row, actionable: live.has(`${action.kind}:${action.id}`) };
  });
}
