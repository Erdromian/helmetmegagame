-- Escort, the bodyguard verb (docs/systemdocs/ATTACK.md §6a, MAP.md §3d): who
-- this character is escorting. One nullable column; every existing row is
-- already correct as NULL, so nothing to backfill.

ALTER TABLE "Character" ADD COLUMN "guardingId" TEXT;

-- SET NULL: the charge's row going away only ends the escort.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_guardingId_fkey"
  FOREIGN KEY ("guardingId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The one query a move and a fight run: everyone escorting these people.
CREATE INDEX "Character_guardingId_idx" ON "Character"("guardingId");
