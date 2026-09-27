// The Depot's counter, on Discord: the infoterminal (the ATM, renamed) on the Storefront (and on the
// Inn's bar, db/lib/depot.js#ATM_ROOM_SLUGS), the drop box
// beside it, and the Merchant's gun on his office wall. Each is a button on a
// Room's starter post (db/lib/placeAffordances.js), and the rules behind all
// three live in db/lib/depotCounter.js so this face and the web's place panel
// answer the same way.
//
// Every one of these is deliberately thinner than its web twin. The Depot's
// page is where you compare prices and re-point a sale; these are for the
// moment you are standing at the machine with your phone out.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  counterState,
  bankMove,
  dropIntoBox,
  depotTurretPanel,
  toggleDepotTurret,
} = require("@lifeweb/db/lib/depotCounter");
const { buildAmountModal } = require("../../lib/depotModals");
const { buildTurretModal, TURRET_WORD_FIELD } = require("../../lib/turretModal");
const { DROPBOX_HELP, DROPBOX_EMPTY } = require("@lifeweb/db/lib/placeAffordances");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ack, respond } = require("../../lib/respond");
const { RING_TEXT } = require("@lifeweb/db/lib/ringText");

const ATM_OUT_PREFIX = "depotatm:out";
const ATM_IN_PREFIX = "depotatm:in";
// A button or modal id ending in this asks for the account's PIN as well
// (db/lib/depotCounter.js#terminalAccount): the ring is somebody else's, or its
// owner is Concussed or Amnesiac.
const ATM_PIN_SUFFIX = ":pin";
const ATM_PIN_FIELD = "depotatm:pin";
const ATM_MODAL_PREFIX = "depotatm:m:";
const ATM_AMOUNT_FIELD = "depotatm:amount";

const DROP_PICK_PREFIX = "depotdrop:pick";
const DROP_MODAL_PREFIX = "depotdrop:m:";
const DROP_AMOUNT_FIELD = "depotdrop:amount";

const DEPOT_TURRET_MODAL_PREFIX = "depotturret:toggle:";

// Discord's select menus cap at 25 options, and a pocket with more than 25
// kinds of sellable thing in it is a job for the web page.
const DROP_OPTION_CAP = 25;

async function openTurn() {
  return prisma.turn.findFirst({ where: { closedAt: null }, orderBy: { number: "desc" } });
}

// ---------------------------------------------------------- the infoterminal

// It reads the ring on the presser's finger (docs/systemdocs/RINGS.md). When a
// PIN is needed the balance stays hidden, and each amount modal carries a PIN
// box instead: Discord has no dialog to keep a typed PIN in between steps.
async function handleAtmOpen(interaction) {
  await ack(interaction);
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }

  if (!state.account && state.pinNeeded) {
    await respond(interaction, {
      content: `» *${state.pinPrompt}*`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ATM_OUT_PREFIX + ATM_PIN_SUFFIX).setLabel("Take coin out").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(ATM_IN_PREFIX + ATM_PIN_SUFFIX).setLabel("Put coin in").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }
  if (!state.account) {
    await respond(interaction, state.accountProblem);
    return;
  }

  const backing = state.account.backed ? "" : " Held off-world.";
  await respond(interaction, {
    content:
      `» *${state.account.fingerprint} — ${state.account.balanceObols} ¢ in the account, ` +
      `${state.heldObols} ¢ in your pocket.${backing}*`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ATM_OUT_PREFIX).setLabel("Take coin out").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ATM_IN_PREFIX).setLabel("Put coin in").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// showModal IS the acknowledgement, so these must NOT be acked first.
async function handleAtmAmountOpen(interaction, withdrawing, withPin = false) {
  const modal = buildAmountModal({
    customId: `${ATM_MODAL_PREFIX}${withdrawing ? "out" : "in"}${withPin ? ATM_PIN_SUFFIX : ""}`,
    field: ATM_AMOUNT_FIELD,
    title: withdrawing ? "Take coin out" : "Put coin in",
    label: "How many obols",
  });
  if (withPin) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(RING_TEXT.infoterminalPinLabel)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId(ATM_PIN_FIELD).setStyle(TextInputStyle.Short).setMaxLength(8).setRequired(true),
        ),
    );
  }
  await interaction.showModal(modal);
}

