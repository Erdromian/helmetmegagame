-- GameConfig.autoRejectUnprovenDesires: a /gm/dev switch, off by default, that
-- rejects a claim on a checkable Desire when it finds no proof (DESIRES.md §6c).
-- Desire.autoRejectedAt marks a claim it rejected. Both additive.
ALTER TABLE "GameConfig" ADD COLUMN "autoRejectUnprovenDesires" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Desire" ADD COLUMN "autoRejectedAt" TIMESTAMP(3);
