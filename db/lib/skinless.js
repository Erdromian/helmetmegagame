// THE SKINLESS (E:\Bascinet\V3\Skinless\Skinless Overview.docx,
// docs/systemdocs/SKINLESS.md): a hidden fate that only opens through a
// lateparty (db/lib/lateParty.js), and never fills -- there is always room for
// another Skinless, so a party that names them runs until a superadmin ends it.
//
// A Skinless is never BUILT. Respawning as one skips the wizard: a coin-flip
// sex, a first name from the doc's pool, the last name "Skinless", the fixed
// avatar (web/lib/avatarResponse.js), the preset tags, one weapon, and a few
// random tags by the doc's likelihoods. Everything else the doc asks for hangs
// off the `skinless` TAG, not the role, so a GM granting or stripping it by
// hand moves every rule with it: the grunts (db/lib/strangers.js), the equip
// gate (db/lib/verbs/self.js), the brain a butcher cuts out, the desires, Smell
// Skin, the refusals at conversion and at the store.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/reincarnate.js convention; require it by path.
// Only the two pure requires at the top: the lens (db/lib/strangers.js) and the
// equip gate load this file, and the database half below reaches into the
// lobby and the map, which would close a require cycle if loaded eagerly.
const { formatCharacterName } = require("./characterName");

const SKINLESS_ROLE_SLUG = "skinless";
const SKINLESS_TAG_SLUG = "skinless";
// What a butcher cuts out of a dead Skinless, besides the usual.
const SKINLESS_BRAIN_SLUG = "skinless-brain";
const SKINLESS_LAST_NAME = "Skinless";
// How old a new body is, both ends included.
const SKINLESS_AGE_MIN = 20;
const SKINLESS_AGE_MAX = 70;
// Where every Skinless of a party arrives is picked once, when the party opens
// (LateParty.skinlessLocationId), from this zone's Locations.
const SKINLESS_SPAWN_ZONE_SLUG = "depths";
// What a Skinless may not wear: anything that goes on the body (the doc's
// "clothes, armour or any other accessory"). A weapon in the hand is fine, and
// so is a mount.
const SKINLESS_BARRED_SLOTS = ["HEAD", "BODY", "ACCESSORY", "FINGER"];
const SKINLESS_EQUIP_REFUSAL = "Your raw flesh cannot accommodate that.";
// No religion will take a Skinless, and no group will have one.
const SKINLESS_BELIEF_REFUSAL = "Skinless cannot hold beliefs.";
// Changing the portrait anyway.
const SKINLESS_FACE_REFUSAL = "Your appearance is beyond your control.";
const SKINLESS_GROUP_REFUSAL = "A Skinless can't join any faction or antagonist group.";
// The fixed face, served for anybody holding the tag.
const SKINLESS_AVATAR_PATH = "/assets/skinless/skinless-avatar.webp";

// The doc's name pool, Bascinet's names as written.
const SKINLESS_NAMES = {
  MAN: [
    "Urist", "Hunter", "Laugherty", "Theodore", "Nikolai", "Boris", "Todd", "Cecil", "Ulfric", "Godwin",
    "Wolf", "Richard", "Sven", "Emil", "Gerold", "Pierre", "Alexander", "Moss", "Hanbal", "Podinki",
    "Drogo", "Butch", "Solomon", "Benedict", "Clement", "Walter", "Osric", "Ivor",
  ],
  WOMAN: [
    "Anne", "Beatrice", "Sybil", "Eleanore", "Magdalena", "Isabel", "Amelia", "Angeline", "Ostrich", "Leonora",
    "Mira", "Katherine", "Joan", "Alice", "Ursula", "Evelyn", "Agnes", "Inga", "Brenna", "Maud",
    "Helen", "Eloise", "Brunhilde", "Eden", "Mary", "Sarah", "Esther", "Judith",
  ],
};

// Every Skinless starts with these. The doc's "Melee 1", "Ranged 1" and
// "Guerilla" are the catalog's Melee I, Ranged I and Guerrilla.
const SKINLESS_PRESET_TAGS = [
  SKINLESS_TAG_SLUG,
  "hungerless",
  "cave-eyes",
  "melee-basic",
  "caving",
  "climbing",
  "ranged-basic",
  "guerrilla",
];

