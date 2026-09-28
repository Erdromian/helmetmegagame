-- The Keep's Vault is stocked with 350 obols a game, up from 250
-- (docs/zones.yaml, `undertown-1-7`), with the new starting balances in
-- docs/roles.yaml.
--
-- db:import-zones never updates a room it already has, so the stored seed
-- Start Game pours from (Room.stashSeed, db/lib/roomStashSeed.js) keeps saying
-- 250 until something rewrites it. This does, and only where it still says
-- exactly 250: a GM who has typed another figure in keeps theirs. `items` is a
-- list of [slug, quantity] pairs, kept in order.
--
-- It changes the NEXT pour, not the coin: a Vault already seeded this game has
-- `obol` in seededStashSlugs and is never poured again until Restart Game. And
-- the 350 is the middle of the range — Start Game rolls it within 10%
-- (db/lib/startingVariance.js).
UPDATE "Room" AS r
SET "stashSeed" = jsonb_set(
  r."stashSeed"::jsonb,
  '{items}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN e.item #>> '{0}' = 'obol' AND e.item #>> '{1}' = '250' THEN '["obol", 350]'::jsonb
        ELSE e.item
      END
      ORDER BY e.ord
    )
    FROM jsonb_array_elements(r."stashSeed"::jsonb -> 'items') WITH ORDINALITY AS e(item, ord)
  )
)
WHERE r."slug" = 'undertown-1-7'
AND EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb)) AS e(item)
  WHERE e.item #>> '{0}' = 'obol' AND e.item #>> '{1}' = '250'
);
