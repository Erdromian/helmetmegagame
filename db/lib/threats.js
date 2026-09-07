// The threat catalog: every antagonist seat in the game, in one place.
//
// A threat is three things at once, and which ones an entry carries is what
// tells them apart:
//
//   optIn      a checkbox in the lobby and on the wizard's Antagonists step.
//              Consent data — a player says which seats they are open to being
//              handed. Either `true`, or `{ name, whitelist }`: `name` is the
//              PUBLIC name the checkbox wears when it differs from the seat's
//              ("Succubus" for the Demoness, so the 18+ nature is plain;
//              "Cultist" for a Thanati, so the word never appears), and
//              `whitelist: true` locks the box to holders of the Whitelist
//              Discord role — the same role that gates leader seats.
//   assign     a real seat a GM can hand to an existing character. Grants the
//              tags and points named here and DMs the seat's Role charter.
//   spawn      the same seat, handed to somebody with no character: a whole
//              new one, offered over DM and accepted with a button.
//
// HALF THE OPT-INS ARE DECOYS. They carry `optIn` and nothing else, so ticking
// one tells a GM about consent without telling the player which seats are
// real. The hand-run briefs (Brigands, Monsters, the Sympathizer) are not
// entries at all — they live in SECRETS.md, since nothing here reads prose.
//
// A seat's INCOMPATIBLE TAGS are not listed here: they are `conflictsWith`
// edges on the seat tag itself in docs/tags.yaml, so the store and Add Tag
// refuse them for a holder without knowing what a threat is. Assign resolves
// what a character already holds (db/lib/seatConflicts.js).
//
// Kept in code rather than a table for the same reason as db/lib/roleIds.js:
// fixed values that can never differ per environment, so a row would only add
// a join and a way to drift.
//
// Alphabetized by `name` so catalog order *is* display order and nothing
// downstream has to sort. That ordering is also what hides the real seats
// among the decoys on the wizard.
//
// No prose lives here. What a seated player reads is the Role's own charter
// from docs/roles.yaml (intro + description), sent by the seat DM in
// web/app/(app)/gm/dev/threatActions.js. The hand-run briefs — Brigands,
// Monsters, the Sympathizer — are in SECRETS.md.

