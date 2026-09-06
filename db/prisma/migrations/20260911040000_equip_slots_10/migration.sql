-- Ten equip slots instead of six, Bascinet's call.
--
-- Two statements, because the default alone would only reach a GameConfig row
-- that does not exist yet — the singleton is already written and holds 6. The
-- UPDATE is narrowed to rows still sitting on the old default, so a value a GM
-- has since tuned from the Dev Panel is not stamped back over.
--
-- This is the FLAT count only. The per-body-part rule (Tag.equipSlot /
-- equipLayer, db/lib/equipSlots.js) is untouched, so ten slots still does not
-- let anyone wear two helmets.
ALTER TABLE "GameConfig" ALTER COLUMN "equipSlots" SET DEFAULT 10;
UPDATE "GameConfig" SET "equipSlots" = 10 WHERE "equipSlots" = 6;
