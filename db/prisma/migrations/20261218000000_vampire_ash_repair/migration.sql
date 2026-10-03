-- A dead Vampire leaves no body (docs/systemdocs/VAMPIRE.md §7): their goods fall on
-- the floor beside a Pile of Ash and the sheet is gibbed. Until this deploy that only
-- happened on two death paths out of eleven, so a vampire killed by a collar, the
-- Magma, a rite, the turret or a turn pass left an ordinary corpse. And even the two
-- paths that did ash them left the dead sheet lying in the room as a body, still
-- lootable, since only a Gibbed sheet drops out of db/lib/presence.js#UNBURIED_BODY_WHERE.
-- The code now does all of it inside db/lib/characterDeath.js#applyDeathToRow
-- (db/lib/vampireDeath.js#ashBody). This puts every vampire who already died into
-- the same state.
--
-- For every DEAD, unburied vampire whose sheet is not already Gibbed:
--   1. The room: wherever their corpse lies, or else a random public room at the
--      Location where they fell (roomStash.js#pickRandomPublicRoom's rule). With
--      neither, they are left alone for a GM and named in a NOTICE.
--   2. Every tradeable holding, ⬢ included, moves onto that room's floor. It merges
--      the way tagWrites.js#addToRoomStack does: quantities add, the earlier clock
--      wins, and poison only joins a matching payload. The ⬢ move writes one BALANCE
--      ledger row, character to room, so neither side reads as drift (ECONOMY.md §3).
--      GOODS rows are not reconciled, so none is written for them.
--   3. Their corpse is removed from the world. Its holdings go first, since
--      CharacterTag.tagId is RESTRICT. The Tag row goes too, unless something still
--      points at it.
--   4. One Pile of Ash lands in the room.
--   5. The sheet is gibbed, like characterDeath.js#vaporizeTags: every tag goes except
--      the antagonist seats (threats.js#SEAT_TAG_SLUGS, which the epilogue reads off
--      live rows), and one Gibbed tag goes on. Nobody is left carrying the body.
--   6. One vampire_ashed audit row records what moved.
--
-- Idempotent: a repaired sheet is Gibbed, so a second run matches nobody. A buried
-- vampire is left alone, because their body was already dealt with. No Discord line
-- goes out for an old death.
DO $$
DECLARE
  ash_id     TEXT;
  gibbed_id  TEXT;
  game_id    TEXT;
  v          RECORD;
  r          RECORD;
  corpse_id  TEXT;
  room_id    TEXT;
  room_name  TEXT;
  room_loc   TEXT;
  moved      JSONB;
BEGIN
  SELECT "id" INTO ash_id FROM "Tag" WHERE "slug" = 'pile-of-ash';
  SELECT "id" INTO gibbed_id FROM "Tag" WHERE "slug" = 'gibbed';
  IF ash_id IS NULL OR gibbed_id IS NULL THEN
    RAISE NOTICE 'Vampire ash repair skipped: the pile-of-ash or gibbed tag is missing (run db:sync-tags, then repair by hand).';
    RETURN;
  END IF;
  SELECT "gameId" INTO game_id FROM "GameState" WHERE "id" = 1;

  FOR v IN
    SELECT c."id", c."name", c."locationId", c."zoneId"
    FROM "Character" c
    WHERE c."status" = 'DEAD'
      AND c."buriedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "CharacterTag" ct JOIN "Tag" t ON t."id" = ct."tagId"
        WHERE ct."characterId" = c."id" AND t."slug" = 'vampire'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CharacterTag" ct
        WHERE ct."characterId" = c."id" AND ct."tagId" = gibbed_id
      )
  LOOP
    -- 1. Where the remains go.
    corpse_id := NULL;
    room_id := NULL;
    SELECT "id" INTO corpse_id FROM "Tag" WHERE "corpseOfCharacterId" = v."id";
    IF corpse_id IS NOT NULL THEN
      SELECT rt."roomId" INTO room_id
      FROM "RoomTag" rt JOIN "Room" rm ON rm."id" = rt."roomId"
      WHERE rt."tagId" = corpse_id AND rm."destroysContents" = false
      LIMIT 1;
    END IF;
    IF room_id IS NULL AND v."locationId" IS NOT NULL THEN
      SELECT "id" INTO room_id
      FROM "Room"
      WHERE "locationId" = v."locationId" AND "kind" = 'PUBLIC' AND "destroysContents" = false
      ORDER BY random()
      LIMIT 1;
    END IF;
    IF room_id IS NULL THEN
      RAISE NOTICE 'Vampire ash repair: no room for % (%), left for a GM.', v."name", v."id";
      CONTINUE;
    END IF;
    SELECT "name", "locationId" INTO room_name, room_loc FROM "Room" WHERE "id" = room_id;

    -- 2. Their goods, onto the floor.
    moved := '[]'::jsonb;
    FOR r IN
      SELECT ct."id", ct."tagId", ct."quantity", ct."expiresTurn", ct."poisonedCount", ct."poisonPayload",
             t."slug", t."name"
      FROM "CharacterTag" ct JOIN "Tag" t ON t."id" = ct."tagId"
      WHERE ct."characterId" = v."id"
        AND ct."quantity" > 0
        AND t."tradeable" = true
        AND t."id" IS DISTINCT FROM corpse_id
    LOOP
      INSERT INTO "RoomTag" ("id", "roomId", "tagId", "quantity", "expiresTurn", "poisonedCount", "poisonPayload", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid()::text, room_id, r."tagId", r."quantity", r."expiresTurn",
        GREATEST(r."poisonedCount", 0),
        CASE WHEN r."poisonedCount" > 0 THEN r."poisonPayload" END,
        now(), now()
      )
      ON CONFLICT ("roomId", "tagId") DO UPDATE SET
        "quantity" = "RoomTag"."quantity" + EXCLUDED."quantity",
        -- LEAST skips NULLs: the earlier clock wins, and a clockless side never clears one.
        "expiresTurn" = LEAST("RoomTag"."expiresTurn", EXCLUDED."expiresTurn"),
        "poisonedCount" = CASE
          WHEN EXCLUDED."poisonedCount" > 0
           AND ("RoomTag"."poisonPayload" IS NULL OR "RoomTag"."poisonPayload" = EXCLUDED."poisonPayload")
          THEN "RoomTag"."poisonedCount" + EXCLUDED."poisonedCount"
          ELSE "RoomTag"."poisonedCount" END,
        "poisonPayload" = CASE
          WHEN EXCLUDED."poisonedCount" > 0
           AND ("RoomTag"."poisonPayload" IS NULL OR "RoomTag"."poisonPayload" = EXCLUDED."poisonPayload")
          THEN COALESCE(EXCLUDED."poisonPayload", "RoomTag"."poisonPayload")
          ELSE "RoomTag"."poisonPayload" END,
        "updatedAt" = now();

      DELETE FROM "CharacterTag" WHERE "id" = r."id";

      IF r."slug" = 'resources' AND game_id IS NOT NULL THEN
        INSERT INTO "EconomyEntry" (
          "id", "gameId", "fromKind", "fromId", "fromName", "toKind", "toId", "toName",
          "form", "amount", "tagId", "tagSlug", "quantity", "unitValue", "reason",
          "actionType", "actorDiscordUserId", "zoneId", "locationId", "roomId"
        ) VALUES (
          gen_random_uuid()::text, game_id, 'character', v."id", v."name", 'room', room_id, room_name,
          'BALANCE', r."quantity", r."tagId", r."slug", r."quantity", 1, 'UNATTRIBUTED',
          'vampire_ashed', 'system:migration', v."zoneId", room_loc, room_id
        );
      END IF;

      moved := moved || jsonb_build_array(jsonb_build_object(
        'tagId', r."tagId", 'tagSlug', r."slug", 'tagName', r."name", 'quantity', r."quantity"
      ));
    END LOOP;

    -- 3. The corpse goes out of the world.
    IF corpse_id IS NOT NULL THEN
      DELETE FROM "CharacterTag" WHERE "tagId" = corpse_id;
      DELETE FROM "RoomTag" WHERE "tagId" = corpse_id;
      IF NOT EXISTS (SELECT 1 FROM "Offer" WHERE "tagId" = corpse_id)
         AND NOT EXISTS (SELECT 1 FROM "CraftProject" WHERE "tagId" = corpse_id)
         AND NOT EXISTS (SELECT 1 FROM "CavingRoll" WHERE "lootTagId" = corpse_id) THEN
        DELETE FROM "Tag" WHERE "id" = corpse_id;
      END IF;
    END IF;

    -- 4. The Pile of Ash.
    INSERT INTO "RoomTag" ("id", "roomId", "tagId", "quantity", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, room_id, ash_id, 1, now(), now())
    ON CONFLICT ("roomId", "tagId") DO UPDATE SET "quantity" = "RoomTag"."quantity" + 1, "updatedAt" = now();

    -- 5. The gib. Seat list mirrors db/lib/threats.js#SEAT_TAG_SLUGS.
    DELETE FROM "CharacterTag" ct
    USING "Tag" t
    WHERE ct."tagId" = t."id"
      AND ct."characterId" = v."id"
      AND t."slug" NOT IN ('bastard', 'demoness', 'judge', 'thanati', 'thanati-leader',
                           'ordinator-insignia', 'tribunal-helmet', 'vampire');
    INSERT INTO "CharacterTag" ("id", "characterId", "tagId", "source", "quantity", "acquiredAt")
    VALUES (gen_random_uuid()::text, v."id", gibbed_id, 'EVENT', 1, now())
    ON CONFLICT ("characterId", "tagId") DO NOTHING;
    UPDATE "Character" SET "escortedById" = NULL, "deathMaskTagId" = NULL WHERE "id" = v."id";

    -- 6. The record.
    INSERT INTO "AuditLog" ("id", "actorDiscordUserId", "actionType", "targetCharacterId", "details", "createdAt")
    VALUES (
      gen_random_uuid()::text, 'system:migration', 'vampire_ashed', v."id",
      jsonb_build_object(
        'roomId', room_id, 'roomName', room_name, 'ash', true, 'tags', moved,
        'corpseRemoved', corpse_id IS NOT NULL, 'repair', '20261218000000_vampire_ash_repair'
      ),
      now()
    );

    RAISE NOTICE 'Vampire ash repair: % (%) is ash in %.', v."name", v."id", room_name;
  END LOOP;
END $$;
