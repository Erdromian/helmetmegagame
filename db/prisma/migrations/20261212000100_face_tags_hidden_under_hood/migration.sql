-- The face tags move from ALWAYS to FACE, so a hooded character's 🔍 stops
-- listing what is on the face the hood covers. The same twelve slugs
-- docs/tags.yaml now marks `visible: face`; the deploy's tag sync would write
-- this too, and this makes a running game right without waiting on it.
--
-- Only rows still ALWAYS move, so a GM's hand-set visibility on one of these
-- survives. Idempotent. No CharacterTag row is touched: what anybody holds is
-- unchanged, only who can see it.
UPDATE "Tag"
SET "inspectVisibility" = 'FACE'
WHERE "slug" IN (
  'black-sclera',
  'disfigured',
  'ugly',
  'missing-eye',
  'glass-eye-worn',
  'broken-jaw',
  'wired-jaw',
  'lockjaw',
  'phrygian-toxin',
  'pretty',
  'beautiful',
  'otherworldly-beauty'
)
AND "inspectVisibility" = 'ALWAYS';