// And one of these. The doc's "Bone club" is the Cracked Bone Club.
const SKINLESS_WEAPONS = ["spear", "cracked-bone-club", "hatchet", "sling"];

// The chance of each likelihood the doc names (Bascinet's numbers, 2026-09-28).
const LIKELIHOOD = { LOW: 0.1, MEDIUM: 0.25, HIGH: 0.5 };

// Rolled one by one, each on its own chance. Melee 2 and Ranged 2 sit on top
// of the preset Melee I and Ranged I, the way every rung chain is held.
const SKINLESS_RANDOM_TAGS = [
  { slug: "fat", likelihood: "MEDIUM" },
  { slug: "frail", likelihood: "MEDIUM" },
  { slug: "glass-jaw", likelihood: "LOW" },
  { slug: "dwarf", likelihood: "LOW" },
  { slug: "giant", likelihood: "LOW" },
  { slug: "ambidextrous", likelihood: "LOW" },
  { slug: "biter", likelihood: "MEDIUM" },
  { slug: "grappler", likelihood: "LOW" },
  { slug: "brand", likelihood: "LOW" },
  { slug: "disfigured", likelihood: "MEDIUM" },
  { slug: "missing-arm", likelihood: "LOW" },
  { slug: "clumsy", likelihood: "LOW" },
  { slug: "stupid", likelihood: "LOW" },
  { slug: "strong", likelihood: "MEDIUM" },
  { slug: "strong-swimmer", likelihood: "MEDIUM" },
  { slug: "eunuch", likelihood: "LOW" },
  { slug: "hard-of-hearing", likelihood: "LOW" },
  { slug: "melee-trained", likelihood: "LOW" },
  { slug: "ranged-trained", likelihood: "LOW" },
  { slug: "ranged-throwing-weapons", likelihood: "MEDIUM" },
  { slug: "medical-basic", likelihood: "LOW" },
  { slug: "reckless-attacker", likelihood: "HIGH" },
];

// Every slug a spawn may grant, for the one catalog read.
const SKINLESS_TAG_SLUGS = [
  ...SKINLESS_PRESET_TAGS,
  ...SKINLESS_WEAPONS,
  ...SKINLESS_RANDOM_TAGS.map((t) => t.slug),
];

// What a Skinless's speech sounds like to anybody who is not one. Not Stupid's
// babble (db/lib/babble.js) and not a Ghoul's growl: wet, throaty, and kept
// lower case.
const SKINLESS_SYLLABLES = [
  "hrrk", "ghh", "hnnh", "urgh", "khh", "grrh", "hhuh", "nngh", "gak", "hrm", "uhh", "ghrk",
];

// ─── Pure ────────────────────────────────────────────────────────────────────

