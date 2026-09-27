// Both party kinds are Location-grain — a room's Locations are every side it opens onto (db/lib/roomSides.js) — using the same accessibleRooms() the thread-membership sync uses, so the gate and the door never disagree.
import { prisma } from "@lifeweb/db";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { partyRoom } from "@lifeweb/db/lib/parties";
import { isHere } from "@/lib/peopleHere";

// One rule, both ends of a transfer: you have to be standing where the goods
// are, and a room's door has to open for you. The faction silo used to be the
// exception — a locked silo stayed a mail slot you could post into from across
// the zone — and that exception went with the silos.
export async function canReachParty(
  actor,
  party,
  { heldSlugs = null, guestRoomIds = null, allowDead = false, allowConcealed = false } = {},
) {
  if (!party) return false;
  if (party.kind === "room") {
    // The room as seen from where the actor stands: null if it does not open onto here, and that side's own gate if it does.
    const view = actor?.locationId ? partyRoom(party, actor.locationId) : null;
    if (!view) return false;
    const keys =
      heldSlugs && guestRoomIds ? { heldSlugs, guestRoomIds } : await roomAccessKeys(prisma, actor.id);
    // partyRoom, never the party: its `kind` is "room", so a private room read straight off it opened for
    // anybody standing at the Location — Transfer, Steal and a room-paid craft or cure all came through here.
    return accessibleRooms([view], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 1;
  }
  if (party.kind === "character") return isHere(actor, party, { allowDead, allowConcealed });
  return false;
}

// A person names nobody: a plain id for somebody here in a hood resolves to no
// party at all (db/lib/targetKey.js), and callers answer that with this same
// sentence — "Ada isn't here." beside it would tell the two cases apart.
export function outOfReachMessage(party) {
  if (party?.kind === "room") return `You can't get into ${party.name} from where you stand.`;
  return "They aren't here.";
}
