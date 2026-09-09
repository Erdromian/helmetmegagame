const HUNGER_SLUG = "hungry";
const HUNGERLESS_SLUG = "hungerless";
// Doubles the per-turn upkeep to 2 ⬢ (db/lib/hungerPass.js). The magnitude of
// the charge is hardcoded by slug the same way hungerless/ate-meal exemptions
// are — there is no generic upkeep field on Tag.
const FAST_METABOLISM_SLUG = "fast-metabolism";
const DYING_SLUG = "dying";
// Vaporised outright — the Thanati rites and the bomb (db/lib/characterDeath.js
// `gib`). Replaces every tag the character owned, and no corpse is minted, so
// there is nothing left to loot, carry, butcher or bury.
const GIBBED_SLUG = "gibbed";
const NOBILITY_SLUG = "nobility";
const COURTIER_SLUG = "courtier";
const ATE_MEAL_SLUG = "ate-meal";
const MORTUS_SLUG = "mortus";
const DRAINED_SLUG = "drained";
// The two-stage labor-fatigue ladder — see db/lib/laborFatigue.js.
const TIRED_SLUG = "tired";
const EXHAUSTED_SLUG = "exhausted";
const LABORING_BASIC_SLUG = "laboring-basic";
const LABORING_SKILLED_SLUG = "laboring-skilled";
const LABORING_FARMING_SLUG = "laboring-farming";
const LABORING_HUNTING_SLUG = "laboring-hunting";
const LABORING_FISHING_SLUG = "laboring-fishing";
const CATATONIC_SLUG = "catatonic-afk";
// Over a carry cap (db/lib/carry.js). Granted and cleared by settleCarry,
// never by a player; read by the travel gate in db/lib/locationTravel.js.
const OVERBURDENED_SLUG = "overburdened";

// Stepping lightly, read on a gate crossing (db/lib/locationMove.js
// #announceGateCrossing). It takes the announcement down one step rather than
// silencing every gate: an unmanned gate says nothing at all, a MANNED one
// falls back to what a passer-by saw instead of the name off your papers.
const STEALTH_SLUG = "stealth";

// Corpses (docs/systemdocs/CORPSES.md). CORPSE_GROUP_SLUG is the whole
// discriminator on the catalog side — the three monster corpses live in that
// group, and so does every "{name}'s Corpse" a death writes. BUTCHER_SLUG
// gates the Butcher button; ENGRAVE_RESOURCE_COST is what carving a stone for
// someone whose body you can't find costs.
const CORPSE_GROUP_SLUG = "items-corpse";
const BUTCHER_SLUG = "butcher";

// The two standing kits (db/lib/equipmentReach.js). Neither is worn: each is
// satisfied by HOLDING it or by standing where one is already set up, which is
// what makes a Sanctuary operating theatre and a Factory floor worth walking
// to. Workshop Equipment gates smithing and building; Surgical Equipment is
// +1 on a medical Gambit.
const WORKSHOP_EQUIPMENT_SLUG = "workshop-equipment";
// Packaging Equipment is the third standing kit, alongside the two above:
// having it in reach is what turns the Package button on. Unlike those two it
// is not craftable — there are exactly two in the world, one on the Godard
// Factory's Logistics Room floor and one in the Merchant's Cargo Bay.
const PACKAGING_EQUIPMENT_SLUG = "packaging-equipment";
// What one crate holds, and how long the line printed on its side may be.
// 150 lb is the number the Squeeze economy is balanced on: at 17 lb a cube
// that is 8 to a crate, 68 lb each, and a Horse-and-Cart takes 6 of them.
// See docs/systemdocs/FACTORY.md.
const PACKAGE_MAX_LBS = 150;
// The weight cap does not bound the weightless — obols are 0 lb and stackable
// without a ceiling — and a crate's consumesInto repeats a slug per unit.
const PACKAGE_MAX_UNITS = 200;
const PACKAGE_LABEL_MAX = 120;

