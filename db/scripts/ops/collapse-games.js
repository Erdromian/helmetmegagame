// Fold the whole Game history down to a single game numbered 1, and empty the
// transcript with it.
//
// WHY. The Game table accumulates one row per Restart Game, and on
// 2026-09-09 a run of restarts while a bug was being chased left seventeen of
// them, most carrying an epilogue for a game nobody played. Bascinet wanted one
// game, numbered 1, with a clean transcript behind it.
//
// WHAT IT KEEPS. The game that is CURRENT — its characters, tags, turns,
// factions, everything GameState points at. Only the historical Game rows and
// the archive go. The current row is renumbered to 1 and stripped of any
// ending: `Game.endedAt`, `closingNote`, `epilogue`, and the two ending stamps
// (`nukeDetonatedTurn` / `ascensionFiredTurn`, which are what pin the fireball
// over every turn announcement — db/lib/turnBanner.js).
//
// ArchiveEntry.gameId is a snapshot column, not a foreign key, so deleting
// Game rows cannot be blocked by the transcript — but the transcript would be
// orphaned, which is why it goes in the same pass.
//
// DESTRUCTIVE AND NOT UNDOABLE. Take a backup first (`npm run db:backup`).
// DRY RUN unless given `-- --apply`, the db/scripts/ops convention.
const { prisma, Prisma } = require("../../index");

async function main() {
  const apply = process.argv.includes("--apply");

  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: true },
  });
  if (!state?.game) {
    console.error("No current Game to keep. Refusing to touch anything.");
    process.exitCode = 1;
    return;
  }

  const all = await prisma.game.findMany({ orderBy: { number: "asc" }, select: { id: true, number: true } });
  const doomed = all.filter((g) => g.id !== state.game.id);
  const archives = await prisma.archiveEntry.count();

  console.log(`Current game: #${state.game.number} (phase ${state.phase})`);
  console.log(`  Game rows           : ${all.length} total, ${doomed.length} to delete`);
  console.log(`  Numbers to delete   : ${doomed.map((g) => g.number).join(", ") || "(none)"}`);
  console.log(`  ArchiveEntry rows   : ${archives} to delete`);
  console.log(`  Renumber #${state.game.number} -> #1, and clear its ending:`);
  console.log(`    endedAt=${state.game.endedAt ?? "null"} closingNote=${state.game.closingNote ? "set" : "null"} epilogue=${state.game.epilogue ? "set" : "null"}`);
  console.log(`    nukeDetonatedTurn=${state.game.nukeDetonatedTurn ?? "null"} ascensionFiredTurn=${state.game.ascensionFiredTurn ?? "null"}`);
  console.log("  GameState: clear closingNote/endedAt and both countdowns; the phase is left alone");

  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with -- --apply once a backup is in the bucket.");
    return;
  }

  await prisma.$transaction([
    prisma.archiveEntry.deleteMany({}),
    prisma.game.deleteMany({ where: { id: { not: state.game.id } } }),
    prisma.game.update({
      where: { id: state.game.id },
      data: {
        number: 1,
        endedAt: null,
        closingNote: null,
        epilogue: Prisma.DbNull,
        nukeDetonatedTurn: null,
        ascensionFiredTurn: null,
      },
    }),
    prisma.gameState.update({
      where: { id: 1 },
      data: {
        closingNote: null,
        endedAt: null,
        // The phase is deliberately NOT touched. After a Restart Game it is
        // CLOSED, which is where a fresh game starts from; forcing RUNNING
        // here would drop everyone into a game with no lobby behind it.
        // The countdown goes with the ending. Leaving an armed bomb behind is
        // how a "fresh" game detonates on its first close.
        nukeArmedTurn: null,
        nukeDetonatedTurn: null,
        ascensionArmedTurn: null,
        ascensionFiredTurn: null,
        ascensionLeaderCharacterId: null,
      },
    }),
  ]);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: "games_collapsed",
        details: { deleted: doomed.map((g) => g.number), archivesDeleted: archives, keptAs: 1 },
      },
    })
    .catch((err) => console.error("games_collapsed audit failed:", err));

  console.log("\nDone. One game, numbered 1, with nothing behind it and no ending on it.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
