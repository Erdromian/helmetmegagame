-- Which private Room threads a character has actually been pushed into.
--
-- Lets db/lib/roomAccess.js act on the difference rather than re-asserting all
-- 66 private rooms on every tag change — which, now that membership follows
-- entitlement instead of presence, would otherwise fire on every equip and
-- every meal.
--
-- Empty default, so applying this changes nothing until the next sync or the
-- next channel-doctor run fills it in.
ALTER TABLE "Character" ADD COLUMN "roomThreadRoomIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
