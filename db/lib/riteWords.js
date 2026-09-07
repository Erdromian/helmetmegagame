// This game's Words of the Circle, rolled once and kept on GameState
// (docs/systemdocs/THANATI.md). Lazy: the first reader — a chant, the
// Grimoire document, the GM panel — rolls them. Restart Game recreates the
// GameState row, so a new game rolls new words with no extra step.
//
// Takes `db` as a parameter, the db/lib/dm.js convention, and is not on the
// barrel.
const { Prisma } = require("@prisma/client");
const { rollRiteWords } = require("./rites");
const { readGameState } = require("./gameState");

// A READ first — this runs on every line of chat, and an upsert would take a
// write lock on GameState for each one (db/lib/gameState.js). Only the very
// first caller in a game reaches the write below.
async function ensureRiteWords(db) {
  const state = await readGameState(db, { riteWords: true });
  if (state?.riteWords && typeof state.riteWords === "object") return state.riteWords;

  // Guarded write: two first readers racing here both roll, and only the one
  // that finds the column still null lands. The loser re-reads the winner's.
  await db.gameState.updateMany({
    where: { id: 1, riteWords: { equals: Prisma.DbNull } },
    data: { riteWords: rollRiteWords() },
  });
  const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
  return after?.riteWords ?? {};
}

module.exports = { ensureRiteWords };
