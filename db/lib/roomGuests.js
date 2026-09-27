// A RoomGuest row is the ONE way into a private room's thread without one of its access tags (db/lib/roomAccess.js). Both faces call these —
// the bot picks its target from a Discord ROLE and hands the id down. Who may work the door: anyone STANDING here who can get in — a key or a
// guest row, plus their own feet — or a GM. The target has to be standing here too, since the grant is spent the moment they leave. removeRoomGuest
// refuses a key-holder on purpose: their key would let them straight back in, so taking the key is the real removal.
// A room that opens onto several Locations (db/lib/roomSides.js) is worked one side at a time: the door is the side the
// actor stands at (a GM's, the target's), checked against THAT side's gate, and the pass is good on that side only.

const { heldTagSlugs, recordRoomThread, roomAccessKeys } = require("./roomAccess");
const { addThreadMember, removeThreadMember } = require("./discordRest");
const { presentedMembers, presentedNameOf } = require("./presentedMembers");
const { hiddenFrom } = require("./whosHere");
const { WITH_SIDES, membershipKey, roomAt } = require("./roomSides");

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  accessTagSlugs: true,
  locationId: true,
  discordThreadId: true,
  sortOrder: true,
  location: { select: { name: true } },
  ...WITH_SIDES,
};

const GUEST_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  discordUserId: true,
  discordMirrored: true,
  updatedAt: true,
};

// The shared front half: the room, the actor's standing, and the target.
// `actor` may be null for a GM. Returns { room, target } or { error }.
//
// `byToken` says the caller got `characterId` by resolving a hood token, which
// is the only way a player may reach somebody standing here in a mask. A plain
// id — the web's named row, or the bot's role picker, which names a character
// outright — is refused for a hood with the same sentence as somebody who is
// not here at all, or naming a suspect and watching the door open would tell
// you who is under the mask.
async function doorwayFor(prisma, { actor, roomId, characterId, gm = false, byToken = false }) {
  const row = await prisma.room.findUnique({ where: { id: roomId }, select: ROOM_SELECT });
  if (!row) return { error: "That room no longer exists." };

  const target = await prisma.character.findFirst({
    where: { id: String(characterId ?? ""), status: "ALIVE" },
    select: GUEST_SELECT,
  });

  // The side this door is on: where the actor stands, or for a GM where the target does.
  const room = roomAt(row, gm ? (target?.locationId ?? row.locationId) : actor?.locationId);
  if (!gm && (!actor?.id || !room)) return { error: "You're not in this room." };
  if (room && room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in." };

  if (!gm) {
    // Standing at the Location is NOT being inside the room. A key or a guest row is what being inside means, the same pair accessibleRooms() tests.
    const keys = await roomAccessKeys(prisma, actor.id);
    const inside =
      room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
    if (!inside) return { error: "You aren't inside that room." };
  }

  if (!target) return { error: "That isn't a living character." };
  // Names nobody: the presented name here used to say "A young man isn't here
  // to be let in." for an absent id, which told the asker that character was
  // wearing a hood right now, wherever they were.
  const notHere = { error: "They aren't here to be let in." };
  if (!room || target.locationId !== room.locationId) return notHere;
  if (!gm && !byToken && (await hiddenFrom(prisma, actor, target.id))) return notHere;
  return { room, target };
}

// `notify` is the "a door opened for you" DM the caller sends, left to the caller since the two faces reach a player's DMs differently.
async function addRoomGuest(prisma, { actor = null, roomId, characterId, gm = false, byToken = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm, byToken });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  await prisma.roomGuest
    .upsert({
      where: { roomId_characterId: { roomId: room.id, characterId: target.id } },
      // A pass given at one side and now given at another moves with them: one row per guest per room.
      update: { locationId: room.locationId },
      create: { roomId: room.id, characterId: target.id, invitedById: actor?.id ?? null, locationId: room.locationId },
    })
    .catch((err) => console.error("Failed to record room guest:", err.message ?? err));

  // The guest ROW above is the grant; thread membership is only Discord's copy — a character not mirrored to Discord has none (CHAT.md §6).
  if (target.discordMirrored && target.discordUserId && room.discordThreadId) {
    try {
      await addThreadMember(room.discordThreadId, target.discordUserId);
      // Without this the guest is never shown out: the mover's recompute only acts where entitlement and the record DISAGREE.
      await recordRoomThread(prisma, target.id, membershipKey(room), true);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to room ${room.id}:`, err.message ?? err);
    }
  }

  return {
    ok: true,
    room,
    target,
    notify: {
      discordUserId: target.discordUserId,
      placeName: room.location?.name ?? null,
      threadName: room.name,
      threadId: room.discordThreadId,
    },
    line: `${await presentedNameOf(prisma, target.id, actor)} was let in.`,
  };
}

async function removeRoomGuest(prisma, { actor = null, roomId, characterId, gm = false, byToken = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm, byToken });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  const held = await heldTagSlugs(prisma, target.id);
  if (room.accessTagSlugs.some((slug) => held.has(slug))) {
    return { ok: false, error: "You can't remove them; they have a key." };
  }

  await prisma.roomGuest
    .deleteMany({ where: { roomId: room.id, characterId: target.id } })
    .catch((err) => console.error("Failed to delete room guest:", err.message ?? err));

  if (target.discordUserId && room.discordThreadId) {
    try {
      await removeThreadMember(room.discordThreadId, target.discordUserId);
      // The record has to follow, or syncCharacterRoomAccess sees no disagreement and this eviction un-does itself on the next sync.
      await recordRoomThread(prisma, target.id, membershipKey(room), false);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from room ${room.id}:`, err.message ?? err);
      return { ok: false, error: "Couldn't remove them. The bot may be missing Manage Threads." };
    }
  }

  const shown = await presentedNameOf(prisma, target.id, actor ?? null);
  return { ok: true, room, target, line: `${shown} was shown out.` };
}

// Who is in a private room on a guest row — on one side, when `atLocationId` names it. Key-holders are NOT in this list — a different fact the room's own accessTagSlugs already says.
// Through db/lib/presentedMembers.js, the same resolver the HERE column and a conversation's strip go through — /api/avatar/<id> is ungated, so
// a raw id would leak a hooded guest's real portrait.
async function roomGuests(prisma, roomId, viewer, { atLocationId = null, ...options } = {}) {
  if (!roomId) return [];
  const rows = await prisma.roomGuest.findMany({
    where: { roomId, ...(atLocationId ? { locationId: atLocationId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { characterId: true },
  });
  if (rows.length === 0) return [];
  return presentedMembers(prisma, rows.map((row) => row.characterId), viewer, options);
}

module.exports = { addRoomGuest, removeRoomGuest, roomGuests };
