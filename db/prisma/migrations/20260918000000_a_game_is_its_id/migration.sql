-- A game is its id.
--
-- `Game.number` was a creation ordinal. Nothing joined on it — GameState.gameId
-- and ArchiveEntry.gameId have always keyed on the cuid — and every playtest
-- wipe consumed one, so it reached 13 before the game had launched once. The
-- picker stopped showing it when games got labels; this takes the column.
--
-- Ordering that used it is `createdAt` now, which is the same order.
--
-- Archive packets are unaffected: db/lib/archiveExport.js#decodeGame walks the
-- CURRENT schema's fields and ignores anything else in the file, so a packet
-- written while games had numbers still imports.
DROP INDEX "Game_number_key";
ALTER TABLE "Game" DROP COLUMN "number";
