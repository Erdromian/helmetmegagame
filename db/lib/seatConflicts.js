// What happens to tags a character already holds when a seat lands on them
// (THREATS.md §3). A seat's incompatible tags are `conflictsWith` edges plus
// anything in the same exclusive group. For a NEW character point-buy never
// offers those; for an EXISTING one, Assign runs this in two sweeps.
//
// SWEEP 1 — unconditional, ignores `conflictsWith`: every ADDICTION goes
// (no seat wants that Desire slot back); a PERSONALITY tag goes only where
// it actually LOCKS one of the seat's own Desires, asked of the real
// evaluator (db/lib/desireGates.js), not a hand-kept list. Both refund their
// points — `pointCost` on a drawback is negative, so the balance MAY go
// negative deliberately (the store's check is `cost > tagPoints`, so debt
// just blocks further buying rather than being quietly forgiven).
//
// SWEEP 2 — pairwise/exclusive rules, at two strengths:
// - the SEAT TAG's own edges always win. The clash is removed and its
//   `pointCost` goes back with it, same as sweep 1 — refunded if it was
//   bought, clawed back if it was a drawback, so neither is farmed.
// - the EXTRA tags a seat hands out (Literacy, Brave, Outsider...) only
//   remove a clash that cost points, refunded; a drawback they clash with is
//   KEPT. Bascinet's call: a Slow cultist stays Slow. A drawback the seat
//   really forbids goes on the seat tag's own `conflictsWith`.
// An exclusive-group clash refunds max(cost, 0) either way.
//
// Sweep 1 runs FIRST so a tag both rules name — Pacifist is a `conflictsWith`
// edge and a `violence` lock — is reported once. Runs inside Assign's
// transaction, AFTER seat tags land, and returns what it did so the DM can
// say so. Never touches equipped state on what it keeps.
const { unionLockClauses, lockedReasonForTemplate } = require("./desireGates");
const { joinList } = require("./roomStash");

const ADDICTION_GROUP = "general-addictions";
const PERSONALITY_GROUP = "general-personality";

// Mirrors web/lib/characterCreation.js#conflictingTag and #exclusiveConflict,
// restated here since that module is ESM for the browser.
function pairwiseConflict(seat, other) {
  return seat.conflictsWithIds.includes(other.id);
}

function exclusiveClash(seat, other) {
  if (!seat.exclusive || !other.exclusive) return false;
  if ((seat.groupId ?? null) !== (other.groupId ?? null)) return false;
  // A requiredTag-linked pair is the one sanctioned stack, same as the creation rule.
  return seat.requiredTagId !== other.id && other.requiredTagId !== seat.id;
}

// Every non-retired Desire the seat's own tags open — a retired template is in nobody's catalog, so a lock on it is in nobody's way.
async function seatDesireTemplates(tx, seatTagIds) {
  if (!seatTagIds.length) return [];
  return tx.desireTemplate.findMany({
    where: { retired: false, requiresAnyTags: { some: { id: { in: seatTagIds } } } },
    // `slug` is here for the `named` lock clause (db/lib/desireShapes.js),
    // which matches on it — without it every named lock reads as no lock and a
    // seat conflict goes unnoticed.
    select: { slug: true, families: true, tier: true },
  });
}

// Would holding this tag lock any of them? Slot-agnostic scope is right here:
// Addictions (the only scoped shape) are taken wholesale above.
function blocksSeatDesires(tag, templates) {
  if (!Array.isArray(tag.desireLocks) || tag.desireLocks.length === 0) return false;
  const pairs = unionLockClauses([tag]);
  return templates.some((template) => lockedReasonForTemplate(template, pairs) !== null);
}

