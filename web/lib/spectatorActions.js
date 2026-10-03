// What a spectator reads of a pushed turn on /actions (docs/systemdocs/CHAT.md §5a): every Move, every
// fight and every Caving result, with what came of each.
//
// Bascinet's call (2026-10-03): outcomes, never dice. A spectator reads the Move as written, the GM's
// Result box and every message the push actually sent; a fight's sides, what each fighter wrote, how it
// ended and its Result; a Caving result's kind, severity and loot. Real names throughout, as the desk
// has them. Never the die, a modifier, a total, a snapshot, a Vampire's compulsion, a GM's private notes
// or a message still sitting unsent on the desk.
//
// So every select below is an ALLOW-list and every row is built field by field, never spread out of the
// query: a GM-only column added to one of these tables later stays out of the spectator's browser until
// somebody writes it in here on purpose. web/lib/__tests__/spectatorActions.test.js holds that line.
//
// Only RESOLVED turns. The open turn is the GMs' desk still being worked, and nothing on it has happened
// yet as far as anybody watching is concerned.
//
// Takes the Prisma client as an argument and imports nothing that reaches it, so the test can hand it a
// fake one.

import { moveWhere } from "./moveWhere.js";
import { moveKindLabel, isTravelMove } from "./moves.js";
import { CAVING_KIND_LABELS, foldCavingRolls, severityLabel } from "./cavingLabels.js";
import { COMBAT_END_LABELS } from "./combatLabels.js";

export function spectatorTurnLabel(turn) {
  return `Turn ${turn.number} · Day ${turn.dayNumber}`;
}

// Every pushed turn, newest first — the page's turn picker.
export async function loadSpectatorTurns(db) {
  const turns = await db.turn.findMany({
    where: { status: "RESOLVED" },
    orderBy: { number: "desc" },
    select: { id: true, number: true, dayNumber: true },
  });
  return turns.map((t) => ({ id: t.id, number: t.number, label: spectatorTurnLabel(t) }));
}

const PLACE = { select: { id: true, name: true } };
const PERSON = { select: { id: true, name: true, updatedAt: true } };

const MOVE_SELECT = {
  id: true,
  characterId: true,
  moveKind: true,
  description: true,
  resultMessage: true,
  // Read for the auto-filed markers (moves.js#moveKindLabel, #isTravelMove) and nothing else. Never shipped.
  gmNotes: true,
  createdAt: true,
  zone: PLACE,
  location: PLACE,
  character: { select: { id: true, name: true, updatedAt: true, zone: PLACE, location: PLACE } },
};

// PUBLIC_PARTICIPANT_SELECT's shape (db/lib/combat.js) plus what they wrote and why they left. No die,
// rolls, modifiers, total, snapshot or compelled.
const COMBAT_SELECT = {
  id: true,
  locationName: true,
  location: { select: { name: true, zone: { select: { name: true } } } },
  fromAmbush: true,
  openingMessage: true,
  endReason: true,
  resultMessage: true,
  startedAt: true,
  participants: {
    orderBy: { joinedAt: "asc" },
    select: {
      id: true,
      characterId: true,
      side: true,
      role: true,
      status: true,
      description: true,
      leftReason: true,
      fromLocationName: true,
      character: PERSON,
    },
  },
};

// What foldCavingRolls reads, and what the row below prints. No die, no gmNotes, no presentedState.
const CAVING_SELECT = {
  id: true,
  characterId: true,
  kind: true,
  lootAlreadyHeld: true,
  lootUndoneAt: true,
  alert: true,
  response: true,
  respondedAt: true,
  resolvedAt: true,
  createdAt: true,
  character: PERSON,
  zone: { select: { name: true } },
  location: { select: { name: true } },
  lootTag: { select: { name: true } },
  lootRoom: { select: { name: true } },
};

const MESSAGE_SELECT = {
  id: true,
  moveId: true,
  cavingRollId: true,
  combatId: true,
  kind: true,
  content: true,
  createdAt: true,
  zone: { select: { name: true } },
  recipients: { select: { character: { select: { name: true } } } },
};

function messageRow(m) {
  return {
    id: m.id,
    kind: m.kind === "PUBLIC" ? "PUBLIC" : "PRIVATE",
    content: m.content,
    // A private message names who got it; a public one, the zone it was posted to.
    to:
      m.kind === "PUBLIC"
        ? (m.zone?.name ?? "")
        : m.recipients.map((r) => r.character?.name ?? "somebody").join(", "),
  };
}

function avatarVersion(character) {
  return character?.updatedAt ? character.updatedAt.getTime() : null;
}

function moveRow(a, messages) {
  const where = moveWhere(a);
  return {
    id: a.id,
    characterId: a.characterId,
    characterName: a.character?.name ?? "(deleted)",
    avatarVersion: avatarVersion(a.character),
    kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
    where: where.label,
    description: a.description ?? "",
    result: a.resultMessage ?? "",
    messages,
  };
}

// Only the people who were in it: an invite nobody answered counts as declined (ATTACK.md), and
// somebody who declined never fought.
const FOUGHT = new Set(["JOINED", "LEFT"]);

const SIDES = [
  { key: "attackers", label: "Attackers", test: (p) => p.side === "ATTACKER" && p.role !== "INTERVENER" },
  { key: "defenders", label: "Defenders", test: (p) => p.side === "DEFENDER" && p.role !== "INTERVENER" },
  { key: "joinA", label: "Joined the attackers", test: (p) => p.side === "ATTACKER" && p.role === "INTERVENER" },
  { key: "joinD", label: "Joined the defenders", test: (p) => p.side === "DEFENDER" && p.role === "INTERVENER" },
];

