// A fight's buttons on Discord (docs/systemdocs/ATTACK.md): Join / Decline on an invitation, Write your attack
// and Call off on a fighter's own DM, and the modal the writing happens in. Every button names the clicker's own
// CombatParticipant (db/lib/combat.js), never a character, and the clicker is resolved from the interaction —
// never from the button — so a forwarded message answers nothing.
//
// Join, Decline and Call off go through db/lib/dmAnswer.js#answerDmAction, the same function the web's DM
// thread calls, so the two faces cannot answer differently. Writing is a modal here and the Attack dialog on the
// web; both land in db/lib/verbs/combat.js#describeFight.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { describeFight } = require("@lifeweb/db/lib/verbs/combat");
const { DESCRIPTION_LIMIT, SURPRISED } = require("@lifeweb/db/lib/combatMode");
const {
  COMBAT_JOIN_PREFIX,
  COMBAT_DECLINE_PREFIX,
  COMBAT_WRITE_PREFIX,
  COMBAT_DESCRIBE_PREFIX,
  COMBAT_CALL_OFF_PREFIX,
} = require("@lifeweb/db/lib/combat");
const { ack, respond } = require("./respond");
const { sendDm } = require("./dm");

const PREFIXES = [COMBAT_JOIN_PREFIX, COMBAT_DECLINE_PREFIX, COMBAT_WRITE_PREFIX, COMBAT_CALL_OFF_PREFIX];

function isCombatButton(customId) {
  return PREFIXES.some((p) => String(customId ?? "").startsWith(p));
}

function isCombatModal(customId) {
  return String(customId ?? "").startsWith(COMBAT_DESCRIBE_PREFIX);
}

// A fight's DMs, gateway-side, carrying their buttons and the web's descriptor so the two faces draw the same
// row. The `»` is written here because bot/src/lib/dm.js leaves it to its callers.
async function sendCombatDms(client, dms) {
  for (const dm of dms ?? []) {
    const user = await client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(
      user,
      { content: `» ${dm.content}`, components: dm.components ?? [], allowedMentions: { parse: [] } },
      { kind: dm.kind, meta: dm.meta, sfx: dm.sfx, authorDiscordUserId: dm.authorDiscordUserId ?? null },
    ).catch((err) => console.error(`Fight DM to ${dm.discordUserId} failed:`, err.message ?? err));
  }
}

function writeModal(participantId, current, note = null) {
  const input = new TextInputBuilder()
    .setCustomId("combat:body")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DESCRIPTION_LIMIT)
    // Required, so an empty submit can never wipe what was written — the one safe answer when the read below
    // lost its race and the box opened empty.
    .setRequired(true);
  if (current) input.setValue(current.slice(0, DESCRIPTION_LIMIT));
  const modal = new ModalBuilder()
    .setCustomId(`${COMBAT_DESCRIBE_PREFIX}${participantId}`)
    .setTitle("Your attack")
    .addLabelComponents(new LabelBuilder().setLabel("What do you do?").setTextInputComponent(input));
  modal.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(note ?? "-# You can change this until Moves lock."),
  );
  return modal;
}

async function handleCombatButton(interaction) {
  const id = interaction.customId;

  // Showing the modal IS the acknowledgement, so nothing slow may run first. One read, raced against 800ms
  // (the Move modal's shape): if it loses, the box opens empty with a note, and what they send replaces the
  // old text. The submit re-checks everything.
  if (id.startsWith(COMBAT_WRITE_PREFIX)) {
    const participantId = id.slice(COMBAT_WRITE_PREFIX.length);
    const row = await Promise.race([
      prisma.combatParticipant
        .findUnique({
          where: { id: participantId },
          select: { description: true, alert: true, activeTurnId: true, character: { select: { discordUserId: true } } },
        })
        .catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(undefined), 800)),
    ]);
    if (row === null || (row && row.character?.discordUserId !== interaction.user.id)) {
      await respond(interaction, "That fight is over.");
      return;
    }
    if (row && !row.activeTurnId) {
      await respond(interaction, "That fight is over.");
      return;
    }
    if (row && !row.alert) {
      await respond(interaction, SURPRISED);
      return;
    }
    const note = row === undefined ? "-# Couldn't load what you wrote before — what you send now replaces it." : null;
    await interaction.showModal(writeModal(participantId, row?.description ?? "", note));
    return;
  }

  await ack(interaction, { update: true });
  const [kind, choice, participantId] = id.startsWith(COMBAT_JOIN_PREFIX)
    ? [DM_ACTION.COMBAT_INVITE, DM_CHOICE.ACCEPT, id.slice(COMBAT_JOIN_PREFIX.length)]
    : id.startsWith(COMBAT_DECLINE_PREFIX)
      ? [DM_ACTION.COMBAT_INVITE, DM_CHOICE.DECLINE, id.slice(COMBAT_DECLINE_PREFIX.length)]
      : [DM_ACTION.COMBAT, DM_CHOICE.ACCEPT, id.slice(COMBAT_CALL_OFF_PREFIX.length)];
  const result = await answerDmAction(prisma, {
    action: { kind, id: participantId },
    choice,
    discordUserId: interaction.user.id,
  });
  // An invitation's buttons go once it is answered; a fight's own DM keeps its Write button, so only a refusal
  // or a call-off that ended the fight clears it.
  const keep = kind === DM_ACTION.COMBAT && result.ok && !/called off/.test(result.line ?? "");
  await respond(interaction, keep ? { content: result.line } : { content: result.line, components: [] });
  await sendCombatDms(interaction.client, result.dms);
}

async function handleCombatDescribe(interaction) {
  await ack(interaction);
  const participantId = interaction.customId.slice(COMBAT_DESCRIBE_PREFIX.length);
  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const out = await describeFight(prisma, {
    characterId: character.id,
    participantId,
    text: interaction.fields.getTextInputValue("combat:body"),
    turn,
  });
  await respond(interaction, out.ok ? out.line : out.error);
}

module.exports = { isCombatButton, isCombatModal, handleCombatButton, handleCombatDescribe, sendCombatDms, writeModal };