async function handleAtmSubmit(interaction, which) {
  await ack(interaction);
  const turn = await openTurn();
  const withPin = which.endsWith(ATM_PIN_SUFFIX);
  const result = await bankMove(prisma, interaction.user.id, {
    direction: which.startsWith("out") ? "WITHDRAW" : "DEPOSIT",
    amount: Number(interaction.fields.getTextInputValue(ATM_AMOUNT_FIELD)),
    pin: withPin ? interaction.fields.getTextInputValue(ATM_PIN_FIELD) : null,
    turn,
  });
  await respond(interaction, result.ok ? result.line : result.error);
}

// -------------------------------------------------------------- the drop box

async function handleDropBoxOpen(interaction) {
  await ack(interaction);
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }
  if (!state.ownAccount) {
    await respond(interaction, "You don't have an account yet.");
    return;
  }
  if (!state.sellable.length) {
    await respond(interaction, DROPBOX_EMPTY);
    return;
  }

  await respond(interaction, {
    content: `» *${DROPBOX_HELP}*`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(DROP_PICK_PREFIX)
          .setPlaceholder("What goes in?")
          .addOptions(
            state.sellable.slice(0, DROP_OPTION_CAP).map((item) => ({
              label: item.name.slice(0, 100),
              description: `${item.unitPrice} ¢ each · ${item.quantity} held`.slice(0, 100),
              value: item.tagId,
            })),
          ),
      ),
    ],
  });
}

// Opens a modal, so it must NOT be acked first.
async function handleDropBoxPick(interaction) {
  const tagId = interaction.values?.[0] ?? "";
  await interaction.showModal(
    buildAmountModal({
      customId: `${DROP_MODAL_PREFIX}${tagId}`,
      field: DROP_AMOUNT_FIELD,
      title: "Dropbox",
      label: "How many",
    }),
  );
}

async function handleDropBoxSubmit(interaction, tagId) {
  await ack(interaction);
  const turn = await openTurn();
  // The destination is re-derived server-side from the presser's own papers;
  // Discord never offers the choice, so there is nothing here to trust.
  const state = await counterState(prisma, interaction.user.id);
  if (!state.ok) {
    await respond(interaction, state.error);
    return;
  }
  const result = await dropIntoBox(prisma, interaction.user.id, {
    tagId,
    quantity: Number(interaction.fields.getTextInputValue(DROP_AMOUNT_FIELD)),
    destination: state.defaultDestination,
    turn,
  });
  await respond(interaction, result.ok ? result.line : result.error);
}

// ---------------------------------------------------------------- the gun

// Opening the modal isn't the act — the typed word is — so this only checks
// which way the switch is thrown. Everything else waits for the submit.
async function handleDepotTurretOpen(interaction) {
  const panel = await depotTurretPanel(prisma, interaction.user.id);
  if (!panel.ok) {
    await ack(interaction);
    await respond(interaction, panel.error);
    return;
  }
  await interaction.showModal(buildTurretModal("depot", panel.armed, DEPOT_TURRET_MODAL_PREFIX));
}

async function handleDepotTurretSubmit(interaction) {
  await ack(interaction);
  const turn = await openTurn();
  const result = await toggleDepotTurret(prisma, interaction.user.id, {
    word: interaction.fields.getTextInputValue(TURRET_WORD_FIELD),
    turn,
  });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // The room's only warning; best-effort, the switch is thrown either way.
  const location = await prisma.location
    .findUnique({ where: { id: result.locationId }, select: { discordChannelId: true } })
    .catch(() => null);
  if (location?.discordChannelId) {
    await postMessage(location.discordChannelId, ambientLine(result.ambient, [], { signed: false })).catch((err) =>
      console.error("Depot turret line failed:", err),
    );
  }

  await respond(interaction, result.line);
}

module.exports = {
  ATM_OUT_PREFIX,
  ATM_IN_PREFIX,
  ATM_PIN_SUFFIX,
  ATM_MODAL_PREFIX,
  DROP_PICK_PREFIX,
  DROP_MODAL_PREFIX,
  DEPOT_TURRET_MODAL_PREFIX,
  handleAtmOpen,
  handleAtmAmountOpen,
  handleAtmSubmit,
  handleDropBoxOpen,
  handleDropBoxPick,
  handleDropBoxSubmit,
  handleDepotTurretOpen,
  handleDepotTurretSubmit,
};
