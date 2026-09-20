-- The noise a line made, for the web face: a token from db/lib/sfx.js ("gate-open",
-- "alarm"), never a filename and never a path. The browser looks the token up in its own
-- map, so a row carrying anything else plays nothing.
--
-- Nullable with no default and no backfill, and that is not laziness: silence is what
-- almost every line is, and a sound is something that happened at the time rather than a
-- property of the transcript. Nothing that already exists should acquire one.
ALTER TABLE "ArchiveEntry" ADD COLUMN "sfx" TEXT;
