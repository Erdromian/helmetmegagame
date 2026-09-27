// LEGACY (docs/systemdocs/ATTACK.md §12). The old one-on-one Attack, kept only so the fights that were
// live on the turn the Combat Overhaul deployed still settle: a "Cancel attack" button already sitting in
// somebody's DMs still works, and a relocation or a death still ends an old row. NOTHING FILES AN ATTACK
// ROW ANY MORE — a fight is db/lib/combat.js. Delete this file, its three callers' lines and the
// ATTACK_HOLD button once a turn has pushed with the overhaul live.
//
// Takes `db` as a parameter; not on the @lifeweb/db barrel.
const { HELD_REASON } = require("./intercept");

const ATTACK_CANCEL_PREFIX = "atk:cancel:";
const ATTACK_CALLED_OFF_DM = "The fight is off. You can move again.";

function liveAttackWhere(characterId, turnId) {
  return {
    turnId,
    cancelledAt: null,
    OR: [{ attackerId: characterId }, { targetCharacterId: characterId }],
  };
}

// Re-derive an old fight's hold from its rows — unless the character is in a NEW fight, whose hold is
// combat.js's to manage and must never be cleared from here.
async function settleHold(db, characterId, turnId) {
  const inNewFight = await db.combatParticipant?.findFirst?.({
    where: { characterId, activeTurnId: turnId },
    select: { id: true },
  });
  if (inNewFight) return { held: true };
  const still = await db.attack.findMany({
    where: liveAttackWhere(characterId, turnId),
    select: { attackerId: true, targetCharacterId: true },
  });
  if (still.length === 0) {
    await db.character.updateMany({
      where: { id: characterId, heldReason: { in: [HELD_REASON.ATTACK, HELD_REASON.ATTACKING] } },
      data: { heldUntil: null, heldById: null, heldReason: null },
    });
    return { held: false };
  }
  const jumped = still.find((row) => row.targetCharacterId === characterId);
  const row = jumped ?? still[0];
  const opponent = jumped ? row.attackerId : row.targetCharacterId;
  await db.character.updateMany({
    where: { id: characterId, heldReason: { in: [HELD_REASON.ATTACK, HELD_REASON.ATTACKING] } },
    data: { heldById: opponent, heldReason: jumped ? HELD_REASON.ATTACK : HELD_REASON.ATTACKING },
  });
  return { held: true };
}

// The old DM button's answer. `where` is the ownership check.
async function cancelAttack(db, { attackerId, targetCharacterId, turnId }) {
  const done = await db.attack.updateMany({
    where: { attackerId, targetCharacterId, turnId, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });
  if (done.count === 0) return { ok: false };
  await settleHold(db, targetCharacterId, turnId);
  await settleHold(db, attackerId, turnId);
  return { ok: true };
}

// A relocation or a death ends any old fight this character is still in.
async function closeFightsFor(db, characterId) {
  if (!characterId) return { closed: 0 };
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { closed: 0 };
  const live = await db.attack.findMany({
    where: liveAttackWhere(characterId, openTurn.id),
    select: { id: true, attackerId: true, targetCharacterId: true },
  });
  if (live.length === 0) return { closed: 0 };
  await db.attack.updateMany({ where: { id: { in: live.map((row) => row.id) } }, data: { cancelledAt: new Date() } });
  const touched = new Set();
  for (const row of live) {
    touched.add(row.attackerId);
    touched.add(row.targetCharacterId);
  }
  for (const id of touched) await settleHold(db, id, openTurn.id);
  return { closed: live.length };
}

module.exports = {
  ATTACK_CANCEL_PREFIX,
  ATTACK_CALLED_OFF_DM,
  cancelAttack,
  closeFightsFor,
};
