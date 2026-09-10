// What happens to the tags a character already holds when a seat lands on
// them (THREATS.md §3).
//
// A seat's incompatible tags are `conflictsWith` edges on the seat tag, plus
// anything in the same exclusive group (a Belief, for the Thanati). For a NEW
// character the point-buy simply never offers those. For an EXISTING one,
// Assign runs this, in two sweeps.
//
// SWEEP 1 — what the seat CLEARS OUT OF ITS OWN WAY. Unconditional, and the
// half that does not care about `conflictsWith` at all:
//
//   * every ADDICTION goes. A cultist whose bottom Desire slot is spoken for
//     by the next drink is not doing the Dark Lord's work, and no seat wants
//     that slot back on a per-seat basis — so this is the whole group, for
//     every antagonist seat.
//   * a PERSONALITY tag goes only where it actually LOCKS one of the seat's
//     own Desires. Asked of the real evaluator (db/lib/desireGates.js), not
//     a hand-kept list: Pacifist locks `violence` and the Thanati want a
//     churchman dead, so it goes; Kleptomaniac locks `wealth`, which no
//     Thanati Desire is in, so it stays. A seat that opens no Desires of its
//     own therefore strips no Personality tags, only Addictions.
//
// Both take their points back with them. `pointCost` on a drawback is
// negative, so the same increment that refunds a purchase charges for a flaw
// — the player banked 4 for Alcoholic and the seat has just deleted
// Alcoholic. The balance MAY go negative, deliberately: the store's check is
// `cost > tagPoints`, so a character in debt simply buys nothing until they
// have worked it off, which is the honest arithmetic rather than a floor that
// quietly forgives the difference.
//
// SWEEP 2 — the older pairwise/exclusive rules, unchanged:
//
//   * a pairwise conflict with a POSITIVE cost is removed and its points go
//     back to Character.tagPoints — the player paid for something the seat
//     now forbids, and the seat should not cost them the purchase;
//   * a pairwise conflict with a zero or negative cost is GRANDFATHERED —
//     kept, because a drawback refunded would be a drawback farmed, and a
//     free tag refunded is nothing;
//   * an exclusive-group clash is always removed, refunding max(cost, 0):
//     two Beliefs cannot be held at once, whatever they cost.
//
// Sweep 1 runs FIRST so the two can never disagree about the same tag.
// Pacifist is both a `conflictsWith` edge on the seat tag AND a `violence`
// lock; taken by sweep 2 first it would be reported as "kept, drawbacks and
// all" in the same DM that says it was stripped.
//
// Runs inside Assign's transaction, AFTER the seat tags are on the sheet, and
// returns what it did so the DM can say so. Never touches equipped state on
// what it keeps.
const { unionLockClauses, lockedReasonForTemplate } = require("./desireGates");
const { joinList } = require("./roomStash");

const ADDICTION_GROUP = "general-addictions";
const PERSONALITY_GROUP = "general-personality";

// The two checks mirror web/lib/characterCreation.js#conflictingTag and
// #exclusiveConflict, restated here because that module is ESM for the
// browser and this one runs inside a db transaction.
function pairwiseConflict(seat, other) {
  return seat.conflictsWithIds.includes(other.id);
}

function exclusiveClash(seat, other) {
  if (!seat.exclusive || !other.exclusive) return false;
  if ((seat.groupId ?? null) !== (other.groupId ?? null)) return false;
  // A requiredTag-linked pair (Fundamentalist on Post-Christian) is the one
  // sanctioned stack, same as the creation rule.
  return seat.requiredTagId !== other.id && other.requiredTagId !== seat.id;
}

// Every non-retired Desire the seat's own tags open. A retired template is
// excluded for the same reason db:prune-tags stops counting one as a blocker:
// it is in nobody's catalog, so a lock on it is in nobody's way.
async function seatDesireTemplates(tx, seatTagIds) {
  if (!seatTagIds.length) return [];
  return tx.desireTemplate.findMany({
    where: { retired: false, requiresAnyTags: { some: { id: { in: seatTagIds } } } },
    select: { families: true, tier: true },
  });
}

// Would holding this tag lock any of them? The slot-agnostic scope is the
// right one here: an Addiction's `slot: bottom` clause is the only scoped
// shape in the catalog and Addictions are taken wholesale above, so nothing
// reaches this that needs a slot to answer.
function blocksSeatDesires(tag, templates) {
  if (!Array.isArray(tag.desireLocks) || tag.desireLocks.length === 0) return false;
  const pairs = unionLockClauses([tag]);
  return templates.some((template) => lockedReasonForTemplate(template, pairs) !== null);
}

async function resolveSeatConflicts(tx, characterId, seatTagIds) {
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

  const refunded = [];
  const removed = [];
  const kept = [];
  const stripped = [];
  const toDelete = new Set();
  let points = 0;
  let clawedBack = 0;

  // Sweep 1: Addictions outright, Personality tags that lock the seat's own
  // Desires. Before sweep 2, so a tag both rules name is only reported once.
  const templates = await seatDesireTemplates(tx, [...seatIds]);
  for (const other of held) {
    if (seatIds.has(other.tagId)) continue;
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

  // Sweep 2: the pairwise and exclusive rules.
  for (const seatId of seatIds) {
    const seat = byId.get(seatId);
    if (!seat) continue;
    for (const other of held) {
      if (seatIds.has(other.tagId) || toDelete.has(other.tagId)) continue;
      const tag = byId.get(other.tagId);
      const pairwise = pairwiseConflict(seat, tag);
      const exclusive = exclusiveClash(seat, tag);
      if (!pairwise && !exclusive) continue;
      const cost = tag.pointCost ?? 0;
      if (exclusive || cost > 0) {
        toDelete.add(other.tagId);
        const back = Math.max(cost, 0);
        points += back;
        (back > 0 ? refunded : removed).push({ name: tag.name, points: back });
      } else {
        kept.push({ name: tag.name, points: cost });
      }
    }
  }

  if (toDelete.size) {
    await tx.characterTag.deleteMany({ where: { characterId, tagId: { in: [...toDelete] } } });
  }
  // `!== 0` rather than `> 0`: sweep 1's clawback is a negative net, and a
  // seat that strips exactly as much as it refunds writes nothing.
  if (points !== 0) {
    await tx.character.update({ where: { id: characterId }, data: { tagPoints: { increment: points } } });
  }
  return { refunded, removed, kept, stripped, points, clawedBack };
}

// One line for the DM, or null when nothing happened.
function describeSeatConflicts({ refunded, removed, kept, stripped = [], clawedBack = 0 }) {
  const parts = [];
  // Sweep 1 first, because it is the sentence that costs the player points.
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
