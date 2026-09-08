-- The desire slot lock comes down from 2 whole turns to 1
-- (docs/systemdocs/DESIRES.md §2). A claim on turn N now reopens the slot on
-- N+2 rather than N+3.
--
-- The live GameConfig row is moved too, but only if nobody has hand-set it
-- from /gm/dev — same posture as the carry-cap migration.
ALTER TABLE "GameConfig" ALTER COLUMN "desireSlotLockTurns" SET DEFAULT 1;
UPDATE "GameConfig" SET "desireSlotLockTurns" = 1 WHERE "desireSlotLockTurns" = 2;
