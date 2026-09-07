// The chant hook: every line a character says on either face passes through
// db/lib/say.js#recordSpeech, which hands the written row to noteChant() here
// (docs/systemdocs/THANATI.md). There is no Rite button — this is how a rite
// begins, and the sweep (db/lib/riteSweep.js) is how it ends.
//
// A chant COUNTS when all of these hold:
//   - it was said in a Room's thread, or in a Conversation linked to a Room;
//   - the line contains this game's Word of the Circle for some rite;
//   - the speaker is wearing Black Robes and holds Dark Inspiration.
// It then joins (or opens) the RiteAttempt for that rite in that room, and the
// attempt is re-judged: enough distinct chanters and the floor ingredients
// present → READY, the two-minute clock starts, and the room hears one line.
//
// Best-effort, and it must NEVER slow or fail the message it rides on: the
// caller fires it without awaiting and every path here is caught. Takes `db`
// as a parameter, the db/lib/dm.js convention.
const { RITES, WINDOW_MS, GRACE_MS, riteByKey, matchRites, floorIngredients } = require("./rites");
const { ensureRiteWords } = require("./riteWords");
const { chanterReady } = require("./thanati");
const { postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

// Bascinet's line, verbatim and unsigned. Posted once per attempt, the moment
// the last requirement lands.
const TENSE_LINE = "You feel tense... Anyone else who wants to participate should join in now.";

// room:<id> directly; conv:<id> through the Conversation's linked room. Null
// for a Location channel, a zone, a DM, or a Conversation nobody linked.
async function roomIdForPlaceKey(db, placeKey) {
  if (!placeKey) return null;
  if (placeKey.startsWith("room:")) return placeKey.slice("room:".length) || null;
  if (placeKey.startsWith("conv:")) {
    const thread = await db.playerThread.findUnique({
      where: { id: placeKey.slice("conv:".length) },
      select: { roomId: true },
    });
    return thread?.roomId ?? null;
  }
  return null;
}

// Whether the floor holds what the rite lists. Kinds the scripted rite
// resolves itself (a bound person, a corpse, a photograph, a weapon) are not
// judged here and count as present.
async function floorHas(db, rite, roomId) {
  const needs = floorIngredients(rite);
  if (needs.length === 0) return true;
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: { resources: true, tags: { select: { quantity: true, tag: { select: { slug: true } } } } },
  });
  if (!room) return false;
  const stacks = new Map(room.tags.map((t) => [t.tag.slug, t.quantity]));
  for (const need of needs) {
    if (need.resources && room.resources < need.resources) return false;
    if (need.tag && (stacks.get(need.tag) ?? 0) < (need.count ?? 1)) return false;
  }
  return true;
}

async function distinctChanters(db, attemptId) {
  const rows = await db.riteChant.findMany({
    where: { attemptId },
    select: { characterId: true, characterName: true },
  });
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.characterId)) seen.set(r.characterId, r.characterName);
  return [...seen].map(([characterId, name]) => ({ characterId, name }));
}

// Re-judge an OPEN attempt. Idempotent: the READY write is guarded on readyAt
// still being null, so a second judge racing this one posts nothing twice.
async function evaluateAttempt(db, attempt) {
  const rite = riteByKey(attempt.riteKey);
  if (!rite || attempt.status !== "OPEN") return false;
  const chanters = await distinctChanters(db, attempt.id);
  if (chanters.length < rite.minChanters) return false;
  if (!(await floorHas(db, rite, attempt.roomId))) return false;

  const now = new Date();
  const { count } = await db.riteAttempt.updateMany({
    where: { id: attempt.id, status: "OPEN", readyAt: null },
    data: { status: "READY", readyAt: now, firesAt: new Date(now.getTime() + GRACE_MS) },
  });
  if (count === 0) return false;

  const room = await db.room.findUnique({
    where: { id: attempt.roomId },
    select: { id: true, name: true, discordThreadId: true },
  });
  if (room?.discordThreadId) {
    await postMessage(room.discordThreadId, ambientLine(TENSE_LINE)).catch((err) =>
      console.error(`Rite tense line failed (${room.name}):`, err.message ?? err),
    );
  }
  if (room?.id) await sceneLineAt(db, { roomId: room.id, text: TENSE_LINE, signed: false });
  return true;
}

// The live attempt for this rite in this room, or a fresh one. READY counts
// as live so a late chanter inside the grace window is still a participant.
async function attemptFor(db, rite, room) {
  const since = new Date(Date.now() - WINDOW_MS);
  const live = await db.riteAttempt.findFirst({
    where: { riteKey: rite.key, roomId: room.id, status: { in: ["OPEN", "READY"] }, openedAt: { gte: since } },
    orderBy: { openedAt: "desc" },
  });
  if (live) return live;
  return db.riteAttempt.create({ data: { riteKey: rite.key, roomId: room.id, roomName: room.name } });
}

async function noteChantImpl(db, { row, character }) {
  if (!row?.content || !character?.id) return;
  const roomId = await roomIdForPlaceKey(db, row.placeKey);
  if (!roomId) return;

  const words = await ensureRiteWords(db);
  const keys = matchRites(row.content, words);
  if (keys.length === 0) return;

  if (!(await chanterReady(db, character.id))) return;

  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, name: true } });
  if (!room) return;

  for (const key of keys) {
    const rite = riteByKey(key);
    if (!rite) continue;
    const attempt = await attemptFor(db, rite, room);
    await db.riteChant.create({
      data: {
        attemptId: attempt.id,
        characterId: character.id,
        characterName: character.name ?? "",
        archiveSeq: row.seq ?? null,
      },
    });
    await evaluateAttempt(db, attempt);
  }
}

// Fire-and-forget. Returns a promise the caller may ignore.
function noteChant(db, args) {
  return noteChantImpl(db, args).catch((err) => console.error("Rite chant hook failed:", err.message ?? err));
}

module.exports = { noteChant, evaluateAttempt, floorHas, distinctChanters, roomIdForPlaceKey, TENSE_LINE, RITES };
