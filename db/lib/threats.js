// The threat catalog: every antagonist seat, in one place. A threat is three
// things: optIn (a lobby/wizard checkbox — consent data, `true` or
// `{name, whitelist}`; `name` is the PUBLIC name when it differs, e.g.
// "Succubus" for the Demoness, "Cultist" for a Thanati, so the word never
// appears; `whitelist: true` locks it to the Whitelist Discord role), assign
// (a real seat a GM hands to an existing character, granting the tags/points
// here and DMing the Role charter), and spawn (the same seat as a whole new
// character, offered over DM). HALF THE OPT-INS ARE DECOYS — `optIn` alone,
// so ticking one tells a GM about consent without naming the real seats; the
// hand-run briefs (Monsters, the Sympathizer) live in SECRETS.md,
// not here. INCOMPATIBLE TAGS are `conflictsWith` edges on the seat tag in
// docs/tags.yaml, not listed here. Kept in code, not a table, for the reason
// db/lib/roleIds.js gives: fixed values that can never differ per environment.
// Alphabetized by `name` so catalog order *is* display order, which also hides
// the real seats among the decoys. No prose here except `brief` below — a
// seated player reads the Role's own charter. A PARTY is the group a seat
// scores objectives with; seats with no `party` are SOLO in the reveal.
// Pure, no prisma -- safe to require from a catalog module (db/lib/nameCorpus.js).
const { randomCharacterName, cultureForRole } = require("./nameCorpus");

const THANATI_PARTY = { key: "thanati", name: "Thanati" };
const TRIBUNAL_PARTY = { key: "tribunal", name: "Tribunal" };
// The invading party. Its six roles are LATE JOINS (db/lib/lateJoin.js), not
// spawns: only the leader's seat is handed out from here, and the five soldiers
// arrive through the picker once a GM -- or the Bastard's own Call
// reinforcements button -- has opened the chairs.
const BASTARD_PARTY = { key: "bastard", name: "The Bastard" };

// THE ONE EXCEPTION TO "NO PROSE IN THE CATALOG": the Thanati have no Role of
// their own (spawn.roleSlug is null, the GM picks a cover role), so nowhere
// else for this to live. A seat WITH a role of its own never gets one of these: write it on the role.
const THANATI_BRIEF = [
  "You are a Thanati. Crudux Cruo! This reality is flawed to its core. Lord Tzchernobog will deliver a new, perfect reality once this one has come to an end, when the last human observer has passed into nothingness.",
  "Read the Thanati document for more information.",
  "Secrecy is your greatest strength. Ever since the arrival of the Inquisitor, the cult's position has been tenuous. The capture of one of you will result in your exposure. Death is preferable to what the sadistic inquisition will do to you.",
  "You are running out of time. Be quick!",
];
const THANATI_LEADER_BRIEF = [
  "You are the Thanati cult leader. Crudux Cruo! This reality is flawed to its core! Lord Tzchernobog will deliver a new, perfect reality once this one has come to an end, when the last human observer has passed into nothingness.",
  "Read the Thanati document for more information.",
  "Secrecy is your greatest strength. Ever since the arrival of the Inquisitor, the cult's position has been tenuous. The capture of one of you will result in your exposure. Death is preferable to what the sadistic inquisition will do to you.",
  "You are running out of time. Be quick, and organize your followers!",
];