// `seatTagIds` are the seat's own tags (full strength); `grantedTagIds` the
// extras handed out with it (bought clashes only).
async function resolveSeatConflicts(tx, characterId, seatTagIds, grantedTagIds = []) {
  const held = await tx.characterTag.findMany({
    where: { characterId },
    select: {
      tagId: true,
      quantity: true,
      tag: {
        select: {
          id: true,
          name: true,
          pointCost: true,
          exclusive: true,
          groupId: true,
          requiredTagId: true,
          desireLocks: true,
          group: { select: { slug: true } },
          conflictsWith: { select: { id: true } },
        },
      },
    },
  });
  const byId = new Map(
    held.map((row) => [row.tag.id, { ...row.tag, conflictsWithIds: row.tag.conflictsWith.map((c) => c.id) }]),
  );
  const seatIds = new Set(seatTagIds);
  const grantedIds = new Set([...seatTagIds, ...grantedTagIds]);

  const refunded = [];
  const removed = [];
  const kept = [];
  const stripped = [];
  const toDelete = new Set();
  let points = 0;
  let clawedBack = 0;

  // Sweep 1, before sweep 2 so a tag both rules name is only reported once.
  const templates = await seatDesireTemplates(tx, [...grantedIds]);
  for (const other of held) {
    if (grantedIds.has(other.tagId)) continue;
    const tag = byId.get(other.tagId);
    const groupSlug = tag.group?.slug ?? null;
    const strip =
      groupSlug === ADDICTION_GROUP ||
      (groupSlug === PERSONALITY_GROUP && blocksSeatDesires(tag, templates));
    if (!strip) continue;
    toDelete.add(other.tagId);
    const cost = tag.pointCost ?? 0;
    points += cost;
    if (cost < 0) clawedBack += -cost;
    stripped.push({ name: tag.name, points: cost });
  }

  // Sweep 2: the pairwise and exclusive rules. `grantedIds` lists the seat
  // tags first, so a tag both a seat tag and an extra clash with gets the
  // seat's answer.
  const keptIds = new Set();
  for (const grantId of grantedIds) {
    const grant = byId.get(grantId);
    if (!grant) continue;
    const isSeat = seatIds.has(grantId);
    for (const other of held) {
      if (grantedIds.has(other.tagId) || toDelete.has(other.tagId)) continue;
      const tag = byId.get(other.tagId);
      const pairwise = pairwiseConflict(grant, tag);
      const exclusive = exclusiveClash(grant, tag);
      if (!pairwise && !exclusive) continue;
      const cost = tag.pointCost ?? 0;
      if (!exclusive && cost <= 0 && !isSeat) {
        if (!keptIds.has(other.tagId)) kept.push({ name: tag.name, points: cost });
        keptIds.add(other.tagId);
        continue;
      }
      toDelete.add(other.tagId);
      if (!exclusive && cost < 0) {
        // A drawback's points go back the way sweep 1 takes them.
        points += cost;
        clawedBack += -cost;
        stripped.push({ name: tag.name, points: cost });
        continue;
      }
      const back = Math.max(cost, 0);
      points += back;
      (back > 0 ? refunded : removed).push({ name: tag.name, points: back });
    }
  }

  if (toDelete.size) {
    await tx.characterTag.deleteMany({ where: { characterId, tagId: { in: [...toDelete] } } });
  }
  // `!== 0`, not `> 0`: sweep 1's clawback is a negative net.
  if (points !== 0) {
    await tx.character.update({ where: { id: characterId }, data: { tagPoints: { increment: points } } });
  }
  return { refunded, removed, kept, stripped, points, clawedBack };
}

// One line for the DM, or null when nothing happened.
function describeSeatConflicts({ refunded, removed, kept = [], stripped = [], clawedBack = 0 }) {
  const parts = [];
  if (stripped.length) {
    const names = joinList(stripped.map((s) => s.name));
    const taken = clawedBack === 1 ? "1 tag point has" : `${clawedBack} tag points have`;
    parts.push(
      clawedBack > 0
        ? `Your role conflicted with ${names}, so ${taken} been taken back with them.`
        : `Your role conflicted with ${names}.`,
    );
  }
  if (refunded.length) {
    parts.push(
      `Refunded, since the seat forbids them: ${refunded.map((r) => `${r.name} (+${r.points})`).join(", ")}.`,
    );
  }
  if (removed.length) parts.push(`Dropped: ${removed.map((r) => r.name).join(", ")}.`);
  if (kept.length) parts.push(`Kept, drawbacks and all: ${kept.map((r) => r.name).join(", ")}.`);
  return parts.length ? parts.join(" ") : null;
}

module.exports = { resolveSeatConflicts, describeSeatConflicts, blocksSeatDesires };
