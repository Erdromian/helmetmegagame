// The Nuclear Device, the Datacard that points at it, and the countdown.
//
// THE SHAPE, because it is not obvious from any one function:
//
//   - WHERE the device is lives on the tag rows, and is read fresh every time
//     the pointer is used. Nothing caches it, so carrying the bomb, stashing
//     it in a room or packing it into a crate all just work.
//   - WHETHER it is armed lives on GameState.nukeArmedTurn — global state,
//     not a tag. A tag would have a holder, and a holder can die inside the
//     two-turn window, which would silently cancel the explosion. The blast
//     needs no location: it is everyone above ground, wherever they are.
//   - The explosion itself is a turn pass (db/lib/nukeExplosionPass.js).
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays OFF the @lifeweb/db barrel.

const { soundRange } = require("./locationGraph");

const DEVICE_SLUG = "nuclear-device";
const DATACARD_SLUG = "nuclear-datacard";

// Turns between arming and the fireball. Two, counted the way every other
// duration in the game counts (TAGS.md §5): armed while turn T is open, it
// fires as turn T+1 closes — two turn-closes away from the player pressing it.
const NUKE_FUSE_TURNS = 2;

// Where the device physically is, as a locationId, or null if it is nowhere
// the map can name.
//
// THREE homes, and the third is the one that is easy to forget: a tag can sit
// on a character, in a room's stash, or inside a CRATE — and crate contents
// are a JSON column (Tag.crateContents), not a relation, so no `where: { tagId }`
// will ever find one. A bomb packed into a crate would make the pointer lie,
// which is worse than it failing.
async function deviceLocationId(prisma) {
  const tag = await prisma.tag.findUnique({ where: { slug: DEVICE_SLUG }, select: { id: true } });
  if (!tag) return null;

  // 1. On somebody's sheet. A character with no location (never placed) is
  //    not an answer, hence the `not: null`.
  const held = await prisma.characterTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (held?.character?.locationId) return held.character.locationId;

  // 2. In a room stash. RoomTag carries no locationId of its own.
  const stashed = await prisma.roomTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  if (stashed?.room?.locationId) return stashed.room.locationId;

  // 3. Inside a crate, somewhere. Only runtime crate rows carry contents, so
  //    this scans a handful of rows rather than the catalog.
  const crates = await prisma.tag.findMany({
    where: { crateContents: { not: null } },
    select: { id: true, crateContents: true },
  });
  const carrying = crates
    .filter((c) => Array.isArray(c.crateContents) && c.crateContents.some((line) => line?.tagId === tag.id))
    .map((c) => c.id);
  if (carrying.length === 0) return null;

  const crateHeld = await prisma.characterTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (crateHeld?.character?.locationId) return crateHeld.character.locationId;

  const crateStashed = await prisma.roomTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  return crateStashed?.room?.locationId ?? null;
}

// What the datacard says to somebody standing at `fromLocationId`.
//
// Returns { here: true } when the device is at their own Location — on the
// ground, in a room they can see or not, or in anybody's hands — because the
// card cannot point at something it is standing on. Otherwise
// { here: false, via } naming the next Location on the way there.
//
// `via` comes from soundRange's BFS, which already computes "the neighbour on
// the shortest path back toward the origin" for every reachable Location. It
// is run from the DEVICE outward with no hop limit, and with throughHidden so
// the card reads through a secret door — it is tracking its own warhead, not
// overhearing a noise.
async function pointerReading(prisma, fromLocationId) {
  const target = await deviceLocationId(prisma);
  if (!target) return { found: false };
  if (!fromLocationId) return { found: true, here: false, via: null };
  if (target === fromLocationId) return { found: true, here: true, via: null };

  const reach = await soundRange(prisma, target, Infinity, { throughHidden: true });
  const mine = reach.find((row) => row.locationId === fromLocationId) ?? null;
  // No row means no path at all — the device is somewhere the graph cannot
  // reach from here. The card still knows it exists, it just cannot say which
  // way, which is a truthful thing for it to report.
  return { found: true, here: false, via: mine?.viaName ?? null };
}

// The lines the card DMs back. Bascinet's own wording, kept verbatim.
function pointerLine(reading) {
  if (!reading.found) return "» *The datacard finds nothing to point at.* ‡";
  if (reading.here) return "» *The datacard stopped pointing. The nuclear device is here.* ‡";
  if (!reading.via) return "» *The datacard strains, and settles. It cannot find a way there.* ‡";
  return `» *The datacard points towards ${reading.via}.* ‡`;
}

module.exports = {
  DEVICE_SLUG,
  DATACARD_SLUG,
  NUKE_FUSE_TURNS,
  deviceLocationId,
  pointerReading,
  pointerLine,
};
