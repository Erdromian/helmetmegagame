// Which fulfilled Desire claims a GM still has to look at, and the shared core of revoking one
// (docs/systemdocs/DESIRES.md §6, §10). A claim posts its points immediately and waits for GM review
// after — the same pay-first-check-later shape as avatarReview.js: a pure predicate, a matching Prisma
// `where`, kept in sync by hand. Zero requires of db/index.js (db/lib/dm.js convention) — every export
// takes `prisma` as a parameter.

// A refusal this module raises on purpose. The caller recasts ONLY this into a user-facing error —
// a blanket catch would hand a GM the text of a connection failure as though it were a rule.
class DesireRevokeRefused extends Error {}

// A claim is waiting when it is a FULFILLED, catalog-backed Desire with no review stamp yet. Pure,
// and the twin of `desireReviewWhere` below — they must agree. GM free-text awards have templateId
// null and must NEVER enter this queue.
function desireNeedsReview(desire) {
  if (!desire) return false;
  if (desire.status !== "FULFILLED") return false;
  if (!desire.templateId) return false;
  return !desire.reviewedAt;
}

// The rows the Desires lens lists. MUST agree with desireNeedsReview above on what waits. reviewedAt is
// deliberately NOT in this where: the queue shows reviewed rows too, dimmed; it's a sort key, not a filter.
// The one CANCELLED shape it lists is a claim the GM switch rejected on the spot (DESIRES.md §6c), so a GM
// can see what the game turned down; a claim a GM rejected by hand drops out, as it always did.
function desireReviewWhere() {
  return {
    templateId: { not: null },
    OR: [{ status: "FULFILLED" }, { status: "CANCELLED", autoRejectedAt: { not: null } }],
  };
}

// Auto-confirmed and not yet checked by a person (DESIRES.md §6b): the claim
// found its own proof, so it was born with reviewedAt stamped and reviewedBy
// null. It asks nothing of a GM — it is not in the tab count — but a GM may
// still Keep it (filling reviewedBy in) or Reject it.
function desireIsAutoUnchecked(desire) {
  return Boolean(desire?.autoVerifiedAt) && !desire.reviewedBy;
}

// Rejected on the spot because its autoVerify rule found no proof (DESIRES.md §6c). Born CANCELLED
// with reviewedAt stamped, so it asks nothing of a GM and neither Keep nor Reject acts on it.
function desireIsAutoRejected(desire) {
  return Boolean(desire?.autoRejectedAt);
}

// Whether a GM's Keep or Reject may still act on this row: waiting on a
// person, or auto-confirmed with no person behind it yet. Pure twin of
// desireAnswerableWhere below.
function desireAnswerable(desire) {
  if (!desire) return false;
  return !desire.reviewedAt || desireIsAutoUnchecked(desire);
}

function desireAnswerableWhere() {
  return { OR: [{ reviewedAt: null }, { autoVerifiedAt: { not: null }, reviewedBy: null }] };
}

// The transaction body of revoking a GM-fulfilled Desire, shared by the review queue's reject action
// and the Dev Panel's revoke button (web/app/(app)/gm/dev/characters/[characterId]/actions.js).
// Deliberately does NOT touch mood — DESIRE_RELIEF_PER_POINT (docs/systemdocs/MOOD.md) is never reversed here.
async function revokeDesireCore(tx, { characterId, desireId, desire }) {
  const { count } = await tx.desire.updateMany({
    where: { id: desireId, characterId, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED", endedTurnNumber: null },
  });
  // Guarded against a race: only the Revoke that actually flipped the row may take the points back.
  if (count === 0) throw new DesireRevokeRefused("That desire was already revoked.");
  if (desire.status === "FULFILLED") {
    await tx.character.update({
      where: { id: characterId },
      data: { tagPoints: { decrement: desire.points } },
    });
  }
  return desire.status === "FULFILLED" ? desire.points : 0;
}

module.exports = {
  DesireRevokeRefused,
  desireNeedsReview,
  desireReviewWhere,
  desireIsAutoUnchecked,
  desireIsAutoRejected,
  desireAnswerable,
  desireAnswerableWhere,
  revokeDesireCore,
};
