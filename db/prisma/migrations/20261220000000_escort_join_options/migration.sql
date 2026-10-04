-- Escort's two choices (docs/systemdocs/ATTACK.md §6a): step in when the charge
-- is attacked, and join in when the charge is attacking. The defaults are the
-- behaviour every escort already had, so existing rows need no backfill.

ALTER TABLE "Character" ADD COLUMN "guardDefends" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Character" ADD COLUMN "guardAttacks" BOOLEAN NOT NULL DEFAULT false;
