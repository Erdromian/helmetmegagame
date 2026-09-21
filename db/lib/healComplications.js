// What a botched medical Gambit leaves behind. Hardcoded the way
// db/lib/hiddenCures.js is hardcoded — a small, curated, reviewable table
// rather than something derived, because "what does a failed surgery
// plausibly turn into" is an authoring question, not an arithmetic one.
//
// Keyed by the treated tag's own Health GROUP, then by the complication
// rung db/lib/healGambit.js#healOutcome picked off the roll's margin. Every
// slug named here must exist and be `healable` (or at least a real Health
// tag) in docs/tags.yaml — db/test/healComplications.test.js asserts it, so
// a typo fails a test instead of silently granting nothing.
//
// health-mind's four entries are exactly web/lib/healRequests.js's own
// INFLICTABLE_SLUGS (concussed, shell-shocked, mute, blind) — the same
// curated "plausible to happen TO someone" list HARM_CHARACTER already
// trusts, reused rather than re-judged. health-maiming only names the two
// rungs where something new and lasting is warranted; a lighter miss on a
// maiming attempt falls through to health-wounds, same as health-minor and
// health-recovery (neither is authored at all — nothing in health-recovery
// is ever offered to Heal, and a botched minor complaint reads fine as a
// mundane wound).
const FALLBACK_GROUP = "health-wounds";

const TABLE = Object.freeze({
  "health-wounds": Object.freeze({
    1: ["bruised", "minor-bleeding", "dislocated-shoulder"],
    2: ["sprained-ankle", "burned", "frostbite", "minor-wound"],
    3: ["deep-wound", "broken-bone", "cracked-ribs", "blunt-force-trauma"],
    4: ["severe-bleeding", "arterial-bleed", "severe-burns", "broken-jaw", "mangled-hand"],
    5: ["crush-injury", "grievous-wound"],
    6: ["punctured-lung", "gut-wound"],
  }),
  "health-infection": Object.freeze({
    2: ["infected"],
    4: ["festering", "lockjaw"],
    5: ["feverish", "necrosis"],
    6: ["sepsis", "dying"],
  }),
  "health-illness": Object.freeze({
    2: ["hypothermia"],
    3: ["poisoned", "heatstroke", "cave-fever"],
    4: ["rot-lung", "pox", "choking"],
    5: ["stuffed"],
    6: ["appendicitis", "envenomated", "consumptive", "exploded-chest", "phrygian-toxin"],
  }),
  "health-maiming": Object.freeze({
    4: ["missing-fingers"],
    6: ["disfigured", "crippled-leg"],
  }),
  "health-mind": Object.freeze({
    3: ["concussed"],
    4: ["shell-shocked"],
    5: ["mute"],
    6: ["blind"],
  }),
});

// Every slug this table can ever grant, for the test that checks each one
// against the live tag catalog.
function allComplicationSlugs() {
  const out = new Set();
  for (const byRung of Object.values(TABLE)) {
    for (const slugs of Object.values(byRung)) for (const slug of slugs) out.add(slug);
  }
  return [...out];
}

// Walks the treated group down from `rung` to 1 looking for a populated row,
// then does the same over the fallback group. Never returns null for a rung
// in [1, 6] — health-wounds' rung 1 is always populated, and every caller
// clamps into that range first (db/lib/healGambit.js#healOutcome).
function pickComplication(groupSlug, rung) {
  const clamped = Math.min(6, Math.max(1, Math.round(rung ?? 1)));
  for (const group of [groupSlug, FALLBACK_GROUP]) {
    const byRung = TABLE[group];
    if (!byRung) continue;
    for (let r = clamped; r >= 1; r--) {
      const options = byRung[r];
      if (options?.length) return options[Math.floor(Math.random() * options.length)];
    }
  }
  return null;
}

module.exports = { TABLE, pickComplication, allComplicationSlugs };
