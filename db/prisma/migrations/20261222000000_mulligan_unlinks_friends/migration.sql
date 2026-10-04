-- A Mulligan Potion is a fresh start now (docs/systemdocs/CHARACTERS.md, MEMORIES.md
-- §2e). Drinking one unlinks every Friends entry anybody else held for the drinker,
-- so the new face reads as a stranger to everyone, and sets roleUnteachable, so
-- their seat is never taught or seeded again. The entries stay on each owner's
-- page as loose notes (MANUAL, tied to nobody), old name and role and notes intact.
--
-- 1. The column, false for everybody.
-- 2. One character on the running game drank a potion before this deploy: the
--    one played by Discord user 436238225401446401. That player's characters
--    with a request_change_name audit row (the potion, drunk) get the same
--    treatment the code now gives at the moment of drinking, plus one
--    mulligan_friends_unlinked audit row.
--
-- Idempotent, and a no-op on any other database: a second run finds the flag set
-- and nothing still linked, so it writes nothing. No Discord line goes out.
ALTER TABLE "Character" ADD COLUMN "roleUnteachable" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  d        RECORD;
  unlinked INTEGER;
BEGIN
  FOR d IN
    SELECT c."id", c."name", c."roleUnteachable"
    FROM "Character" c
    WHERE c."discordUserId" = '436238225401446401'
      AND EXISTS (
        SELECT 1 FROM "AuditLog" a
        WHERE a."targetCharacterId" = c."id" AND a."actionType" = 'request_change_name'
      )
  LOOP
    UPDATE "Acquaintance"
    SET "subjectId" = NULL, "source" = 'MANUAL', "updatedAt" = now()
    WHERE "subjectId" = d."id";
    GET DIAGNOSTICS unlinked = ROW_COUNT;

    IF unlinked = 0 AND d."roleUnteachable" THEN
      CONTINUE;
    END IF;

    UPDATE "Character" SET "roleUnteachable" = true WHERE "id" = d."id";

    INSERT INTO "AuditLog" ("id", "actorDiscordUserId", "actionType", "targetCharacterId", "details", "createdAt")
    VALUES (
      gen_random_uuid()::text, 'system:migration', 'mulligan_friends_unlinked', d."id",
      jsonb_build_object('unlinked', unlinked, 'repair', '20261222000000_mulligan_unlinks_friends'),
      now()
    );

    RAISE NOTICE 'Mulligan repair: % (%) — % Friends entries unlinked.', d."name", d."id", unlinked;
  END LOOP;
END $$;
