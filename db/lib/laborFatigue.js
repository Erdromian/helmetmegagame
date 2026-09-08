// The decision behind the Tired -> Exhausted ladder (docs/systemdocs/TAGS.md,
// docs/systemdocs/LABORING.md §4). Two independent triggers drive a character
// through it — a day's Labor (db/lib/moveEffects.js) and a bad night's sleep
// (db/lib/dawnAfflictionPass.js) — and both need to escalate identically:
// first hit grants Tired, a second hit while already Tired escalates straight
// to Exhausted instead of refreshing it. Exhausted degrading back into Tired
// a turn later is the ordinary `expiresInto` chain (TAGS.md §5c) and needs no
// code at all.
//
// Pure and DB-free on purpose, so either caller can compute the target slug
// off tags it already has in hand before doing its own (differently-shaped)
// write.
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");

// heldSlugs: a Set (or anything with .has) of the character's current tag
// slugs. Returns the slug this trigger should grant, or null if they're
// already at the top of the ladder — a second bad night on top of an
// Exhausted from yesterday's Labor has nothing left to escalate to.
function nextLaborFatigueSlug(heldSlugs) {
  if (heldSlugs.has(EXHAUSTED_SLUG)) return null;
  return heldSlugs.has(TIRED_SLUG) ? EXHAUSTED_SLUG : TIRED_SLUG;
}

module.exports = { nextLaborFatigueSlug };
