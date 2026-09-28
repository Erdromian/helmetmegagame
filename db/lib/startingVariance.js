// Starting money wobbles a little from game to game.
//
// Every figure the YAML sets for the opening economy — a seat's
// `starting_account:` balance and its `Obol xN` purse (docs/roles.yaml), and
// the coin poured into the Keep's Vault (docs/zones.yaml, `undertown-1-7`) —
// is the MIDDLE of a range, not the exact amount. Each is rolled within 10% of
// what was written, so nobody can work out another seat's money from the
// roles list, and the Vault's cover against the town's claims is never quite
// the same twice.
//
// When each roll happens, and why there:
//
//   - A character's balance and purse roll at creation
//     (web/app/(app)/character/createActions.js, and db/lib/reincarnate.js for
//     the purse), once per character. Two Courtiers in one game rarely match.
//   - The Vault rolls when Start Game pours the authored stashes
//     (db/lib/roomStashSeed.js#seedAuthoredStashes). That pour happens once a
//     game — Room.seededStashSlugs guards it — so the Vault gets one roll a game
//     too. A GM typing a stash in by hand on /gm/dev/zones gets exactly what
//     they typed.
//
// The range is whole obols: from 10% under, rounded up, to 10% over, rounded
// down, every whole number in it equally likely. So a figure under 10 cannot
// move at all (3 ¢ is 2.7–3.3, and the only whole obol in that is 3), which is
// right for pocket change and saves anybody reading 0 where the YAML says 1.
//
// Pure apart from the two slugs it needs, with an injectable `rng` so the
// tests can pin the ends of the range.

const { OBOL_SLUG } = require("./depotState");
const { VAULT_ROOM_SLUG } = require("./bankAccounts");

// Tenths, so the bounds are integer arithmetic: 9n/10 and 11n/10 never land a
// hair above a whole number the way n * 0.9 can.
const VARIANCE_TENTHS = 1;

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

// The Vault's authored stash, as roomStashSeed.js#stashSeedEntries returns it
// ([[slug, quantity, hidden], ...]). Only the Vault, and only its visible
// obols: every other room pours exactly what it was written with.
function varyVaultEntries(roomSlug, entries, rng = Math.random) {
  if (roomSlug !== VAULT_ROOM_SLUG) return entries;
  return entries.map(([slug, quantity, hidden]) =>
    slug === OBOL_SLUG ? [slug, varyStarting(quantity, rng), hidden] : [slug, quantity, hidden],
  );
}

module.exports = { startingRange, varyStarting, varyStartingPurse, varyVaultEntries };
