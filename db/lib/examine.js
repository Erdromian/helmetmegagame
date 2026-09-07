// What one character sees when they look at another: the ONE readout behind
// both the 🔍 reaction in Discord (bot/src/events/messageReactionAdd.js) and
// the Examine button on /character.
//
// It exists because those two used to be one hand-written embed builder inside
// the reaction handler, and the web button would have been a second copy of it
// — the twin drift ARCHITECTURE.md §3 warns about, on rules (the doctor's eye,
// the concealed read, Inscrutable) where a divergence is invisible until a
// player notices one surface telling them something the other won't.
//
// Pure and Prisma-free, same posture as inspectVision.js and presence.js: it
// takes rows the caller already loaded and returns plain data. Rendering is
// the caller's job — the bot builds an EmbedBuilder out of this, the web app
// builds JSX — because an embed field and a <dl> row are not the same shape and
// pretending they are is how a shared module grows a `format:` argument.
//
// The two queries it cannot do for you, being Prisma-free, are the subject's
// last fulfilled Desire and the skill catalog behind the doctor's eye. Both
// come in as arguments; see EXAMINE_SUBJECT_SELECT for the rest.
const { concealedLine } = require("./concealedIdentity");
const { inRealFaction } = require("./factionConstants");
const { formatTagRequirement } = require("./formatTagRequirement");
const { formatTagArmor } = require("./formatTagArmor");
const { ARMOR_TAG_FIELDS } = require("./armorValue");
const { inspectVision, isInscrutable } = require("./inspectVision");
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

// The subject `select` both callers load. Kept here beside the reader so a
// field this file starts reading can't be missing at one call site — the
// failure mode is a silently absent embed field, not an error.
const EXAMINE_SUBJECT_SELECT = {
  id: true,
  name: true,
  appearance: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  roleTitle: true,
  resources: true,
  factionId: true,
  faction: { select: { name: true, slug: true } },
  tags: {
    select: {
      equipped: true,
      tag: {
        select: {
          name: true,
          category: true,
          inspectVisibility: true,
          forcedName: true,
          ...CONCEALMENT_TAG_FIELDS,
          // The six formatTagRequirement() reads. It renders no ingredient
          // line rather than throwing when requirementItems is missing, which
          // is the quiet failure this shared select exists to prevent — and
          // without requirementPerTurn a `turnsCost: 1/N` cure showed as a
          // flat "1 turn" instead of its real fraction (review fix, M2).
          requirementGambit: true,
          requirementTurns: true,
          requirementPerTurn: true,
          requirementResources: true,
          requirementItems: true,
          requirementSkills: { select: { id: true, name: true } },
          ...ARMOR_TAG_FIELDS,
        },
      },
      expiresTurn: true,
    },
  },
};

// A tag as one line of the readout. The treat cost prints for a Health tag
// only — a bystander has no business learning what forging a worn sword takes
// — and `viaSkill` marks the rows the subject is NOT showing the room, which
// the caller renders as "your diagnosis" so a medic knows not to repeat it
// aloud as common knowledge.
function describeTag({ characterTag: ct, viaSkill }, openTurnNumber) {
  const bits = [
    ct.tag.category === HEALTH_CATEGORY ? formatTagRequirement(ct.tag) : null,
    // Armour is public in a way a treat cost is not: a breastplate is a thing
    // you can see somebody wearing, and how good it looks is exactly what a
    // person sizing them up would take in.
    formatTagArmor(ct.tag),
    formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurnNumber)),
    viaSkill ? "your diagnosis" : null,
  ].filter(Boolean);
  return {
    name: ct.tag.name,
    detail: bits.length > 0 ? bits.join(" · ") : null,
    viaSkill: Boolean(viaSkill),
  };
}

// The concealed read: deliberately impoverished, and built BEFORE any of the
// normal field logic so nothing can leak through it. The hood hides the
// identity, not the inventory — a drawn dagger still shows, by the same
// seenByBystander gate the ordinary read uses — but there is no appearance, no
// name, no faction and no Desire, whatever the viewer's own gates are. The
// doctor's eye does not apply either: a surgeon reading a hood is still just
// reading a hood.
function concealedReadout(identity, subject) {
  const seen = (subject.tags ?? []).filter((ct) => seenByBystander(ct.tag, ct));
  // Tag.category stores the display name, not the YAML slug.
  const isHealth = (ct) => ct.tag.category === HEALTH_CATEGORY;
  return {
    concealed: true,
    name: identity.name,
    avatarPath: identity.avatarPath,
    line: concealedLine(identity.alias),
    appearance: null,
    ailments: seen.filter(isHealth).map((ct) => ct.tag.name),
    equipment: seen.filter((ct) => !isHealth(ct)).map((ct) => ct.tag.name),
    tags: [],
    desire: null,
    roleTitle: null,
    resources: null,
  };
}

