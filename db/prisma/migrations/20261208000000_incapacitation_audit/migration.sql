-- Every time a character is bound or incapacitated, /gm/audit gets a
-- `character_incapacitated` row naming them and the tag that did it.
--
-- A trigger rather than a call in each writer, for the same reason as
-- 20260913060000_dm_notify: these tags land from a couple of dozen places
-- across three packages — Bind, Shackle and Crucify, a fight's Unconscious, a
-- wound expiring into Dying, Squeeze's Seizure, the catatonic pass, a GM's tag
-- edit, a staged effect at the push — and several of those write CharacterTag
-- raw rather than through db/lib/tagWrites.js. A hook in each would miss the
-- next one. The verbs that already write their own row (request_bind_character
-- and friends) keep it; this one is the record that the STATE began, whoever
-- or whatever caused it.
--
-- INSERT only. A tag that was already held is not news, and an
-- `ON CONFLICT DO NOTHING` (Prisma's skipDuplicates) inserts nothing, so it
-- fires nothing. Getting free again is left to the verbs that free people.
--
-- The slug list is db/lib/incapacitation.js#INCAPACITATING_SLUGS (every slug
-- whose restrictions include ACT — Bound among them).
-- db/test/incapacitationAudit.test.js fails if the two drift apart; change
-- one, change both, with a new migration that replaces this function.
--
-- The row is written as the engine (`system:incapacitation`). Names are
-- snapshotted into `details`, as every audit renderer expects
-- (schema.prisma's AuditLog notes), and the character's Location fills the
-- place column so the room/location filter finds it. Prisma does not model
-- triggers; this exists only in migration SQL.
CREATE OR REPLACE FUNCTION bascinet_incapacitation_audit() RETURNS trigger AS $$
DECLARE
  tag_row RECORD;
  who RECORD;
BEGIN
  SELECT "slug", "name" INTO tag_row FROM "Tag" WHERE "id" = NEW."tagId";
  IF tag_row."slug" IS NULL OR tag_row."slug" NOT IN (
    'dying', 'catatonic-afk', 'bound', 'shackled', 'crucified', 'seizure', 'paralyzed', 'unconscious'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT c."name", c."locationId", l."name" AS "locationName"
    INTO who
    FROM "Character" c
    LEFT JOIN "Location" l ON l."id" = c."locationId"
   WHERE c."id" = NEW."characterId";

  INSERT INTO "AuditLog" ("id", "actorDiscordUserId", "actionType", "targetCharacterId", "details", "locationId", "createdAt")
  VALUES (
    'inc_' || replace(gen_random_uuid()::text, '-', ''),
    'system:incapacitation',
    'character_incapacitated',
    NEW."characterId",
    jsonb_build_object(
      'tagId', NEW."tagId",
      'tagSlug', tag_row."slug",
      'tagName', tag_row."name",
      'source', NEW."source"::text,
      'characterName', who."name",
      'locationName', who."locationName"
    ),
    who."locationId",
    now()
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CharacterTag_incapacitation_audit" ON "CharacterTag";
CREATE TRIGGER "CharacterTag_incapacitation_audit"
  AFTER INSERT ON "CharacterTag"
  FOR EACH ROW EXECUTE FUNCTION bascinet_incapacitation_audit();