const THREATS = [
  {
    slug: "archon",
    name: "Archon",
    optIn: true,
  },
  {
    slug: "bastard",
    name: "Bastard",
    optIn: { whitelist: true },
    assignable: true,
    seatTagSlug: "bastard",
    zone: "Hills",
    party: BASTARD_PARTY,
    assign: { tagPoints: 2, tagSlugs: ["bastard", "tactician", "literacy", "brave", "rough-camper", "outsider"] },
    spawn: {
      gender: "MAN",
      roleSlug: "bastard",
      resources: 1,
      tagPoints: 2,
      tagSlugs: ["obol x4"],
    },
  },
  {
    slug: "demoness",
    name: "Demoness",
    optIn: { name: "Succubus", whitelist: true },
    assignable: true,
    seatTagSlug: "demoness", // derived from the tag, not stored, so a hand grant still shows up.
    zone: "Fortress",
    assign: { tagPoints: 7, tagSlugs: ["demoness", "hungerless", "beautiful", "rough-camper"] },
    spawn: {
      gender: "WOMAN",
      roleSlug: null, // no default role; the GM picks one when offering.
      resources: 3,
      tagPoints: 7,
      tagSlugs: ["dagger", "obol x4"], // "x4" is a stack count (parseStartingTag), not four entries.
    },
  },
  {
    slug: "judge",
    name: "Judge",
    optIn: true,
    assignable: true,
    seatTagSlug: "judge",
    zone: "Town, or Cave",
    assign: { tagPoints: 17, tagSlugs: ["cruel", "judge", "rough-camper", "outsider", "brave"] },
    spawn: {
      gender: "ROLL",
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
  // THE THANATI: two real seats behind two public names so the word Thanati is never on a checkbox.
  {
    slug: "thanati",
    name: "Thanati",
    optIn: { name: "Cultist" },
    assignable: true,
    seatTagSlug: "thanati",
    zone: "Anywhere",
    party: THANATI_PARTY,
    brief: THANATI_BRIEF,
    assign: { tagPoints: 4, tagSlugs: ["thanati", "literacy"] },
    spawn: {
      gender: "ROLL",
      roleSlug: null,
      resources: 3,
      tagPoints: 4,
      tagSlugs: ["literacy", "obol x4"],
    },
  },
  {
    slug: "thanati-leader",
    name: "Thanati Leader",
    optIn: { name: "Cultist Leader", whitelist: true },
    assignable: true,
    seatTagSlug: "thanati-leader",
    zone: "Anywhere",
    party: THANATI_PARTY,
    brief: THANATI_LEADER_BRIEF,
    assign: { tagPoints: 7, tagSlugs: ["thanati", "thanati-leader", "literacy"] },
    spawn: {
      gender: "ROLL",
      roleSlug: null,
      resources: 3,
      tagPoints: 7,
      tagSlugs: ["thanati-mask", "literacy", "obol x4"],
    },
  },
  // THE TRIBUNAL. Both carry `spawn.locationSlug`, which nothing else does — the seat knows where its own shuttle puts down.
  {
    slug: "tribunal-ordinator",
    name: "Tribunal Ordinator",
    optIn: { whitelist: true },
    assignable: true,
    seatTagSlug: "ordinator-insignia",
    zone: "Black Hills",
    party: TRIBUNAL_PARTY,
    assign: {
      tagPoints: 10,
      // Mirrors tribunal-ordinator's starting_tags (docs/roles.yaml); Assign/Spawn are separate lists, keep both in sync.
      tagSlugs: [
        "ordinator-insignia",
        "cataphract-armor",
        "tribunal-ordinator-helmet",
        "elevator-key",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
        "literacy",
        "radio-243000",
      ],
    },
    spawn: {
      gender: "MAN",
      honorific: "Ordinator",
      namePool: "TRIBUNAL",
      roleSlug: "tribunal-ordinator",
      locationSlug: "east-river",
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
    party: TRIBUNAL_PARTY,
    assign: {
      tagPoints: 10,
      // Mirrors tribune's starting_tags — see the Ordinator's note above.
      tagSlugs: [
        "tribunal-helmet",
        "heavy-infantry-armor",
        "c4",
        "fragmentation-grenade",
        "motorcycle",
        "supply-kit",
        "literacy",
        "radio-243000",
      ],
    },
    spawn: {
      gender: "MAN",
      honorific: ["Sergeant", "Corporal"],
      namePool: "TRIBUNAL",
      roleSlug: "tribune",
      locationSlug: "east-river",
      resources: 8,
      tagPoints: 10,
    },
  },
  // Assign-only, deliberately no `spawn` block — every other entry above
  // that carries `assign` also carries `spawn`, and this is the first
  // exception. A Vampire is an existing, opted-in player a GM hands the seat
  // to (docs/systemdocs/VAMPIRE.md); it is never a brand-new arrival, so
  // there is nothing for a Spawn offer to hand over. No Role of its own (no
  // unique starting kit), so `brief` carries what a Role's own charter would
  // otherwise say, per this file's own rule for a seat with no Role. The
  // Blood Abilities menu, its purchasable tags and the Vampire's own Desires
  // are built (VAMPIRE.md §6-9) — `hungerless` rides along with the seat
  // tag itself, the same reuse Demoness above makes, rather than a second
  // hunger-exemption mechanism.
  {
    slug: "vampire",
    name: "Vampire",
    optIn: true,
    assignable: true,
    seatTagSlug: "vampire",
    zone: "Anywhere",
    brief: [
      "You are a Vampire. You must feed on hapless mortals to sustain yourself. You have a blood and humanity stat, manage them carefully. View your vampire document for more information.",
      "Let none know of your true nature, they would not understand your gift and seek to end your immortal life.",
    ],
    assign: { tagPoints: 0, tagSlugs: ["vampire", "hungerless"] },
  },
  // Retired (docs/archive/windlander.yaml); the box stays as a decoy.
  {
    slug: "windlander",
    name: "Windlander",
    optIn: true,
  },
];

// Seats that arrive by shuttle (db/lib/threatSpawn.js). A set, not a flag, so a future seat joins with one line.
const SHUTTLE_ARRIVAL_SLUGS = new Set(["tribunal-ordinator", "tribune"]);

const THREATS_BY_SLUG = new Map(THREATS.map((t) => [t.slug, t]));

function optInName(threat) {
  return (typeof threat.optIn === "object" && threat.optIn?.name) || threat.name;
}

function optInWhitelisted(threat) {
  return typeof threat.optIn === "object" && threat.optIn?.whitelist === true;
}

// PUBLIC-name order, so the lobby/wizard read as alphabetical whatever the seat is called.
const OPT_IN_THREATS = THREATS.filter((t) => t.optIn).sort((a, b) =>
  optInName(a).localeCompare(optInName(b)),
);
const ANTAGONISTS = OPT_IN_THREATS;
const ANTAGONIST_SLUGS = new Set(OPT_IN_THREATS.map((t) => t.slug));

// Assignable and spawnable are the same set.
const ASSIGNABLE_THREATS = THREATS.filter((t) => t.assignable);

const SEAT_TAG_SLUGS = ASSIGNABLE_THREATS.map((t) => t.seatTagSlug).filter(Boolean);

// The SECRET seats: a hidden tag worn under an ordinary cover role, with no
// Role of their own to spawn into — the Thanati, their leader, the Vampire,
// the Demoness and the Judge. The Tribunal and the Bastard's host are the
// opposite case: open invaders with seats of their own, whom a town can learn
// to recognise. The Memories system (docs/systemdocs/MEMORIES.md §2d) treats
// the secret ones as not existing at all: nothing about them is ever seeded,
// learned or remembered — only the cover role is, like anybody else's.
const SECRET_THREATS = ASSIGNABLE_THREATS.filter((t) => !t.spawn?.roleSlug);

// Every word a secret seat goes by — its name and the public name it wears in
// the lobby (a Thanati opts in as a "Cultist") — lower-cased for matching.
const SECRET_SEAT_WORDS = [
  ...new Set(SECRET_THREATS.flatMap((t) => [t.name, optInName(t)]).map((w) => w.toLowerCase())),
];

function threatBySlug(slug) {
  return THREATS_BY_SLUG.get(slug) ?? null;
}

function threatBySeatTag(tagSlug) {
  return ASSIGNABLE_THREATS.find((t) => t.seatTagSlug === tagSlug) ?? null;
}

// `solo` is what the reveal reads to choose "was a" over "were the".
function partyOf(threat) {
  if (!threat) return null;
  if (threat.party) return { key: threat.party.key, name: threat.party.name, solo: false };
  return { key: threat.slug, name: threat.name, solo: true };
}

// Every party, deduped, in catalog order (Objectives cards + reveal).
const PARTIES = (() => {
  const seen = new Map();
  for (const t of ASSIGNABLE_THREATS) {
    const p = partyOf(t);
    if (!seen.has(p.key)) seen.set(p.key, p);
  }
  return [...seen.values()];
})();

function partyByKey(key) {
  return PARTIES.find((p) => p.key === key) ?? null;
}

// Whatever the form posted, reduced to known opt-in slugs. A slug that has
// since left the catalog is dropped here, so renaming one needs no data migration.
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

// Slugs -> PUBLIC names. Unknown slugs are dropped rather than rendered raw, so a stale value can never leak into the UI.
function antagonistNames(slugs) {
  const held = new Set(slugs ?? []);
  return OPT_IN_THREATS.filter((t) => held.has(t.slug)).map(optInName);
}

// The one line under the "Enable antagonist roles" box, on both the lobby and
// the creation wizard. It lives here so the two surfaces can never drift.
const ANTAGONIST_BLURB =
  "Antagonist roles are randomly selected at game start, or become available later on. " +
  "An antagonist is expected to drop their roleplay to focus on completing their objectives, " +
  "but gets unique gameplay styles and mechanics.";

// Every opt-in seat the player may actually take. The lobby and the wizard ask
// one question now — "antagonist roles: yes or no" — so a yes means all of
// these, and a whitelisted seat only joins the list for somebody who holds the
// whitelist. The column is still a list of slugs, which is what keeps the
// assignment roll and every GM surface unchanged.
function takeableAntagonistSlugs({ whitelisted = false } = {}) {
  return OPT_IN_THREATS.filter((t) => whitelisted || !optInWhitelisted(t)).map((t) => t.slug);
}

// Slugs a player without the Whitelist role may not tick; server drops them too.
const WHITELISTED_OPT_IN_SLUGS = new Set(OPT_IN_THREATS.filter(optInWhitelisted).map((t) => t.slug));

// A spawned character has nobody to type a name, so one is rolled.
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
};

// The Tribunal names itself, and the pool is the seat's alone — `spawn.namePool:
// "TRIBUNAL"` opts in. Both seats are MAN, so there is no gender split here. All
// 50 carry a surname, which the shared pool above never has: a Tribunal officer
// arrives with a full name, everyone else with one.
const TRIBUNAL_NAMES = [
  { firstName: "Yevgeny", lastName: "Kostoprav" },
  { firstName: "Arkhip", lastName: "Chernomor" },
  { firstName: "Fyodor", lastName: "Volkodav" },
  { firstName: "Nikita", lastName: "Zloradov" },
  { firstName: "Danilo", lastName: "Shkurodyor" },
  { firstName: "Ilarion", lastName: "Mertvograd" },
  { firstName: "Stepan", lastName: "Krovopolin" },
  { firstName: "Miroslav", lastName: "Groznenko" },
  { firstName: "Yaropolk", lastName: "Kostolom" },
  { firstName: "Lavrenty", lastName: "Zubodrob" },
  { firstName: "Tikhon", lastName: "Mogilnikov" },
  { firstName: "Prokhor", lastName: "Smertyashin" },
  { firstName: "Zosim", lastName: "Palachov" },
  { firstName: "Rodion", lastName: "Peklovsky" },
  { firstName: "Serafim", lastName: "Volchizub" },
  { firstName: "Ansgar", lastName: "Todwacht" },
  { firstName: "Dietrich", lastName: "Schwarzhand" },
  { firstName: "Otho", lastName: "Blutgraber" },
  { firstName: "Kaspar", lastName: "Grabenholt" },
  { firstName: "Volkmar", lastName: "Eisenzahn" },
  { firstName: "Helmuth", lastName: "Kaltbrandt" },
  { firstName: "Reinhard", lastName: "Knochwald" },
  { firstName: "Wilhelm", lastName: "Dornhaus" },
  { firstName: "Gottfried", lastName: "Aschenmund" },
  { firstName: "Konrad", lastName: "Wolfsgrimm" },
  { firstName: "Eckhart", lastName: "Steinnacht" },
  { firstName: "Siegmund", lastName: "Rabenhold" },
  { firstName: "Lothar", lastName: "Galgenbruch" },
  { firstName: "Hartmut", lastName: "Bleichmann" },
  { firstName: "Egon", lastName: "Nachtrieger" },
  { firstName: "Malachi", lastName: "Vurdalakov" },
  { firstName: "Ezekiel", lastName: "Gadyukin" },
  { firstName: "Uriel", lastName: "Krovogryz" },
  { firstName: "Amos", lastName: "Chernokosti" },
  { firstName: "Boaz", lastName: "Kandalov" },
  { firstName: "Azariah", lastName: "Smertograd" },
  { firstName: "Ithamar", lastName: "Kostogryz" },
  { firstName: "Obadiah", lastName: "Mrakobesov" },
  { firstName: "Zebediah", lastName: "Chernozub" },
  { firstName: "Abiram", lastName: "Grobovoi" },
  { firstName: "Amitai", lastName: "Dunkelhart" },
  { firstName: "Yitzhak", lastName: "Sturmgrab" },
  { firstName: "Eliphaz", lastName: "Winterhalt" },
  { firstName: "Gershom", lastName: "Kreuzdorn" },
  { firstName: "Nahum", lastName: "Eisenkalt" },
  { firstName: "Abner", lastName: "Hollenstamm" },
  { firstName: "Zadok", lastName: "Feldgrau" },
  { firstName: "Baruch", lastName: "Morgenstern" },
  { firstName: "Shimon", lastName: "Wehrmark" },
  { firstName: "Levi", lastName: "Aschenbrandt" },
];

const NAME_POOLS = {
  TRIBUNAL: TRIBUNAL_NAMES,
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomSpawnName(gender) {
  return pick(SPAWN_NAMES[gender] ?? SPAWN_NAMES[pick(["MAN", "WOMAN"])]);
}

// Everything a spawned character is called. `gender: "ROLL"` is a seat that
// does not care which; the Demoness and both Tribunal seats name one — and it is resolved
// HERE, never written: Character.gender is an enum of MAN/WOMAN/NEUTRAL and
// Prisma rejects the sentinel. `honorific` is the seat's rank, a string or a
// list to roll from; a seat without one arrives untitled, as they all used to.
function rollSpawnIdentity(spawn, role = null) {
  // The Role's own lock beats the seat's roll, so `gender: MAN` in
  // docs/roles.yaml holds whichever door the character came through. A seat
  // with no Role of its own (the Demoness, the Judge, both Thanati) has no
  // lock to read and falls back to what the catalog says.
  const rolled = spawn.gender === "ROLL" ? pick(["MAN", "WOMAN"]) : (spawn.gender ?? "NEUTRAL");
  const gender = role?.lockedGender ?? rolled;
  const rank = spawn.honorific ?? null;
  const pool = NAME_POOLS[spawn.namePool];
  // The Bastard's party draws from its own three registers rather than the
  // shared spawn list, the same as it does in the creation wizard.
  const culture = cultureForRole(role?.slug);
  const drawn = pool
    ? pick(pool)
    : culture
      ? randomCharacterName({ gender, culture })
      : { firstName: randomSpawnName(gender), lastName: null };
  return {
    gender,
    firstName: drawn.firstName,
    lastName: drawn.lastName ?? null,
    honorific: Array.isArray(rank) ? pick(rank) : rank,
  };
}

// The web builds the buttons, the bot routes clicks — REST/gateway twin convention (ARCHITECTURE.md).
const THREAT_SPAWN_ACCEPT_PREFIX = "threat-spawn-accept:";
const THREAT_SPAWN_DECLINE_PREFIX = "threat-spawn-decline:";

module.exports = {
  SHUTTLE_ARRIVAL_SLUGS,
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  SECRET_THREATS,
  SECRET_SEAT_WORDS,
  SPAWN_NAMES,
  TRIBUNAL_NAMES,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  PARTIES,
  partyOf,
  partyByKey,
  optInName,
  optInWhitelisted,
  WHITELISTED_OPT_IN_SLUGS,
  randomSpawnName,
  rollSpawnIdentity,
  ANTAGONISTS, // kept under the old name — the column is still Character.antagonistOptIns.
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
  takeableAntagonistSlugs,
  ANTAGONIST_BLURB,
};
