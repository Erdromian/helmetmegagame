// The verbs tied to one room, on Discord — a button on that room's first post as
// well as its command: Send money at the Depot's Railway. The rule is db/lib's
// (depotCounter.js#bankSend), shared with the infoterminal on the web, and it
// refuses anybody not standing there. The Meister's tax used to be here too; it
// is on the Meister's Terminal now (events/interactions/meisterTerminal.js).
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { bankSend, sendableAccounts } = require("@lifeweb/db/lib/depotCounter");
const { ack, respond } = require("../respond");
const { prisma, openTurn, pickFrom, picked, modalId, OPTION_LIMIT } = require("./context");

const AMOUNT_FIELD = "act:amount";
const VAULT = "vault";

function amountModal(mode, payload, { title, label }) {
  return new ModalBuilder()
    .setCustomId(modalId(mode, payload))
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(label)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId(AMOUNT_FIELD).setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(true),
        ),
    );
}

// --- Send money ------------------------------------------------------------------

// Every living account holder but you, and the Vault. Past Discord's 25 the
// rest are on the web's infoterminal, and the picker says so.
const sendmoney = {
  needs: null,
  async start(interaction, { character }) {
    const accounts = await sendableAccounts(prisma, character.id);
    const shown = accounts.slice(0, OPTION_LIMIT - 1);
    const cut = accounts.length - shown.length;
    return pickFrom(interaction, "sendmoney", "pick", {
      prompt: [
        "Who do you send money to?",
        cut > 0 ? `-# ${cut} more accounts are on the web's infoterminal.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      options: [{ label: "The Vault", value: VAULT }, ...shown.map((a) => ({ label: a.holderName, value: a.id }))],
    });
  },
  steps: {
    // Opens a modal, so it must NOT be acked first.
    pick(interaction) {
      const { value, label } = picked(interaction);
      return interaction.showModal(amountModal("sendmoney", value, { title: `Send to ${label ?? "them"}`.slice(0, 45), label: "How many ¢" }));
    },
  },
  async modal(interaction, to) {
    await ack(interaction);
    const turn = await openTurn();
    const result = await bankSend(prisma, interaction.user.id, {
      toAccountId: to === VAULT ? null : to,
      toTreasury: to === VAULT,
      amount: interaction.fields.getTextInputValue(AMOUNT_FIELD),
      turn,
    });
    if (!result.ok) return respond(interaction, result.error ?? result.reason ?? "That didn't go through.");
    return respond(interaction, result.line ?? `Sent ${result.amount} ¢.`);
  },
};

module.exports = { sendmoney };
