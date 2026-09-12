// The Appraisal skill's per-viewer projection: whether a tag object grows a
// `valueObols` key. Each loader that ships tag data to a browser (see
// referenceData.js#getVisibleTags, character/page.js, pointBuyCatalog.js,
// documents/page.js) calls this once it knows whether ITS viewer holds
// Appraisal — TagDetails.js has no hooks and no viewer context of its own
// (it must keep rendering on the server), so the gate lives here instead of
// at render time.
//
// Three states, deliberately: the key is ABSENT for a non-appraiser (no row
// draws — a loader nobody updated leaks nothing), `null` for an appraiser
// looking at a tag with no sellablePrice, and a number otherwise. No
// requires, so this stays safe inside a "use client" bundle.
export function appraise(tag, canAppraise) {
  if (!tag) return tag;
  // Always drops the raw `sellablePrice` column, appraiser or not — a payload
  // that shipped it unconditionally and only hid the row in the UI would
  // still leak the number to anyone reading dev tools, which defeats the
  // point of gating this behind a skill at all.
  const { sellablePrice, ...rest } = tag;
  if (!canAppraise) return rest;
  return { ...rest, valueObols: sellablePrice ?? null };
}
