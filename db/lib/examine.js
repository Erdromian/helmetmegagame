// The ONE readout behind the 🔍 reaction and the Examine button — one shared
// module rather than the twin-drift ARCHITECTURE.md §3 warns about. Pure and
// Prisma-free; can't query the subject's last Desire or doctor's-eye skill
// catalog itself, both come in as arguments. `subject` may be an assembled snapshot (db/lib/examineSnapshot.js).
const { concealedLine, concealedAlias } = require("./concealedIdentity");
const { THANATI_SLUG, THANATI_LEADER_SLUG } = require("./thanati");
const { formatTagRequirement } = require("./formatTagRequirement");
const { formatTagArmor } = require("./formatTagArmor");
const { tagDisplayName } = require("./tagDisplayName");
const { ARMOR_TAG_FIELDS } = require("./armorValue");
const { inspectVision } = require("./inspectVision");
const {
  HEALTH_CATEGORY,
  medicallyVisibleTags,
  seenByBystander,
} = require("./medicalVision");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { turnsLeft, formatTurnsLeft } = require("./turnFormat");
const { revealedTags } = require("./torture");
const { withoutResources, isResourcesRow } = require("./resourceStack");
const { inCombatMode } = require("./combatMode");
const { DISGUISE_STRANGER_FACE, fooledFace } = require("./disguises");

// TAG half split out for db/lib/examineSnapshot.js — name/armour/requirement are RULES, read live even for an old look.
const EXAMINE_TAG_SELECT = {
  name: true,
  slug: true,
  category: true,
  inspectVisibility: true,
  forcedName: true,
  ...CONCEALMENT_TAG_FIELDS,
  requirementGambit: true,
  requirementTurns: true,
  requirementPerTurn: true,
  requirementResources: true,
  requirementItems: true,
  requirementSkills: { select: { id: true, name: true } },
  ...ARMOR_TAG_FIELDS,
};

const EXAMINE_SUBJECT_SELECT = {
  id: true,
  name: true,
  appearance: true,
  concealed: true,
  combatModeSinceTurn: true,
  age: true,
  gender: true,
  updatedAt: true,
  tags: {
    select: {
      equipped: true,
      // ⬢ are one of these rows now, not a column on the character, so the
      // officer's line below counts them off the tag set — which needs the
      // quantity.
      quantity: true,
      tag: { select: EXAMINE_TAG_SELECT },
      expiresTurn: true,
    },
  },
};

// "They look alert." (COMBAT-MODE.md §5). A subject rebuilt from a line carries `alert` frozen off that
// line (db/lib/examineSnapshot.js#rehydrateSubject), which must win over the live column it was spread
// onto; a live subject answers from the column.
function alertOf(subject) {
  return typeof subject?.alert === "boolean" ? subject.alert : inCombatMode(subject);
}

// `viaSkill` marks a row the subject is NOT showing the room, rendered "your diagnosis" so a medic doesn't repeat it as common knowledge.
function describeTag({ characterTag: ct, viaSkill }, openTurnNumber) {
  const bits = [
    ct.tag.category === HEALTH_CATEGORY ? formatTagRequirement(ct.tag) : null,
    formatTagArmor(ct.tag),
    formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurnNumber)),
    viaSkill ? "your diagnosis" : null,
  ].filter(Boolean);
  return {
    name: tagDisplayName(ct.tag),
    slug: ct.tag.slug ?? null,
    detail: bits.length > 0 ? bits.join(" · ") : null,
    viaSkill: Boolean(viaSkill),
  };
}

function thanatiLines(subjectTags = []) {
  const slugs = new Set(subjectTags.map((ct) => ct.tag?.slug));
  if (!slugs.has(THANATI_SLUG)) return [];
  const seat = subjectTags.find((ct) => ct.tag?.slug === (slugs.has(THANATI_LEADER_SLUG) ? THANATI_LEADER_SLUG : THANATI_SLUG));
  return [{ name: seat.tag.name, slug: seat.tag.slug, detail: null, viaSkill: false }];
}

// Built BEFORE normal field logic. Hood hides identity not inventory; no appearance/name/Desire regardless of viewer gates.
function concealedReadout(identity, subject) {
  const seen = (subject.tags ?? []).filter((ct) => seenByBystander(ct.tag, ct, false));
  const isHealth = (ct) => ct.tag.category === HEALTH_CATEGORY;
  return {
    concealed: true,
    name: identity.name,
    avatarPath: identity.avatarPath,
    line: concealedLine(identity.alias),
    appearance: null,
    ailments: seen.filter(isHealth).map((ct) => ct.tag.name),
    // ⬢ are left out. The catalog already hides them (`visible: false` on
    // `resources`, same as `obol`), so nothing reaches here today — this is
    // the belt to that flag's braces, and it is worth keeping because the rule
    // is not really about visibility: a bare "Resources" chip would announce to
    // any passer-by that there is a balance worth taking.
    equipment: withoutResources(seen.filter((ct) => !isHealth(ct))).map((ct) => ct.tag.name),
    tags: [],
    // A hood hides WHO somebody is, never that they are on guard.
    alert: alertOf(subject),
    desire: null,
    // No title either, for the same reason there is no name: an office is part
    // of who somebody is, and the hood is there to stop the room knowing that.
  };
}

