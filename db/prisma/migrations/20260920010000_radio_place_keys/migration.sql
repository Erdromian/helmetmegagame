-- Radio traffic predates the `net:` place key, so every line ever said on a
-- frequency is filed against nowhere: placeKey NULL, zoneId NULL, and only
-- channelKind to say where it happened. Give those rows their key so /chat and
-- /archive group them the way they group everything else.
--
-- `watch` is in the list because it is what the Cerberon net was called before
-- the rename, and rows from then still carry it (see db/lib/specialChannels.js).
-- Scoped to placeKey IS NULL so an intercom transcript row — deliberately
-- place-less — is never touched.
UPDATE "ArchiveEntry"
SET "placeKey" = 'net:27.065'
WHERE "placeKey" IS NULL AND "channelKind" = '27.065';

UPDATE "ArchiveEntry"
SET "placeKey" = 'net:cerberon'
WHERE "placeKey" IS NULL AND "channelKind" IN ('cerberon', 'watch');
