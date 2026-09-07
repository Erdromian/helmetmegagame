// The Thanati as a cult rather than a seat: who is one, who leads, where the
// hideout is, what the network sells, and the roster line Recall Comrades
// sends (docs/systemdocs/THANATI.md). The seats themselves are in
// db/lib/threats.js; the rites in db/lib/rites.js.
//
// Takes `db` as a parameter where it queries, the db/lib/dm.js convention.

const THANATI_SLUG = "thanati";
const THANATI_LEADER_SLUG = "thanati-leader";
const BLACK_ROBES_SLUG = "black-robes";
const THANATI_MASK_SLUG = "thanati-mask";
const DARK_INSPIRATION_SLUG = "dark-inspiration";
const GRIMOIRE_SLUG = "grimoire";

// What Recover Equipment hands back: whichever of these the cultist is not
// holding.
const RECOVERABLE_SLUGS = Object.freeze([BLACK_ROBES_SLUG, THANATI_MASK_SLUG]);

// The network's shelf, in two currencies. An obol is one ⬢ everywhere else in
// the game (DEPOT.md), so the two columns start equal — kept separate because
// the brief shows both and Bascinet may price them apart. PLACEHOLDER LIST:
// Bascinet fills it. This list is also what "Thanati equipment" means for the
// Black Robes' combat line.
const THANATI_WARES = Object.freeze([
  { slug: "dagger", obols: 6, resources: 6 },
  { slug: "black-robes", obols: 3, resources: 3 },
  { slug: "thanati-mask", obols: 10, resources: 10 },
  { slug: "paper", obols: 1, resources: 1 },
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

// Every living cultist, the leader first, then by name. `roleTitle` is the
// character's own role name as shown on their sheet.
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

// "Your comrades are: Ash, Baron [LEADER] • Wren, Servant". Bascinet's shape.
function formatComrades(rows) {
  const parts = rows.map((r) => `${r.name}, ${r.role}${r.leader ? " [LEADER]" : ""}`);
  return `Your comrades are: ${parts.join(BULLET)}`;
}

// The hideout Room, or null when unset or when the room it pointed at is gone
// (a zone sync recreates rooms; the pointer is a snapshot id on purpose).
async function hideoutRoom(db) {
  const state = await db.gameState.findUnique({ where: { id: 1 }, select: { thanatiHideoutRoomId: true } });
  if (!state?.thanatiHideoutRoomId) return null;
  return db.room.findUnique({
    where: { id: state.thanatiHideoutRoomId },
    select: { id: true, name: true, slug: true, locationId: true, discordThreadId: true, resources: true },
  });
}

// Robed AND Inspired: the two facts that make a chant count. One query.
async function chanterReady(db, characterId) {
  const rows = await db.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: [BLACK_ROBES_SLUG, DARK_INSPIRATION_SLUG] } } },
    select: { equipped: true, tag: { select: { slug: true } } },
  });
  const robed = rows.some((r) => r.tag.slug === BLACK_ROBES_SLUG && r.equipped);
  const inspired = rows.some((r) => r.tag.slug === DARK_INSPIRATION_SLUG);
  return robed && inspired;
}

module.exports = {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  BLACK_ROBES_SLUG,
  THANATI_MASK_SLUG,
  DARK_INSPIRATION_SLUG,
  GRIMOIRE_SLUG,
  RECOVERABLE_SLUGS,
  THANATI_WARES,
  OBOL_SLUG,
  BULLET,
  isThanati,
  isThanatiLeader,
  listComrades,
  formatComrades,
  hideoutRoom,
  chanterReady,
};
