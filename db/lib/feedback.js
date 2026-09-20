// The Feedback composer's Discord half. A player or GM writes one note about a
// bug, it is saved as a Feedback row, and this posts the same words into the
// contributors' #bugs channel wearing their own Discord avatar and name — so
// whoever picks it up is reading it from the person who wrote it, not from a
// bot relaying them.

const { ambientLine } = require("./ambientLine");
const {
  FEEDBACK_COOLDOWN_MESSAGE,
  FEEDBACK_COOLDOWN_MS,
  MAX_FEEDBACK_LENGTH,
} = require("./feedbackLimits");
const { ensureChannelWebhook, executeWebhook } = require("./discordRest");

// #bugs, in the contributor category. Hardcoded for the reason db/lib/roleIds.js
// gives: a channel id is not a secret, there is exactly one guild so there is
// exactly one correct value, and a missing env var would have failed silently —
// feedback quietly going nowhere is the worst way for this to break.
const BUGS_CHANNEL_ID = "1551046581858476213";

// Discord caps a webhook username at 80 characters, the same clamp
// postAsCharacter applies for the same reason.
const USERNAME_LIMIT = 80;

function formatFeedback({ characterName, body }) {
  const quoted = String(body)
    .split("\n")
    .map((line) => `» ${line}`)
    .join("\n");
  if (!characterName) return quoted;
  return `${quoted}\n${ambientLine(`playing ${characterName}`)}`;
}

// Best effort on purpose. The Feedback row is the record; a Discord outage must
// never lose somebody's bug report or show them an error for something that
// already saved.
async function postFeedbackToDiscord({ username, avatarUrl, characterName, body }) {
  try {
    const webhook = await ensureChannelWebhook(BUGS_CHANNEL_ID);
    await executeWebhook(webhook, {
      content: formatFeedback({ characterName, body }),
      username: String(username || "Someone").slice(0, USERNAME_LIMIT),
      avatarUrl: avatarUrl || undefined,
    });
    return true;
  } catch (err) {
    console.error("[feedback] could not post to #bugs:", err?.message ?? err);
    return false;
  }
}

module.exports = {
  BUGS_CHANNEL_ID,
  FEEDBACK_COOLDOWN_MS,
  FEEDBACK_COOLDOWN_MESSAGE,
  MAX_FEEDBACK_LENGTH,
  formatFeedback,
  postFeedbackToDiscord,
};
