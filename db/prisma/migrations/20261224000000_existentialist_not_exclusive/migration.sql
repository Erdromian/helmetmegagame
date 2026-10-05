-- Existentialist is a philosophy, not a religion (TAGS.md §3, `Tag.exclusive`).
-- It stays in the Beliefs group but no longer takes the one-belief slot, so it
-- stacks on Post-Christian, Atheist or any Old Way, and Xom's Pray leaves it on.
--
-- The deploy's tag sync writes the same flag from docs/tags.yaml. This makes
-- it true at migrate time too, and on any database migrated without a sync.
-- No character row changes: until now nobody could hold Existentialist beside
-- another belief.
UPDATE "Tag"
SET "exclusive" = false
WHERE slug = 'existentialist';
