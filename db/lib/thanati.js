// The Thanati as a cult rather than a seat: who is one, who leads, the hideout, the network's shop, and Recall Comrades' roster line (docs/systemdocs/THANATI.md). Seats live in db/lib/threats.js; rites in db/lib/rites.js.
// Takes `db` as a parameter where it queries, the db/lib/dm.js convention.

const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";
const BLACK_ROBES_SLUG = "black-robes";
const THANATI_MASK_SLUG = "thanati-mask";
const DARK_INSPIRATION_SLUG = "dark-inspiration";
const SHIMMERING_ROBES_SLUG = "shimmering-robes";
const SCRYING_EYE_SLUG = "scrying-eye";
const GHOUL_SLUG = "ghoul";
const SERVANT_SLUG = "servant-of-tzchernobog";
const RAGE_SLUG = "rage";

// "Wearing the robes" for a chant: plain, or the Rite of Reflection's imbued pair.
const ROBE_SLUGS = Object.freeze([BLACK_ROBES_SLUG, SHIMMERING_ROBES_SLUG]);

// What Recover Equipment hands back: whichever of these the cultist lacks.
const RECOVERABLE_SLUGS = Object.freeze([BLACK_ROBES_SLUG, THANATI_MASK_SLUG]);

// The network's shelf. ONE price per ware, not two: an obol is one ⬢ everywhere else (DEPOT.md), and the shelf takes both currencies in the same purchase.
// This list is also what "Thanati equipment" means for the Black Robes' combat line.
const THANATI_WARES = Object.freeze([
  { slug: "stack-of-paper", price: 3 },
  { slug: "black-robes", price: 3 },
  { slug: "instant-camera", price: 3 },
  { slug: "sacrificial-knife", price: 4 },
  { slug: "dagger", price: 6 },
  { slug: "thanati-mask", price: 10 },
  { slug: "radio-27065", price: 20 },
  { slug: "adders-bite", price: 30 },
  { slug: "dynamite-stick", price: 30 },
  { slug: "poison-tooth", price: 40 },
  { slug: "sawn-off-double-barrel", price: 45 },
  { slug: "dynamite-bundle", price: 160 },
]);

const OBOL_SLUG = "obol";

// A roster join glyph shared with the torture reveal (db/lib/torture.js).
const BULLET = " • ";

function isThanati(heldSlugs) {
  return heldSlugs.has(THANATI_SLUG);
}

function isThanatiLeader(heldSlugs) {
  return heldSlugs.has(THANATI_LEADER_SLUG);
}

// Every living cultist, leader first, then by name. `roleTitle` is the character's own role name.
async function listComrades(db) {
  const rows = await db.character.findMany({
    where: { status: "ALIVE", tags: { some: { tag: { slug: THANATI_SLUG } } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      roleTitle: true,
      role: { select: { name: true } },
      tags: { where: { tag: { slug: THANATI_LEADER_SLUG } }, select: { id: true } },
    },
  });
  return rows
    .map((c) => ({ id: c.id, name: c.name, role: c.roleTitle ?? c.role?.name ?? "", leader: c.tags.length > 0 }))
    .sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
}

// The hideout Room, or null when unset or the pointed-at room is gone (a zone sync recreates rooms; the pointer is a snapshot id on purpose).
async function hideoutRoom(db) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, select: { thanatiHideoutRoomId: true } });
  if (!state?.thanatiHideoutRoomId) return null;
  return db.room.findUnique({
    where: { id: state.thanatiHideoutRoomId },
    // `kind`/`accessTagSlugs` ride along for accessibleRooms: Purchase Gear checks the BUYER's key against this room, not just their Location.
    // No ⬢ here: the hideout's balance is a stack row now, so a caller that needs it asks db/lib/resourceStack.js#readRoomResources.
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      locationId: true,
      discordThreadId: true,
    },
  });
}

// The words on a cultist's own THANATI buttons, sent by the server to a
// cultist and to nobody else. web/app/components/actionRegistry.js is in every
// player's browser bundle, so it carries the four buttons (under the neutral
// pool keys seatVerbs / seatLead) but none of their words: the section's name,
// the labels and the help lines all ride on this. The help is Bascinet's words,
// verbatim; Purchase Gear carries none on purpose.
const RECOVER_WORDS = Object.freeze({
  [BLACK_ROBES_SLUG]: { label: "Robes", noun: "the robes" },
  [THANATI_MASK_SLUG]: { label: "Mask", noun: "the mask" },
});

function thanatiVerbCopy(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  const missing = RECOVERABLE_SLUGS.filter((slug) => !held.has(slug)).map((slug) => RECOVER_WORDS[slug]);
  return {
    section: "THANATI",
    labels: {
      recall: "Recall comrades",
      // Worded for what it would actually hand back: "Recover Mask" when the robes are on.
      recover: missing.length ? `Recover ${missing.map((w) => w.label).join(" & ")}` : "Recover equipment",
      hideout: "Set hideout",
      purchase: "Purchase gear",
    },
    help: {
      recall: "Remember the other Thanati cultists in Ravenheart.",
      recover: "Recover your mask and robes from where you left them.",
      hideout: "Set your hideout room, determining where you can purchase things from.",
    },
    canRecover: missing.length > 0,
    recoverAsk: missing.length ? `You get ${missing.map((w) => w.noun).join(" and ")} back.` : "You get them back.",
  };
}

// Robed AND Inspired: the two facts that make a chant count. One query.
async function chanterReady(db, characterId) {
  const rows = await db.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: [...ROBE_SLUGS, DARK_INSPIRATION_SLUG] } } },
    select: { equipped: true, tag: { select: { slug: true } } },
  });
  const robed = rows.some((r) => ROBE_SLUGS.includes(r.tag.slug) && r.equipped);
  const inspired = rows.some((r) => r.tag.slug === DARK_INSPIRATION_SLUG);
  return robed && inspired;
}

module.exports = {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  SHIMMERING_ROBES_SLUG,
  SCRYING_EYE_SLUG,
  GHOUL_SLUG,
  SERVANT_SLUG,
  RAGE_SLUG,
  ROBE_SLUGS,
  RECOVERABLE_SLUGS,
  THANATI_WARES,
  OBOL_SLUG,
  BULLET,
  isThanati,
  isThanatiLeader,
  listComrades,
  hideoutRoom,
  chanterReady,
  thanatiVerbCopy,
};
