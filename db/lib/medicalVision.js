// Who is qualified to treat what, and — because of that — who can SEE what.
// 🔍-inspecting someone shows you the ailments YOU could treat as routine,
// even ones nobody else can see. Same posture as inspectVision.js: no Prisma
// import, required by subpath from both bot/ and web/. web/lib/healRequests.js
// re-exports the two ancestry helpers so its callers keep importing from
// where they always did.

// Tag.parentTagId is the replacing tier chain (Medical Basic -> Skilled ->
// Expert). A higher tier must satisfy a requirement written against a lower
// one, or a surgeon couldn't do a nurse's job. `tags` is the flat catalog as
// [{ id, parentTagId }]; result maps a tag id to itself plus every ancestor.
// Cycle-guarded, since nothing in the schema stops a chain looping back.
function buildSkillAncestry(tags) {
  const parentOf = new Map((tags ?? []).map((t) => [t.id, t.parentTagId ?? null]));
  const ancestry = new Map();
  for (const id of parentOf.keys()) {
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    ancestry.set(id, seen);
  }
  return ancestry;
}

// Every skill the character counts as having: what they hold, plus everything
// those tags are an upgrade of.
function satisfiedSkillIds(heldTagIds, ancestry) {
  const satisfied = new Set();
  for (const id of heldTagIds ?? []) {
    for (const ancestorId of ancestry.get(id) ?? [id]) satisfied.add(ancestorId);
  }
  return satisfied;
}

// Health category's display name, as stored in Tag.category (syncTags writes
// the display name, not the YAML slug).
const HEALTH_CATEGORY = "Health";

// Can a bystander see this tag on this character at all? The plain vision
// gate, before medical reasoning layers exceptions on top. Five states
// (Tag.inspectVisibility): never, always, only while equipped, only while
// the subject is going under their own name, or only while their face shows.
// NAMED is a reputation rather than a thing — a hood or false name takes it
// off the read. FACE is a thing ON the face (Disfigured, a missing eye): a
// hood covers it, and a Disguise Kit's false name does not.
// `identityVisible` defaults TRUE so no existing caller changes behaviour by
// not passing it. `faceVisible` defaults to `identityVisible`, so a caller
// that says "this subject is hooded" hides the face with it, without having to
// know FACE exists — only examine.js's forced-name path (a name hidden, a face
// not) passes the two apart. `tag` needs inspectVisibility; `characterTag`
// needs equipped.
function seenByBystander(tag, characterTag, identityVisible = true, faceVisible = identityVisible) {
  if (tag?.inspectVisibility === "ALWAYS") return true;
  if (tag?.inspectVisibility === "NAMED") return Boolean(identityVisible);
  if (tag?.inspectVisibility === "FACE") return Boolean(faceVisible);
  if (tag?.inspectVisibility === "WORN") return Boolean(characterTag?.equipped);
  return false;
}

// "What is plainly on this person, whatever they carry?" — the context line on
// a Search readout (db/lib/search.js#onShowTags): ALWAYS, plus FACE while the
// face shows. Not seenByBystander, which also counts an equipped WORN item and
// a NAMED reputation — the search lists the first as cargo and never the
// second. Here rather than in search.js for the reason given below.
function onShowWhateverCarried(tag, faceVisible = true) {
  if (tag?.inspectVisibility === "ALWAYS") return true;
  if (tag?.inspectVisibility === "FACE") return Boolean(faceVisible);
  return false;
}

// "Could this be palmed before a Search?" (docs/systemdocs/SEARCH.md §2) —
// HIDDEN or WORN, never ALWAYS, NAMED or FACE. It sits beside seenByBystander
// because it is the same column read for a related question, and putting it in search.js
// would be the call-site enum comparison TAGS.md §5 forbids. It is genuinely a
// SECOND predicate rather than a wrapper: an equipped WORN item IS seen by a
// bystander and is still hideable from a search, so seenByBystander cannot
// answer this.
//
// Note the direction, because it is the opposite of the one above and the trap
// is real. A VISION gate fails closed by HIDING. This one is an allowlist, so
// it fails closed by REVEALING — a new TagVisibility value arrives searchable
// and unhideable, quietly. That is the safer of the two wrong answers, but it
// is a wrong answer, so a new enum value has to come back here. FACE did, and
// unhideable is right for it: nobody palms their own face.
function hideableFromSearch(tag) {
  return tag?.inspectVisibility === "HIDDEN" || tag?.inspectVisibility === "WORN";
}

