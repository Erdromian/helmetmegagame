-- Tag.name stops being unique, so a written sheet can just be called "A Note".
--
-- It was unique only because nothing else forced it to be, and that constraint
-- is what made every letter carry a waybill code in its own title —
-- "A Note (XY-1234)" — since each new sheet needed a name no other tag had.
-- Identity lives on Tag.slug, which is unique and always was.
--
-- ORDER MATTERS. Step 1 joins on "Tag"."name" and needs the unique index to
-- still be there to resolve each authored name to exactly one slug. Only then
-- does step 2 drop it.

-- 1. Role.startingTagSlugs finally holds slugs.
--
-- docs/roles.yaml authors starting_tags as display names ("Merchant's
-- License") and this column stored them verbatim, despite its own name. Every
-- runtime reader now matches on slug (db/lib/startingTags.js), so the stored
-- rows are rewritten to match. An entry may carry a count — "Obol x5" — and
-- the suffix is preserved onto the resolved slug.
--
-- A name with no catalog row is left exactly as it is rather than dropped:
-- losing a role's starting kit to a typo would be worse than leaving one entry
-- that db:sync-roles will refuse loudly on its next run.
UPDATE "Role" r
SET "startingTagSlugs" = sub.resolved
FROM (
  SELECT
    r2.id,
    ARRAY(
      SELECT COALESCE(
        -- The count suffix is rebuilt, not concatenated raw: parsed.m[2] is
        -- the digits alone, so " x" has to go back in front of them or
        -- "Obol x5" resolves to "obol5" and parses as a slug nothing matches.
        t.slug || CASE WHEN parsed.m[2] IS NOT NULL THEN ' x' || parsed.m[2] ELSE '' END,
        u.entry
      )
      FROM unnest(r2."startingTagSlugs") WITH ORDINALITY AS u(entry, ord)
      CROSS JOIN LATERAL (
        SELECT regexp_match(u.entry, '^(.*\S)\s+x(\d+)$') AS m
      ) AS parsed
      LEFT JOIN "Tag" t ON t.name = COALESCE(parsed.m[1], u.entry)
      ORDER BY u.ord
    ) AS resolved
  FROM "Role" r2
) AS sub
WHERE r.id = sub.id;

-- 2. The constraint itself.
DROP INDEX IF EXISTS "Tag_name_key";
