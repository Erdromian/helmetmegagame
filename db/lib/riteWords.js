// This game's Words of the Circle, rolled once and kept on GameState (docs/systemdocs/THANATI.md). Lazy: the first reader rolls them. Takes `db` as a parameter, the db/lib/dm.js convention, and is not on the barrel.
const { Prisma } = require("@prisma/client");
const { RITES, rollRiteWords, staleRiteWords } = require("./rites");
const { readGameState } = require("./gameState");

// A READ first — this runs on every line of chat, and an upsert would take a write lock on GameState for each one.
async function ensureRiteWords(db) {
  const state = await readGameState(db, { riteWords: true });
  const stored = state?.riteWords && typeof state.riteWords === "object" ? state.riteWords : null;
  if (stored) {
    // Two reasons to roll again, and they are not the same reason. MISSING is a rite the catalog gained since the roll. STALE is a phrase
    // that was legal when it was rolled and is not any more -- a word retired from the dictionary, a phrase that became a reserved battle
    // cry, one over the word cap. Without the second, a game goes on chanting something the rules now forbid, because nothing ever looks
    // again (db/lib/rites.js#staleRiteWords).
    const missing = RITES.filter((rite) => typeof stored[rite.key] !== "string" || !stored[rite.key].trim()).map((r) => r.key);
    const redo = new Set([...missing, ...staleRiteWords(stored)]);
    if (redo.size === 0) return stored;
    // Only the condemned are dropped; every phrase still legal is handed back to the roll as `existing` and kept exactly as it was.
    const kept = Object.fromEntries(Object.entries(stored).filter(([key]) => !redo.has(key)));
    const topped = rollRiteWords(Math.random, RITES, kept);
    await db.gameState.updateMany({
      where: { id: 1, riteWords: { equals: stored } },
      data: { riteWords: topped },
    });
    const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
    return after?.riteWords ?? topped;
  }

  // Guarded write: two first readers racing here both roll, and only the one that finds the column still null lands.
  await db.gameState.updateMany({
    where: { id: 1, riteWords: { equals: Prisma.DbNull } },
    data: { riteWords: rollRiteWords() },
  });
  const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
  return after?.riteWords ?? {};
}

module.exports = { ensureRiteWords };
