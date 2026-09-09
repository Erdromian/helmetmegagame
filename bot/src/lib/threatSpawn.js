// The Accept / Decline click on a threat spawn offer (docs/systemdocs/THREATS.md).
//
// The DM arrives in the target's DMs, so guild/member are null; the clicker is
// matched to the offer by Discord user id inside db/lib/threatSpawn.js. The
// acknowledgement is interaction.update(): the buttons come off the message and
// the outcome is written under it, so a dead button can't be clicked twice and
// the DM reads as a record afterwards. Same shape as bot/src/lib/offers.js —
// this file only routes.
//
// The seat's brief, the audit row and the archive entry now live in
// db/lib/dmAnswer.js, because the WEB answers these buttons too
// (db/lib/dmActions.js). What is left here is gateway-only: editing the
// interaction's own message, and fetching a GuildMember for the nickname sync.
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { applySpawnSideEffects } = require("@lifeweb/db/lib/threatSpawn");
const { syncMemberNickname } = require("./nickname");
const { sendDm } = require("./dm");

// Strips the buttons and writes the outcome under the original text. The
// original content already carries sendDm's `»`; the outcome gets its own.
async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({ content: `${original}\n» ${line}`.slice(0, 2000), components: [] })
    .catch((err) => console.error("Threat spawn button update failed:", err));
}

async function handleSpawn(interaction, spawnId, choice) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.THREAT_SPAWN, id: spawnId },
    choice,
    discordUserId: interaction.user.id,
  });

  // Answer first, then do the slow Discord work — the player is watching, and
  // none of what follows may cost a character that already exists.
  await settle(interaction, result.line);
  if (!result.ok) return;

  // Bascinet's words; one » at the top, as web's sendDm would put it.
  for (const dm of result.dms ?? []) {
    await sendDm(interaction.user, `» ${dm.content}`).catch((err) =>
      console.error("Threat spawn brief DM failed:", err),
    );
  }

  if (result.sideEffects.spawn) {
    await applySpawnSideEffects(prisma, result.sideEffects.spawn).catch((err) =>
      console.error("Threat spawn side effects failed:", err),
    );
  }

  // The nickname sync wants a guild member, which a DM interaction has not
  // got — fetch it. buildNickname lives on each face separately, so this is
  // the bot's own copy rather than a third one in db/lib.
  if (result.sideEffects.nicknameSyncDiscordUserId) {
    try {
      const guild = await interaction.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const member = await guild.members.fetch(result.sideEffects.nicknameSyncDiscordUserId);
      await syncMemberNickname(member);
    } catch (err) {
      console.error("Threat spawn nickname sync failed:", err);
    }
  }
}

async function handleThreatSpawnAccept(interaction, spawnId) {
  await handleSpawn(interaction, spawnId, DM_CHOICE.ACCEPT);
}

async function handleThreatSpawnDecline(interaction, spawnId) {
  await handleSpawn(interaction, spawnId, DM_CHOICE.DECLINE);
}

module.exports = { handleThreatSpawnAccept, handleThreatSpawnDecline };
