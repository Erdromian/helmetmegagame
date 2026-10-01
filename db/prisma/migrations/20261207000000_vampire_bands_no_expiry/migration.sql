-- The Vampire's band tags no longer expire (VAMPIRE.md §2 and §3). Each one now
-- stays until db/lib/vampirePass.js drops it because the meter left the band.
-- Before this, every grant carried a one-turn expiry, so each close's expiry
-- sweep took the bands off and the vampire pass put them straight back.
--
-- The new code grants with no expiry, but rows a vampire already holds still
-- carry the old one. Clear it so nothing is swept off at the next close.
-- Pale is only touched on a vampire: a GM may have given a timed Pale to
-- somebody else.
UPDATE "CharacterTag" ct
SET "expiresTurn" = NULL
FROM "Tag" t
WHERE ct."tagId" = t.id
  AND ct."expiresTurn" IS NOT NULL
  AND (
    t.slug IN (
      'flush', 'satiated', 'thirsty', 'famished', 'bloodcrazed', 'black-sclera',
      'humane', 'estranged', 'disturbed', 'warped'
    )
    OR (
      t.slug = 'pale'
      AND EXISTS (
        SELECT 1 FROM "CharacterTag" v
        JOIN "Tag" vt ON vt.id = v."tagId"
        WHERE v."characterId" = ct."characterId" AND vt.slug = 'vampire'
      )
    )
  );
