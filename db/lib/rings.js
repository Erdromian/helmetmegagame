// Signet rings: what a ring is, what it opens and what it presses into wax
// (docs/systemdocs/RINGS.md). Pure — no Prisma — so the access checks, the
// sheet and the tests all read the same answers. Minting and registering live
// in db/lib/ringMint.js; the words live in db/lib/ringText.js.
//
// A ring is a minted Tag row with ringOfCharacterId set. Worn, it adds its
// ringAccessSlugs to the set of door tokens its wearer holds. Those tokens are
// the retired seat keys' slugs (barons-key, tower-key…), which is still what
// every room's `access:` and every locked way names, so a door needs no
// rewiring to take a ring instead of a key.

const { fillRingText, tidyStops } = require("./ringText");

// The Tag columns accessSlugsOf reads. Select these (with CharacterTag.equipped
// beside them) anywhere a door is decided from a hand-picked select, or a worn
// ring silently opens nothing.
const RING_ACCESS_TAG_FIELDS = Object.freeze({
  slug: true,
  ringOfCharacterId: true,
  ringRegisteredAt: true,
  ringAccessSlugs: true,
  // What an infoterminal reads (db/lib/depotCounter.js#terminalAccount).
  ringBankAccountId: true,
});

const RING_SLUG = "ring";
const FORGED_SEAL_SLUG = "forged-wax-seal";
const FINGER = "FINGER";

function tagOf(entry) {
  return entry?.tag ?? entry;
}

function isRing(tag) {
  return Boolean(tagOf(tag)?.ringOfCharacterId);
}

function isRegistered(tag) {
  return Boolean(tagOf(tag)?.ringRegisteredAt);
}

// "Aurel Vane" -> "A.V." · "Gribb" -> "G." Given a character, only the first
// and last name are engraved, one letter each: `Sir Aurel "the Bold" Vane` is
// still "A.V.", as the honorific and the quoted title are not part of who the
// ring is for. Each name gives its first CAPITAL letter, so a name that holds a
// space or a lowercase particle still gives one: "Mary Anne" "de Vere" is
// "M.V.". A name with no capital at all falls back to its first letter. A bare
// string (or a row with no firstName) is split on whitespace, so a three-part
// name still produces something.
function initialsOf(nameOrCharacter) {
  const character = nameOrCharacter && typeof nameOrCharacter === "object" ? nameOrCharacter : null;
  const parts = character?.firstName
    ? [character.firstName, character.lastName]
    : String((character ? character.name : nameOrCharacter) ?? "").split(/\s+/);
  const letters = parts
    .map((part) => String(part ?? "").replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((part) => (part.match(/\p{Lu}/u)?.[0] ?? part[0]).toUpperCase());
  if (letters.length === 0) return null;
  return letters.map((letter) => `${letter}.`).join("");
}

// The ring a character is wearing, or null. The FINGER slot holds one
// (db/lib/equipSlots.js), so there is never a second to choose between.
function wornRing(characterTags) {
  for (const entry of characterTags ?? []) {
    if (!entry?.equipped) continue;
    const tag = tagOf(entry);
    if (isRing(tag)) return tag;
  }
  return null;
}

// Every door token a character has: the slugs of what they hold, plus what the
// ring on their finger opens. A ring in a pocket opens nothing (the doc: "wearing
// it grants access"), and an unregistered one opens nothing either.
function accessSlugsOf(characterTags) {
  const slugs = new Set();
  for (const entry of characterTags ?? []) {
    const slug = tagOf(entry)?.slug;
    if (slug) slugs.add(slug);
  }
  const ring = wornRing(characterTags);
  if (ring && isRegistered(ring)) {
    for (const token of ring.ringAccessSlugs ?? []) slugs.add(token);
  }
  return slugs;
}

// Just the worn, registered ring's tokens, off tags already loaded (the pure
// twin of roomAccess.js#wornRingTokens). For a thing only a ring may unlock,
// where a held tag of the same slug must not count.
function wornRingAccess(characterTags) {
  const ring = wornRing(characterTags);
  return ring && isRegistered(ring) ? [...(ring.ringAccessSlugs ?? [])] : [];
}

// Which of the tokens in `accessSlugsOf` came from the ring and not from
// something held, for a surface that wants to say "your ring opens this way".
function ringOnlyTokens(characterTags) {
  const ring = wornRing(characterTags);
  if (!ring || !isRegistered(ring)) return new Set();
  const held = new Set((characterTags ?? []).map((e) => tagOf(e)?.slug).filter(Boolean));
  return new Set((ring.ringAccessSlugs ?? []).filter((t) => !held.has(t)));
}

// The union of the named seats' door tokens, sorted so two rings registered
// to the same seats carry identical lists. `roles` is Role rows (or any
// { slug, ringAccessSlugs }).
function ringAccessFor(roleSlugs, roles) {
  const bySlug = new Map((roles ?? []).map((r) => [r.slug, r]));
  const out = new Set();
  for (const slug of roleSlugs ?? []) {
    for (const token of bySlug.get(slug)?.ringAccessSlugs ?? []) out.add(token);
  }
  return [...out].sort();
}

function withInitials(template, initials) {
  return tidyStops(String(template ?? "").replace(/\{initials\}/g, initials ?? ""));
}

// A seat's own spawned ring. An OFFICE ring (the nine seats that used to keep a
// wax stamp) wears its own name and description from docs/roles.yaml and is
// the only kind of ring that seals. Every other ring is the plain "Silver
// Ring" (RING_TEXT.ringName) and leaves no seal of any kind. Returns the Tag columns to write.
function spawnRingShape(role, initials) {
  if (role?.ringSealOffice) {
    return {
      name: withInitials(role.ringName, initials),
      description: withInitials(role.ringDescription, initials),
      sealMark: withInitials(role.ringSealMark, initials),
      sealOffice: role.ringSealOffice,
    };
  }
  return {
    name: ringName(initials),
    description: ringDescription({ initials, registered: true }),
    sealMark: null,
    sealOffice: null,
  };
}

function ringName(initials) {
  return fillRingText("ringName", { initials });
}

// A plain ring's description is composed from its state, so registering it
// rewrites one sentence rather than an authored paragraph. An office ring's is
// its own and never recomposed.
function ringDescription({ initials, registered, office = false }) {
  const parts = [fillRingText("ringDescription", { initials })];
  if (!registered) parts.push(fillRingText("ringUnregistered"));
  // A smithed ring registered to an office's doors says it isn't the original.
  if (office) parts.push(fillRingText("ringSealless"));
  return parts.join(" ");
}

// The engraving, off its own column (Tag.ringInitials).
function ringInitials(tag) {
  return tagOf(tag)?.ringInitials ?? "";
}

module.exports = {
  RING_ACCESS_TAG_FIELDS,
  RING_SLUG,
  FORGED_SEAL_SLUG,
  FINGER,
  isRing,
  isRegistered,
  initialsOf,
  wornRing,
  accessSlugsOf,
  wornRingAccess,
  ringOnlyTokens,
  ringAccessFor,
  spawnRingShape,
  ringName,
  ringDescription,
  ringInitials,
};
