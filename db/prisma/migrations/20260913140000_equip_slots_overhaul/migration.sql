-- Equipment overhaul (docs/systemdocs/TAGS.md, "equipSlot / equipLayer").
-- Three new places a thing can be equipped, and the two-hands flag on a
-- weapon. Additive only: GameConfig.equipSlots stays where it is, unread.
ALTER TYPE "EquipSlot" ADD VALUE 'WEAPON';
ALTER TYPE "EquipSlot" ADD VALUE 'ACCESSORY';
ALTER TYPE "EquipSlot" ADD VALUE 'MOUNT';

ALTER TABLE "Tag" ADD COLUMN "twoHanded" BOOLEAN NOT NULL DEFAULT false;
