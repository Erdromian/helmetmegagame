// Starting money: the wobble on every seat's figures, and the Vault's share.
//
// A seat's `starting_account:` balance and its `Obol xN` purse
// (docs/roles.yaml) are the MIDDLE of a range, not the exact amount. Each
// character rolls both within 10% at creation (web/app/(app)/character/
// createActions.js, and db/lib/reincarnate.js for the purse), so nobody can
// work out another seat's money from the roles list and two Courtiers in one
// game rarely match.
//
// The range is whole obols: from 10% under, rounded up, to 10% over, rounded
// down, every whole number in it equally likely. So a figure under 10 cannot
// move at all (3 ¢ is 2.7–3.3, and the only whole obol in that is 3), which is
// right for pocket change and saves anybody reading 0 where the YAML says 1.
//
// The Keep's Vault has no authored pile any more. It is stocked as the town is
// made: each new character's starting balance — as rolled — puts
// GameConfig.vaultReservePercent of it into the Vault as coin (vaultStockFor
// below; 25% by default, a knob on /gm/dev). So the Vault always holds that
// share of what everybody opened with, late joiners included, and it wobbles
// from game to game along with the balances it follows. The Baron is left out:
// their account is the treasury's to begin with, and the Vault is not stocked
// against it.
//
// Pure apart from the obol slug, with an injectable `rng` so the tests can pin
// the ends of the range.

const { OBOL_SLUG } = require("./depotState");

// Tenths, so the bounds are integer arithmetic: 9n/10 and 11n/10 never land a
// hair above a whole number the way n * 0.9 can.
const VARIANCE_TENTHS = 1;

// Whose starting balance does not stock the Vault.
const VAULT_UNSTOCKED_ROLE_SLUGS = new Set(["baron"]);

// GameConfig.vaultReservePercent's default (db/lib/gameConfigFields.js), for a
// config row that predates the column.
const DEFAULT_VAULT_RESERVE_PERCENT = 25;

function startingRange(value) {
  const n = Math.trunc(Number(value) || 0);
  if (n <= 0) return { lo: n, hi: n };
  const lo = Math.ceil((n * (10 - VARIANCE_TENTHS)) / 10);
  const hi = Math.floor((n * (10 + VARIANCE_TENTHS)) / 10);
  return hi < lo ? { lo: n, hi: n } : { lo, hi };
}

function varyStarting(value, rng = Math.random) {
  const { lo, hi } = startingRange(value);
  if (hi === lo) return lo;
  return lo + Math.min(hi - lo, Math.floor(rng() * (hi - lo + 1)));
}

// A role kit resolved into slug -> quantity (the Map createActions.js and
// reincarnate.js both build): the purse rolls, nothing else does. Mutates and
// returns the Map, so a caller can keep its own `const`.
function varyStartingPurse(wanted, rng = Math.random) {
  if (wanted?.has(OBOL_SLUG)) wanted.set(OBOL_SLUG, varyStarting(wanted.get(OBOL_SLUG), rng));
  return wanted;
}

// How many obols one new character's starting balance puts into the Vault.
// Rounded UP, one character at a time, so the Vault never falls short of the
// percentage through rounding — 25% of a 5 ¢ balance stocks 2, not 1.
function vaultStockFor({ roleSlug, balance, percent }) {
  if (VAULT_UNSTOCKED_ROLE_SLUGS.has(roleSlug)) return 0;
  const b = Math.trunc(Number(balance) || 0);
  const p = Math.trunc(Number(percent) || 0);
  if (b <= 0 || p <= 0) return 0;
  return Math.ceil((b * p) / 100);
}

module.exports = {
  startingRange,
  varyStarting,
  varyStartingPurse,
  vaultStockFor,
  VAULT_UNSTOCKED_ROLE_SLUGS,
  DEFAULT_VAULT_RESERVE_PERCENT,
};
