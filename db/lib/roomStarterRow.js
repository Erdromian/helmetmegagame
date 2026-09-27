// The buttons on a Room's starter post: Storage (docs/systemdocs/CARRY.md), Search (SEARCH.md §9), Intercom on the Council Room (db/lib/intercom.js), Toggle Turret on the Censor's Office (db/lib/gatehouseTurret.js) and on the Merchant's Office (db/lib/depotCounter.js), Sound Bell on the Cathedral's Bell Tower (db/lib/bell.js), the ATM on the Storefront and in the Inn's and the Den's bars, the Drop Box in the Railyard (docs/systemdocs/DEPOT.md), and the Slot Machine in the Den's Casino (db/lib/slotMachine.js). Watchtowers get a SECOND row composed by db/lib/syncZones.js#roomComponents. Raw component JSON, same reason as locationAnchorRow.js — the sync posts it over REST from db/, which has no discord.js.
// The room id rides in the custom_id, routed by prefix in bot/src/events/interactionCreate.js — change it here and you must change it there. This row is hashed into Room.postHash.

// Labels and predicates live in db/lib/placeAffordances.js; this file is just Discord's shape (rows of five, a style per tone).
const {
  DANGER: DANGER_TONE,
  CENSOR_OFFICE_ROOM_SLUG,
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_SEARCH_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DROPBOX_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  ROOM_SLOTS_PREFIX,
  ROOM_PHONE_PREFIX,
  ROOM_VENDING_PREFIX,
  ROOM_NUKE_PREFIX,
  ROOM_BLACK_MARKET_PREFIX,
  ROOM_CHARON_ENTER_PREFIX,
  ROOM_CHARON_LAUNCH_PREFIX,
  ROOM_CHARON_SLEEP_PREFIX,
  CHARON_LEAVE_PREFIX,
  CASINO_ROOM_SLUG,
  gateControlIn,
  roomAffordances,
} = require("./placeAffordances");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const DANGER = 4;

// Discord's cap on buttons in one action row. A message the cap is broken on
// is rejected whole, which for a starter post means a room nobody can reach.
const ROW_BUTTON_LIMIT = 5;

// `room` needs { id, slug }; `location` needs { slug, attributes } and is
// optional — only the Charon's two read it (db/lib/placeAffordances.js), and
// omitting it drops those rather than breaking the row.
//
// ROWS, five buttons to a row: the Railway at the Depot carries seven (Storage,
// Search, the ATM, the Dropbox, the Phone, Send money, Merchant credit). A room
// with five or fewer is one row, exactly as before, so its Room.postHash does
// not move.
function roomStarterRows(room, location = null) {
  const buttons = roomAffordances(room, location).map((entry) => ({
    type: BUTTON,
    style: entry.tone === DANGER_TONE ? DANGER : SECONDARY,
    custom_id: entry.customId,
    label: entry.label,
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += ROW_BUTTON_LIMIT) {
    rows.push({ type: ACTION_ROW, components: buttons.slice(i, i + ROW_BUTTON_LIMIT) });
  }
  return rows.length > 0 ? rows : [{ type: ACTION_ROW, components: [] }];
}

module.exports = {
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_SEARCH_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  ROOM_ATM_PREFIX,
  ROOM_DROPBOX_PREFIX,
  ROOM_DEPOT_TURRET_PREFIX,
  ROOM_SLOTS_PREFIX,
  ROOM_PHONE_PREFIX,
  ROOM_VENDING_PREFIX,
  ROOM_NUKE_PREFIX,
  ROOM_BLACK_MARKET_PREFIX,
  ROOM_CHARON_ENTER_PREFIX,
  ROOM_CHARON_LAUNCH_PREFIX,
  ROOM_CHARON_SLEEP_PREFIX,
  // Leave is a LOCATION affordance, not a room one — re-exported here anyway so
  // the bot's router has all four Charon prefixes from one import.
  CHARON_LEAVE_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  CASINO_ROOM_SLUG,
  gateControlIn,
  roomStarterRows,
  ROW_BUTTON_LIMIT,
};