// "Could this character treat that affliction without rolling for it?" A
// Gambit is by definition NOT routine, so a tier-7 affliction stays hidden
// even from an Expert who could attempt it. A tag with no requirementSkills
// is nobody's professional business. `tag` needs requirementSkills (at least
// { id }) and requirementGambit.
function canTreatAsRoutine(tag, satisfied) {
  const skills = tag?.requirementSkills ?? [];
  if (skills.length === 0 || tag.requirementGambit) return false;
  return skills.every((skill) => satisfied.has(skill.id));
}

// What an inspector sees of a subject's tags, and why. Returns rows to show
// as { characterTag, viaSkill } — `viaSkill` true when shown ONLY because the
// inspector is qualified, so callers can avoid repeating it as common
// knowledge. `satisfied` is satisfiedSkillIds() for the INSPECTOR;
// `identityVisible` and `faceVisible` pass straight through to seenByBystander.
function medicallyVisibleTags(characterTags = [], satisfied = new Set(), identityVisible = true, faceVisible = identityVisible) {
  const out = [];
  for (const ct of characterTags) {
    const tag = ct?.tag;
    if (!tag) continue;
    if (seenByBystander(tag, ct, identityVisible, faceVisible)) {
      out.push({ characterTag: ct, viaSkill: false });
      continue;
    }
    // Only afflictions — a doctor's training says nothing about whether someone is secretly a Demoness.
    if (tag.category !== HEALTH_CATEGORY) continue;
    if (canTreatAsRoutine(tag, satisfied)) out.push({ characterTag: ct, viaSkill: true });
  }
  return out;
}

// The Medical skill the Heal verb is gated on, and the Saint's Perform Miracle
// (docs/tags.yaml `saint:`): two free instant cures a turn, capped at the cure
// ladder's Moderate rung — Dead Simple, Simple, or Moderate (TAGS.md §5c). No
// ⬢, no Move, no Medical training needed; its own count on the AuditLog.
// Lifted out of web/lib/healRequests.js, which re-exports them, so the Discord
// bot's Miracle and Actions menu read the same rules.
const HEAL_SKILL_SLUG = "medical-basic";
const SAINT_SLUG = "saint";
const MIRACLE_PER_TURN = 2;

// A Health tag without the catalog's `healable` flag is tier 0 of the cure ladder (docs/systemdocs/TAGS.md §5c) — untreatable.
function isHealable(tag) {
  return Boolean(tag?.healable);
}

// A healable tag qualifies for a miracle when it sits at tier 1–3 on the cure
// ladder (Dead Simple, Simple, Moderate — TAGS.md §5c). The ⬢ column is what
// tells the three rungs apart from the ones above them: tier 1 costs 1 ⬢, tiers
// 2 and 3 cost 2 ⬢, and every rung from Severe up costs 4 ⬢ or more. So
// requirementResources ≤ 2 is the whole ceiling — Grievous Wound (7 ⬢) and the
// surgical rungs are excluded automatically. A Gambit rung is refused outright
// too — a miracle is instant, not a roll.
function isMiracleable(tag) {
  if (!isHealable(tag)) return false;
  if (tag?.requirementGambit) return false;
  const cost = tag?.requirementResources ?? 0;
  return cost > 0 && cost <= 2;
}

module.exports = {
  HEAL_SKILL_SLUG,
  SAINT_SLUG,
  MIRACLE_PER_TURN,
  isHealable,
  isMiracleable,
  HEALTH_CATEGORY,
  buildSkillAncestry,
  satisfiedSkillIds,
  canTreatAsRoutine,
  seenByBystander,
  onShowWhateverCarried,
  hideableFromSearch,
  medicallyVisibleTags,
};
