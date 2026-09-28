// WHO A DISGUISE FOOLS (docs/systemdocs/STRANGERS.md §10). A Disguise Kit mints a tag whose
// Tag.forcedName is the name its wearer goes by (./disguiseMint.js). Unlike a public forced name
// (Apex Form's "Beast", which the whole room reads) a disguise is a new face with a name on it, and
// what each reader makes of it depends on who they know:
//
// - FOOLED: the reader has a Friends entry for the real character the name belongs to. They take the
//   wearer for that person: the name, and that person's portrait.
// - RECOGNISED: the reader learned this disguise's name (an Acquaintance with a `disguiseKey`, made by
//   hearing it said — ./memoryHearing.js#learnFromSpeech). They read the name, on a letter plaque.
// - A STRANGER to everyone else: "a young man", like any face they have never met.
//
// A disguise changes the name, and the job if the wearer claims one, never the body under it. Age and
// gender are always the wearer's: the stranger's alias says them, a title takes the wearer's form ("Sir"
// on a woman is "Dame"), and somebody fooled sees the portrait of the person they take the wearer for
// only when the two look alike — the same gender and the same age band (looksAlike). Otherwise they
// see the name's letter plaque. A claimed job's estate is the colour everybody sees the disguise in,
// fooled or not; a disguise that claims no job wears no colour.
//
// The name is matched on its bare "First Last", so a title the disguise claims ("Sir") never decides
// who is fooled. This module is the one place any of that is decided. Takes `db` (prisma or a tx),
// the dm.js convention.

const { TITLE_WORDS } = require("./titles");
const { formatBareName, matchesTypedName } = require("./characterName");
const { ageWord } = require("./concealedIdentity");

const DISGUISE_SLUG_PREFIX = "custom-disguise-";

// The face a disguise shows somebody who cannot put a name to it: the blank plaque any stranger with no
// portrait wears, so it says nothing about a disguise being there at all. Never the wearer's own face.
const DISGUISE_STRANGER_FACE = "/assets/letters/_default.webp";

// Whether a tag row (or the `tag` inside a CharacterTag) is a Disguise Kit's. Needs `slug` selected; a
// row loaded without it reads as a public forced name, which is how every disguise read before this.
function isDisguiseTag(tag) {
  return typeof tag?.slug === "string" && tag.slug.startsWith(DISGUISE_SLUG_PREFIX);
}

// Whether a hood is up over a disguise, which hides it: CONCEALMENT BEATS A DISGUISE. A wearer who
// conceals themselves is a hooded stranger like anybody else, under their own concealed alias and
// presence label ("a young man (2)"), and the disguise's name shows again when the hood comes down. A
// hood is up the way presentedIdentity.js decides it: an equipped concealing piece that forces it, or
// one the character has chosen to wear up (`character.concealed`). A character loaded without the
// column counts only a forcing piece. Needs the equipped concealing tags (CONCEALMENT_TAG_FIELDS)
// alongside the forced-name ones; without them nothing reads as up. A public forced name (Apex Form's
// "Beast") is never hidden: its wearer cannot conceal at all.
function hoodUpOverDisguise(tags, character) {
  if (!Array.isArray(tags)) return false;
  let piece = false;
  for (const entry of tags) {
    if (entry?.equipped !== true) continue;
    const tag = entry?.tag ?? entry;
    if (!tag?.concealsIdentity || !tag?.concealSprite) continue;
    if (tag.forcesConceal) return true;
    piece = true;
  }
  return piece && character?.concealed === true;
}

// The first held forced-name tag, when it is a disguise with no hood over it: the disguise showing.
function shownDisguiseTag(tags, character) {
  if (!Array.isArray(tags)) return null;
  for (const entry of tags) {
    const tag = entry?.tag ?? entry;
    const name = tag?.forcedName;
    if (typeof name !== "string" || !name.trim()) continue;
    if (!isDisguiseTag(tag) || hoodUpOverDisguise(tags, character)) return null;
    return tag;
  }
  return null;
}

// The disguise name a character is going by, or null. Mirrors presentedIdentity.js#forcedNameFrom,
// which takes the FIRST held forced name: only when that one is a disguise is the character disguised,
// so the two can never disagree about which name is showing. Pass the character (with `concealed`)
// so a hood over the disguise hides it (hoodUpOverDisguise).
function disguiseNameFrom(tags, character = null) {
  return shownDisguiseTag(tags, character)?.forcedName.trim() ?? null;
}

