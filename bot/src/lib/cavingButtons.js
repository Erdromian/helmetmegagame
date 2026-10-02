// A failed Caving roll's "Write your response" on Discord (docs/systemdocs/COMBAT-MODE.md §6): the button on an
// alert caver's trouble DM and the modal the writing happens in — combatButtons.js's Write shape. The button names
// a CavingRoll, never a character, and the caver is resolved from the interaction, so a forwarded message writes
// nothing. The web writes through the same db/lib/cavingResponse.js#respondToCaving.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { CAVING_WRITE_PREFIX, CAVING_RESPOND_PREFIX, cavingResultFor, respondToCaving } = require("@lifeweb/db/lib/cavingResponse");
const { DESCRIPTION_LIMIT, CAVING_SURPRISED } = require("@lifeweb/db/lib/combatMode");
const { ack, respond } = require("./respond");

const OVER = "That caving result is over.";

function isCavingButton(customId) {
  return String(customId ?? "").startsWith(CAVING_WRITE_PREFIX);
}

function isCavingModal(customId) {
  return String(customId ?? "").startsWith(CAVING_RESPOND_PREFIX);
}

function responseModal(rollId, current, note = null) {
  const input = new TextInputBuilder()
    .setCustomId("caving:body")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DESCRIPTION_LIMIT)
    // Required, so an empty submit can never wipe what was written (combatButtons.js#writeModal).
    .setRequired(true);
  if (current) input.setValue(current.slice(0, DESCRIPTION_LIMIT));
  return new ModalBuilder()
    .setCustomId(`${CAVING_RESPOND_PREFIX}${rollId}`)
    .setTitle("Your response")
    .addLabelComponents(new LabelBuilder().setLabel("How do you respond?").setTextInputComponent(input))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(note ?? "-# You can change this until Moves lock."));
}

// Showing the modal IS the acknowledgement, so nothing slow may run first: the reads race 800ms, the Move
// modal's shape. If they lose, the box opens empty with a note. The submit re-checks everything.
async function handleCavingButton(interaction) {
  const rollId = interaction.customId.slice(CAVING_WRITE_PREFIX.length);
  const read = async () => {
    const roll = await prisma.cavingRoll.findUnique({
      where: { id: rollId },
      select: { characterId: true, turn: { select: { id: true, status: true } }, character: { select: { discordUserId: true } } },
    });
    if (!roll || roll.character?.discordUserId !== interaction.user.id || roll.turn?.status !== "OPEN") return null;
    return (await cavingResultFor(prisma, roll.characterId, roll.turn)) ?? null;
  };
  const result = await Promise.race([
    read().catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 800)),
  ]);
  if (result === null) {
    await respond(interaction, OVER);
    return;
  }
  if (result && !result.alert) {
    await respond(interaction, CAVING_SURPRISED);
    return;
  }
  const note = result === undefined ? "-# Couldn't load what you wrote before — what you send now replaces it." : null;
  await interaction.showModal(responseModal(rollId, result?.response ?? "", note));
}

async function handleCavingRespond(interaction) {
  await ack(interaction);
  const rollId = interaction.customId.slice(CAVING_RESPOND_PREFIX.length);
  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const out = await respondToCaving(prisma, {
    characterId: character.id,
    rollId,
    text: interaction.fields.getTextInputValue("caving:body"),
    turn,
  });
  await respond(interaction, out.ok ? out.line : out.error);
}

module.exports = { isCavingButton, isCavingModal, handleCavingButton, handleCavingRespond, responseModal };
