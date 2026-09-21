// The Appraisal skill's per-viewer projection: whether a tag object grows the two price keys. Each
// loader shipping tag data to a browser calls this once it knows whether ITS viewer holds Appraisal
// — TagDetails.js has no viewer context of its own, so the gate lives here, not at render time.
//   valueObols  what the Depot PAYS for one (Tag.sellablePrice) — the sell price
//   buyObols    what the Depot CHARGES for one (Tag.depotPrice) — the buy price
// Each has three states: key ABSENT for a non-appraiser, `null` for no price, a number otherwise.
// `valueObols` keeps its old name (it was the only number this readout had), so nothing that reads
// it changes; `buyObols` is the new half.
export function appraise(tag, canAppraise) {
  if (!tag) return tag;
  // Always drops both raw columns — leaving either in the payload would leak it via dev tools.
  const { sellablePrice, depotPrice, ...rest } = tag;
  if (!canAppraise) return rest;
  return { ...rest, valueObols: sellablePrice ?? null, buyObols: depotPrice ?? null };
}
