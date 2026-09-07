// The Location components both faces share, as raw component JSON: the
// buttons on every Location channel's pinned anchor (Who's here?, Secret
// rooms?, Examine, Converse), one Open/Close button per modular gate — which
// renders on the WATCHTOWER at that gate rather than on either anchor
// (db/lib/roomStarterRow.js#WATCHTOWER_ROOM_SLUGS) — and the Yes/No pair on
// the DM a keyed crossing sends.
//
// Plain JSON rather than discord.js builders for the same reason as
// db/lib/turnsConsoleRow.js: the sync posts these over REST from db/, which
// has no discord.js, while the bot answers the clicks over the gateway.
// One definition serves both faces.
//
// The location id rides in the custom_id so the handlers need no
// channel→location lookup. Routed by prefix in
// bot/src/events/interactionCreate.js — change a prefix here and you must
// change it there.

// The LABELS and the predicates live in db/lib/placeAffordances.js, so the
// anchor and the Hall's place panel cannot drift about what a place offers.
// What is left here is Discord's shape: rows, styles and the 5-per-row cap.
const {
  GO,
  DANGER: DANGER_TONE,
  TRAVEL_CUSTOM_ID,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  locationAffordances,
  gateLabel,
} = require("./placeAffordances");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;


// Discord's cap on buttons in one action row, and on a button label.
const ROW_BUTTON_LIMIT = 5;
const LABEL_MAX = 80;

// Takes the LOCATION rather than a bare id, because the Noticeboard button is
// conditional: it only appears where docs/zones.yaml declared one
// (db/lib/noticeboard.js).
//
// This returns the flat BUTTON LIST; locationAnchorRows below chunks it. It
// used to be one row, with a note that five was Discord's cap and anything
// more needed a second — then Travel arrived, which with a Noticeboard makes
// six. Chunking rather than hand-placing the split means the next button to
// arrive needs no thought either.
//
// TRAVEL IS FIRST, and it carries no emoji. It is the same `loc:open` the
// #turns console offers (db/lib/turnsConsoleRow.js), where it wears a 🗺️ — on
// an anchor it sits in a row of plain-text buttons and the one emoji only made
// it shout. The handler resolves the mover from the interaction rather than
// the channel, so the identical id works from anywhere.
const TONE_STYLE = { [GO]: SUCCESS, [DANGER_TONE]: DANGER };

function locationAnchorButtons(location) {
  return locationAffordances(location).map((entry) => ({
    type: BUTTON,
    style: TONE_STYLE[entry.tone] ?? SECONDARY,
    custom_id: entry.customId,
    label: entry.label.slice(0, LABEL_MAX),
  }));
}

// The rows the anchor posts: the buttons above, chunked to Discord's per-row
// cap. Discord allows five rows of five on one message, so there is headroom;
// the limit that bites first will be the message's, not this.
function locationAnchorRows(location) {
  const buttons = locationAnchorButtons(location);
  const rows = [];
  for (let i = 0; i < buttons.length; i += ROW_BUTTON_LIMIT) {
    rows.push({ type: ACTION_ROW, components: buttons.slice(i, i + ROW_BUTTON_LIMIT) });
  }
  return rows;
}

// One button per modular gate on this location, or null when it has none —
// an action row with no components is rejected by Discord.
//
// This row goes on the watchtower Room's starter post, not on a Location
// anchor. A portcullis has a winch and the winch is in the tower; being able
// to drop one from the open road was the thing that moved it.
//
// The label names the far side, because a location can hold two gates and
// "Close" alone would be a coin flip. The verb is what the click DOES, not
// what the gate currently is: a way standing open offers "Close".
//
// The link id rides in the custom_id, so the handler needs no lookup from
// channel to location to edge. `gates` is [{ linkId, isOpen, farName }],
// built by whoever has the links loaded.
function locationGateRow(gates) {
  const shown = (gates ?? []).slice(0, ROW_BUTTON_LIMIT);
  if (shown.length === 0) return null;
  return {
    type: ACTION_ROW,
    components: shown.map((gate) => ({
      type: BUTTON,
      // Danger on the one that shuts a way, so a misclick reads as one.
      style: gate.isOpen ? DANGER : SUCCESS,
      custom_id: `${GATE_PREFIX}${gate.linkId}`,
      label: gateLabel(gate).slice(0, LABEL_MAX),
    })),
  };
}

// The two buttons on the DM a keyed crossing raises. Not an anchor row — it
// rides on a direct message — but it lives here because every "loc:" custom
// id belongs in one file, which is what keeps the bot's router honest.
//
// The verb is what the click DOES. "Leave it open" is the affirmative, and it
// is the SUCCESS style, because holding a door is the generous act; letting it
// shut is the quiet default and gets no colour.
function keyedPromptRow(linkId) {
  return [
    {
      type: ACTION_ROW,
      components: [
        {
          type: BUTTON,
          style: SUCCESS,
          custom_id: `${KEYED_PREFIX}${linkId}:yes`,
          label: "Leave it open",
        },
        {
          type: BUTTON,
          style: SECONDARY,
          custom_id: `${KEYED_PREFIX}${linkId}:no`,
          label: "Let it shut",
        },
      ],
    },
  ];
}

module.exports = {
  EXAMINE_PREFIX,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  locationAnchorRows,
  TRAVEL_CUSTOM_ID,
  locationGateRow,
  keyedPromptRow,
};
