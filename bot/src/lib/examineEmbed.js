// The 🔍 readout as an embed — one builder behind the 🔍 and 📸 reactions
// (bot/src/events/messageReactionAdd.js) and the /look command
// (bot/src/lib/verbs/people.js), over db/lib/examineRow.js's one readout.
const { EmbedBuilder } = require("discord.js");
const { ALERT_LINE } = require("@lifeweb/db/lib/combatMode");

// Discord embed limits: a breach rejects the whole embed silently. Trim with
// fitField/fitDescription below before adding a field.
const EMBED_FIELD_LIMIT = 1024;
const EMBED_DESCRIPTION_LIMIT = 4096;

function fitField(value) {
  const text = String(value ?? "");
  return text.length > EMBED_FIELD_LIMIT ? `${text.slice(0, EMBED_FIELD_LIMIT - 14)}… (+more)` : text;
}

function fitDescription(value) {
  const text = String(value ?? "");
  return text.length > EMBED_DESCRIPTION_LIMIT ? `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…` : text;
}

// Shared by 🔍 and 📸 — a photograph shows the same thing looking at somebody does.
function examineEmbed(readout) {
  const embed = new EmbedBuilder();
  // "They look alert." under whatever the description says, hood or no hood (COMBAT-MODE.md §5).
  const alert = readout.alert ? `\n\n${ALERT_LINE}` : "";
  if (readout.concealed) {
    embed.setDescription(fitDescription(`${readout.line}${alert}`));
  } else {
    embed.setTitle(readout.name).setDescription(fitDescription(`${readout.appearance || "No visible appearance."}${alert}`));
  }
  // An office is part of who somebody is, so it sits above what they are
  // carrying. It is what the looker REMEMBERS of them (the Friends section of
  // /memories), so a stranger or a hood leaves this null (db/lib/examine.js).
  // Guarded rather than tidied: Discord rejects an empty field value.
  if (readout.roleTitle) {
    embed.addFields({ name: "Role", value: fitField(readout.roleTitle), inline: true });
  }
  if (readout.memory?.name && readout.memory.name !== readout.name) {
    embed.addFields({ name: "You know them as", value: fitField(readout.memory.name), inline: true });
  }
  if (readout.memory?.notes) {
    embed.addFields({ name: "Your notes", value: fitField(readout.memory.notes) });
  }
  if (readout.ailments.length > 0) {
    embed.addFields({ name: "Ailments", value: fitField(readout.ailments.join(", ")) });
  }
  if (readout.equipment.length > 0) {
    embed.addFields({ name: "Equipment", value: fitField(readout.equipment.join(", ")) });
  }
  if (readout.tags.length > 0) {
    const value = readout.tags.map((t) => (t.detail ? `${t.name} (${t.detail})` : t.name)).join(", ");
    embed.addFields({ name: "Tags", value: fitField(value) });
  }
  if (readout.desire) {
    embed.addFields({
      name: "Last Desire",
      value: readout.desire.text
        ? fitField(`» ${readout.desire.text} (+${readout.desire.points})`)
        : "Nothing you can read.",
    });
  }
  // No Resources field. That one used to ride on sharing a faction — a balance
  // with that faction's officers — and with factions gone nobody but a GM is
  // entitled to it. The GM dossier above still prints it, and prints every
  // role, opaque seats included.
  if (process.env.WEB_BASE_URL) {
    embed.setThumbnail(`${process.env.WEB_BASE_URL}${readout.avatarPath}`);
  }
  return embed;
}

module.exports = { fitField, fitDescription, examineEmbed };
