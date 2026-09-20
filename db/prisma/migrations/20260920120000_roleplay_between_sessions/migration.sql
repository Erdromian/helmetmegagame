-- Between sessions a player may talk and nothing else. This knob is whether
-- the talking stays open too; off is a total freeze. Additive, defaulted on,
-- so an existing game keeps the roleplay it already had.
ALTER TABLE "GameConfig" ADD COLUMN "roleplayBetweenSessions" BOOLEAN NOT NULL DEFAULT true;
