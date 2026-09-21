const { prisma } = require("@lifeweb/db");
const { answerConversionPick } = require("@lifeweb/db/lib/conversionRite");
const { ack, respond } = require("./respond");

// The Rite of Conversion's picker — Discord's half only. Every rule lives in
// db/lib/conversionRite.js, shared with the web (THANATI.md §4a). Runs in a DM,
// so there is no guild and no member: the core resolves the acting character
// off the account and checks it against the chanters snapshotted on the
// attempt, so nothing here has to be trusted.

async function handleConversionPick(interaction, attemptId) {
  await ack(interaction, { ephemeral: true });

  const targetId = interaction.values?.[0];
  if (!targetId) return respond(interaction, { content: "Nobody picked." });

  const result = await answerConversionPick(prisma, {
    attemptId,
    discordUserId: interaction.user.id,
    targetId,
  });
  return respond(interaction, { content: result.ok ? result.line : result.reason });
}

module.exports = { handleConversionPick };
