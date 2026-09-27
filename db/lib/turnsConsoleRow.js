// The #turns console buttons, as raw component JSON — plain JSON rather than discord.js builders because both faces need it and only one has discord.js. discord.js accepts raw component JSON exactly as the API does, so one definition serves both, avoiding the twin-drift ARCHITECTURE.md §3 warns about.
// The customIds are routed by exact equality in bot/src/events/interactionCreate.js — change one here and you must change it there.

const BUTTON = 2;
const ACTION_ROW = 1;
const PRIMARY = 1;
const SECONDARY = 2;

const MOVE_EMOJI = "⚜️";

// The Actions menu (bot/src/lib/verbs/index.js) — also on every Location anchor.
const ACTIONS_OPEN_ID = "act:open";
// A player's own buttons, not a character's (bot/src/lib/verbs/meta.js).
const FEEDBACK_ID = "meta:feedback";
const LOBBY_READY_ID = "meta:lobby:ready";
const LOBBY_UNREADY_ID = "meta:lobby:unready";

const FEEDBACK_BUTTON = { type: BUTTON, style: SECONDARY, custom_id: FEEDBACK_ID, label: "Feedback" };

// While a game runs.
const TURNS_CONSOLE_ROW = {
  type: ACTION_ROW,
  components: [
    { type: BUTTON, style: SECONDARY, custom_id: "move:open", label: "Move", emoji: { name: MOVE_EMOJI } },
    { type: BUTTON, style: SECONDARY, custom_id: "loc:open", label: "Travel", emoji: { name: "🗺️" } },
    { type: BUTTON, style: SECONDARY, custom_id: ACTIONS_OPEN_ID, label: "Actions" },
    FEEDBACK_BUTTON,
  ],
};

const CONSOLE_TEXT =
  "-# Moves take effect next turn • Crossing a zone is free once a turn, then it spends your Move • Use /message in a room to speak without showing you typing.";

// While the lobby is open, in place of the console above: nobody has a
// character to move yet, and readying up is the one thing to do (LOBBY.md §2).
const LOBBY_CONSOLE_ROW = {
  type: ACTION_ROW,
  components: [
    { type: BUTTON, style: PRIMARY, custom_id: LOBBY_READY_ID, label: "Ready" },
    { type: BUTTON, style: SECONDARY, custom_id: LOBBY_UNREADY_ID, label: "Not ready" },
    FEEDBACK_BUTTON,
  ],
};

const LOBBY_CONSOLE_TEXT = [
  "**The lobby is open.**",
  "-# Press Ready to be in the roll for a seat when the game starts. Pick and rank the roles you want on the web, at /character.",
].join("\n");

module.exports = {
  TURNS_CONSOLE_ROW,
  CONSOLE_TEXT,
  LOBBY_CONSOLE_ROW,
  LOBBY_CONSOLE_TEXT,
  ACTIONS_OPEN_ID,
  FEEDBACK_ID,
  LOBBY_READY_ID,
  LOBBY_UNREADY_ID,
};
