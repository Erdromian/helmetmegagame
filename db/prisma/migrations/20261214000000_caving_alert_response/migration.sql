-- The prompt an alert caver gets on a failed Caving roll (Combat Mode.docx;
-- docs/systemdocs/COMBAT-MODE.md §6, CAVING.md §5b).
--
-- Additive: one defaulted column and two nullable ones, nothing dropped.
-- `alert` freezes whether the caver was in combat mode at that 1; `response`
-- and `respondedAt` hold what they wrote, on the result's oldest row.
ALTER TABLE "CavingRoll" ADD COLUMN "alert" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CavingRoll" ADD COLUMN "response" TEXT;
ALTER TABLE "CavingRoll" ADD COLUMN "respondedAt" TIMESTAMP(3);

-- Every 1 already rolled kept its combat mode in its snapshot as `m: 1`
-- (db/lib/examineSnapshot.js); copy that onto the new column so the desk reads
-- the turn already under way the same way it reads the next one. A row with
-- no snapshot stays false, which is what the desk has always shown for it.
-- Fires CavingRoll_notify once per row touched: open desks re-read them, nothing else.
UPDATE "CavingRoll"
SET "alert" = true
WHERE "kind" = 'TROUBLE'
  AND "presentedState" IS NOT NULL
  AND "presentedState"->>'m' = '1';
