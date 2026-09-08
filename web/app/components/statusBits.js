// The carry cap's breakdown, in words. It lives here rather than in
// StatusPanel.js because two sheet layouts want the same string — the status
// panel and /ledger's band — and a second copy would have been two places to
// fix the day the wording changes.

// What holds a carry cap up, as one hover string. Assets are absent on
// purpose: they raise the cap without ever weighing on it (CARRY.md §1).
export function carryCapTitle(carry) {
  const lines = [`Base ${carry.baseWeightCap} lb`];
  // Signed, because a body can now push the cap down as well as up: a Cart
  // reads "+4", Frail reads "−0.1" (CARRY.md §1).
  for (const m of carry.breakdown ?? []) {
    lines.push(`${m.name} ${m.bonus > 0 ? "+" : "−"}${Math.abs(m.bonus)}`);
  }
  lines.push(`= ${carry.weightCap} lb, and ${carry.weightHardCap} lb is the most you could ever hold.`);
  return lines.join("\n");
}
