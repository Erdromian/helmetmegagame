const { prisma } = require("@lifeweb/db");
const { searchRoom } = require("@lifeweb/db/lib/roomSearch");
const { announceInRoom } = require("@lifeweb/db/lib/roomAnnounce");
const { ack, respond } = require("./respond");
const { actingCharacter } = require("./interactionGuild");

// The Search button on a Room's starter post (db/lib/roomStarterRow.js):
// going through the room for what is under the floor (docs/systemdocs/SEARCH.md
// §9). Every rule — reach, the door, the ACT blocker, one room a turn,
// the die — is db/lib/roomSearch.js#searchRoom, shared with /chat, so the two
// faces cannot disagree about who found what. This file is only the ack, the
// ephemeral answer, and the room's one ambient line.
async function handleRoomSearch(interaction, roomId) {
  await ack(interaction, { ephemeral: true });
  const character = await actingCharacter(interaction, {
    select: {
      id: true,
      status: true,
      locationId: true,
      discordUserId: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return respond(interaction, { content: "You have no living character." });
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  const out = await searchRoom(prisma, { character, roomId, turn });
  if (!out.ok) return respond(interaction, { content: out.reason });

  // The room hears that somebody went through it, and not what they found —
  // Storage says that to anyone who looks. REST, after the answer, so a slow
  // Discord cannot push the reply past the three-second window.
  await respond(interaction, { content: out.readout });
  await announceInRoom(out.room, character, out.line).catch(() => {});
  return undefined;
}

module.exports = { handleRoomSearch };