// The Raven Draught carries one sentence (docs/systemdocs/BIRD.md §8a). Shared
// so the textarea and the server's own clamp cannot drift into a player losing
// the tail of what they typed with no error.
const WHISPER_MAX = 400;
const SURGICAL_EQUIPMENT_SLUG = "surgical-equipment";
// The fourth standing kit: +1 on a torture roll for anyone working within
// reach of it (db/lib/torture.js). One sits in the Order Chambers from turn
// one; the rest are crafted by a Torturer out of a knife, a hatchet and a
// cudgel. TORTURER_SLUG is the tag that shows the Torture button at all.
const TORTURING_EQUIPMENT_SLUG = "torturing-equipment";
const TORTURER_SLUG = "torturer";

// Mutilate's gate: any ONE of the three shows the button (docs/systemdocs/
// TORTURE.md §6). Three rather than one because there is no single "would cut
// pieces off somebody" tag — Cruel is the personality, Torturer is the trade,
// and the Thanati are the ones who want the pieces.
const MUTILATE_GATE_SLUGS = Object.freeze(["cruel", "torturer", "thanati"]);

// Kissing's OTHER gate (docs/systemdocs/KISS.md). The incapacity half lives in
// db/lib/incapacitation.js, where every ACT-blocking state already removes the
// KISS capability; this is the short, hand-written list of things that are not
// an incapacity at all — a character here walks, works and talks normally and
// still cannot kiss or be kissed.
//
// Hand-written and deliberately shorter than it could be, the same posture
// FINISHABLE_SLUGS takes: every addition should cost somebody a keystroke.
// Taste, belief and appearance stay OUT of it — Prudish, Eunuch, Pacifist,
// Saint, Ugly and Unhygienic all keep the button, because the game's own
// convention is that a build locks DESIRES rather than removing a verb
// (Eunuch and Prudish already lock the `romance` family in docs/tags.yaml).
//
//   ghoul / apex-form / servant-of-tzchernobog
//                       not a person any more. A pallid corpse, a thing with
//                       hands like rakes, and one "unable to perform anything
//                       other than violence".
//   rage                consumed by bloodlust; already locks every Desire but
//                       cruelty.
//   broken /            the Demoness's Break leaves a walking empty shell.
//   broken-enslaved     It can press Accept, which is exactly why it is here:
//                       the consent would not mean anything. This is what
//                       keeps {desire:dem-kiss-a-broken} a GM's adjudication
//                       rather than a button.
//   phrygian-toxin      "Blood is dripping from your mouth."
//   installed-poison-tooth
//                       a nerve agent wired into a tooth, released by biting
//                       down. See KISS.md for the tell this refusal leaks.
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

// Holding one puts a Sound Trumpet button on your own Character page, and
// sounding it is heard across the Location graph (db/lib/trumpet.js). Held,
// not equipped: you pick a trumpet up to blow it.
const TRUMPET_SLUG = "trumpet";

// The horse eats: 1 ⬢ every turn it is in your inventory, charged by
// db/lib/horseUpkeepPass.js. HELD, not equipped — deliberately unlike
// everything else the horse does (db/lib/mounts.js gates the free move on
// `equipped`), so stowing it indoors is not a way to skip the bill.
const HORSE_SLUG = "horse";
const HORSE_UPKEEP_COST = 1;
const HUMAN_FLESH_SLUG = "human-flesh";
const ENGRAVE_RESOURCE_COST = 4;
// How many turns a person's corpse stays fresh before it turns. Monster
// corpses never rot — only a person stinks.
const CORPSE_ROT_TURNS = 3;

// The Teaching tree (docs/systemdocs/LESSONS.md). Holding Teaching lets you
// run a lesson; Lecturing widens one Routine to LECTURE_CAPACITY learners;
// a Drill Instructor's students succeed on a 4 when the skill's group is
// FIGHTING_GROUP_SLUG. Thresholds are the die's face after the modifier.
const TEACHING_SLUG = "teaching";
const LECTURING_SLUG = "teaching-lecturing";
const DRILL_INSTRUCTOR_SLUG = "teaching-drill-instructor";
const FIGHTING_GROUP_SLUG = "skills-fighting";
const LECTURE_CAPACITY = 3;
const LESSON_THRESHOLD = 5;
const DRILL_THRESHOLD = 4;

// Confession (docs/systemdocs/CONFESSION.md). Holding CHAPLAIN_SLUG is what
// lets you hear one — the Bishop holds it too, which is why the gate is the
// tag and never the role. Same threshold as a lesson, on the modified die.
const CHAPLAIN_SLUG = "chaplain";
const CONFESSION_THRESHOLD = 5;

