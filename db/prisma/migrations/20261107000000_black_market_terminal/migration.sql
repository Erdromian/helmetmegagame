-- The Black Market terminal (docs/systemdocs/DEPOT.md §0n).
--
-- Additive: one column, defaulted, nothing dropped. 0 is right for every row:
-- no terminal has taken a coin yet.
ALTER TABLE "Room" ADD COLUMN "blackMarketObols" INTEGER NOT NULL DEFAULT 0;

-- The terminal's token opens the Exactor's Office too, so the Pusher's ring
-- reaches it. docs/zones.yaml says so, but db:import-zones never updates a
-- room that already exists, so the live row is changed here. Idempotent: a
-- room that already names the token is left alone.
UPDATE "Room"
SET "accessTagSlugs" = array_append("accessTagSlugs", 'black-market-key')
WHERE "slug" = 'undertown-9-3'
  AND NOT ('black-market-key' = ANY("accessTagSlugs"));
