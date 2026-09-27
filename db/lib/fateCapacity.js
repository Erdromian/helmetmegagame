// Seat math for a fate (a Role row), shared by the character-creation picker, createCharacter's race check, the roll
// and the GM panel, so all of them agree on "full". The rules are E:\Bascinet\V3\Fates\Fate Slot Logic.docx, written
// up in docs/systemdocs/CHARACTERS.md "Fate seats":
//
//   - a constant fate (`multiple: false`) has exactly 1 seat at any game size;
//   - an open fate (`weight: unlimited`) is uncapped;
//   - every other fate carries a share out of FATE_SHARE_TOTAL (`weight:` in docs/roles.yaml) of the POOL — the total
//     fate seats less the CONSTANT_FATE_COUNT constant ones — rounded to the nearest whole seat and never below 1.
//
// `fateSeats` is the total: the readied count plus 10% (fateSeatsFor), which Start Game stamps on
// GameState.playerCount; before Start, the GameConfig.playerCount knob stands in (effectivePlayerCount).

// How many constant fates the lobby hands out, and what the shares add up to. Both are the doc's own numbers — 72
// readied is 80 fate seats, 20 of them constant, leaving 60 for the shares. db/lib/syncRoles.js refuses a roles.yaml
// that stops agreeing with either, so these can never drift from the roster.
const CONSTANT_FATE_COUNT = 20;
const FATE_SHARE_TOTAL = 60;

// Readied players plus 10%, rounded up. Integer arithmetic on purpose: 50 * 1.1 is 55.000000000000014 in floating
// point, which would ceil to 56.
function fateSeatsFor(readied) {
  return Math.ceil((readied * 11) / 10);
}

function fateCapacity(fate, fateSeats) {
  if (fate.isUnique) return 1;
  if (fate.unlimited) return Infinity;
  if (fate.weight == null) return 1;
  const pool = Math.max(0, fateSeats - CONSTANT_FATE_COUNT);
  // round(weight * pool / total), half up, kept in integers.
  return Math.max(1, Math.floor((2 * fate.weight * pool + FATE_SHARE_TOTAL) / (2 * FATE_SHARE_TOTAL)));
}

// Bum and Migrant: the two open fates. Both are uncapped, both are left off the lobby's priority list (a player the
// roll cannot seat picks one of them, or the lobby, as their fallback — LOBBY.md §3), and they are the only seats that
// reopen when their holder dies. Every OTHER fate is spent for the rest of the run — a death costs the roster a seat,
// and nobody inherits it (CHARACTERS.md "Fate seats"). Keyed on Role.slug.
//
// The reopening half of this list used to run the other way, naming the seventeen seats that stayed shut while
// everything else refilled itself. Inverted 2026-09-18: a Merchant who dies takes the Merchant's chair with him, and a
// player who gets buried comes back into whatever is actually left — in a full game, these two.
const OPEN_FATE_SLUGS = ["bum", "migrant"];

// Fates that never appear in the ordinary creation picker — kept here so the roll (db/lib/fateAssignment.js) and the
// picker read one list. Two ways in: a GM spawn (THREATS.md §4), and a late join the GM has opened
// (db/lib/lateJoin.js), which draws its own "Special" section ABOVE the social buckets rather than un-hiding the seat
// here.
const SPAWN_ONLY_FATE_SLUGS = [
  "tribunal-ordinator",
  "tribune",
  // The Bastard's invading party. The Bastard seat itself is the leader; the
  // other five are what Call reinforcements opens.
  "bastard",
  "bastard-infantry",
  "bastard-heavy-infantry",
  "bastard-rifleman",
  "bastard-healer",
  "bastard-engineer",
];

function isSpawnOnly(fate) {
  return SPAWN_ONLY_FATE_SLUGS.includes(fate?.slug);
}

function isOpenFate(fate) {
  return OPEN_FATE_SLUGS.includes(fate?.slug);
}

// May a player put a priority on this fate in the lobby, and may the roll hand it out? Not a spawn-only seat, and not
// Bum or Migrant — those two are the fallback, never a pick.
function isLobbyFate(fate) {
  return !isSpawnOnly(fate) && !isOpenFate(fate);
}

function isPermanentSeat(fate) {
  return !isOpenFate(fate);
}

// Which Character.status values occupy a seat — the one definition behind every `taken` count.
// DEAD counts almost everywhere now, so a seat is only handed back by the two open fates above.
function seatHolderStatuses(fate) {
  return isPermanentSeat(fate) ? ["ALIVE", "DEAD"] : ["ALIVE"];
}

module.exports = {
  CONSTANT_FATE_COUNT,
  FATE_SHARE_TOTAL,
  fateSeatsFor,
  fateCapacity,
  OPEN_FATE_SLUGS,
  SPAWN_ONLY_FATE_SLUGS,
  isSpawnOnly,
  isOpenFate,
  isLobbyFate,
  isPermanentSeat,
  seatHolderStatuses,
};