// `subject` is a row loaded with EXAMINE_SUBJECT_SELECT.
// `viewerTags` is the LOOKER's CharacterTag rows (for Seductive), `satisfied`
// their satisfiedSkillIds() (for the doctor's eye), and `lastDesire` the
// subject's most recent FULFILLED Desire or null — the caller queries it only
// when `canSeeDesire(viewerTags)` says the field will be rendered at all.
function examineReadout({
  subject,
  viewerTags = [],
  satisfied = new Set(),
  openTurnNumber,
  lastDesire = null,
  viewerFactionId = null,
  viewerIsOfficer = false,
  wasConcealedAs = null,
}) {
  const identity = presentedIdentity(subject, {
    forcedName: forcedNameFrom(subject.tags),
    concealment: concealmentFrom(subject.tags),
  });
  // A reader answering for a MOMENT rather than for now — the 🔍 and 📸
  // reactions, which both hang off a message that was posted at some point in
  // the past. Concealment is derived from live equipment
  // (db/lib/presentedIdentity.js), so a subject who has since taken the hood
  // off would otherwise be unmasked retroactively by a reaction on a message
  // the room saw a masked person write. The camera made that permanent — the
  // print would be filed under a real name nobody present ever heard — so the
  // caller passes the alias the room actually saw and it wins outright.
  if (wasConcealedAs && !identity.concealed) {
    return concealedReadout({ ...identity, name: wasConcealedAs, alias: wasConcealedAs }, subject);
  }
  // `concealed` is false for a forced name (Apex Form): a Beast is not hiding,
  // it is being something else, so it gets the ordinary read under its own
  // presented name. presentedIdentity.js carries that distinction.
  if (identity.concealed) return concealedReadout(identity, subject);

  const { canSeeDesire } = inspectVision(viewerTags);
  return {
    concealed: false,
    name: identity.name,
    avatarPath: identity.avatarPath,
    line: null,
    appearance: subject.appearance || null,
    ailments: [],
    equipment: [],
    // Poison detection (M4) does NOT live here: medicallyVisibleTags only
    // ever returns a row that's either bystander-visible equipment or a
    // Health-category affliction, and a poisoned stack is neither (it's a
    // food/drink row, category `items`) — the marker this readout used to
    // compute was dead on arrival, since no row it could ever attach to was
    // reachable in the first place. The real, reachable detection surfaces
    // are the sheet (character/page.js) and /play's own (thingRows.js) —
    // both read the CHARACTER'S OWN held tags directly, which is the design
    // (own-sheet detection, not examining someone else's pockets).
    tags: medicallyVisibleTags(subject.tags, satisfied).map((entry) =>
      describeTag(entry, openTurnNumber),
    ),
    // An unseen field is ABSENT, never a "hidden" placeholder — and nothing
    // tells the subject they were read. Once the viewer holds the sight, an
    // empty result reads exactly as Inscrutable's block does, so a reader
    // cannot tell "they're guarded" from "there's nothing there".
    desire: canSeeDesire
      ? { text: isInscrutable(subject.tags) ? null : (lastDesire?.text ?? null), points: lastDesire?.points ?? null }
      : null,
    // Role is same-faction knowledge, not officer authority (FACTIONS.md §4a)
    // — the same rule the Who's here? list reads by.
    roleTitle: inRealFaction(subject) && viewerFactionId === subject.factionId ? (subject.roleTitle ?? null) : null,
    // A Leader/Treasurer of the subject's OWN faction sees their ⬢, same as
    // the /faction roster column. The caller resolves the seat, since that is
    // a query and this file holds no prisma.
    resources: inRealFaction(subject) && viewerIsOfficer ? subject.resources : null,
  };
}

// Whether the caller needs to run the Desire query at all.
function canSeeDesire(viewerTags = []) {
  return inspectVision(viewerTags).canSeeDesire;
}

// What a BROKEN person gives up (docs/systemdocs/TORTURE.md). None of the
// gates above apply: no doctor's eye, no bystander filter, no hood. The true
// name and the true face, on purpose — breaking somebody is exactly the thing
// that gets past a false one — so this reads Character.name and the own
// avatar rather than going through presentedIdentity. What it leaves out is
// db/lib/torture.js's business (wounds and statuses), not this file's.
// `subject` is a row loaded with EXAMINE_SUBJECT_SELECT.
function tortureReadout({ subject, openTurnNumber }) {
  return {
    name: subject.name,
    avatarPath: `/api/avatar/${subject.id}?v=${subject.updatedAt?.getTime?.() ?? 0}`,
    tags: revealedTags(subject.tags).map((ct) => describeTag({ characterTag: ct, viaSkill: false }, openTurnNumber)),
  };
}

module.exports = { EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire, tortureReadout };
