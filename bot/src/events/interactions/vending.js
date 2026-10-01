// The Merchant's vending machine on Discord (docs/systemdocs/VENDING.md).
//
// The full twin of Chat's dialog: a customer can insert, buy and withdraw, and
// the licence holder can unlock, restock, re-price and empty the till. Every
// rule, every refusal and the line the room reads live in db/lib/vending.js, so
// this face and Chat's cannot drift — this file is buttons and modals only.
//
// ACK FIRST on everything (bot/src/lib/respond.js), except the three that open a
// MODAL: showModal IS the acknowledgement, and a deferred interaction can no
// longer open one (CLAUDE.md, "Slash commands").
//
// The panel is re-rendered after every press rather than patched, because the
// machine moves under you: somebody else's five minutes can run out, and the
// shelf is the server's answer rather than this file's memory.
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
const { ack, respond, scheduleDismiss } = require("../../lib/respond");
const {
  machineView,
  takeMachine,
  releaseMachine,
  insertCoins,
  withdrawCoins,
  buySlot,
  unlockMachine,
  lockMachine,
  collectTill,
  stockMachine,
  unstockMachine,
  setSlotPrice,
} = require("@lifeweb/db/lib/vending");
const {
  VENDING_TEXT,
  VENDING_MAX_PRICE,
  VENDING_SHELF_CAP,
  timeLeftFromSeconds,
} = require("@lifeweb/db/lib/vendingText");
const { isTradeable } = require("@lifeweb/db/lib/tradeable");
const { OBOL_SLUG } = require("@lifeweb/db/lib/depotState");

// Every sub-prefix starts with the open prefix "room:vending:", so
// interactionCreate.js must test these BEFORE it — the lesson Pray and Slots
// each learned the hard way.
const VENDING_BUY_PREFIX = "room:vending:buy:";
const VENDING_INSERT_PREFIX = "room:vending:insert:";
const VENDING_INSERT_MODAL = "room:vending:insertmodal:";
const VENDING_WITHDRAW_PREFIX = "room:vending:withdraw:";
const VENDING_LEAVE_PREFIX = "room:vending:leave:";
const VENDING_UNLOCK_PREFIX = "room:vending:unlock:";
const VENDING_LOCK_PREFIX = "room:vending:lock:";
const VENDING_COLLECT_PREFIX = "room:vending:collect:";
const VENDING_OUT_PREFIX = "room:vending:out:";
const VENDING_IN_PREFIX = "room:vending:in:";
const VENDING_IN_MODAL = "room:vending:inmodal:";
const VENDING_PRICE_PREFIX = "room:vending:price:";
const VENDING_PRICE_MODAL = "room:vending:pricemodal:";

/** The open turn, for the ledger stamp and the audit row. Null is fine — the machine runs between turns too. */
function openTurn() {
  return prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
}

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

/**
 * The grey line under a dropdown option. Free is spelled out rather than priced
 * at 0, matching the shelf line directly above it — the dropdown used to read
 * "0 ¢ each" under a line reading "free".
 */
function shelfDesc(s) {
  return s.priceObols > 0
    ? VENDING_TEXT.selectDesc(s.priceObols, s.quantity)
    : VENDING_TEXT.selectDescFree(s.quantity);
}

/** Discord allows five buttons a row and five rows; the panel never needs more than three. */
function rows(...buttons) {
  const out = [];
  const flat = buttons.filter(Boolean);
  for (let i = 0; i < flat.length; i += 5) {
    out.push(new ActionRowBuilder().addComponents(flat.slice(i, i + 5)));
  }
  return out;
}