// The job the disguise that disguiseNameFrom reads claims: `{ name, slug }`, or null for none. `name` is
// the job title as worn, real or made up; `slug` is the Role it names, null for a made-up job, which
// therefore has no estate and no colour. The same first forced-name tag, so the name and the job always
// come off one disguise, and a hood over it hides the job too. Needs `disguiseJob` and
// `disguiseJobSlug` selected.
function disguiseJobFrom(tags, character = null) {
  const tag = shownDisguiseTag(tags, character);
  if (!tag) return null;
  const job = typeof tag.disguiseJob === "string" && tag.disguiseJob.trim() ? tag.disguiseJob.trim() : null;
  const slug = tag.disguiseJobSlug ?? null;
  return job || slug ? { name: job, slug } : null;
}

// The jobs behind these Role slugs: Map<slug, { slug, name, groupSlug }>. A slug no Role has any more is
// simply missing, and reads as no job.
async function jobsBySlug(db, slugs) {
  const list = [...new Set((slugs ?? []).filter((slug) => typeof slug === "string" && slug))];
  if (list.length === 0 || typeof db?.role?.findMany !== "function") return new Map();
  const roles = await db.role.findMany({ where: { slug: { in: list } }, select: { slug: true, name: true, groupSlug: true } });
  return new Map(roles.map((role) => [role.slug, role]));
}

// PURE. Whether somebody wearing a disguise looks enough like the person it fools a reader into seeing
// for that person's portrait to stand in for them: the same gender, and the same age band — the words a
// stranger's alias uses (./concealedIdentity.js#ageWord), so "young", grown and "old". Either side
// unknown (`age` or `gender` missing) never looks alike.
function looksAlike(wearer, look) {
  if (!wearer?.gender || !look?.gender || wearer.gender !== look.gender) return false;
  if (typeof wearer.age !== "number" || typeof look.age !== "number") return false;
  return ageWord(wearer.age) === ageWord(look.age);
}

// PURE. Whether this reader sees the portrait of the person the disguise fools them into seeing, rather
// than the name's letter plaque. `read` is one disguiseRead answer; `wearer` has `age` and `gender`.
function fooledFace(read, wearer) {
  return Boolean(read?.fooledAs) && looksAlike(wearer, read.fooledLook);
}

// Where a disguise's title ends. A title is any words at all ("Grand Poobah"), and a name may have
// spaces in it too, so no word of the stored name can say where one stops and the other starts. The
// Kit joins the title to the name with a NO-BREAK SPACE instead (./disguiseMint.js#normalizeDisguiseName):
// it reads as an ordinary space everywhere, it survives onto every line the disguise says
// (ArchiveEntry.concealedAlias freezes the string as it is), and nothing a player types can put one in,
// since every typed part has its whitespace collapsed first.
const DISGUISE_TITLE_JOIN = "\u00A0";

function squash(value) {
  return (value ?? "").toString().replace(/\s+/g, " ").trim();
}

// PURE. A stored disguise name ("Grand Poobah Aldric Vask") split the way a character's name is: its
// title, a first name, and the rest as the last name. The title is everything before the no-break
// space the Kit put after it; a name with none (older, or typed as one string) takes a leading title
// word of the game's own (./titles.js), as it always did. Shaped like a character row, so
// characterName.js#matchesTypedName and memoryLessons.js#nameFormsFor take it as one.
function disguiseParts(name) {
  const raw = (name ?? "").toString().trim();
  const full = squash(raw);
  const at = raw.lastIndexOf(DISGUISE_TITLE_JOIN);
  const titled = at > 0 && Boolean(squash(raw.slice(0, at))) && Boolean(squash(raw.slice(at + 1)));
  const rest = titled ? squash(raw.slice(at + 1)) : full;
  const words = rest ? rest.split(" ") : [];
  let honorific = titled ? squash(raw.slice(0, at)) : null;
  if (!titled && words.length > 1 && TITLE_WORDS.includes(words[0])) honorific = words.shift();
  const firstName = words.shift() ?? "";
  const lastName = words.length ? words.join(" ") : null;
  return { name: full, honorific, firstName, lastName };
}

function nameKey(value) {
  return (value ?? "").toString().trim().replace(/\s+/g, " ").toLowerCase();
}

// PURE. What an entry learned for this disguise is keyed on: the bare name, lower-cased. Null for a
// name with nothing in it.
function disguiseKey(name) {
  return nameKey(formatBareName(disguiseParts(name))) || null;
}

// PURE. Does this disguise name belong to `character` (a row with firstName/lastName)? The bare names
// must match in full, so a title the disguise adds or leaves off makes no difference, and "Aldric"
// alone is not "Aldric Vask".
function namesCharacter(name, character) {
  const key = disguiseKey(name);
  return Boolean(key) && key === nameKey(formatBareName(character ?? {}));
}

// PURE. Does a name typed on an Intercept watch catch somebody going by this disguise? The same match a
// typed name makes against a real character: the full name as worn, or the bare one.
function typedNameMatches(name, typed) {
  return matchesTypedName(disguiseParts(name), typed);
}

