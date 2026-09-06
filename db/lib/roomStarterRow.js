// The buttons on a Room's starter post. Storage is on every one of them and
// prints what is lying in the room's stash (docs/systemdocs/CARRY.md);
// Intercom is on exactly one, the Council Room, and works the PA
// (db/lib/intercom.js); Toggle Turret is on exactly one other, the Censor's
// Office, and works the gun in the fortress yard
// (db/lib/gatehouseTurret.js); Sound Bell is on the Cathedral's Bell Tower and
// carries across the Location graph (db/lib/bell.js). The four watchtowers get a SECOND
// row on top of this one — the gate button — composed by
// db/lib/syncZones.js#roomComponents rather than here, because it needs the
// graph and this file has no prisma. Raw component JSON for the same reason as
// locationAnchorRow.js — the sync posts it over REST from db/, which has no
// discord.js, while the bot answers the click.
//
// The room id rides in the custom_id so the handler needs no thread→Room
// lookup. Routed by prefix in bot/src/events/interactionCreate.js — change
// it here and you must change it there.
//
// This row is hashed into Room.postHash, so adding a button here is enough:
// the next db:sync-zones rewrites the one starter that changed and leaves the
// rest of them untouched.

// The LABELS and the predicates live in db/lib/placeAffordances.js, so a
// room's starter post and the Hall's place panel cannot drift about what a
// room offers. What is left here is Discord's shape: one row, and a style
// per tone.
const {
  DANGER: DANGER_TONE,
  CENSOR_OFFICE_ROOM_SLUG,
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  roomAffordances,
} = require("./placeAffordances");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const DANGER = 4;

// `room` needs { id, slug }.
function roomStarterRow(room) {
  return {
    type: ACTION_ROW,
    components: roomAffordances(room).map((entry) => ({
      type: BUTTON,
      style: entry.tone === DANGER_TONE ? DANGER : SECONDARY,
      custom_id: entry.customId,
      label: entry.label,
    })),
  };
}

module.exports = {
  WATCHTOWER_ROOM_SLUGS,
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  roomStarterRow,
};
