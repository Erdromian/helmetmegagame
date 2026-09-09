const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// Speaking as your character without typing in the channel. The typing
// indicator fires under the player's REAL Discord account, so composing in a
// modal is the only way to say something in a room without announcing who you
// are first.
//
// One entry point: /message, run in the channel or thread you want to speak
// in. It does NOT hide the typing indicator when you are already sitting in
// that channel — but it does stop the message existing in plain sight under
// your real name before the proxy deletes it, and run from anywhere you are
// not typing there is no indicator to give you away.
//
// There used to be a 🔊 button on the #turns console with a destination picker
// in front of this modal. The picker could never list a Room thread or a
// Conversation (bot/src/lib/speakTargets.js says why), so it is gone.

// Concealment is no longer asked here: it is a standing state on the
// character (Character.concealed, toggled by /conceal or the switch on
// /character), so a modal checkbox would be a second, contradictable answer
// to a question already settled. A held forcesName tag (db/lib/presentedIdentity.js)
// overrides concealment the same way, and refuses /conceal outright — so
// there is nothing for this modal to ask about that either.
const SPEAK_HELP = "-# Sent as your character. Nobody sees you typing. ‡";

// customId carries the destination, so the submit handler needs no state of
// its own — which matters because an open modal outlives a player walking out
// of the room, and the handler re-checks permissions on submit anyway.
function buildSpeakModal(channelId, channelName) {
  return new ModalBuilder()
    .setCustomId(`say:send:${channelId}`)
    .setTitle(channelName ? `Speak in ${channelName}`.slice(0, 45) : "Speak")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Message")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("say:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1800)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(SPEAK_HELP));
}

module.exports = { buildSpeakModal };
