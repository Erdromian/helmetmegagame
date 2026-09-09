-- A fourth TagVisibility state: NAMED, seen only while the subject is going
-- under their own name. Wanted is the tag that wanted it — the Cerberon know
-- your FACE, so a hood or a Disguise Kit's false name takes it off the read.
--
-- Additive, so nothing is rewritten and no row can be lost. `wanted` keeps
-- ALWAYS until `npm run db:sync-tags` reads the new `visible: named` out of
-- docs/tags.yaml, which is a separate step on purpose.
ALTER TYPE "TagVisibility" ADD VALUE IF NOT EXISTS 'NAMED';
