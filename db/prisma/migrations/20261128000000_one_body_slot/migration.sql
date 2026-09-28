-- BODY holds one thing now, the way HEAD does (docs/systemdocs/TAGS.md,
-- "equipSlot / equipLayer / twoHanded"). Its two layers, Mail under Over,
-- are gone: clothes, a robe, a mail shirt, a breastplate or a cloak, and
-- never two of them.
--
-- 1. Every BODY tag loses its layer. db:sync-tags does the same to the
-- catalog tags on its own, since docs/tags.yaml no longer sets one. This
-- statement is for what the YAML cannot reach: the runtime `custom:` clones
-- that copy equipLayer off a base tag -- a custom craft
-- (db/lib/customCraftMint.js) and an animated piece (db/lib/riteEffects.js).
UPDATE "Tag" SET "equipLayer" = NULL WHERE "equipSlot" = 'BODY' AND "equipLayer" IS NOT NULL;

-- 2. Anybody wearing two body pieces keeps one and takes the rest off.
-- This is not tidying: a clash is checked over the WHOLE equipped set
-- (db/lib/equipSlots.js#findEquipProblem), so a robe under a breastplate
-- left on would refuse every later equip, sword included, and name two
-- things the player never touched. The keeper is picked the way
-- db/scripts/ops/collapse-equip-slots.js picks one: most armour first, then
-- a concealing piece so a hidden face stays hidden, then the row id so the
-- answer is stable. Silent to players, same as that script; nothing is
-- dropped, the rest just go back in the pack.
WITH worn AS (
  SELECT
    ct."id",
    ROW_NUMBER() OVER (
      PARTITION BY ct."characterId"
      ORDER BY
        GREATEST(COALESCE(t."meleeArmor", 0), COALESCE(t."ballisticArmor", 0)) DESC,
        t."concealsIdentity" DESC,
        ct."id" ASC
    ) AS "rank"
  FROM "CharacterTag" ct
  JOIN "Tag" t ON t."id" = ct."tagId"
  WHERE t."equipSlot" = 'BODY' AND ct."equippedQuantity" > 0
)
UPDATE "CharacterTag" ct
SET "equipped" = false, "equippedQuantity" = 0
FROM worn
WHERE worn."id" = ct."id" AND worn."rank" > 1;

-- 3. The keeper wears ONE unit. Two units of one stackable body piece (a
-- Graga-Hide Cloak, a Jester Outfit) are two things on one body.
UPDATE "CharacterTag" ct
SET "equippedQuantity" = 1
FROM "Tag" t
WHERE t."id" = ct."tagId" AND t."equipSlot" = 'BODY' AND ct."equippedQuantity" > 1;