// `lastDesire` queried only when `canSeeDesire(viewerTags)` says it will render.
function examineReadout({
  subject,
  viewerTags = [],
  satisfied = new Set(),
  openTurnNumber,
  lastDesire = null,
  wasConcealedAs = null,
  // A Thanati sees whether the subject is one too (THANATI.md); HIDDEN otherwise.
  viewerIsThanati = false,
  // The looker's own Friends entry for the subject, as they can read it today
  // (db/lib/examineRow.js#memoryForLook, already scrambled if they are
  // Concussed): `{ name, roleText, roleGroup, notes }`, or null for a stranger.
  // Everything a look says that the eye cannot see comes from here
  // (docs/systemdocs/MEMORIES.md §6), so a stranger's look carries no role.
  memory = null,
  // Somebody the looker cannot put a name to (docs/systemdocs/STRANGERS.md).
  // Their face and everything visible reads as normal, but under their alias,
  // "Young Man", and with their face fetched by the line it was said on
  // (`strangerSeq`) rather than by an id.
  stranger = false,
  strangerSeq = null,
  // What the looker makes of a Disguise Kit's name (./disguises.js#disguiseRead), for a line said in
  // one: `{ known, fooledAs, fooledLook }`, or null for anything else. Unknown reads as a stranger's
  // blank face under their alias; fooled shows the face of the person they take the wearer for, by the
  // line, when the wearer looks like them. A disguise the looker learned brings its own entry as
  // `memory`, which is how its job reads.
  disguise = null,
}) {
  const identity = presentedIdentity(subject, {
    forcedName: forcedNameFrom(subject.tags, subject),
    concealment: concealmentFrom(subject.tags),
  });
  // MOMENT answer (🔍/📸): a since-unmasked subject would be exposed retroactively — caller-passed alias wins outright.
  if (wasConcealedAs && !identity.concealed) {
    return concealedReadout({ ...identity, name: wasConcealedAs, alias: wasConcealedAs }, subject);
  }
  // `concealed` is false for a forced name (Apex Form) — being something else, not hiding.
  if (identity.concealed) return concealedReadout(identity, subject);

  // A Disguise Kit is a false name over an unhidden face — the NAMED tag comes off here too, or a wanted man could wear it and still show as Wanted.
  const identityVisible = !identity.forced;

  const { canSeeDesire } = inspectVision(viewerTags);
  // A false name is somebody else as far as the room can tell, so the looker's
  // memory of the person underneath has nothing to attach to. The caller
  // already withholds it; this is the belt to that brace.
  const disguised = identity.forced && disguise ? disguise : null;
  const known = identityVisible || (disguised?.known && !disguised.fooledAs) ? memory : null;
  const unnamed = stranger && identityVisible && !known;
  const lineFace = strangerSeq ? `/api/avatar/line/${strangerSeq}` : null;
  return {
    concealed: false,
    name: unnamed || (disguised && !disguised.known) ? concealedAlias(subject) : identity.name,
    avatarPath: unnamed
      ? lineFace
      : disguised && !disguised.known
        ? DISGUISE_STRANGER_FACE
        : fooledFace(disguised, subject)
          ? (lineFace ?? identity.avatarPath)
          : identity.avatarPath,
    line: null,
    appearance: subject.appearance || null,
    alert: alertOf(subject),
    ailments: [],
    equipment: [],
    tags: [
      // Same rule as the bystander readout above, and likewise a no-op while
      // the catalog hides ⬢. It stays because it is what stops a reader seeing
      // a "Resources" chip at all the day somebody makes the stack visible
      // again — what somebody is holding is nobody else's to count.
      ...medicallyVisibleTags(subject.tags, satisfied, identityVisible)
        .filter((entry) => !isResourcesRow(entry.characterTag))
        .map((entry) => describeTag(entry, openTurnNumber)),
      ...(viewerIsThanati ? thanatiLines(subject.tags) : []),
    ],
    // ABSENT, never "hidden" — a viewer without sight and nothing-to-read look the same.
    desire: canSeeDesire ? { text: lastDesire?.text ?? null, points: lastDesire?.points ?? null } : null,
    // The title is what the LOOKER remembers, not what the subject holds: a
    // role is not something anybody can see. Never `subject.roleTitle` — a raw
    // Character row carries the truth, and the truth is exactly what a stranger
    // must not read. An entry the player rewrote reads as they rewrote it.
    //
    // Still no ⬢ figure, for anybody. That one used to ride on sharing a
    // faction — a balance with that faction's officers — and with factions
    // gone there is no reader entitled to it. A GM reads it off the desk.
    roleTitle: known?.roleText || null,
    // Which of the six estates to paint that title in, or null for one that
    // wears no colour — the same answer the feed paints a name with.
    roleGroup: known?.roleText ? (known.roleGroup ?? null) : null,
    // The rest of the entry: the name the looker knows them by and whatever
    // they wrote down. Null for a stranger.
    memory: known ? { name: known.name || null, notes: known.notes || null } : null,
  };
}

function canSeeDesire(viewerTags = []) {
  return inspectVision(viewerTags).canSeeDesire;
}

// True name and face, on purpose — reads Character.name/avatar directly
// rather than through presentedIdentity. Wounds/statuses are db/lib/torture.js's business, not this file's.
function tortureReadout({ subject, openTurnNumber }) {
  return {
    name: subject.name,
    avatarPath: `/api/avatar/${subject.id}?v=${subject.updatedAt?.getTime?.() ?? 0}`,
    tags: revealedTags(subject.tags).map((ct) => describeTag({ characterTag: ct, viaSkill: false }, openTurnNumber)),
  };
}

module.exports = { EXAMINE_TAG_SELECT, EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire, tortureReadout };
