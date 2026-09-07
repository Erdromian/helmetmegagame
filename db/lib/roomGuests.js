// TODO(rewire): a faithful extraction of the Room half of /add and /remove,
// bot/src/events/interactionCreate.js#handleRoomGuestCommand (around lines
// 458-538 at 2f4f79ca). The bot still runs its own copy; it should call
// addRoomGuest()/removeRoomGuest() and answer with the `line` they hand back.
// Same gates in the same order, same refusal sentences, same Discord side
// effects — the one difference is that the bot resolves its target from a
// Discord ROLE and these take a character id, so the "that isn't a living
// character's role" refusal is worded for a caller that picked a person.

// A RoomGuest row is the ONE way into a private room's thread without one of
// its access tags (db/lib/roomAccess.js).
//
// Who may work the door: anyone STANDING here who can get in — a key or a
// guest row, plus their own feet. Both halves are checked; the feet alone are
// not enough. A GM may always. That used to be read off
// Discord thread membership, which quietly became "holds a key" once a
// keyholder was a member of every room their key opens, everywhere on the map;
// the LOCATION comparison is the thing that was always meant.
//
// The target has to be standing here too, because the grant is spent the
// moment they leave — inviting somebody far away would hand them a row that
// dies before they ever saw the door.
//
// removeRoomGuest refuses a key-holder on purpose. Their key is what admits
// them, and the next arrival or tag change would let them straight back in;
// taking the key is the real removal, so say so rather than doing something
// that undoes itself.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { heldTagSlugs, recordRoomThread, roomAccessKeys } = require("./roomAccess");
const { addThreadMember, removeThreadMember } = require("./discordRest");

const ROOM_SELECT = {
  id: true,
  name: true,
  kind: true,
  accessTagSlugs: true,
  locationId: true,
  discordThreadId: true,
  location: { select: { name: true } },
};

const GUEST_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  discordUserId: true,
  webOnly: true,
  updatedAt: true,
};

// The shared front half: the room, the actor's standing, and the target.
// `actor` may be null for a GM. Returns { room, target } or { error }.
async function doorwayFor(prisma, { actor, roomId, characterId, gm = false }) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: ROOM_SELECT });
  if (!room) return { error: "That room no longer exists. ‡" };
  if (room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in. ‡" };

  if (!gm) {
    if (!actor?.id || !room.locationId || actor.locationId !== room.locationId) {
      return { error: "You're not in this room. ‡" };
    }
    // Standing at the Location is NOT being inside the room. On Discord that
    // second half was implicit — the command was typed into the room's own
    // thread, which only an entitled character can see — and lifting the code
    // out of the bot dropped it, so anybody in the street could have let
    // anybody through a door they had no key to. A key or a guest row is what
    // being inside means (db/lib/roomAccess.js), and it is the same pair
    // accessibleRooms() tests everywhere else.
    const keys = await roomAccessKeys(prisma, actor.id);
    const inside =
      room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
    if (!inside) return { error: "You are not inside that room. ‡" };
  }

  const target = await prisma.character.findFirst({
    where: { id: String(characterId ?? ""), status: "ALIVE" },
    select: GUEST_SELECT,
  });
  if (!target) return { error: "That isn't a living character. ‡" };
  if (target.locationId !== room.locationId) {
    return { error: `${target.name} isn't here to be let in. ‡` };
  }
  return { room, target };
}

// Returns { ok, line, target, room, notify } — `notify` is the "a door opened
// for you" DM the caller sends (the bot's notifyLetIn), left to the caller
// because the two faces reach a player's DMs through different functions.
async function addRoomGuest(prisma, { actor = null, roomId, characterId, gm = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  await prisma.roomGuest
    .upsert({
      where: { roomId_characterId: { roomId: room.id, characterId: target.id } },
      update: {},
      create: { roomId: room.id, characterId: target.id, invitedById: actor?.id ?? null },
    })
    .catch((err) => console.error("Failed to record room guest:", err.message ?? err));

  // The guest ROW above is the grant; thread membership is only Discord's copy
  // of it, and a "web only" character has no Discord copy of anything
  // (HALL.md §6). Their record is left saying "not in the thread", which is
  // true, and the web feed shows them the room off the guest row regardless.
  if (!target.webOnly && target.discordUserId && room.discordThreadId) {
    try {
      await addThreadMember(room.discordThreadId, target.discordUserId);
      // Without this the guest is never shown out: the mover's recompute only
      // acts where entitlement and the record DISAGREE, and an unrecorded
      // membership agrees with "not entitled" forever. See recordRoomThread.
      await recordRoomThread(prisma, target.id, room.id, true);
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
    line: `${target.name} was let in. They stay until they leave. ‡`,
  };
}

async function removeRoomGuest(prisma, { actor = null, roomId, characterId, gm = false } = {}) {
  const found = await doorwayFor(prisma, { actor, roomId, characterId, gm });
  if (found.error) return { ok: false, error: found.error };
  const { room, target } = found;

  const held = await heldTagSlugs(prisma, target.id);
  if (room.accessTagSlugs.some((slug) => held.has(slug))) {
    return { ok: false, error: "Their key admits them. Take the key. ‡" };
  }

  await prisma.roomGuest
    .deleteMany({ where: { roomId: room.id, characterId: target.id } })
    .catch((err) => console.error("Failed to delete room guest:", err.message ?? err));

  // No account behind the character means there is no thread member to drop.
  // Calling with an undefined id fails, and the catch below would report it as
  // a missing bot permission — a wrong answer to a question nobody asked.
  if (target.discordUserId && room.discordThreadId) {
    try {
      await removeThreadMember(room.discordThreadId, target.discordUserId);
      // The record has to follow, or the diff in syncCharacterRoomAccess sees
      // no disagreement and this eviction un-does itself on the next sync.
      await recordRoomThread(prisma, target.id, room.id, false);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from room ${room.id}:`, err.message ?? err);
      return { ok: false, error: "Couldn't remove them. The bot may be missing Manage Threads. ‡" };
    }
  }

  return { ok: true, room, target, line: `${target.name} was shown out.` };
}

// Who is in a private room on a guest row. Key-holders are NOT in this list —
// they are in it by their key, which is a different fact and one the room's
// own accessTagSlugs already says.
async function roomGuests(prisma, roomId) {
  if (!roomId) return [];
  const rows = await prisma.roomGuest.findMany({
    where: { roomId },
    orderBy: { createdAt: "asc" },
    select: { character: { select: { id: true, name: true, status: true, updatedAt: true } } },
  });
  return rows
    .map((row) => row.character)
    .filter((entry) => entry && entry.status === "ALIVE")
    .map((entry) => ({
      characterId: entry.id,
      name: entry.name,
      avatarVersion: entry.updatedAt?.getTime?.() ?? null,
    }));
}

module.exports = { addRoomGuest, removeRoomGuest, roomGuests };
