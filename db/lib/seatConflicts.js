// What happens to the tags a character already holds when a seat lands on
// them (THREATS.md §3).
//
// A seat's incompatible tags are `conflictsWith` edges on the seat tag, plus
// anything in the same exclusive group (a Belief, for the Thanati). For a NEW
// character the point-buy simply never offers those. For an EXISTING one,
// Assign runs this:
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
// Runs inside Assign's transaction, AFTER the seat tags are on the sheet, and
// returns what it did so the DM can say so. Never touches equipped state on
// what it keeps.

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
  const toDelete = new Set();
  let points = 0;

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
  if (points > 0) {
    await tx.character.update({ where: { id: characterId }, data: { tagPoints: { increment: points } } });
  }
  return { refunded, removed, kept, points };
}

// One line for the DM, or null when nothing happened.
function describeSeatConflicts({ refunded, removed, kept }) {
  const parts = [];
  if (refunded.length) {
    parts.push(
      `Refunded, since the seat forbids them: ${refunded.map((r) => `${r.name} (+${r.points})`).join(", ")}.`,
    );
  }
  if (removed.length) parts.push(`Dropped: ${removed.map((r) => r.name).join(", ")}.`);
  if (kept.length) parts.push(`Kept, drawbacks and all: ${kept.map((r) => r.name).join(", ")}.`);
  return parts.length ? parts.join(" ") : null;
}

module.exports = { resolveSeatConflicts, describeSeatConflicts };
