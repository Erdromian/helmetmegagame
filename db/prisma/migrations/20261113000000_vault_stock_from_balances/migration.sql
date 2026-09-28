-- The Keep's Vault has no authored pile of obols any more. It is stocked as
-- the town is made: each new character's starting bank balance puts
-- GameConfig.vaultReservePercent of it into the Vault as coin (the next
-- migration adds the knob; docs/systemdocs/DEPOT.md §0g).
--
-- docs/zones.yaml drops the Vault's `obol:` line, but db:import-zones never
-- updates a room it already has, so the stored seed Start Game pours from
-- (Room.stashSeed, db/lib/roomStashSeed.js) would keep pouring 250 on top of
-- the stock. This takes the obol entry out of it — only while it still says
-- the authored 250, so a figure a GM typed in by hand is theirs to keep.
-- `items` is a list of [slug, quantity] pairs; the rest keep their order.
--
-- It changes the NEXT pour, not the coin: a Vault already stocked this game
-- keeps what is in it until Restart Game.
UPDATE "Room" AS r
SET "stashSeed" = jsonb_set(
  r."stashSeed"::jsonb,
  '{items}',
  COALESCE(
    (
      SELECT jsonb_agg(e.item ORDER BY e.ord)
      FROM jsonb_array_elements(r."stashSeed"::jsonb -> 'items') WITH ORDINALITY AS e(item, ord)
      WHERE NOT (e.item #>> '{0}' = 'obol' AND e.item #>> '{1}' = '250')
    ),
    '[]'::jsonb
  )
)
WHERE r."slug" = 'undertown-1-7'
AND EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(r."stashSeed"::jsonb -> 'items', '[]'::jsonb)) AS e(item)
  WHERE e.item #>> '{0}' = 'obol' AND e.item #>> '{1}' = '250'
);
