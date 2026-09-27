// The Merchant's Terminal on Discord (docs/systemdocs/DEPOT.md §0c).
//
// The twin of Chat's dialog, thinner, for the moment you are standing at the
// Depot with your phone out: it opens locked, Unlock asks the same question
// the web does, and then you can feed it or empty it, order a ware at a time
// off its shelf, or take a pending order back. Changing an order's quantities
// line by line is the web's; Discord's modals hold five fields and an order
// can hold forty lines. Every rule and every refusal live in
// db/lib/merchantTerminal.js.
//
// ACK FIRST on everything (bot/src/lib/respond.js), except the ones that open a
// MODAL: showModal IS the acknowledgement.
//
// Its own `mt:` prefixes rather than sub-prefixes of "loc:merchantterminal:",
// so interactionCreate.js does not have to test them in any particular order.
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { ack, respond } = require("../../lib/respond");
const {
  terminalState,
  insertObols,
  withdrawObols,
  placeOrder,
  removeOrder,
  orderSummary,
} = require("@lifeweb/db/lib/merchantTerminal");
const { MERCHANT_TERMINAL_TEXT: T } = require("@lifeweb/db/lib/merchantTerminalText");

const MT_UNLOCK = "mt:unlock";
const MT_INSERT = "mt:insert";
const MT_WITHDRAW = "mt:withdraw";
const MT_COIN_MODAL = "mt:coin:";
const MT_PICK_PREFIX = "mt:pick:";
const MT_QTY_MODAL = "mt:qty:";
const MT_REMOVE_PICK = "mt:remove";

// Discord's cap on one select's options, and on rows in one message.
const SELECT_CAP = 25;
const ROW_CAP = 5;

function openTurn() {
  return prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
}

function lockedPanel() {
  return {
    content: [`**${T.title}**`, `\`${T.locked}\``, T.lockedPrompt].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(MT_UNLOCK).setLabel(T.unlockButton).setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

/** The unlocked panel, off one fresh read. */
async function panel(discordUserId) {
  const view = await terminalState(prisma, discordUserId, { unlock: true });
  if (!view.ok) return { content: view.error, components: [] };

  const pendingLines = view.pending.length
    ? view.pending.map((o) => `· ${orderSummary(o.lines)} — ${o.total} ¢ (${T.placedBy(o.placedByName, o.placedTurn)})`)
    : [T.noPending];
  const content = [
    `**${T.title}**`,
    `${T.holds(view.holds)} ${T.committed(view.committed)}`,
    T.carrying(view.carrying),
    `-# ${T.taxNote(view.taxRate)}`,
    "",
    `**${T.tabPending}**`,
    ...pendingLines,
  ].join("\n");

  // The shelf, in its groups' order, cut into selects. One row is kept for the
  // coin buttons and, when there is anything pending, one for Remove.
  const wares = view.groups.flatMap((g) => g.wares.map((w) => ({ ...w, group: g.name })));
  const shelfRows = ROW_CAP - 1 - (view.pending.length ? 1 : 0);
  const components = [];
  for (let i = 0; i < wares.length && components.length < shelfRows; i += SELECT_CAP) {
    const chunk = wares.slice(i, i + SELECT_CAP);
    const groups = [...new Set(chunk.map((w) => w.group))];
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${MT_PICK_PREFIX}${i / SELECT_CAP}`)
          .setPlaceholder(`${T.orderButton}: ${groups[0]}${groups.length > 1 ? ` – ${groups[groups.length - 1]}` : ""}`.slice(0, 150))
          .addOptions(
            chunk.map((w) => ({
              label: w.name.slice(0, 100),
              value: w.id,
              description: `${w.group} · ${w.priceWithTax} ¢${w.stackable ? " each" : ""}`.slice(0, 100),
            })),
          ),
      ),
    );
  }
  if (view.pending.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(MT_REMOVE_PICK)
          .setPlaceholder(`${T.removeButton}…`)
          .addOptions(
            view.pending.slice(0, SELECT_CAP).map((o) => ({
              label: orderSummary(o.lines).slice(0, 100) || "—",
              value: o.id,
              description: `${o.total} ¢ · ${T.placedBy(o.placedByName, o.placedTurn)}`.slice(0, 100),
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(MT_INSERT).setLabel(T.insertLabel).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MT_WITHDRAW).setLabel(T.withdrawLabel).setStyle(ButtonStyle.Secondary),
    ),
  );
  return { content: wares.length ? content : `${content}\n${T.emptyShelf}`, components };
}

/** Say what happened, then redraw — the coin and the list move under you. */
async function answer(interaction, result) {
  const next = await panel(interaction.user.id);
  await respond(interaction, {
    content: [result.ok ? result.line : result.error, next.content].filter(Boolean).join("\n\n"),
    components: next.components,
  });
}

// The button on the Depot's anchor: always the locked screen first.
async function handleMerchantTerminalOpen(interaction) {
  await ack(interaction);
  const view = await terminalState(prisma, interaction.user.id, { unlock: false });
  if (!view.ok) {
    await respond(interaction, view.error);
    return;
  }
  await respond(interaction, lockedPanel());
}

async function handleMerchantTerminalUnlock(interaction) {
  await ack(interaction);
  await respond(interaction, await panel(interaction.user.id));
}

// showModal IS the ack here.
async function handleMerchantTerminalCoin(interaction, withdrawing) {
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${MT_COIN_MODAL}${withdrawing ? "out" : "in"}`)
      .setTitle(withdrawing ? T.withdrawLabel : T.insertLabel)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("amount")
            .setLabel("How many obols?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      ),
  );
}

async function handleMerchantTerminalCoinSubmit(interaction, which) {
  await ack(interaction);
  const fn = which === "out" ? withdrawObols : insertObols;
  const result = await fn(prisma, interaction.user.id, {
    amount: interaction.fields.getTextInputValue("amount"),
    turn: await openTurn(),
  });
  await answer(interaction, result);
}

// A ware picked: ask how many. showModal is the ack.
async function handleMerchantTerminalPick(interaction) {
  const tagId = interaction.values?.[0] ?? "";
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { name: true } }).catch(() => null);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${MT_QTY_MODAL}${tagId}`)
      .setTitle(`${T.orderButton}: ${tag?.name ?? "ware"}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("quantity")
            .setLabel(T.quantityLabel)
            .setStyle(TextInputStyle.Short)
            .setValue("1")
            .setRequired(true),
        ),
      ),
  );
}

async function handleMerchantTerminalQtySubmit(interaction, tagId) {
  await ack(interaction);
  const result = await placeOrder(prisma, interaction.user.id, {
    items: [{ tagId, quantity: interaction.fields.getTextInputValue("quantity") }],
    turn: await openTurn(),
  });
  await answer(interaction, result);
}

async function handleMerchantTerminalRemove(interaction) {
  await ack(interaction);
  const result = await removeOrder(prisma, interaction.user.id, {
    orderId: interaction.values?.[0] ?? "",
    turn: await openTurn(),
  });
  await answer(interaction, result);
}

module.exports = {
  MT_UNLOCK,
  MT_INSERT,
  MT_WITHDRAW,
  MT_COIN_MODAL,
  MT_PICK_PREFIX,
  MT_QTY_MODAL,
  MT_REMOVE_PICK,
  handleMerchantTerminalOpen,
  handleMerchantTerminalUnlock,
  handleMerchantTerminalCoin,
  handleMerchantTerminalCoinSubmit,
  handleMerchantTerminalPick,
  handleMerchantTerminalQtySubmit,
  handleMerchantTerminalRemove,
};