/** The whole panel, as Discord sees it, off one fresh read. */
async function panel(discordUserId, roomId) {
  const view = await machineView(prisma, discordUserId, roomId);
  if (!view.ok) return { content: view.error, components: [] };

  if (view.mode === "busy") {
    return { content: `${VENDING_TEXT.holderIs(view.holderName ?? "Somebody")}`, components: [] };
  }
  if (view.mode === "closed") {
    return {
      content: VENDING_TEXT.closed,
      components: rows(button(`room:vending:${roomId}`, VENDING_TEXT.btnOpen, ButtonStyle.Primary)),
    };
  }

  const merchant = view.mode === "merchant";
  const held = view.floatObols ?? 0;
  const lines = [
    merchant ? VENDING_TEXT.promptMerchant : VENDING_TEXT.prompt,
    held > 0 ? VENDING_TEXT.floatLine(held) : VENDING_TEXT.floatNone,
    merchant ? (view.tillObols > 0 ? VENDING_TEXT.tillLine(view.tillObols) : VENDING_TEXT.tillNone) : null,
    // Through the shared helper, never VENDING_TEXT.timeLeft directly — reaching
    // for it here is what had Discord saying "274 seconds left." beside Chat's
    // "5 minutes left." off the same machine.
    timeLeftFromSeconds(view.secondsLeft),
  ].filter(Boolean);

  const slots = view.slots ?? [];
  if (slots.length === 0) {
    lines.push(merchant ? VENDING_TEXT.emptyMerchant : VENDING_TEXT.empty);
  } else {
    for (const s of slots) {
      lines.push(
        s.priceObols > 0
          ? VENDING_TEXT.slotRow(s.name, s.priceObols, s.quantity)
          : VENDING_TEXT.slotRowFree(s.name, s.quantity),
      );
    }
  }

  const components = [];
  if (slots.length > 0) {
    // The shelf as a select rather than a button each: VENDING_SHELF_CAP is 25
    // for exactly this reason, so the two faces agree on what fits.
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${VENDING_BUY_PREFIX}${roomId}`)
          .setPlaceholder(VENDING_TEXT.selectBuy)
          .addOptions(
            slots.slice(0, VENDING_SHELF_CAP).map((s) => ({
              label: s.name.slice(0, 100),
              value: s.tagId,
              description: shelfDesc(s).slice(0, 100),
            })),
          ),
      ),
    );
  }

  const controls = [
    button(`${VENDING_INSERT_PREFIX}${roomId}`, VENDING_TEXT.btnInsert, ButtonStyle.Primary),
    button(`${VENDING_WITHDRAW_PREFIX}${roomId}`, VENDING_TEXT.btnWithdraw, ButtonStyle.Secondary, held <= 0),
    view.licensed && !merchant ? button(`${VENDING_UNLOCK_PREFIX}${roomId}`, VENDING_TEXT.btnUnlock) : null,
    merchant ? button(`${VENDING_LOCK_PREFIX}${roomId}`, VENDING_TEXT.btnLock) : null,
    button(`${VENDING_LEAVE_PREFIX}${roomId}`, VENDING_TEXT.btnLeave, ButtonStyle.Secondary),
  ];
  const merchantControls = merchant
    ? [
        button(`${VENDING_COLLECT_PREFIX}${roomId}`, VENDING_TEXT.btnCollect, ButtonStyle.Secondary, !(view.tillObols > 0)),
        button(`${VENDING_IN_PREFIX}${roomId}`, VENDING_TEXT.btnStockIn),
        slots.length > 0 ? button(`${VENDING_OUT_PREFIX}${roomId}`, VENDING_TEXT.btnStockOut) : null,
        slots.length > 0 ? button(`${VENDING_PRICE_PREFIX}${roomId}`, VENDING_TEXT.btnSetPrice) : null,
      ]
    : [];

  components.push(...rows(...controls, ...merchantControls));
  return { content: lines.join("\n"), components };
}

/** Do a verb, then redraw. The redraw is what makes the panel honest. */
async function verb(interaction, roomId, fn, args = {}) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await fn(prisma, interaction.user.id, { roomId, turn, ...args });
  const next = await panel(interaction.user.id, roomId);
  await respond(interaction, {
    content: [result.ok ? result.line : result.error, next.content].filter(Boolean).join("\n\n"),
    components: next.components,
  });
}

// --- opening -------------------------------------------------------------

async function handleVendingOpen(interaction, roomId) {
  await ack(interaction);
  const turn = await openTurn();
  // Opening TAKES the machine — the view is what is exclusive, so a second
  // person cannot so much as read the float. A refusal is not fatal: the panel
  // draws "somebody else is at it" rather than an error.
  await takeMachine(prisma, interaction.user.id, { roomId, turn });
  const next = await panel(interaction.user.id, roomId);
  await respond(interaction, next);
}

async function handleVendingLeave(interaction, roomId) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await releaseMachine(prisma, interaction.user.id, { roomId, turn });
  await respond(interaction, result.ok ? result.line : result.error);
  if (result.ok) scheduleDismiss(interaction);
}

// --- the customer --------------------------------------------------------

// showModal IS the ack here — no ack() above it, or the modal can never open.
async function handleVendingInsert(interaction, roomId) {
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${VENDING_INSERT_MODAL}${roomId}`)
      .setTitle(VENDING_TEXT.modalInsertTitle)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("amount")
            .setLabel(VENDING_TEXT.modalInsertField)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      ),
  );
}

