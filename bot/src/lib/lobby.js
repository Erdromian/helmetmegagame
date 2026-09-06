// The Decline click on an assignment DM (docs/systemdocs/LOBBY.md §4). The DM
// arrives in the player's DMs, so guild/member are null; the clicker is matched
// to the entry by Discord user id inside db/lib/lobby.js. The acknowledgement
// is interaction.update(): the button comes off and the outcome is written
// under the text, the same shape as bot/src/lib/threatSpawn.js.
const { prisma } = require("@lifeweb/db");
const { declineAssignment } = require("@lifeweb/db/lib/lobby");

async function handleLobbyDecline(interaction, entryId) {
  const result = await declineAssignment(prisma, entryId, interaction.user.id);
  const original = interaction.message?.content ?? "";
  await interaction
    .update({ content: `${original}\n» ${result.ok ? result.line : result.reason}`.slice(0, 2000), components: [] })
    .catch((err) => console.error("Lobby decline button update failed:", err));
}

module.exports = { handleLobbyDecline };