const THREATS = [
  {
    slug: "archon",
    name: "Archon",
    optIn: true,
  },
  // The Bastard is a figure in the Court's story, and the box is whitelisted
  // because the name alone promises a seat at the top of it.
  {
    slug: "bastard",
    name: "Bastard",
    optIn: { whitelist: true },
  },
  {
    slug: "demoness",
    name: "Demoness",
    // "Succubus" on the checkbox: the word says 18+ and lewd out loud, which
    // is the consent the box is there to collect. Whitelisted for the same
    // reason.
    optIn: { name: "Succubus", whitelist: true },
    assignable: true,
    // How the roster finds who holds this seat. Derived from the tag rather
    // than stored on the character, so a GM granting it by hand from
    // /gm/dev/characters/[id] still shows up.
    seatTagSlug: "demoness",
    zone: "Fortress",
    // Rough Camper: she sleeps where she hunts (docs/systemdocs/FEAR.md).
    assign: { tagPoints: 7, tagSlugs: ["demoness", "hungerless", "beautiful", "rough-camper"] },
    spawn: {
      gender: "WOMAN",
      // null: the seat has no default role, so the GM picks one when offering.
      roleSlug: null,
      resources: 3,
      tagPoints: 7,
      // parseStartingTag syntax (db/lib/startingTags.js) — "x4" is a stack
      // count, not four entries, which a name-set lookup would collapse.
      tagSlugs: ["dagger", "obol x4"],
    },
  },
  {
    slug: "judge",
    name: "Judge",
    optIn: true,
    assignable: true,
    seatTagSlug: "judge",
    zone: "Town, or Cave",
    // Nothing out there frightens him, and little else does (FEAR.md).
    assign: { tagPoints: 17, tagSlugs: ["cruel", "judge", "rough-camper", "outsider", "brave"] },
    spawn: {
      gender: "MAN",
      roleSlug: null,
      resources: 3,
      tagPoints: 17,
      tagSlugs: ["neoclassic-duelista", "light-infantry-armour", "obol x4"],
    },
  },
  {
    slug: "obsessed",
    name: "Obsessed",
    optIn: true,
  },
  {
    slug: "schemer",
    name: "Schemer",
    optIn: true,
  },
  {
    slug: "skinless",
    name: "Skinless",
    optIn: true,
  },
  // THE THANATI. Two real seats behind two public names — "Cultist Leader"
  // and "Cultist" — so the word Thanati is never on a checkbox. Both grant the
  // `thanati` Belief (docs/tags.yaml), which is what makes a holder one; the
  // leader wears the `thanati-leader` tag on top, which is how the roster tells
  // the two seats apart. Points and kits are first drafts for Bascinet to tune.
  {
    slug: "thanati",
    name: "Thanati",
    optIn: { name: "Cultist" },
    assignable: true,
    seatTagSlug: "thanati",
    zone: "Anywhere",
    assign: { tagPoints: 5, tagSlugs: ["thanati"] },
    spawn: {
      gender: "NEUTRAL",
      roleSlug: null,
      resources: 3,
      tagPoints: 5,
      tagSlugs: ["obol x4"],
    },
  },
  {
    slug: "thanati-leader",
    name: "Thanati Leader",
    optIn: { name: "Cultist Leader", whitelist: true },
    assignable: true,
    seatTagSlug: "thanati-leader",
    zone: "Anywhere",
    assign: { tagPoints: 10, tagSlugs: ["thanati", "thanati-leader"] },
    spawn: {
      gender: "NEUTRAL",
      roleSlug: null,
      resources: 3,
      tagPoints: 10,
      tagSlugs: ["thanati-mask", "obol x4"],
    },
  },
  // THE TRIBUNAL. Both carry `spawn.locationSlug`, which nothing else does:
  // the seat knows where its own shuttle puts down, so a GM offering one does
  // not have to remember. Black Pines is the corner the map already describes
  // as dense enough that "sound does not carry, neither do shouts", and it
  // borders both crossings into the Marshes.
  {
    slug: "tribunal-ordinator",
    name: "Tribunal Ordinator",
    optIn: { whitelist: true },
    assignable: true,
    seatTagSlug: "ordinator-insignia",
    zone: "Black Hills",
    assign: {
      tagPoints: 10,
      // Mirrors the tribunal-ordinator Role's starting_tags (docs/roles.yaml).
      // Assign and Spawn are separate lists over the same seat, so a kit change
      // has to land in both or a GM's two buttons hand out different soldiers.
      tagSlugs: [
        "ordinator-insignia",
        "cataphract-armor",
        "tribunal-ordinator-helmet",
        "nuclear-datacard",
        "elevator-key",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
      ],
    },
    spawn: {
      gender: "NEUTRAL",
      roleSlug: "tribunal-ordinator",
      locationSlug: "hills-black-pines",
      resources: 8,
      tagPoints: 10,
    },
  },
  {
    slug: "tribune",
    name: "Tribune",
    optIn: true,
    assignable: true,
    seatTagSlug: "tribunal-helmet",
    zone: "Black Hills",
    assign: {
      tagPoints: 10,
      // Mirrors the tribune Role's starting_tags (docs/roles.yaml) — see the
      // Ordinator's note above on why both lists have to move together.
      tagSlugs: [
        "tribunal-helmet",
        "heavy-infantry-armor",
        "c4",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
      ],
    },
    spawn: {
      gender: "NEUTRAL",
      roleSlug: "tribune",
      locationSlug: "hills-black-pines",
      resources: 8,
      tagPoints: 10,
    },
  },
  // Retired from the live game (docs/archive/windlander.yaml); the box stays as
  // a decoy.
  {
    slug: "windlander",
    name: "Windlander",
    optIn: true,
  },
];

// The seats that arrive by shuttle. Spawning one tells the whole map that
// something came down — db/lib/threatSpawn.js. A set rather than a flag on the
// entries so a future Tribunal seat joins by adding one line here.
const SHUTTLE_ARRIVAL_SLUGS = new Set(["tribunal-ordinator", "tribune"]);

const THREATS_BY_SLUG = new Map(THREATS.map((t) => [t.slug, t]));

// The public name a checkbox wears, and whether it is whitelisted. Both read
// off the `optIn` shape so a decoy and a real seat are indistinguishable here.
function optInName(threat) {
  return (typeof threat.optIn === "object" && threat.optIn?.name) || threat.name;
}

function optInWhitelisted(threat) {
  return typeof threat.optIn === "object" && threat.optIn?.whitelist === true;
}

// The checkbox list, in PUBLIC-name order so the lobby and the wizard read as
// an alphabetical list whatever the seats behind it are called.
const OPT_IN_THREATS = THREATS.filter((t) => t.optIn).sort((a, b) =>
  optInName(a).localeCompare(optInName(b)),
);
const ANTAGONISTS = OPT_IN_THREATS;
const ANTAGONIST_SLUGS = new Set(OPT_IN_THREATS.map((t) => t.slug));