// A small seeded generator, so one line grunts the same way for every reader
// and on both faces (the web lens and the Discord post seed it with the row's
// seq).
function seededRng(seed) {
  let a = Number(seed) | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A Skinless's line as anybody else hears it: one grunt per word, the shape
// kept and the meaning gone. Mostly bare sounds run together, with a comma or
// an ellipsis only now and then, every four to seven sounds.
function gruntify(text, seed = 0) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const rng = seededRng(seed);
  const out = [];
  let sinceBreak = 0;
  for (let i = 0; i < words.length; i += 1) {
    const sound = pick(SKINLESS_SYLLABLES, rng);
    out.push(i === 0 ? sound.charAt(0).toUpperCase() + sound.slice(1) : sound);
    if (i === words.length - 1) break;
    sinceBreak += 1;
    if (sinceBreak >= 4 + Math.floor(rng() * 4)) {
      out[out.length - 1] += rng() < 0.5 ? "," : "…";
      sinceBreak = 0;
    }
  }
  return `${out.join(" ")}${rng() < 0.5 ? "!" : "…"}`;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Who the new body is. A coin flip between MAN and WOMAN, a first name from
// that half of the pool, the last name every Skinless shares, and an age
// anywhere from SKINLESS_AGE_MIN to SKINLESS_AGE_MAX, which is what makes one
// a "Young Skinless Man" and another an "Old Skinless Woman" to a stranger. No
// honorific: nobody chose one.
function rollSkinlessIdentity(rng = Math.random) {
  const gender = rng() < 0.5 ? "MAN" : "WOMAN";
  const firstName = pick(SKINLESS_NAMES[gender], rng);
  const lastName = SKINLESS_LAST_NAME;
  const age = SKINLESS_AGE_MIN + Math.floor(rng() * (SKINLESS_AGE_MAX - SKINLESS_AGE_MIN + 1));
  return {
    gender,
    age,
    firstName,
    lastName,
    name: formatCharacterName({ honorific: null, firstName, title: null, lastName }),
  };
}

// The tags a new Skinless holds, as slugs: the preset, one weapon, and every
// random tag whose roll lands. `catalog` is the Tag rows for SKINLESS_TAG_SLUGS
// with `id`, `slug`, `requiredTagId` and `conflictsWith: [{ id }]`. A random
// tag that clashes with something already chosen (Dwarf and Giant, Frail and
// Strong), or whose prerequisite is not held, is skipped. The random list is
// shuffled first, so the first of a clashing pair is not always the one kept.
function rollSkinlessTags(catalog, rng = Math.random) {
  const bySlug = new Map((catalog ?? []).map((t) => [t.slug, t]));
  const chosen = [];
  const heldIds = new Set();
  const take = (slug) => {
    const tag = bySlug.get(slug);
    if (!tag || heldIds.has(tag.id)) return false;
    chosen.push(slug);
    heldIds.add(tag.id);
    return true;
  };

  for (const slug of SKINLESS_PRESET_TAGS) take(slug);
  take(pick(SKINLESS_WEAPONS, rng));

  const order = [...SKINLESS_RANDOM_TAGS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const { slug, likelihood } of order) {
    if (rng() >= LIKELIHOOD[likelihood]) continue;
    const tag = bySlug.get(slug);
    if (!tag || heldIds.has(tag.id)) continue;
    if ((tag.conflictsWith ?? []).some((c) => heldIds.has(c.id))) continue;
    // A conflict is written on one side of a pair only, so check the other way too.
    if ([...heldIds].some((id) => (catalog.find((t) => t.id === id)?.conflictsWith ?? []).some((c) => c.id === tag.id))) {
      continue;
    }
    if (tag.requiredTagId && !heldIds.has(tag.requiredTagId)) continue;
    take(slug);
  }
  return chosen;
}

// Held-tag rows (`{ tag: { slug } }` or bare `{ slug }`) -> is this a Skinless?
function isSkinlessTags(tags) {
  return (tags ?? []).some((row) => (row?.tag?.slug ?? row?.slug) === SKINLESS_TAG_SLUG && (row?.quantity ?? 1) > 0);
}

// Smell Skin's answer, from the hops to the nearest person with skin (null
// when nobody can be smelled at all).
function smellSkinLine(distance) {
  if (distance === null || distance === undefined) return "You can't seem to smell any skin.";
  if (distance === 0) return "You smell skin right here.";
  if (distance === 1) return "You smell skin 1 location away.";
  return `You smell skin ${distance} locations away.`;
}

// ─── Database ────────────────────────────────────────────────────────────────

// Does this character hold the tag?
async function isSkinless(db, characterId) {
  if (!characterId) return false;
  const n = await db.characterTag.count({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: SKINLESS_TAG_SLUG } },
  });
  return n > 0;
}

// Of these characters, which hold the tag. One query for a batch.
async function skinlessIdsAmong(db, characterIds) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await db.characterTag.findMany({
    where: { characterId: { in: ids }, quantity: { gt: 0 }, tag: { slug: SKINLESS_TAG_SLUG } },
    select: { characterId: true },
  });
  return new Set(rows.map((r) => r.characterId));
}

// Where this party's Skinless arrive: a random live Location of the Depths.
// Null if the zone has none, and the role's own start is used instead.
async function pickSkinlessSpawn(db, rng = Math.random) {
  const rows = await db.location.findMany({
    where: { retiredAt: null, zone: { slug: SKINLESS_SPAWN_ZONE_SLUG } },
    select: { id: true },
    orderBy: { slug: "asc" },
  });
  return rows.length ? pick(rows, rng).id : null;
}

