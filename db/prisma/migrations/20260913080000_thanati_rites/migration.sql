-- The rite scripts (docs/systemdocs/THANATI.md §4): a photograph remembers
-- whose picture it is, and a rite can wait on a word from the room.

ALTER TABLE "Tag" ADD COLUMN "photoOfCharacterId" TEXT;

ALTER TYPE "RiteAttemptStatus" ADD VALUE 'AWAITING';