// Every seat a GM can hand out. Assignable and spawnable are the same set:
// anything that can be given to an existing character can also arrive as a
// new one.
const ASSIGNABLE_THREATS = THREATS.filter((t) => t.assignable);

// Slug -> the tag that means "holds this seat", for the roster's derivation.
const SEAT_TAG_SLUGS = ASSIGNABLE_THREATS.map((t) => t.seatTagSlug).filter(Boolean);

function threatBySlug(slug) {
  return THREATS_BY_SLUG.get(slug) ?? null;
}

// The one entry, if any, whose seat tag this slug is. Lets the roster turn a
// held tag back into the seat it stands for.
function threatBySeatTag(tagSlug) {
  return ASSIGNABLE_THREATS.find((t) => t.seatTagSlug === tagSlug) ?? null;
}

// Whatever the form posted, reduced to known opt-in slugs, deduped, in
// catalog order. The wizard's checkboxes are UX; this is the boundary that
// keeps junk out of the column, same posture as normalizeHonorific's
// allowlist. A slug that has since left the catalog is dropped here, which is
// why renaming one needs no data migration.
function normalizeAntagonistSlugs(input, { whitelisted = true } = {}) {
  const posted = new Set(
    (Array.isArray(input) ? input : [input])
      .filter((v) => v != null)
      .map((v) => v.toString().trim()),
  );
  return OPT_IN_THREATS.filter((t) => posted.has(t.slug))
    .filter((t) => whitelisted || !optInWhitelisted(t))
    .map((t) => t.slug);
}

// Slugs -> PUBLIC names, in catalog order. Unknown slugs are dropped rather
// than rendered raw, so a stale value can never leak into the UI. Public
// rather than real on purpose: this is what a player ticked, and a GM table
// showing "Demoness" beside a box that said "Succubus" is a puzzle nobody
// needs.
function antagonistNames(slugs) {
  const held = new Set(slugs ?? []);
  return OPT_IN_THREATS.filter((t) => held.has(t.slug)).map(optInName);
}

// The slugs a player without the Whitelist role may not tick. The lobby and
// the wizard grey these; the server drops them (normalizeAntagonistSlugs's
// `whitelisted` option) so a hand-posted form cannot slip one through.
const WHITELISTED_OPT_IN_SLUGS = new Set(OPT_IN_THREATS.filter(optInWhitelisted).map((t) => t.slug));

// A spawned character needs a name and there is nobody to type one, so one is
// rolled. NO ‡ ANYWHERE IN THESE — a name is written to Character.name, the
// Discord nickname and the personal role title, all of which are matched or
// worn as identity rather than read as prose.
const SPAWN_NAMES = {
  WOMAN: [
    "Maeris", "Ilvane", "Corrin", "Sabeth", "Vessa", "Orlaith",
    "Thessaly", "Maren", "Yveline", "Perrin", "Cassia", "Domna",
    "Roswitha", "Ferren", "Alisaunde", "Nyssa", "Odila", "Verity",
    "Halcyone", "Ismene", "Brenna", "Solveig", "Cerise", "Aldith",
  ],
  MAN: [
    "Jorren", "Aldric", "Vaskin", "Corben", "Merric", "Thaddeus",
    "Ossian", "Ruvain", "Gaspar", "Edren", "Lucan", "Ambrose",
    "Halvard", "Ceril", "Rodrigan", "Ysbrand", "Emeric", "Tobias",
    "Warrin", "Anselm", "Dorian", "Fenric", "Marcus", "Oswin",
  ],
  NEUTRAL: [
    "Ash", "Corvin", "Wren", "Sable", "Lark", "Rowan",
    "Vesper", "Quill", "Ember", "Marlow", "Peregrine", "Sorrel",
  ],
};

function randomSpawnName(gender) {
  const pool = SPAWN_NAMES[gender] ?? SPAWN_NAMES.NEUTRAL;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Button customId prefixes for the spawn offer. The web builds the buttons and
// the bot routes the clicks, so the strings live here rather than on either
// side — the REST/gateway twin convention (ARCHITECTURE.md).
const THREAT_SPAWN_ACCEPT_PREFIX = "threat-spawn-accept:";
const THREAT_SPAWN_DECLINE_PREFIX = "threat-spawn-decline:";

module.exports = {
  SHUTTLE_ARRIVAL_SLUGS,
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  SPAWN_NAMES,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  optInName,
  optInWhitelisted,
  WHITELISTED_OPT_IN_SLUGS,
  randomSpawnName,
  // Kept under the old names: the column is still Character.antagonistOptIns
  // and every caller of these two is about that column.
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
};
