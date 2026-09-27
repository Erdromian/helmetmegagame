// THE GATES ON ATTACK AND INTERCEPT (docs/systemdocs/ATTACK.md §1, INTERCEPT.md §1). Each answers a
// sentence or null — the heldReasonFor shape (db/lib/intercept.js) — so a greyed button, the server
// action and the Discord verb can never disagree about why.
//
// A fight no longer costs the Move (Bascinet, 2026-09-27): the attack description IS the fight's
// declaration, so the old "you've already used your Move" refusal is gone. What stops a fight now is
// the turn lock, combat mode, and the fight rules themselves.

const { movesOpen } = require("./turnGate");
const {
  inCombatMode,
  NEEDS_COMBAT_MODE_ATTACK,
  NEEDS_COMBAT_MODE_INTERCEPT,
  ATTACK_LOCKED,
  INTERCEPT_LOCKED,
  ALREADY_FIGHTING,
  WITHDRAWING_BLOCK,
  DECLINED_HERE,
  AMBUSH_SPRUNG,
} = require("./combatMode");

// Held for withdrawing — the one hold reason this file reads, spelled out rather than required from
// intercept.js so this module stays out of that one's require graph.
const WITHDRAWING = "withdrawing";

// The turn lock (the Move cutoff) shuts starting, joining and laying in wait (Combat Overhaul.docx).
// The other refusals — no turn, not in session — keep the gate's own sentence.
async function lockBlock(db, turn, sentence) {
  const gate = await movesOpen(db, { turn });
  if (gate.ok) return null;
  return gate.reason === "LOCKED" ? sentence : gate.message;
}

// May this character start a fight here, or join one? In this order:
//   1. the turn lock — nothing a player can fix today, so it is said first
//   2. combat mode — required to attack (Combat Mode.docx)
//   3. already in a fight — one at a time
//   4. withdrawing — they called one off, and wait thirty minutes (Bascinet, 2026-09-27)
//   5. they were asked to join a fight HERE this turn and declined (the doc)
// `character` needs id, combatModeSinceTurn, heldUntil and heldReason; `locationId` is where they stand.
async function combatBlock(db, { character, turn, locationId = character?.locationId ?? null, now = new Date() }) {
  if (!turn) return "No turn is open.";
  const locked = await lockBlock(db, turn, ATTACK_LOCKED);
  if (locked) return locked;
  if (!inCombatMode(character)) return NEEDS_COMBAT_MODE_ATTACK;
  const busy = await db.combatParticipant.findFirst({
    where: { characterId: character.id, activeTurnId: turn.id },
    select: { id: true },
  });
  if (busy) return ALREADY_FIGHTING;
  if (character.heldReason === WITHDRAWING && character.heldUntil && new Date(character.heldUntil) > now) {
    return WITHDRAWING_BLOCK;
  }
  if (locationId) {
    const declined = await db.combatParticipant.findFirst({
      where: { characterId: character.id, status: "DECLINED", combat: { turnId: turn.id, locationId } },
      select: { id: true },
    });
    if (declined) return DECLINED_HERE;
  }
  return null;
}

// Setting an Intercept watch. Only an AMBUSH needs combat mode now (Combat Overhaul.docx); a Safe watch
// is a word on the road, not a fight. Both are shut by the lock, and both by an ambush of theirs that has
// sprung and is still being fought: every later catch joins that fight (combat.js#springAmbush), so a
// watch re-set mid-fight would pull in people it was never set for. Only the targets it sprang with are
// added (Bascinet, 2026-09-27). Stopping one never asks (db/lib/verbs/watch.js#stopWatch) — that only
// narrows it.
async function interceptBlock(db, characterId, { mode = "SAFE", turn = null } = {}) {
  const openTurn =
    turn ?? (typeof db.turn?.findFirst === "function" ? await db.turn.findFirst({ where: { status: "OPEN" } }) : null);
  if (openTurn) {
    const locked = await lockBlock(db, openTurn, INTERCEPT_LOCKED);
    if (locked) return locked;
    if (typeof db.combat?.findFirst === "function") {
      const sprung = await db.combat.findFirst({
        where: { turnId: openTurn.id, fromAmbush: true, ambushOwnerId: characterId, endedAt: null },
        select: { id: true },
      });
      if (sprung) return AMBUSH_SPRUNG;
    }
  }
  if (mode !== "AMBUSH") return null;
  return (await combatModeOn(db, characterId)) ? null : NEEDS_COMBAT_MODE_INTERCEPT;
}

async function combatModeOn(db, characterId) {
  return inCombatMode(await db.character.findUnique({ where: { id: characterId }, select: { combatModeSinceTurn: true } }));
}

module.exports = {
  combatBlock,
  interceptBlock,
};