async function handleVendingInsertSubmit(interaction, roomId) {
  await verb(interaction, roomId, insertCoins, {
    amount: interaction.fields.getTextInputValue("amount"),
  });
}

async function handleVendingWithdraw(interaction, roomId) {
  await verb(interaction, roomId, withdrawCoins);
}

async function handleVendingBuy(interaction, roomId) {
  await verb(interaction, roomId, buySlot, { tagId: interaction.values?.[0] });
}

// --- the merchant --------------------------------------------------------

async function handleVendingUnlock(interaction, roomId) {
  await verb(interaction, roomId, unlockMachine);
}

async function handleVendingLock(interaction, roomId) {
  await verb(interaction, roomId, lockMachine);
}

async function handleVendingCollect(interaction, roomId) {
  await verb(interaction, roomId, collectTill);
}

/** What is in his pockets that could go on the shelf — cargo, ⬢ included, and not coin. */
async function stockables(discordUserId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) return [];
  const held = await prisma.characterTag.findMany({
    where: { characterId: character.id, quantity: { gt: 0 } },
    select: { quantity: true, tag: { select: { id: true, name: true, slug: true, tradeable: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return held
    .filter((ct) => isTradeable(ct.tag) && ct.tag.slug !== OBOL_SLUG)
    .slice(0, VENDING_SHELF_CAP)
    .map((ct) => ({ tagId: ct.tag.id, name: ct.tag.name, held: ct.quantity }));
}

async function handleVendingStockIn(interaction, roomId) {
  await ack(interaction);
  const rowsOut = await stockables(interaction.user.id);
  if (rowsOut.length === 0) {
    await respond(interaction, "You aren't carrying anything the machine would take.");
    return;
  }
  await respond(interaction, {
    content: VENDING_TEXT.selectStock,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${VENDING_IN_MODAL}${roomId}`)
          .setPlaceholder(VENDING_TEXT.selectStock)
          .addOptions(
            rowsOut.map((r) => ({
              label: r.name.slice(0, 100),
              value: r.tagId,
              description: `${r.held} in hand`.slice(0, 100),
            })),
          ),
      ),
    ],
  });
}

// The select hands over to a modal for the two numbers. showModal is the ack.
async function handleVendingStockInPicked(interaction, roomId) {
  const tagId = interaction.values?.[0] ?? "";
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${VENDING_IN_MODAL}${roomId}:${tagId}`)
      .setTitle(VENDING_TEXT.modalStockTitle)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("quantity")
            .setLabel(VENDING_TEXT.modalStockQtyField)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("price")
            .setLabel(VENDING_TEXT.modalStockPriceField)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      ),
  );
}

async function handleVendingStockInSubmit(interaction, rest) {
  const [roomId, tagId] = String(rest).split(":");
  await verb(interaction, roomId, stockMachine, {
    tagId,
    quantity: interaction.fields.getTextInputValue("quantity"),
    priceObols: interaction.fields.getTextInputValue("price"),
  });
}

async function handleVendingStockOut(interaction, roomId) {
  await ack(interaction);
  const view = await machineView(prisma, interaction.user.id, roomId);
  if (!view.ok) {
    await respond(interaction, view.error);
    return;
  }
  const slots = view.slots ?? [];
  if (slots.length === 0) {
    await respond(interaction, VENDING_TEXT.emptyMerchant);
    return;
  }
  await respond(interaction, {
    content: VENDING_TEXT.selectOut,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${VENDING_OUT_PREFIX}pick:${roomId}`)
          .setPlaceholder(VENDING_TEXT.selectOut)
          .addOptions(
            slots.slice(0, VENDING_SHELF_CAP).map((s) => ({
              label: s.name.slice(0, 100),
              value: s.tagId,
              description: shelfDesc(s).slice(0, 100),
            })),
          ),
      ),
    ],
  });
}

// One at a time, which is what the button says. A quantity picker for a shelf
// the merchant is standing in front of is a modal nobody needs.
async function handleVendingStockOutPicked(interaction, roomId) {
  await verb(interaction, roomId, unstockMachine, { tagId: interaction.values?.[0], quantity: 1 });
}

async function handleVendingPrice(interaction, roomId) {
  await ack(interaction);
  const view = await machineView(prisma, interaction.user.id, roomId);
  if (!view.ok) {
    await respond(interaction, view.error);
    return;
  }
  const slots = view.slots ?? [];
  if (slots.length === 0) {
    await respond(interaction, VENDING_TEXT.emptyMerchant);
    return;
  }
  await respond(interaction, {
    content: VENDING_TEXT.selectPrice,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${VENDING_PRICE_PREFIX}pick:${roomId}`)
          .setPlaceholder(VENDING_TEXT.selectPrice)
          .addOptions(
            slots.slice(0, VENDING_SHELF_CAP).map((s) => ({
              label: s.name.slice(0, 100),
              value: s.tagId,
              description: shelfDesc(s).slice(0, 100),
            })),
          ),
      ),
    ],
  });
}

