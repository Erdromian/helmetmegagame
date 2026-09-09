-- The Off hand is gone. SHIELD was a second rule for the same place on the
-- body -- one cell holding exactly one thing, beside a row that counted hands
-- -- so it folds into WEAPON, and WEAPON_HANDS goes from three to four. Four
-- is what the two slots already allowed together: a shield plus three hands
-- of weapons, so nobody comes out of this wearing a set the rules refuse.
--
-- db:sync-tags moves the four catalog shields on its own. This statement is
-- for what the YAML cannot reach: the runtime `custom:` clones that copy
-- equipSlot off a base tag -- a custom craft
-- (web/app/(app)/character/requestActions.js) and an animated weapon
-- (db/lib/riteEffects.js).
UPDATE "Tag" SET "equipSlot" = 'WEAPON' WHERE "equipSlot" = 'SHIELD';

-- The enum value itself STAYS. Postgres has no ALTER TYPE ... DROP VALUE, and
-- rebuilding the type to save one dead word is not worth the risk on a live
-- database. Nothing reads it: db/lib/equipSlots.js leaves SHIELD out of
-- EQUIP_SLOTS, so db/lib/syncTags.js throws on any YAML that still names it.
