// The Black Market terminal on Discord (docs/systemdocs/DEPOT.md §0n).
//
// The twin of Chat's dialog: feed it obols, or pick a ware and say how many.
// Every rule and every refusal live in db/lib/blackMarket.js, so this face and
// Chat's cannot drift — this file is buttons, selects and modals only.
//
// ACK FIRST on everything (bot/src/lib/respond.js), except the two that open a
// MODAL: showModal IS the acknowledgement, and a deferred interaction can no
// longer open one (CLAUDE.md, "Slash commands").
//
// Its own `bm:` prefixes rather than sub-prefixes of "room:blackmarket:", so
// interactionCreate.js does not have to test them in any particular order.
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
const { blackMarketState, insertObols, blackMarketOrder } = require("@lifeweb/db/lib/blackMarket");
const { BLACK_MARKET_TEXT: T } = require("@lifeweb/db/lib/blackMarketText");

const BM_INSERT_PREFIX = "bm:insert";
const BM_INSERT_MODAL = "bm:insertmodal";
const BM_PICK_PREFIX = "bm:pick:";
const BM_QTY_MODAL = "bm:qty:";

// Discord's cap on one select's options. The shelf runs past it, so it is cut
// into as many selects as it needs (29 wares today: two).
const SELECT_CAP = 25;

/** The open turn, for the ledger stamp and the audit row. Null is fine. */
function openTurn() {
  return prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
}

/** The whole panel, off one fresh read. */
async function panel(discordUserId) {
  const view = await blackMarketState(prisma, discordUserId);
  if (!view.ok) return { content: view.error, components: [] };

  const content = [`**${T.title}**`, T.credit(view.credit), T.carrying(view.carrying), `-# ${T.noWithdraw}`].join("\n");

  const components = [];
  const wares = view.wares.filter((w) => !w.owned);
  for (let i = 0; i < wares.length && components.length < 4; i += SELECT_CAP) {
    const chunk = wares.slice(i, i + SELECT_CAP);
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${BM_PICK_PREFIX}${i / SELECT_CAP}`)
          .setPlaceholder(`${T.orderLabel}: ${chunk[0].name} – ${chunk[chunk.length - 1].name}`.slice(0, 150))
          .addOptions(
            chunk.map((w) => ({
              label: w.name.slice(0, 100),
              value: w.id,
              description: `${w.price} ¢${w.stackable ? " each" : ""}`,
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BM_INSERT_PREFIX).setLabel(T.insertLabel).setStyle(ButtonStyle.Primary),
    ),
  );
  return { content: wares.length ? content : `${content}\n${T.emptyShelf}`, components };
}

/** Say what happened, then redraw — the credit moves under you. */
async function answer(interaction, result) {
  const next = await panel(interaction.user.id);
  await respond(interaction, {
    content: [result.ok ? result.line : result.error, next.content].filter(Boolean).join("\n\n"),
    components: next.components,
  });
}

async function handleBlackMarketOpen(interaction) {
  await ack(interaction);
  await respond(interaction, await panel(interaction.user.id));
}

// showModal IS the ack here — no ack() above it, or the modal can never open.
async function handleBlackMarketInsert(interaction) {
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(BM_INSERT_MODAL)
      .setTitle(T.insertLabel)
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

async function handleBlackMarketInsertSubmit(interaction) {
  await ack(interaction);
  const result = await insertObols(prisma, interaction.user.id, {
    amount: interaction.fields.getTextInputValue("amount"),
    turn: await openTurn(),
  });
  await answer(interaction, result);
}

// A ware picked: ask how many. showModal is the ack.
async function handleBlackMarketPick(interaction) {
  const tagId = interaction.values?.[0] ?? "";
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { name: true } }).catch(() => null);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${BM_QTY_MODAL}${tagId}`)
      .setTitle(`${T.orderLabel}: ${tag?.name ?? "ware"}`.slice(0, 45))
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

async function handleBlackMarketQtySubmit(interaction, tagId) {
  await ack(interaction);
  const result = await blackMarketOrder(prisma, interaction.user.id, {
    items: [{ tagId, quantity: interaction.fields.getTextInputValue("quantity") }],
    turn: await openTurn(),
  });
  await answer(interaction, result);
}

module.exports = {
  BM_INSERT_PREFIX,
  BM_INSERT_MODAL,
  BM_PICK_PREFIX,
  BM_QTY_MODAL,
  handleBlackMarketOpen,
  handleBlackMarketInsert,
  handleBlackMarketInsertSubmit,
  handleBlackMarketPick,
  handleBlackMarketQtySubmit,
};
