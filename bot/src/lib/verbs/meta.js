// The two things a PLAYER does rather than their character, on Discord:
// sending feedback, and readying up in the lobby. Neither is a verb in
// db/lib/actionCatalog.js — the lobby comes before there is a character at all,
// and feedback belongs to whoever is typing — so they have their own commands
// (/feedback, /lobby ready|unready) and their own buttons on #turns: Feedback on
// the turns console, Ready and Not ready on the lobby console
// (db/lib/turnsConsoleRow.js). Both are open between sessions. The rules are
// db/lib/verbs/place.js's, shared with the web's Feedback composer and lobby.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { submitFeedback, setReady, setUnready } = require("@lifeweb/db/lib/verbs/place");
const { MAX_FEEDBACK_LENGTH } = require("@lifeweb/db/lib/feedbackLimits");
const { FEEDBACK_ID, LOBBY_READY_ID, LOBBY_UNREADY_ID } = require("@lifeweb/db/lib/turnsConsoleRow");
const { prisma } = require("@lifeweb/db");
const { resolveActingMember } = require("../interactionGuild");
const { ack, respond } = require("../respond");

const META_PREFIX = "meta:";
const FEEDBACK_MODAL_ID = "meta:feedback:send";
const FEEDBACK_FIELD = "meta:feedback:body";

// Opens a modal, so it must NOT be acked first.
function openFeedback(interaction) {
  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(FEEDBACK_MODAL_ID)
      .setTitle("Send feedback")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("What's broken, or what could be better")
          .setDescription("It goes to the GMs, signed with your name.")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(FEEDBACK_FIELD)
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(MAX_FEEDBACK_LENGTH)
              .setRequired(true),
          ),
      ),
  );
}

async function sendFeedback(interaction) {
  await ack(interaction);
  const { member } = await resolveActingMember(interaction);
  const user = interaction.user;
  const result = await submitFeedback(prisma, {
    discordUserId: user.id,
    username: member?.nickname || user.globalName || user.username,
    avatarUrl: member?.displayAvatarURL?.() ?? user.displayAvatarURL?.() ?? null,
    body: interaction.fields.getTextInputValue(FEEDBACK_FIELD),
  });
  return respond(interaction, result.ok ? result.line : result.error);
}

// The member's roles are the roster: the Player role, or a playtester's
// (db/lib/verbs/place.js#onRoster). Read off the guild, never the DM.
async function lobbyAnswer(interaction, verb) {
  await ack(interaction);
  const { member } = await resolveActingMember(interaction);
  const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  const result = await verb(prisma, { discordUserId: interaction.user.id, roleIds });
  return respond(interaction, result.ok ? result.line : result.error);
}

function handleMetaCommand(interaction) {
  if (interaction.commandName === "feedback") return openFeedback(interaction);
  if (interaction.commandName === "lobby") {
    const sub = interaction.options.getSubcommand(false);
    return lobbyAnswer(interaction, sub === "unready" ? setUnready : setReady);
  }
  return null;
}

function handleMetaComponent(interaction) {
  if (interaction.customId === FEEDBACK_ID) return openFeedback(interaction);
  if (interaction.customId === LOBBY_READY_ID) return lobbyAnswer(interaction, setReady);
  if (interaction.customId === LOBBY_UNREADY_ID) return lobbyAnswer(interaction, setUnready);
  if (interaction.customId === FEEDBACK_MODAL_ID) return sendFeedback(interaction);
  return null;
}

const META_COMMANDS = new Set(["feedback", "lobby"]);

module.exports = { META_PREFIX, META_COMMANDS, handleMetaCommand, handleMetaComponent };