async function handleVendingPricePicked(interaction, roomId) {
  const tagId = interaction.values?.[0] ?? "";
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${VENDING_PRICE_MODAL}${roomId}:${tagId}`)
      .setTitle(VENDING_TEXT.modalPriceTitle)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("price")
            .setLabel(VENDING_TEXT.modalPriceField)
            .setPlaceholder(`0 – ${VENDING_MAX_PRICE}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      ),
  );
}

async function handleVendingPriceSubmit(interaction, rest) {
  const [roomId, tagId] = String(rest).split(":");
  await verb(interaction, roomId, setSlotPrice, {
    tagId,
    priceObols: interaction.fields.getTextInputValue("price"),
  });
}

module.exports = {
  VENDING_BUY_PREFIX,
  VENDING_INSERT_PREFIX,
  VENDING_INSERT_MODAL,
  VENDING_WITHDRAW_PREFIX,
  VENDING_LEAVE_PREFIX,
  VENDING_UNLOCK_PREFIX,
  VENDING_LOCK_PREFIX,
  VENDING_COLLECT_PREFIX,
  VENDING_OUT_PREFIX,
  VENDING_IN_PREFIX,
  VENDING_IN_MODAL,
  VENDING_PRICE_PREFIX,
  VENDING_PRICE_MODAL,
  handleVendingOpen,
  handleVendingLeave,
  handleVendingInsert,
  handleVendingInsertSubmit,
  handleVendingWithdraw,
  handleVendingBuy,
  handleVendingUnlock,
  handleVendingLock,
  handleVendingCollect,
  handleVendingStockIn,
  handleVendingStockInPicked,
  handleVendingStockInSubmit,
  handleVendingStockOut,
  handleVendingStockOutPicked,
  handleVendingPrice,
  handleVendingPricePicked,
  handleVendingPriceSubmit,
};
