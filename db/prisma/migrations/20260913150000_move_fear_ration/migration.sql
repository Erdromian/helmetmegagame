-- The movement fear ration (db/lib/fear.js, MOVE_FEAR_TURN_CAP).
-- Additive only: two nullable/defaulted columns, no backfill needed. An
-- existing character simply has no ration spent yet, which is the truth.
ALTER TABLE "Character" ADD COLUMN "moveFearTurnId" TEXT;
ALTER TABLE "Character" ADD COLUMN "moveFearUsed" DOUBLE PRECISION NOT NULL DEFAULT 0;
