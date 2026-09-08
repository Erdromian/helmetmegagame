-- Escorting (docs/systemdocs/MAP.md §3a): a party you attach once and carry
-- with you, replacing the one-shot MOVE_CHARACTER request and the per-move
-- drag picker. Three nullable columns and one enum value — nothing to
-- backfill, and every existing row is already correct as NULL.

ALTER TYPE "OfferKind" ADD VALUE 'ESCORT';

ALTER TABLE "Character" ADD COLUMN "escortedById" TEXT;
ALTER TABLE "Character" ADD COLUMN "escortConsentToId" TEXT;
ALTER TABLE "Character" ADD COLUMN "escortConsentUntilTurn" INTEGER;

-- SET NULL rather than CASCADE: a leader's row going away must never take
-- their followers with it. It only ends the escort.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_escortedById_fkey"
  FOREIGN KEY ("escortedById") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The one query the party ever runs: everyone following this leader.
CREATE INDEX "Character_escortedById_idx" ON "Character"("escortedById");
