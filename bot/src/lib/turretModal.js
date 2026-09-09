const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// The confirm on the big red button in the Censor's Office
// (db/lib/roomStarterRow.js). A modal rather than a second button because
// Discord has no confirm dialog and this one kills people: the gun in the
// fortress yard does not check who anyone is, so arming it endangers the
// Cerberon, the Baron and whoever happens to be crossing the yard.
//
// The typed word is the confirm. It is deliberate friction — a misclick on a
// red button should not be able to shoot the Keep.
//
// The room id rides in the customId so the submit handler can re-check where
// the presser is standing. An ephemeral modal outlives somebody walking out of
// the Garrison, so permission is decided at submit, never at open.

// The two words and the matcher live in db/lib/gatehouseTurret.js, so the
// Chat's confirm asks for the same one.
const { ARM_WORD, DISARM_WORD, turretWordMatches } = require("@lifeweb/db/lib/gatehouseTurret");

const TURRET_MODAL_PREFIX = "turret:toggle:";
const TURRET_WORD_FIELD = "turret:word";

// `armed` is the turret's state RIGHT NOW, so the modal offers the opposite.
function buildTurretModal(roomId, armed) {
  const word = armed ? DISARM_WORD : ARM_WORD;
  return new ModalBuilder()
    .setCustomId(`${TURRET_MODAL_PREFIX}${roomId}`)
    .setTitle(armed ? "Disarm the turret" : "Arm the turret")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Type ${word} to confirm`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(TURRET_WORD_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(16)
            .setRequired(true),
        ),
    );
}

module.exports = {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  ARM_WORD,
  DISARM_WORD,
  buildTurretModal,
  turretWordMatches,
};