// The one "read someone else's sheet" tag — see db/lib/inspectVision.js, the
// only reader. This is the Demoness Seductive; Mindreading, the Succubus
// Draught's grant, is deliberately NOT here, because it reads a Desire on a
// Gambit after a conversation, which no code adjudicates. (Empathetic, a
// general-category tag that worked the same way, was retired 2026-09-05.)
const SEDUCTIVE_DEMONESS_SLUG = "demoness-seductive";

// The "ate a fine or lavish meal this turn" marker a noble needs to sleep
// easy. Granted by consumesInto, consumed by the mood pass — never by time.
const DINED_SLUG = "dined";
// What a drawback-triggered ride leaves you as — db/lib/locationTravel.js.
const VOMITING_SLUG = "vomiting";
// Drawback slugs read by their scripted mechanics.
const LAZY_SLUG = "lazy";
const GUILT_RIDDEN_SLUG = "guilt-ridden";
const INSOMNIAC_SLUG = "insomniac";
const MOTION_SICKNESS_SLUG = "motion-sickness";
// Lightweight / Iron Liver / Steady's slugs live only in
// web/lib/consumeGrants.js — that file ships to the client, so it keeps its
// own copies rather than importing from here.
const DEBTOR_SLUG = "debtor";
// The phobias, Brave, Pale, Rough Camper and friends are read by slug inside
// db/lib/mood.js's multiplier table rather than exported from here.

// A ZONE slug, not a tag: the Fortress holds the Lifeweb tower and the PA
// system, so two separate rules gate on standing there.
const FORTRESS_SLUG = "fortress";

// #leave — the GM-only channel departure alerts and catatonic deaths post to.
// A channel ID, hardcoded for the same reason db/lib/roleIds.js hardcodes its
// role IDs: Bascinet runs in a single guild, the ID is not a secret, and a
// missing env var here would fail silently — a leave nobody hears about.
// Lives in db/ rather than the bot because the turn engine's side-effect
// thunk (db/index.js) posts death alerts to it too.
const LEAVE_ANNOUNCE_CHANNEL_ID = "1540014692926361651";

module.exports = {
  FORTRESS_SLUG,
  LEAVE_ANNOUNCE_CHANNEL_ID,
  HUNGER_SLUG,
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  DYING_SLUG,
  GIBBED_SLUG,
  NOBILITY_SLUG,
  COURTIER_SLUG,
  ATE_MEAL_SLUG,
  MORTUS_SLUG,
  DRAINED_SLUG,
  TIRED_SLUG,
  EXHAUSTED_SLUG,
  LABORING_BASIC_SLUG,
  LABORING_SKILLED_SLUG,
  LABORING_FARMING_SLUG,
  LABORING_HUNTING_SLUG,
  LABORING_FISHING_SLUG,
  CATATONIC_SLUG,
  OVERBURDENED_SLUG,
  STEALTH_SLUG,
  CORPSE_GROUP_SLUG,
  BUTCHER_SLUG,
  WORKSHOP_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_MAX_UNITS,
  PACKAGE_LABEL_MAX,
  WHISPER_MAX,
  SURGICAL_EQUIPMENT_SLUG,
  TORTURING_EQUIPMENT_SLUG,
  TORTURER_SLUG,
  MUTILATE_GATE_SLUGS,
  KISS_BLOCKING_SLUGS,
  TRUMPET_SLUG,
  HORSE_SLUG,
  HORSE_UPKEEP_COST,
  HUMAN_FLESH_SLUG,
  ENGRAVE_RESOURCE_COST,
  CORPSE_ROT_TURNS,
  TEACHING_SLUG,
  LECTURING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  LECTURE_CAPACITY,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
  CHAPLAIN_SLUG,
  CONFESSION_THRESHOLD,
  SEDUCTIVE_DEMONESS_SLUG,
  DINED_SLUG,
  VOMITING_SLUG,
  LAZY_SLUG,
  GUILT_RIDDEN_SLUG,
  INSOMNIAC_SLUG,
  MOTION_SICKNESS_SLUG,
  DEBTOR_SLUG,
};
