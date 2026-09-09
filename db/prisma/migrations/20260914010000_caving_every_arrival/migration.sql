-- Every arrival on a non-safe cave Location rolls the Caving Die now, first
-- visit or fifth. See docs/systemdocs/CAVING.md 2b.
--
-- The old cap was never application logic -- it was this index, and
-- rollCaving read its P2002 as "already rolled". Backtracking out of the
-- Depths in silence read as a bug, so the index goes.
DROP INDEX IF EXISTS "CavingRoll_characterId_turnId_trigger_locationId_key";

-- That unique was also the only index leading with characterId, and Character
-- cascades deletes into CavingRoll. Without a replacement, every character
-- delete sequentially scans the roll log.
CREATE INDEX IF NOT EXISTS "CavingRoll_characterId_idx" ON "CavingRoll"("characterId");