function fighterRow(p) {
  return {
    id: p.id,
    characterId: p.characterId,
    name: p.character?.name ?? "(deleted)",
    avatarVersion: avatarVersion(p.character),
    description: p.description ?? "",
    left: p.status === "LEFT",
    leftReason: p.leftReason ?? null,
    fromLocationName: p.role === "INTERVENER" ? (p.fromLocationName ?? null) : null,
  };
}

function fightRow(c, messages) {
  const fought = c.participants.filter((p) => FOUGHT.has(p.status));
  const sides = SIDES.map((s) => ({ key: s.key, label: s.label, people: fought.filter(s.test).map(fighterRow) })).filter(
    (s) => s.people.length > 0,
  );
  const namesOf = (key) => sides.find((s) => s.key === key)?.people.map((p) => p.name).join(", ");
  const zoneName = c.location?.zone?.name ?? "";
  const placeName = c.locationName ?? c.location?.name ?? "";
  return {
    id: c.id,
    title: `${namesOf("attackers") || "Nobody"} vs ${namesOf("defenders") || "nobody"}`,
    where: [zoneName, placeName].filter(Boolean).join(" · "),
    fromAmbush: Boolean(c.fromAmbush),
    openingMessage: c.openingMessage ?? null,
    endLabel: c.endReason ? (COMBAT_END_LABELS[c.endReason] ?? "Ended") : "Ended",
    result: c.resultMessage ?? "",
    sides,
    messages,
  };
}

// A raw roll in just enough of cavingRollRow's shape for foldCavingRolls to group it.
function cavingFoldInput(c) {
  return {
    id: c.id,
    characterId: c.characterId,
    character: c.character,
    kind: c.kind,
    createdAtMs: c.createdAt.getTime(),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    alert: Boolean(c.alert),
    response: c.response ?? "",
    respondedAtMs: c.respondedAt ? c.respondedAt.getTime() : null,
    zoneName: c.zone?.name ?? "",
    locationName: c.location?.name ?? null,
    lootTagName: c.lootTag?.name ?? null,
    lootAlreadyHeld: Boolean(c.lootAlreadyHeld),
    lootRoomName: c.lootRoom?.name ?? null,
    lootUndone: Boolean(c.lootUndoneAt),
  };
}

function cavingRow(r, messages) {
  return {
    id: r.id,
    characterId: r.characterId,
    characterName: r.character?.name ?? "(deleted)",
    avatarVersion: avatarVersion(r.character),
    kind: r.kind,
    kindLabel: CAVING_KIND_LABELS[r.kind] ?? "Roll",
    severity: severityLabel(r),
    where: [r.zoneName, r.locationName].filter(Boolean).join(" · "),
    lootName: r.kind === "FIND" ? r.lootTagName : null,
    lootAlreadyHeld: r.kind === "FIND" && r.lootAlreadyHeld,
    lootRoomName: r.kind === "FIND" ? r.lootRoomName : null,
    lootUndone: r.kind === "FIND" && r.lootUndone,
    response: r.response ?? "",
    messages,
  };
}

const byWhereThenName = (a, b) => a.where.localeCompare(b.where) || a.characterName.localeCompare(b.characterName);

// One pushed turn, or null when the id names no turn or one that has not been pushed.
export async function loadSpectatorTurn(db, turnId) {
  if (!turnId) return null;
  const turn = await db.turn.findUnique({
    where: { id: turnId },
    select: { id: true, number: true, dayNumber: true, status: true },
  });
  if (!turn || turn.status !== "RESOLVED") return null;

  const [actions, combats, rolls] = await Promise.all([
    // Confirmed only — a PENDING_TYPE row is an abandoned draft (the inspector's Moves tab rule).
    db.action.findMany({
      where: { turnId: turn.id, status: { in: ["CONFIRMED", "ADJUDICATED"] } },
      orderBy: { createdAt: "asc" },
      select: MOVE_SELECT,
    }),
    // Combat.turnId is a plain string, not a relation (schema.prisma).
    db.combat.findMany({ where: { turnId: turn.id }, orderBy: { startedAt: "asc" }, select: COMBAT_SELECT }),
    db.cavingRoll.findMany({ where: { turnId: turn.id }, orderBy: { createdAt: "asc" }, select: CAVING_SELECT }),
  ]);

  // A walk between Locations is filed as a Move so it reaches the desk, already solved; it is on the map,
  // not news. The desk hides these by default too.
  const moves = actions.filter((a) => !isTravelMove(a.gmNotes));
  const moveIds = moves.map((a) => a.id);
  const combatIds = combats.map((c) => c.id);
  const rollIds = rolls.map((c) => c.id);

  // Sent only: a staged row with no sentAt never reached anybody.
  const sent =
    moveIds.length || combatIds.length || rollIds.length
      ? await db.stagedMessage.findMany({
          where: {
            sentAt: { not: null },
            OR: [{ moveId: { in: moveIds } }, { combatId: { in: combatIds } }, { cavingRollId: { in: rollIds } }],
          },
          orderBy: { createdAt: "asc" },
          select: MESSAGE_SELECT,
        })
      : [];
  const messagesWhere = (pick) => sent.filter(pick).map(messageRow);

  const caving = foldCavingRolls(rolls.map(cavingFoldInput)).rows.map((r) => {
    const ids = new Set(r.memberIds ?? [r.id]);
    return cavingRow(r, messagesWhere((m) => ids.has(m.cavingRollId)));
  });

  return {
    turn: { id: turn.id, number: turn.number, label: spectatorTurnLabel(turn) },
    moves: moves.map((a) => moveRow(a, messagesWhere((m) => m.moveId === a.id))).sort(byWhereThenName),
    fights: combats.map((c) => fightRow(c, messagesWhere((m) => m.combatId === c.id))),
    caving: caving.sort(byWhereThenName),
  };
}
