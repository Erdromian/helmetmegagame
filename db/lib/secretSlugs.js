// Slugs that name SECRET content — the Vampire's and the Demoness's tags, and
// the lists that carry the cult's. Moved out of db/lib/constants.js on
// 2026-09-29: constants.js is imported by client components on nearly every
// page (the public handbook included), and it is CommonJS, so every string in
// it shipped to every browser. "vampire-blood-addict" or "servant-of-
// tzchernobog" in a bundle tells anybody with DevTools which opt-in seats are
// real. NEVER import this file from a client component; if the browser needs
// to know something here, the server works it out and sends the answer.
// Zero requires, like constants.js.

// Mutilate's gate: any ONE shows the button (TORTURE.md §6) — no single "would cut pieces off somebody" tag.
const MUTILATE_GATE_SLUGS = Object.freeze([
  "cruel",
  "torturer",
  "thanati",
  "medical-basic",
  "medical-skilled",
  "medical-expert",
  "butcher",
]);

// Kissing's OTHER gate (KISS.md); incapacity half is db/lib/incapacitation.js. Things that walk/work/
// talk normally but still can't kiss: not-a-person (ghoul/apex-form/servant-of-tzchernobog), bloodlust
// (rage), consent-is-meaningless (broken/broken-enslaved — keeps {desire:dem-kiss-a-broken} a GM call),
// and the phrygian-toxin/poison-tooth tell. Taste/belief tags (Prudish, Eunuch, etc) stay OUT — they lock Desires, not the verb.
const KISS_BLOCKING_SLUGS = Object.freeze([
  "ghoul",
  "rage",
  "servant-of-tzchernobog",
  "apex-form",
  "broken",
  "broken-enslaved",
  "phrygian-toxin",
  "installed-poison-tooth",
]);

// The one "read someone else's sheet" tag (db/lib/inspectVision.js). Mindreading is deliberately NOT here — GM-adjudicated Gambit, not code.
const SEDUCTIVE_DEMONESS_SLUG = "demoness-seductive";

// The Vampire (docs/systemdocs/VAMPIRE.md). VAMPIRE_SLUG is the seat marker
// (db/lib/threats.js); the rest are the two checkpoint-tag tracks db/lib/
// vampirePass.js grants/drops off vampireBloodLevel/vampireHumanity. The
// track's PALE_SLUG is the game's existing `pale` tag and stays in
// constants.js, since nothing about it is secret.
const VAMPIRE_SLUG = "vampire";
const FLUSH_SLUG = "flush";
const SATIATED_SLUG = "satiated";
const THIRSTY_SLUG = "thirsty";
const FAMISHED_SLUG = "famished";
const BLOODCRAZED_SLUG = "bloodcrazed";
// The urgency track, top to bottom. A vampire holds exactly one; the sheet
// draws it as the Blood tile in place of Hunger (web/lib/descriptors.js).
const BLOOD_URGENCY_SLUGS = [FLUSH_SLUG, SATIATED_SLUG, THIRSTY_SLUG, FAMISHED_SLUG, BLOODCRAZED_SLUG];
const BLACK_SCLERA_SLUG = "black-sclera";
const HUMANE_SLUG = "humane";
const ESTRANGED_SLUG = "estranged";
const DISTURBED_SLUG = "disturbed";
const WARPED_SLUG = "warped";
const BESTIAL_SLUG = "bestial";
const WIGHT_SLUG = "wight";

// The Blood Abilities menu and its fallout (VAMPIRE.md §6-9 — design doc
// pages 4-11): db/lib/vampireBloodAbilities.js's `grantsTagSlugs`, Corrupt's
// item cost, Enthral's victim tags, and the ash death (db/lib/vampireDeath.js).
// HEART_SLUG, the organ Corrupt consumes, is an ordinary item and stays in constants.js.
const PILE_OF_ASH_SLUG = "pile-of-ash";
const THRALL_SLUG = "thrall";
const VAMPIRE_BLOOD_ADDICT_SLUG = "vampire-blood-addict";

module.exports = {
  MUTILATE_GATE_SLUGS,
  KISS_BLOCKING_SLUGS,
  SEDUCTIVE_DEMONESS_SLUG,
  VAMPIRE_SLUG,
  FLUSH_SLUG,
  SATIATED_SLUG,
  THIRSTY_SLUG,
  FAMISHED_SLUG,
  BLOODCRAZED_SLUG,
  BLOOD_URGENCY_SLUGS,
  BLACK_SCLERA_SLUG,
  HUMANE_SLUG,
  ESTRANGED_SLUG,
  DISTURBED_SLUG,
  WARPED_SLUG,
  BESTIAL_SLUG,
  WIGHT_SLUG,
  PILE_OF_ASH_SLUG,
  THRALL_SLUG,
  VAMPIRE_BLOOD_ADDICT_SLUG,
};
