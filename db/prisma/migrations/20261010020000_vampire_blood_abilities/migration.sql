-- The Blood Abilities menu (docs/systemdocs/VAMPIRE.md §6). The per-ability
-- cooldown tracker is a JSON map keyed by ability key rather than one column
-- per ability — see the field's own comment in schema.prisma.
ALTER TABLE "Character"
  ADD COLUMN "vampireBloodAbilityCooldowns" JSONB;

ALTER TABLE "GameConfig"
  ADD COLUMN "vampireBloodAbilityCooldownVariable" INTEGER NOT NULL DEFAULT 5;
