// This game's Words of the Circle, rolled once and kept on GameState
// (docs/systemdocs/THANATI.md). Lazy: the first reader — a chant, the
// Grimoire document, the GM panel — rolls them. Restart Game recreates the
// GameState row, so a new game rolls new words with no extra step.
//
// Takes `db` as a parameter, the db/lib/dm.js convention, and is not on the
// barrel.
const { Prisma } = require("@prisma/client");
const { RITES, rollRiteWords } = require("./rites");
const { readGameState } = require("./gameState");

// A READ first — this runs on every line of chat, and an upsert would take a
// write lock on GameState for each one (db/lib/gameState.js). Only the very
// first caller in a game reaches the write below.
async function ensureRiteWords(db) {
  const state = await readGameState(db, { riteWords: true });
  const stored = state?.riteWords && typeof state.riteWords === "object" ? state.riteWords : null;
  if (stored) {
    // A rite added to the catalog mid-game has no phrase, and the roll above
    // already happened, so nothing would ever give it one. Top up the missing
    // keys, keeping every phrase players have already learned.
    const missing = RITES.filter((rite) => typeof stored[rite.key] !== "string" || !stored[rite.key].trim());
    if (missing.length === 0) return stored;
    const topped = rollRiteWords(Math.random, RITES, stored);
    // Guarded on the words we read, so two sessions topping up at once cannot
    // hand the same game two different sets. The loser re-reads the winner's.
    await db.gameState.updateMany({
      where: { id: 1, riteWords: { equals: stored } },
      data: { riteWords: topped },
    });
    const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
    return after?.riteWords ?? topped;
  }

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
