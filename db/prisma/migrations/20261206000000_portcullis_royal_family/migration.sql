-- The Baroness, the Heir, the Successor and the Incarn can work the Courtyard's
-- portcullis (docs/roles.yaml, docs/systemdocs/GATEHOUSE.md §1).
--
-- Roles do not sync on deploy (db:sync-deploy runs tags, desires and documents
-- only), so this writes the YAML change onto a running game. It touches only
-- the token list on four Role rows and the token lists on those seats' rings;
-- no other Role column, no running db:sync-roles. Both statements are no-ops
-- on a database that already has the change.

UPDATE "Role"
SET "ringAccessSlugs" = "ringAccessSlugs" || ARRAY['portcullis-key']::TEXT[]
WHERE "slug" IN ('baroness', 'heir', 'successor', 'incarn')
  AND NOT ('portcullis-key' = ANY("ringAccessSlugs"));

-- The rings already on fingers carry a copy of their seats' tokens, so they
-- follow. This only ADDS the token: whatever else a ring carries, a GM's hand
-- edit included, stays. Sorted by code point, as rings.js#ringAccessFor's
-- plain sort() is, so a later db:sync-roles sees nothing to change. A ring not
-- yet registered picks the token up from the Role row when the Meister
-- registers it (db/lib/ringMint.js).
UPDATE "Tag" AS t
SET "ringAccessSlugs" = ARRAY(
  SELECT DISTINCT tok COLLATE "C"
  FROM unnest(t."ringAccessSlugs" || ARRAY['portcullis-key']::TEXT[]) AS tok
  ORDER BY 1
)
WHERE t."ringOfCharacterId" IS NOT NULL
  AND t."ringRegisteredAt" IS NOT NULL
  AND t."ringRoleSlugs" && ARRAY['baroness', 'heir', 'successor', 'incarn']::TEXT[]
  AND NOT ('portcullis-key' = ANY(t."ringAccessSlugs"));