// What `viewerId` makes of each disguise name in `names`: Map<name, { known, fooledAs, fooledLook }>. `fooledAs` is the id of the real character the reader takes the wearer for, and
// `fooledLook` that person's `{ age, gender }` (looksAlike); `known` is true when they can put the name
// to the face at all (fooled, recognised, or it is their own name). Null when there is nobody
// to recognise with, or the GM has the stranger rule off — every caller reads null as "everybody can
// name it", which is how a disguise read before this.
//
// A reader is never fooled by their own name: they know they are not the one wearing it. They read it,
// on the plaque.
async function readDisguises(db, viewerId, names) {
  if (!viewerId || typeof db?.acquaintance?.findMany !== "function") return null;
  // Lazily: strangers.js is heavier and reaches back into the modules that require this one.
  const { anonymizingStrangers } = require("./strangers");
  if (!(await anonymizingStrangers(db))) return null;
  const list = [...new Set((names ?? []).filter((name) => typeof name === "string" && name.trim()))];
  const out = new Map();
  if (list.length === 0) return out;

  const keys = [...new Set(list.map(disguiseKey).filter(Boolean))];
  const firstNames = [...new Set(list.map((name) => disguiseParts(name).firstName).filter(Boolean))];
  const [learned, friends, self] = await Promise.all([
    db.acquaintance.findMany({
      where: { ownerId: viewerId, disguiseKey: { in: keys } },
      select: { disguiseKey: true },
    }),
    // Only entries whose subject could carry one of these names, rather than the whole list.
    db.acquaintance.findMany({
      where: {
        ownerId: viewerId,
        subjectId: { not: null },
        subject: { firstName: { in: firstNames, mode: "insensitive" } },
      },
      select: {
        subject: {
          select: { id: true, firstName: true, lastName: true, age: true, gender: true },
        },
      },
    }),
    db.character.findUnique({ where: { id: viewerId }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const learnedKeys = new Set(learned.map((row) => row.disguiseKey));
  const subjects = friends.map((row) => row.subject).filter((subject) => subject && subject.id !== viewerId);
  for (const name of list) {
    const own = Boolean(self) && namesCharacter(name, self);
    const fooledBy = own ? null : (subjects.find((subject) => namesCharacter(name, subject)) ?? null);
    out.set(name, {
      known: own || Boolean(fooledBy) || learnedKeys.has(disguiseKey(name)),
      fooledAs: fooledBy?.id ?? null,
      // What that person looks like, for the portrait rule (looksAlike).
      fooledLook: fooledBy ? { age: fooledBy.age ?? null, gender: fooledBy.gender ?? null } : null,
    });
  }
  return out;
}

// readDisguises turned round, for a room: which of `ownerIds` can put this one disguise name to the
// face, as a Set. Three queries whatever the room's size. Null when the stranger rule is off, which
// callers read as "everybody can".
async function ownersWhoKnow(db, ownerIds, name) {
  const { anonymizingStrangers } = require("./strangers");
  if (!(await anonymizingStrangers(db))) return null;
  const ids = [...new Set((ownerIds ?? []).filter(Boolean))];
  const key = disguiseKey(name);
  const out = new Set();
  if (ids.length === 0 || !key) return out;
  const { firstName } = disguiseParts(name);
  const [learned, friends, selves] = await Promise.all([
    db.acquaintance.findMany({ where: { ownerId: { in: ids }, disguiseKey: key }, select: { ownerId: true } }),
    db.acquaintance.findMany({
      where: {
        ownerId: { in: ids },
        subjectId: { not: null },
        subject: { firstName: { equals: firstName, mode: "insensitive" } },
      },
      select: { ownerId: true, subject: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.character.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  for (const row of learned) out.add(row.ownerId);
  for (const row of friends) {
    if (row.subject && row.subject.id !== row.ownerId && namesCharacter(name, row.subject)) out.add(row.ownerId);
  }
  for (const self of selves) if (namesCharacter(name, self)) out.add(self.id);
  return out;
}

// PURE. One disguise's reading off readDisguises' answer. A null map (nobody to recognise with, or the
// rule off) knows every name and is fooled by none.
function disguiseRead(reads, name) {
  if (!reads) return { known: true, fooledAs: null, fooledLook: null };
  return reads.get(name) ?? { known: false, fooledAs: null, fooledLook: null };
}

module.exports = {
  DISGUISE_SLUG_PREFIX,
  DISGUISE_TITLE_JOIN,
  DISGUISE_STRANGER_FACE,
  isDisguiseTag,
  hoodUpOverDisguise,
  disguiseNameFrom,
  disguiseJobFrom,
  jobsBySlug,
  looksAlike,
  fooledFace,
  disguiseParts,
  disguiseKey,
  namesCharacter,
  typedNameMatches,
  readDisguises,
  ownersWhoKnow,
  disguiseRead,
};
