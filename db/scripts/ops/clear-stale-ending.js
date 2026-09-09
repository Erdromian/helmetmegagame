// One-off repair: take the previous game's ending off the game that is running.
//
// WHY THIS EXISTS. On 2026-09-09 the bomb detonated on the first turn of a
// freshly restarted game and ended it. A GM pressed Resume, so the clock ticks
// again — but the ending stamps stayed: the Game row kept its closingNote and
// its epilogue, so /archive went on rendering "How it ended" over a game that
// was still being played, and GameState kept a closingNote that the NEXT
// ending would have inherited.
//
// The cross-game half of that is fixed at the root (the stamps live on the
// Game row now, and Resume withdraws the ending — db/lib/gameEnd.js). This
// script is only for the row that is already wrong.
//
// DRY RUN unless given `-- --apply`, the db/scripts/ops convention. It touches
// no character, tag, turn or archive row — only the four fields that make a
// running game read as a finished one.
const { prisma } = require("../../index");

async function main() {
  const apply = process.argv.includes("--apply");

  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: { select: { id: true, number: true, endedAt: true, closingNote: true, epilogue: true } } },
  });
  if (!state) {
    console.error("No GameState row. Nothing to do.");
    return;
  }

  const game = state.game;
  console.log(`Game ${game?.number ?? "?"} — phase ${state.phase}`);
  console.log(`  GameState.closingNote : ${state.closingNote ? JSON.stringify(state.closingNote) : "(none)"}`);
  console.log(`  Game.closingNote      : ${game?.closingNote ? JSON.stringify(game.closingNote) : "(none)"}`);
  console.log(`  Game.epilogue         : ${game?.epilogue ? "present" : "(none)"}`);
  console.log(`  Game.endedAt          : ${game?.endedAt ?? "(none)"}`);

  // A game that really is over keeps its ending — this is for a RUNNING game
  // still wearing one.
  if (state.phase === "ENDED") {
    console.log("\nThis game is ENDED. That ending is real; nothing to clear.");
    return;
  }
  const dirty =
    state.closingNote != null || game?.closingNote != null || game?.epilogue != null || game?.endedAt != null;
  if (!dirty) {
    console.log("\nNothing stale. This game carries no ending.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN. Would clear all four fields above. Re-run with -- --apply.");
    return;
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { closingNote: null } });
  await prisma.game.update({
    where: { id: game.id },
    data: { closingNote: null, endedAt: null, epilogue: prismaDbNull() },
  });
  console.log("\nCleared. The running game no longer carries an ending.");
}

// Prisma.DbNull is the only way to write a SQL NULL into a nullable Json
// column — a plain null is a validation error (db/index.js says the same).
function prismaDbNull() {
  const { Prisma } = require("@prisma/client");
  return Prisma.DbNull;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
