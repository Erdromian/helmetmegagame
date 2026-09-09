// What one of these weighs, for TagChip's hover panel and the GM's tag sheet.
//
// The rule is db/lib/carry.js#rowWeight, restated rather than imported: that
// module requires tagWrites/resourceTransfer/roomStash/roomAnnounce/dm at the
// top, so importing it here would drag prisma and node:fs into a "use client"
// bundle (the failure web/lib/formatTagArmor.js's comment describes).
// actions/MoveThingsDialog.js already inlines the Assets half for the same reason.
// If rowWeight's rule changes, change both.
//
// Three things weigh nothing against the cap and so show no weight at all:
// Assets (a horse carries itself, a house does not move), anything
// untradeable (a graft in your neck is part of you, not cargo), and the whole
// weightless half of the catalog — skills, injuries, statuses, beliefs.

// The number behind the string: what a stack of these weighs in pounds, 0 for
// anything the three rules above exempt. Callers that sort or total rows want
// this rather than the words.
export function tagWeightLbs(tag, quantity = 1) {
  if (!tag?.tradeable) return 0;
  if (tag.category === "Assets") return 0;
  const each = tag.weightLbs ?? 0;
  if (each <= 0) return 0;
  const n = Math.max(1, Number(quantity) || 1);
  // Weights are authored to one decimal, so round the product rather than let
  // float noise show "3.0000000000000004 lb" — same guard carryWeight uses.
  return Math.round(each * n * 100) / 100;
}

export function formatTagWeight(tag, quantity = 1) {
  const total = tagWeightLbs(tag, quantity);
  if (total <= 0) return null;
  const each = tag.weightLbs ?? 0;
  const n = Math.max(1, Number(quantity) || 1);
  if (n === 1) return `${each} lb`;
  return `${each} lb each · ${total} lb`;
}
