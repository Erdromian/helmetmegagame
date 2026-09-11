// The Refuse click on a tax DM (docs/tags.yaml's `taxman` description).
//
// The DM arrives in the target's DMs, so guild/member are null; the clicker
// is matched to the row by Discord user id inside db/lib/tax.js#refuseTax.
// The load, ownership check and the answer itself live in db/lib/dmAnswer.js
// — this file keeps only what a gateway client can do and REST cannot:
// editing the interaction's own message. There is no fan-out and no side
// effect to apply — a refusal tells nobody else anything (REQUESTS.md's
// notifyCharacter posture).
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION } = require("@lifeweb/db/lib/dmActions");

async function handleTaxDecline(interaction, pendingTaxId) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.PENDING_TAX, id: pendingTaxId },
    discordUserId: interaction.user.id,
  });
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${result.ok ? result.line : result.reason}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Tax decline button update failed:", err));
}

module.exports = { handleTaxDecline };
