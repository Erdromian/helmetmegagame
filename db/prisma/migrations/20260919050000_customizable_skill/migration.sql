-- Who may sign a piece, and what a signed piece is a copy of.
-- See docs/systemdocs/CRAFTING.md §4a.
ALTER TABLE "Tag" ADD COLUMN "customizableSkillSlug" TEXT;
ALTER TABLE "Tag" ADD COLUMN "customOfSlug" TEXT;
