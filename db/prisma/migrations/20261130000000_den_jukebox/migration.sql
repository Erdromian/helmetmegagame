-- The Den's jukebox (docs/systemdocs/SOUND.md, "The Den's jukebox").
--
-- Additive: two nullable columns, nothing dropped. Null is right for every row:
-- no jukebox has played yet, and null is "off".
ALTER TABLE "Room" ADD COLUMN "jukeboxSongKey" TEXT;
ALTER TABLE "Room" ADD COLUMN "jukeboxStartedAt" TIMESTAMP(3);
