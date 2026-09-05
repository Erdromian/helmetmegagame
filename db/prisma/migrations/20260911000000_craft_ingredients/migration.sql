-- Recipe ingredients are spent now, not just held (docs/systemdocs/CORPSES.md
-- §8, BREWING.md §4). Two nullable Json columns, one migration:
--
-- CraftProject.consumed — what the ingredients cost, snapshotted when a
--   multi-turn project STARTED, so the GM Undo of the finishing request can
--   hand them back. Same shape as the `replaced` snapshot list.
-- Action.craftBudget — the per-turn craft ledger (family + how much of the
--   Move is left). Kept off appliedEffects, which the turn-end staged push
--   owns and claims rows through.
--
-- Both nullable, so every row already in the table is valid as it stands.
ALTER TABLE "CraftProject" ADD COLUMN "consumed" JSONB;
ALTER TABLE "Action" ADD COLUMN "craftBudget" JSONB;
