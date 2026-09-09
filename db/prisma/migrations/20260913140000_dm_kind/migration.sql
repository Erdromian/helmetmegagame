-- A DirectMessage says what KIND of thing it is, instead of the desk guessing
-- from a free `source` string whose absence read as "a human wrote this".
--
-- Default CONVERSATION here and only here: it is what makes the backfill a
-- no-op for every row the CASE below does not name. The sendDm functions
-- default to NOTICE instead, which is the actual fix.
ALTER TABLE "DirectMessage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CONVERSATION';

-- Backfill. Two different jobs in one statement:
--
--   QUIET and the first four NOTICE sources reproduce exactly what the desk
--   already did with these rows, so nothing a GM has read changes shape.
--
--   The rest of the NOTICE list is the repair. Every one of those strings was
--   invented at a call site and never added to any filter, so a seat
--   assignment and a bird letter have been sitting in the inbox as if a
--   person had typed them. They come out.
--
--   Everything else, NULL included, stays CONVERSATION. A NULL row is
--   ambiguous and is already in somebody's inbox; reclassifying it would
--   rewrite what a GM saw last week.
UPDATE "DirectMessage" SET "kind" = CASE
  WHEN "source" IN ('system_notice', 'prompt_reply')
       OR ("meta"->>'embed') = 'true'
    THEN 'QUIET'
  WHEN "source" IN (
         'bot_auto', 'player_event', 'gm_dev', 'move_unlock', 'mention',
         'gm_letter', 'bird', 'rite', 'gm_dev_panel',
         'threat_assign', 'threat_spawn_offer',
         'lobby_assignment', 'lobby_returned', 'lobby_reminder', 'lobby_expired'
       )
    THEN 'NOTICE'
  ELSE 'CONVERSATION'
END;

-- The rail's DISTINCT ON is now keyed on kind first.
CREATE INDEX "DirectMessage_kind_discordUserId_createdAt_idx"
  ON "DirectMessage"("kind", "discordUserId", "createdAt");

-- Only now does the default flip. It had to be CONVERSATION for the ADD
-- COLUMN above so the backfill CASE was the single decider for every existing
-- row; from here on a row nobody classified is a notice, which is the whole
-- point of the column.
ALTER TABLE "DirectMessage" ALTER COLUMN "kind" SET DEFAULT 'NOTICE';
