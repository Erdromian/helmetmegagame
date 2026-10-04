-- Only the Merchant's and the Baron's rings open a shipped or packed crate
-- now, sealed or not (docs/roles.yaml, db/lib/depotCrates.js#canOpenCrate,
-- docs/systemdocs/DEPOT.md §0e). Both rings carry a new token, `crate-key`.
--
-- Roles do not sync on deploy (db:sync-deploy runs tags, desires and documents
-- only), so this writes the YAML change onto a running game. It touches only
-- the token lists on the two Role rows and on the rings registered to them;
-- no other Role column, no running db:sync-roles. The token's own Tag row
-- (docs/tags.yaml) arrives with the deploy's tag sync. Both statements are
-- no-ops on a database that already has the change.

UPDATE "Role"
SET "ringAccessSlugs" = "ringAccessSlugs" || ARRAY['crate-key']::TEXT[]
WHERE "slug" IN ('merchant', 'baron')
  AND NOT ('crate-key' = ANY("ringAccessSlugs"));

-- The rings already on fingers carry a copy of their seat's tokens, so they
-- follow. This only ADDS the token: whatever else a ring carries, a GM's hand
-- edit included, stays. Sorted by code point, as rings.js#ringAccessFor's
-- plain sort() is, so a later db:sync-roles sees nothing to change. A ring not
-- yet registered picks the token up from the Role row when the Meister
-- registers it (db/lib/ringMint.js).
UPDATE "Tag" AS t
SET "ringAccessSlugs" = ARRAY(
  SELECT DISTINCT tok COLLATE "C"
  FROM unnest(t."ringAccessSlugs" || ARRAY['crate-key']::TEXT[]) AS tok
  ORDER BY 1
)
WHERE t."ringOfCharacterId" IS NOT NULL
  AND t."ringRegisteredAt" IS NOT NULL
  AND t."ringRoleSlugs" && ARRAY['merchant', 'baron']::TEXT[]
  AND NOT ('crate-key' = ANY(t."ringAccessSlugs"));
