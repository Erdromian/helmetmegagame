-- Faces on by default. Both switches were already ON in the live game — a GM
-- turned them on by hand — so this changes no existing row, only what a fresh
-- GameConfig starts with (a new install, or a Restart Game wipe).
ALTER TABLE "GameConfig" ALTER COLUMN "avatarUploadsEnabled" SET DEFAULT true;
ALTER TABLE "GameConfig" ALTER COLUMN "portraitMakerEnabled" SET DEFAULT true;
