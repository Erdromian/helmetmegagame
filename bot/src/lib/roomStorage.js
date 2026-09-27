const { prisma } = require("@lifeweb/db");
const { formatStashLine, formatLocationStorage, countHiddenStacks } = require("@lifeweb/db/lib/roomStash");
const { accessibleRooms, roomAccessKeys } = require("@lifeweb/db/lib/roomAccess");
const { loadRoomsAt, roomAt, WITH_SIDES } = require("@lifeweb/db/lib/roomSides");
const { ack, respond } = require("./respond");
const { actingCharacter } = require("./interactionGuild");

// The Storage button on a Room's starter post (db/lib/roomStarterRow.js):
// an ephemeral line saying what's lying in the room's stash, in Bascinet's
// own format, and a second line saying how many things are hidden under the
// floor (SEARCH.md §9c), so a player knows before spending a Search on it.
// Reading is free to anyone standing at a Location the room opens onto — its
// home, or a side (db/lib/roomSides.js), whose thread carries the same button;
// putting things down or
// picking them up is the web's Transfer (CARRY.md).
async function handleRoomStorage(interaction, roomId) {
  await ack(interaction, { ephemeral: true });
  const character = await actingCharacter(interaction, { select: { locationId: true } });
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      locationId: true,
      ...WITH_SIDES,
      // ⬢ are one of these stacks now, not a column beside them — formatStashLine
      // picks them out by slug, so the slug has to be here.
      tags: { where: { quantity: { gt: 0 } }, select: { quantity: true, tag: { select: { name: true, slug: true } } } },
    },
  });
  if (!room) return respond(interaction, { content: "That room is gone." });
  if (!character?.locationId || !roomAt(room, character.locationId)) {
    return respond(interaction, { content: "You're not here." });
  }
  const hidden = await countHiddenStacks(prisma, roomId);
  return respond(interaction, { content: formatStashLine(room, { hidden }) });
}

// /storage: the same readout for every Room in the character's Location they
// can see — public ones, and private ones their keys or a guest row open. The
// button above lives on each Room's first post, which a player has to find the
// thread and scroll to the top of; this works from anywhere, a DM included.
// Rooms are thread links for a character who plays on Discord, names otherwise.
async function handleStorageCommand(interaction) {
  await ack(interaction);
  const character = await actingCharacter(interaction, {
    select: { id: true, locationId: true, discordMirrored: true, location: { select: { name: true } } },
  });
  if (!character) return respond(interaction, "You don't have a living character.");
  if (!character.locationId) return respond(interaction, "You aren't anywhere yet.");

  const [rooms, keys] = await Promise.all([
    // Every room that opens onto here, and its thread on THIS side.
    loadRoomsAt(prisma, character.locationId, {
      where: { retiredAt: null },
      select: {
        id: true,
        name: true,
        kind: true,
        accessTagSlugs: true,
        discordThreadId: true,
        tags: { where: { quantity: { gt: 0 } }, select: { quantity: true, tag: { select: { name: true, slug: true } } } },
      },
    }),
    roomAccessKeys(prisma, character.id),
  ]);
  const visible = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  const entries = [];
  for (const room of visible) {
    entries.push({
      label: character.discordMirrored && room.discordThreadId ? `<#${room.discordThreadId}>` : `**${room.name}**`,
      room,
      hidden: await countHiddenStacks(prisma, room.id),
    });
  }
  return respond(interaction, formatLocationStorage(character.location?.name ?? "this place", entries));
}

module.exports = { handleRoomStorage, handleStorageCommand };
