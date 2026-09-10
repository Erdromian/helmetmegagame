// ATTACKING SOMEBODY (docs/systemdocs/ATTACK.md).
//
// You press it on somebody standing with you and neither of you goes anywhere:
// both of you are held where you are until the turn ends and a GM reads what
// you filed. That is the whole of it. Nothing here RESOLVES a fight — a fight
// is a Gambit and a GM's ruling, the posture docs/systemdocs/COMBAT.md sets
// and this does not touch.
//
// The hold is Intercept's hold, not a second one: db/lib/intercept.js owns
// Character.heldUntil and every gate that reads it, and this module only
// writes it. An Ambush that fires files one of these too, so an ambush and an
// attack are one thing in one queue.
//
// This module takes `db` as a parameter and is deliberately NOT on the
// @lifeweb/db barrel — the db/lib/dm.js convention. Require it by path.
//
// IT SENDS NOTHING. Like fireWatches, it returns DM descriptors and the caller
// sends them after the transaction commits (ARCHITECTURE.md §5).
const { fightingSkill, bandRank, FIGHTING_TAG_FIELDS } = require("./fightingSkill");
const { turnEndsAt } = require("./turnClock");
const { SAFE_HOLD_MS, HELD_REASON, seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { DM_KIND } = require("./dmKinds");
const { DM_ACTION, dmAction } = require("./dmActions");

// ─── The strength gate ──────────────────────────────────────────────────────

// How far above you somebody may be before the button refuses. The one tunable
// in this file.
//
// BANDS, not points, and that is load-bearing: floor:/cap: tags move the band
// index AFTER the points are summed (db/lib/fightingSkill.js), so a bound
// Expert still scores 55 and only their band knows they are Pitiful. Comparing
// scores would let a tied-up champion refuse to be attacked. Bands are also
// the unit the game already speaks, and they are ten points wide with every
// rung dead centre, so two bands is two tiers.
//
// Why the gate exists at all: without it anybody at all can freeze anybody at
// all for a whole day, and a bum stops the Tribunal Ordinator by walking up to
// them. It is not meant to stop a hard fight, only a hopeless one.
const MAX_BAND_GAP = 2;

// Bascinet's words, verbatim.
const TOO_STRONG = "This opponent is too strong to attack.";

// The Tag columns anything asking this question must select. Miss one and the
// gate silently reads everybody as Weak at that surface only — the discipline
// FIGHTING_TAG_FIELDS states for itself.
const ATTACK_TAG_SELECT = {
  where: { quantity: { gt: 0 } },
  select: { equipped: true, tag: { select: { ...FIGHTING_TAG_FIELDS, slug: true } } },
};

// The better of somebody's two halves. An archer and a swordsman are each
// judged on what they are actually good at, which is the only reading that
// does not make a marksman a free target for anybody with a knife.
function bestBandRank(characterTags) {
  const resolved = fightingSkill(characterTags ?? []);
  return Math.max(bandRank(resolved.melee.band.key), bandRank(resolved.ranged.band.key));
}

// PURE, and the whole gate. Returns the refusal sentence or null. Both
// arguments are CharacterTag rows selected with ATTACK_TAG_SELECT.
//
// Only the gap upward is checked. Attacking somebody far below you is not
// something the game has any business refusing — it is a bad thing to do, not
// an impossible one, and the GM reads it either way.
function attackRefusal(attackerTags, targetTags) {
  const gap = bestBandRank(targetTags) - bestBandRank(attackerTags);
  return gap > MAX_BAND_GAP ? TOO_STRONG : null;
}

// ─── The hold ───────────────────────────────────────────────────────────────

// An attack runs to the end of the turn, so the turn advance frees everybody
// for free and nothing sweeps. Never SHORTER than a Safe intercept, though:
// turnEndsAt is the boundary after the turn STARTED, so a turn the cron has
// not closed on time would otherwise put the deadline in the past and hold
// nobody at all. The db/lib/intercept.js#fireWatches reasoning, verbatim.
function attackHoldUntil(openTurn, now = new Date()) {
  const boundary = turnEndsAt(openTurn);
  const floor = new Date(now.getTime() + SAFE_HOLD_MS);
  return boundary && boundary > floor ? boundary : floor;
}

// Everyone still in a live fight with this character, either end of it. The
// one query the settle below runs, and the reason one person backing out of a
// three-way brawl does not unpick the whole thing.
function liveAttackWhere(characterId, turnId) {
  return {
    turnId,
    cancelledAt: null,
    OR: [{ attackerId: characterId }, { targetCharacterId: characterId }],
  };
}

// Re-derive one person's hold from the fights they are actually still in.
// Called for every side of every attack that ends, however it ends.
//
// It CLEARS or it RE-POINTS — never just clears — and the re-point is the
// half that matters. heldById names one opponent, and a brawl has several: A
// and C both attack B, then A breaks off. B stays held, correctly, but
// heldById still says A, who is now in no fight at all. Leave that stale and
// the next thing that clears "everyone A is holding" — A walking away, A dying
// — frees B out of C's fight. So the pointer is moved to somebody who is
// really still there.
//
// Known and small: a two-minute Safe intercept hold that an attack overwrote
// is not restored when the attack is called off. Tracking that would want a
// second column for two minutes of a stranger's afternoon, which is a worse
// trade than the gap.
async function settleHold(db, characterId, turnId) {
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
  // Being jumped outranks doing the jumping: somebody in both positions at
  // once should read the sentence about the fight they did not choose.
  const jumped = still.find((row) => row.targetCharacterId === characterId);
  const row = jumped ?? still[0];
  const opponent = jumped ? row.attackerId : row.targetCharacterId;
  await db.character.updateMany({
    where: { id: characterId, heldReason: { in: [HELD_REASON.ATTACK, HELD_REASON.ATTACKING] } },
    data: { heldById: opponent, heldReason: jumped ? HELD_REASON.ATTACK : HELD_REASON.ATTACKING },
  });
  return { held: true };
}

// ─── Filing one ─────────────────────────────────────────────────────────────

// `attacker` and `target` are rows selected with intercept.js#IDENTITY_SELECT.
// The strength gate is the CALLER's business, not this function's: an ambush
// files one of these and is deliberately not gated (you set a watch blind).
//
// Returns { ok, already, dms }. A unique violation is not an error — it is the
// rule working, and it means these two are already in it this turn.
async function fileAttack(db, { attacker, target, openTurn, fromAmbush = false, locationId = null }) {
  const now = new Date();
  const until = attackHoldUntil(openTurn, now);

  try {
    await db.attack.create({
      data: {
        attackerId: attacker.id,
        targetCharacterId: target.id,
        turnId: openTurn.id,
        fromAmbush: Boolean(fromAmbush),
        locationId: locationId ?? target.locationId ?? null,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, already: true, dms: [] };
    throw err;
  }

  // BOTH sides, each held BY THE OTHER, and each with its OWN reason. You do
  // not start a fight and stroll off — but the person who was jumped and the
  // person who did the jumping must not read the same sentence off every shut
  // way, and heldReason is the only thing that can tell them apart.
  //
  // Conditional on the clock, the fireWatches rule: a hold already running
  // longer than this one is left exactly where it is.
  for (const [who, by, reason] of [
    [target.id, attacker.id, HELD_REASON.ATTACK],
    [attacker.id, target.id, HELD_REASON.ATTACKING],
  ]) {
    await db.character.updateMany({
      where: { id: who, OR: [{ heldUntil: null }, { heldUntil: { lt: until } }] },
      data: { heldUntil: until, heldById: by, heldReason: reason },
    });
  }

  return { ok: true, already: false, until, dms: attackDms({ attacker, target, fromAmbush }) };
}

// ─── Calling it off ─────────────────────────────────────────────────────────

// Only the attacker may. `where` is the ownership check, the releaseHeldBy
// posture — there is no second lookup to disagree with it.
//
// The row is stamped, never deleted: breaking off is final for the turn, and a
// deleted row would hand the unique back and let somebody attack the same
// person all afternoon.
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

// Every fight this character is in, on either side, ended at once — and both
// sides of each of them settled. Two callers, and they are the two ways a
// fight stops being a fight without anybody choosing:
//
//   * a RELOCATION (db/lib/locationMove.js) — a GM's teleport, a Bulk Move, a
//     staged Relocate to, a rite. You cannot keep a hand on somebody from the
//     next zone. Walking off never reaches it, because a held character cannot
//     walk.
//   * a DEATH (db/lib/characterDeath.js). Both ends: a dead attacker is
//     holding nobody, and a dead target is not being held. Leaving the far
//     half live would strand the survivor — settleHold would keep finding that
//     row and refuse to let go of them for the rest of the turn.
//
// db/lib/intercept.js#releaseHeldBy deliberately cannot do this itself: it
// works off heldById, and only the row knows whether either side is still in
// another fight.
//
// Looks the open turn up itself, the cancelWatchOnMove shape — the callers of
// that function have no turn in hand.
async function closeFightsFor(db, characterId) {
  if (!characterId) return { closed: 0 };
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { closed: 0 };

  const live = await db.attack.findMany({
    where: liveAttackWhere(characterId, openTurn.id),
    select: { id: true, attackerId: true, targetCharacterId: true },
  });
  if (live.length === 0) return { closed: 0 };

  await db.attack.updateMany({
    where: { id: { in: live.map((row) => row.id) } },
    data: { cancelledAt: new Date() },
  });
  const touched = new Set();
  for (const row of live) {
    touched.add(row.attackerId);
    touched.add(row.targetCharacterId);
  }
  for (const id of touched) await settleHold(db, id, openTurn.id);
  return { closed: live.length };
}

// Every live fight this character started, for the sheet's cancel list.
async function attacksBy(db, attackerId, turnId) {
  if (!turnId) return [];
  const rows = await db.attack.findMany({
    where: { attackerId, turnId, cancelledAt: null },
    include: { targetCharacter: { select: IDENTITY_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  // By the face the room saw, never the row — the intercept.js rule, and it
  // matters as much here: attacking a hooded stranger must not unmask them.
  return rows.map((row) => ({ id: row.targetCharacter.id, name: seenAs(identityOf(row.targetCharacter)) }));
}

// ─── The lines ──────────────────────────────────────────────────────────────

const ATTACK_CANCEL_PREFIX = "atk:cancel:";

function attackCancelRow(targetId, label) {
  return [
    {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `${ATTACK_CANCEL_PREFIX}${targetId}`, label: label.slice(0, 80) }],
    },
  ];
}

const ATTACK_CALLED_OFF_DM = "The fight is off. You can move again.";

// An ambush already says its own thing on the way in (fireWatches), so it
// carries no second victim line — only the attacker's, which is where the
// Cancel button lives.
function attackDms({ attacker, target, fromAmbush }) {
  const dms = [];
  const attackerSeen = seenAs(identityOf(attacker));
  const targetSeen = seenAs(identityOf(target));

  if (!fromAmbush && target.discordUserId) {
    dms.push({
      discordUserId: target.discordUserId,
      content: `${attackerSeen} attacked you. You can't move until the end of the turn. Make a Gambit declaring your intent!`,
      kind: DM_KIND.NOTICE,
    });
  }
  if (attacker.discordUserId) {
    dms.push({
      discordUserId: attacker.discordUserId,
      content: fromAmbush
        ? `You successfully ambushed ${targetSeen}. Neither of you can move until the turn ends.`
        : `You attacked ${targetSeen}. Neither of you can move until the turn ends.`,
      kind: DM_KIND.NOTICE,
      components: attackCancelRow(target.id, "Cancel attack"),
      meta: dmAction(DM_ACTION.ATTACK_HOLD, target.id),
    });
  }
  return dms;
}

module.exports = {
  MAX_BAND_GAP,
  TOO_STRONG,
  ATTACK_TAG_SELECT,
  ATTACK_CANCEL_PREFIX,
  ATTACK_CALLED_OFF_DM,
  bestBandRank,
  attackRefusal,
  fileAttack,
  cancelAttack,
  closeFightsFor,
  attacksBy,
};
