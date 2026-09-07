const { prisma } = require("@lifeweb/db");
const { formatStashLine } = require("@lifeweb/db/lib/roomStash");
const { ack, respond } = require("./respond");
const { actingCharacter } = require("./interactionGuild");

// The Storage button on a Room's starter post (db/lib/roomStarterRow.js):
// an ephemeral line saying what's lying in the room's stash, in Bascinet's
// own format. Reading is free to anyone standing in the Location; putting
// things down or picking them up is the web's Transfer (CARRY.md).
async function handleRoomStorage(interaction, roomId) {
  await ack(interaction, { ephemeral: true });
  const character = await actingCharacter(interaction, { select: { locationId: true } });
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      locationId: true,
      resources: true,
      tags: { where: { quantity: { gt: 0 } }, select: { quantity: true, tag: { select: { name: true } } } },
    },
  });
  if (!room) return respond(interaction, { content: "That room is gone.", ephemeral: true });
  if (!character?.locationId || character.locationId !== room.locationId) {
    return respond(interaction, { content: "You're not here.", ephemeral: true });
  }
  return respond(interaction, { content: formatStashLine(room), ephemeral: true });
}

module.exports = { handleRoomStorage };
