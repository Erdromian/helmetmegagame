// What a BODY is. One line, one file, because two modules have to agree on it
// and their own headers say so: db/lib/curse.js asks who may not make a new
// character until their last body is dealt with, db/lib/ghost.js asks who gets
// the watching seat, and the two answer different questions — but what counts
// as a body underneath them was always meant to be the same answer.
//
// It used to be written inline in both, as `status !== "ALIVE"`, with a comment
// in ghost.js pointing at curse.js to keep them honest. That held while there
// were only two ways to be: alive, or a corpse. CharacterStatus.ASLEEP is a
// third (docs/systemdocs/CHARON.md) — the Charon's Habitation takes a character
// out of play without killing them — and it is neither. So:
//
//   ALIVE   you are playing.
//   ASLEEP  you are not playing, and there is nothing of you lying anywhere.
//   DEAD    there is a body. (CURSED too — vestigial, but counted, and it has
//           been counted as one since before the split.)
//
// An asleep character therefore curses nobody, is owed no burial, and gets no
// seat in Deadchat. What they DO get is the respawn, immediately, because they
// are not ALIVE and both modules' first question is whether the player still
// has a living character.
//
// Deliberately free of requires, the db/lib/sfx.js convention: this is reachable
// from a client component, and one require of @lifeweb/db there drags
// PrismaClient into the browser bundle. Require it by path.

/**
 * True for a Character row that has left a body behind.
 *
 * Takes a ROW, not a status string, so a caller who forgot `status` in their
 * `select` gets `false` rather than a confident wrong answer — which fails the
 * safe way on both sides: curse.js reads it as nothing to bury, ghost.js as
 * nobody to seat among the dead.
 */
function isBody(row) {
  const status = row?.status;
  return Boolean(status) && status !== "ALIVE" && status !== "ASLEEP";
}

module.exports = { isBody };
