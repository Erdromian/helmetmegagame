-- Custom craftables (docs/systemdocs/CRAFTING.md): designated recipes may be
-- crafted as a player-named item for +1 ⬢ a unit, and the wayside shrine
-- takes an optional builder's inscription.
--
-- Tag.customizable — the YAML opt-in on the designated recipes.
-- CraftProject.custom — { name?, description? } pending on a multi-turn
--   project until the finishing turn mints the runtime row.
-- Structure.inscription — the builder's line, replacing placement.examine
--   in the Examine readout when set.
--
-- All defaulted or nullable, so every existing row is valid as it stands.
ALTER TABLE "Tag" ADD COLUMN "customizable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CraftProject" ADD COLUMN "custom" JSONB;
ALTER TABLE "Structure" ADD COLUMN "inscription" TEXT;