// Makes a Skinless for this player in this party. Everything is rolled here;
// the caller has already checked the doors (signed in, game open, on the
// roster) and runs the Discord side effects after. Refuses by throwing one of
// three codes, read by the caller: ALREADY_ALIVE, PARTY_OVER, NO_ROLE.
async function spawnSkinless(prisma, { discordUserId, partyId, turn = null, rng = Math.random }) {
  const { partySeatUnderLock } = require("./lateParty");
  const { expiryForGrant } = require("./grantExpiry");
  const { settleLobbyEntry } = require("./lobby");
  const { releaseFate } = require("./fateReservation");
  const role = await prisma.role.findUnique({ where: { slug: SKINLESS_ROLE_SLUG } });
  if (!role) throw new Error("NO_ROLE");
  const party = await prisma.lateParty.findUnique({
    where: { id: partyId },
    select: { skinlessLocationId: true },
  });
  const locationId = party?.skinlessLocationId ?? role.startingLocationId ?? null;
  const location = locationId
    ? await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } })
    : null;

  const catalog = await prisma.tag.findMany({
    where: { slug: { in: SKINLESS_TAG_SLUGS } },
    select: {
      id: true,
      slug: true,
      name: true,
      stackable: true,
      defaultDurationTurns: true,
      requiredTagId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const slugs = rollSkinlessTags(catalog, rng);
  const tags = slugs.map((slug) => catalog.find((t) => t.slug === slug));
  const identity = rollSkinlessIdentity(rng);

  const character = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
    // Under the lock, so a double click cannot make two.
    const living = await tx.character.count({ where: { discordUserId, status: "ALIVE" } });
    if (living > 0) throw new Error("ALREADY_ALIVE");
    const seat = await partySeatUnderLock(tx, partyId, role, { excludeDiscordUserId: discordUserId });
    if (!seat) throw new Error("PARTY_OVER");
    await releaseFate(tx, discordUserId);

    const created = await tx.character.create({
      data: {
        discordUserId,
        firstName: identity.firstName,
        lastName: identity.lastName,
        name: identity.name,
        gender: identity.gender,
        age: identity.age,
        discordMirrored: false, // as createCharacter: web first, Discord from the Bio card
        roleId: role.id,
        roleTitle: role.name,
        // Denormalization contract: every locationId writer also writes zoneId.
        locationId: location?.id ?? null,
        zoneId: location?.zoneId ?? null,
        tagPoints: 0,
        latePartyId: partyId,
      },
    });
    const rows = [];
    for (const tag of tags) {
      rows.push({
        characterId: created.id,
        tagId: tag.id,
        source: "GM_GRANT",
        quantity: 1,
        expiresTurn: await expiryForGrant(tx, tag, turn, { characterId: created.id, where: "spawnSkinless" }),
      });
    }
    await tx.characterTag.createMany({ data: rows });
    // A seat the muster drew, a name in its hat: spent or taken out by this body.
    await settleLobbyEntry(tx, discordUserId, created.id);
    await tx.latePartyEntry.deleteMany({ where: { discordUserId } });
    return created;
  });

  return { character, role, location, tags, identity };
}

// Smell Skin: hops to the nearest living character who is not a Skinless, or
// null. Every way counts, the way a shout's does (locationGraph.js#soundRange);
// the Charon's Space has no ways, so nobody asleep up there is ever smelled.
async function smellSkin(db, character) {
  const { soundRange } = require("./locationGraph");
  if (!character?.locationId) return null;
  const range = await soundRange(db, character.locationId, 999);
  if (range.length === 0) return null;
  const distanceOf = new Map(range.map((r) => [r.locationId, r.distance]));
  const people = await db.character.findMany({
    where: {
      status: "ALIVE",
      id: { not: character.id },
      locationId: { in: [...distanceOf.keys()] },
      tags: { none: { quantity: { gt: 0 }, tag: { slug: SKINLESS_TAG_SLUG } } },
    },
    select: { locationId: true },
  });
  let best = null;
  for (const p of people) {
    const d = distanceOf.get(p.locationId);
    if (d !== undefined && (best === null || d < best)) best = d;
  }
  return best;
}

