// The per-turn fog of war, and the ONE module reading or writing Vantage —
// same rule db/lib/locationVisits.js keeps for LocationVisit and
// db/lib/locationGraph.js keeps for LocationLink. Deliberately NOT on the
// @lifeweb/db barrel; require it by path.
//
// A vantage is a Location you WALKED OUT OF this turn that is still DIRECTLY
// NEXT DOOR to where you stand: you go on watching it, read-only, until you
// walk on past it or the turn shifts. One step, never two. Walk A -> B -> C
// and A goes dark as you reach C, unless C happens to touch A as well.
//
// The zone has nothing to do with it. Walking out through a gate leaves the
// street behind you lit exactly as any other single step would, whether or not
// that gate is a zone boundary.
//
// Where you STAND is never a row — that is Character.locationId, as it always
// was. Keeping it out means the turn wipe is a bare deleteMany with nothing to
// put back, and there is still only one writer of "here".
//
// Every read filters on BOTH snapshot columns: the turn it was lit in, and the
// place the character stood in when it was last confirmed next door
// (`anchorLocationId`). That second one is why a read is one equality rather
// than a walk of the link graph — adjacency is worked out ONCE, by the writer,
// on the move that changes it. So a wipe that failed to run leaves rows that
// already read as dark the instant the character moves, and the channel doctor
// takes their overwrites off on its next pass. The wipes are the belt; this
// filter is the braces.

// What a reader needs to act on a row: where to send the REST call, who to
// send it about, and which zone to file the place under — a vantage can sit in
// a different zone from the one its owner is standing in now. Shared by every
// query below so the shapes can't drift.
const VANTAGE_SELECT = {
  id: true,
  characterId: true,
  locationId: true,
  anchorLocationId: true,
  turnId: true,
  location: {
    select: {
      id: true,
      name: true,
      zoneId: true,
      discordChannelId: true,
      zone: { select: { id: true, name: true } },
    },
  },
};

async function openTurnId(prisma) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  return turn?.id ?? null;
}

// Walking out of somewhere leaves a light on behind you. Called from
// locationMove.js#applyLocationMoveSideEffects, and only for a WALKED crossing
// — a teleport, a rite, a spawn or a staged "Relocate to" never came that way,
// so they leave nothing lit.
//
// `anchorLocationId` is where they now stand, which is what the row is
// adjacent TO. They just walked the link, so the row is next door by
// construction and pruneVantages below will keep it.
//
// Also clears any row on the DESTINATION: you are standing there now, and
// standing is not a row. That is what lets somebody walk back the way they
// came without holding two states of the same channel.
async function lightVantage(prisma, { characterId, fromLocationId, toLocationId, anchorLocationId, turnId }) {
  if (!characterId || !fromLocationId || !anchorLocationId || !turnId) return null;
  if (fromLocationId === toLocationId) return null;

  if (toLocationId) {
    await prisma.vantage.deleteMany({ where: { characterId, locationId: toLocationId } });
  }

  // Upsert rather than create: walking A -> B -> A -> B re-lights A with the
  // current turn, which is also how a row left over from an earlier turn heals.
  return prisma.vantage.upsert({
    where: { characterId_locationId: { characterId, locationId: fromLocationId } },
    create: { characterId, locationId: fromLocationId, anchorLocationId, turnId },
    update: { anchorLocationId, turnId, litAt: new Date() },
    select: VANTAGE_SELECT,
  });
}

// The one-step rule, applied. Called on EVERY arrival, however the character
// got there: what survives is whatever is still next door, and everything else
// goes out. A teleport across the map simply finds nothing adjacent and lands
// in the dark, which is what leaving the zone used to do by a longer road.
//
// `keepLocationIds` is the destination's neighbour list, worked out by the
// caller (travelOptions, so a hidden crawl they lack the tag for never holds a
// light). Survivors are re-anchored to where the character now stands, which
// is what keeps the read filter a single equality.
//
// This is also what puts out a light on the DESTINATION — a teleport or a rite
// can land on a street the character was watching, and without the clear that
// place would be drawn twice in the left column, once as Here and once as
// Elsewhere. Standing somewhere is never a row, so the anchor is never kept.
//
// Returns the rows it PUT OUT, in the usual shape, so the caller can take
// their Discord overwrites off — nothing else knows which channels were open.
async function pruneVantages(prisma, characterId, { anchorLocationId, keepLocationIds = [] } = {}) {
  if (!characterId || !anchorLocationId) return [];

  // Never keep the place they are standing in: here is never a row.
  const keep = [...new Set(keepLocationIds.filter((id) => id && id !== anchorLocationId))];

  const doomed = await prisma.vantage.findMany({
    where: { characterId, locationId: { notIn: keep } },
    select: VANTAGE_SELECT,
  });
  if (doomed.length > 0) {
    await prisma.vantage.deleteMany({ where: { characterId, locationId: { notIn: keep } } });
  }

  if (keep.length > 0) {
    await prisma.vantage.updateMany({
      where: { characterId, locationId: { in: keep } },
      data: { anchorLocationId },
    });
  }

  return doomed;
}

// The lit places for one character, as the whole game should see them. Takes
// the character row rather than an id so the anchor check is against the place
// they are standing in NOW — a row anchored to somewhere they have since
// walked on from is dark, whether or not the prune that should have removed it
// ran.
async function vantagesFor(prisma, character) {
  if (!character?.id || !character.locationId) return [];
  const turnId = await openTurnId(prisma);
  if (!turnId) return [];

  return prisma.vantage.findMany({
    where: { characterId: character.id, anchorLocationId: character.locationId, turnId },
    orderBy: { litAt: "asc" },
    select: VANTAGE_SELECT,
  });
}

// Every valid row in the game, one query, for the channel doctor's occupancy
// sweep. Validity is the same two-column filter as above, applied per row
// against where the character CURRENTLY stands — so a stale row simply doesn't
// come back and the sweep closes its channel.
async function allVantages(prisma, alive) {
  const turnId = await openTurnId(prisma);
  if (!turnId) return [];

  const standingAt = new Map(
    (alive ?? [])
      .filter((c) => c.discordUserId && c.discordMirrored && c.locationId)
      .map((c) => [c.id, c.locationId]),
  );
  if (standingAt.size === 0) return [];

  const rows = await prisma.vantage.findMany({
    where: { turnId, characterId: { in: [...standingAt.keys()] } },
    select: VANTAGE_SELECT,
  });
  return rows.filter((row) => standingAt.get(row.characterId) === row.anchorLocationId);
}

// The turn shift, from the side-effect thunk. `keepTurnId` is the turn that
// has just OPENED: anything lit under it was lit by a relocation inside this
// very push and must survive, everything older goes. Returns the rows with
// their character's Discord id so the caller can close each channel.
async function expireVantages(prisma, { keepTurnId = null } = {}) {
  const where = keepTurnId ? { turnId: { not: keepTurnId } } : {};
  const rows = await prisma.vantage.findMany({
    where,
    select: {
      ...VANTAGE_SELECT,
      character: { select: { id: true, discordUserId: true, discordMirrored: true, status: true } },
    },
  });
  if (rows.length === 0) return [];
  await prisma.vantage.deleteMany({ where });
  return rows;
}

module.exports = {
  lightVantage,
  pruneVantages,
  vantagesFor,
  allVantages,
  expireVantages,
};
