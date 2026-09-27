// A "party" is either a character or a Room stash, resolved to one uniform shape so a transfer never has to branch on which side of it it's looking at. The turn-end push (db/lib/stagedPush.js) and every GM transfer surface resolve the same key the player-facing TRANSFER_RESOURCES request does.
// Takes `prisma` as the first parameter, same reason as db/lib/dm.js: db/index.js is the one importing this module, so requiring it back would resolve to a partial (prisma-less) exports object.

const { RESOURCES_SELECT, resourcesOf } = require("./resourceStack");
const { roomAt } = require("./roomSides");

// "character:<id>" / "room:<id>". Prisma DELETES an undefined field from a where clause rather than matching nothing, so a malformed key with no id would quietly match "any living character" — `?? ""` matches nobody instead.
async function resolveParty(prisma, key, { allowDead = false } = {}) {
  const [kind, id] = (key ?? "").split(":");
  if (!id) return null;
  if (kind === "character") {
    // Looting is the one caller that walks past the ALIVE filter — a corpse is still a "party" whose ⬢ someone else can pull. Every other caller leaves the flag off.
    const statusFilter = allowDead ? { in: ["ALIVE", "DEAD"] } : "ALIVE";
    const c = await prisma.character.findFirst({
      where: { id: id ?? "", status: statusFilter },
      select: {
        id: true,
        name: true,
        ...RESOURCES_SELECT,
        zoneId: true,
        locationId: true,
        status: true,
        concealed: true,
        buriedAt: true,
        discordUserId: true,
      },
    });
    return c
      ? {
          kind,
          id: c.id,
          name: c.name,
          balance: resourcesOf(c),
          zoneId: c.zoneId,
          locationId: c.locationId,
          status: c.status,
          concealed: c.concealed,
          buriedAt: c.buriedAt,
          discordUserId: c.discordUserId,
        }
      : null;
  }
  // A Room's stash (docs/systemdocs/CARRY.md): reach is "standing in this Location, and admitted to this room" (web/lib/transferReach.js, db/lib/roomAccess.js#accessibleRooms).
  if (kind === "room") {
    const r = await prisma.room.findUnique({
      where: { id: id ?? "" },
      select: {
        id: true,
        name: true,
        kind: true,
        ...RESOURCES_SELECT,
        locationId: true,
        accessTagSlugs: true,
        destroysContents: true,
        discordThreadId: true,
        location: { select: { name: true, zoneId: true } },
        // The other Locations it opens onto, each with its own gate (db/lib/roomSides.js).
        sides: { select: { locationId: true, kind: true, accessTagSlugs: true } },
      },
    });
    return r
      ? {
          kind,
          id: r.id,
          name: r.name,
          balance: resourcesOf(r),
          zoneId: r.location.zoneId,
          locationId: r.locationId,
          locationName: r.location.name,
          roomKind: r.kind,
          accessTagSlugs: r.accessTagSlugs,
          // The Godard Factory's Spillway, carried on the party rather than looked up again by every writer.
          destroysContents: r.destroysContents === true,
          discordThreadId: r.discordThreadId,
          sides: r.sides,
        }
      : null;
  }
  return null;
}

// A room party in the shape roomAccess.js#accessibleRooms reads. Not the party itself: a party's `kind` is
// "room" for every room, so handed over as-is it never equals "PRIVATE" and every private door opens. The real
// kind is `roomKind`. Null for a character party.
//
// `atLocationId` asks for the room as seen from that Location: a counter between two Locations is gated
// separately on each side (db/lib/roomSides.js), and null comes back from a Location it does not open onto.
function partyRoom(party, atLocationId = null) {
  if (party?.kind !== "room") return null;
  const home = {
    id: party.id,
    name: party.name,
    locationId: party.locationId,
    kind: party.roomKind,
    accessTagSlugs: party.accessTagSlugs ?? [],
    sides: party.sides ?? [],
  };
  return atLocationId ? roomAt(home, atLocationId) : home;
}

function partyKey(party) {
  return party ? `${party.kind}:${party.id}` : null;
}

function partyLabel(party) {
  return party?.name ?? "Unknown";
}

module.exports = { resolveParty, partyRoom, partyKey, partyLabel };