// ─── Discord ─────────────────────────────────────────────────────────────────
//
// A Discord channel shows one text to everybody in it, so a Skinless's line is
// posted there as grunts (the same grunts the web lens draws, seeded by the
// row). The other Skinless in the room who play on DISCORD are sent the words
// by DM; a Skinless who plays on the web reads them in /chat already.

// What Discord is handed for this row's text: grunts for a Skinless speaker.
async function discordTextFor(db, { characterId, content, seq }) {
  if (!(await isSkinless(db, characterId))) return content;
  return gruntify(content ?? "", Number(seq) || 0);
}

// The DM a Skinless listener gets: the speaker as they know them, and the words.
function skinlessWordsLine(name, words) {
  return `${name} says: ${words}`;
}

// Sends the words of a Skinless's line to every other Skinless present who
// types through Discord -- whose own latest line was sent from there. Returns
// how many were told. Best-effort, and only ever called once the post landed.
// `seq` is the row's; it is read again whole, since callers hold narrower rows.
async function relayWordsToSkinless(db, { seq }) {
  if (seq === null || seq === undefined) return 0;
  const { feedRowShape, FEED_ROW_SELECT } = require("./archive");
  const row = await db.archiveEntry.findUnique({ where: { seq: BigInt(seq) }, select: FEED_ROW_SELECT });
  if (!row?.characterId || !row.placeKey || row.source === "SYSTEM" || row.deletedAt) return 0;
  if (!(await isSkinless(db, row.characterId))) return 0;
  const { presentWhere } = require("./memoryHearing");
  const where = await presentWhere(db, row.placeKey, { speakerId: row.characterId });
  if (!where) return 0;
  const present = await db.character.findMany({
    where: {
      AND: [where, { id: { not: row.characterId } }, { discordMirrored: true }],
    },
    select: { id: true, discordUserId: true },
  });
  const skin = await skinlessIdsAmong(db, present.map((p) => p.id));
  const listeners = present.filter((p) => skin.has(p.id));
  if (listeners.length === 0) return 0;

  const { createLens } = require("./strangers");
  const { tokensToNames } = require("./characterMentions");
  const { sendDm } = require("./dm");
  const words = tokensToNames(row.content ?? "");
  let told = 0;
  for (const listener of listeners) {
    const latest = await db.archiveEntry.findFirst({
      where: { characterId: listener.id, kind: "MESSAGE", source: { not: "SYSTEM" } },
      orderBy: { seq: "desc" },
      select: { source: true },
    });
    if (latest?.source !== "DISCORD") continue;
    const [shown] = await createLens(db, { characterId: listener.id }).all([feedRowShape(row)]);
    const name = shown?.name ?? row.concealedAlias ?? row.characterName ?? "Someone";
    await sendDm(db, listener.discordUserId, skinlessWordsLine(name, words), {
      source: "skinless",
      allowedMentions: { parse: [] },
    }).catch((err) => console.error(`Skinless words DM failed for ${listener.id}:`, err?.message ?? err));
    told += 1;
  }
  return told;
}

module.exports = {
  SKINLESS_ROLE_SLUG,
  SKINLESS_TAG_SLUG,
  SKINLESS_BRAIN_SLUG,
  SKINLESS_LAST_NAME,
  SKINLESS_AGE_MIN,
  SKINLESS_AGE_MAX,
  SKINLESS_SPAWN_ZONE_SLUG,
  SKINLESS_AVATAR_PATH,
  SKINLESS_BARRED_SLOTS,
  SKINLESS_EQUIP_REFUSAL,
  SKINLESS_BELIEF_REFUSAL,
  SKINLESS_FACE_REFUSAL,
  SKINLESS_GROUP_REFUSAL,
  SKINLESS_NAMES,
  SKINLESS_PRESET_TAGS,
  SKINLESS_WEAPONS,
  SKINLESS_RANDOM_TAGS,
  SKINLESS_TAG_SLUGS,
  SKINLESS_SYLLABLES,
  LIKELIHOOD,
  seededRng,
  gruntify,
  rollSkinlessIdentity,
  rollSkinlessTags,
  isSkinlessTags,
  smellSkinLine,
  isSkinless,
  skinlessIdsAmong,
  pickSkinlessSpawn,
  spawnSkinless,
  smellSkin,
  discordTextFor,
  skinlessWordsLine,
  relayWordsToSkinless,
};
