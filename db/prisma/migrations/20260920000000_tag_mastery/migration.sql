-- A MASTERY tag: buyable only once play has started, never at character
-- creation. The two existing flags could not express it — `purchasable` says
-- "buyable at all" and `purchasableAfterStart` says "still buyable mid-game",
-- and neither says "not yet". See docs/systemdocs/TAGS.md 4a.
--
-- Additive with a default, so it applies to a live database without touching
-- an existing row's behaviour: every tag in the catalog is non-mastery until
-- docs/tags.yaml says otherwise and db:sync-tags carries it over.
ALTER TABLE "Tag" ADD COLUMN "mastery" BOOLEAN NOT NULL DEFAULT false;
