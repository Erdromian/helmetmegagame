-- The adjudication desk's live channel (docs/systemdocs/ADJUDICATION.md §3).
--
-- /gm/turns now owns its rows client-side (deskStore.js) and every mutation
-- hands back the rows it changed, so a GM's OWN work shows up at once. What
-- this adds is the other GM's work: a second desk learns about a staged
-- message, a claimed lock or a rejected Move without waiting on a refresh.
--
-- A trigger rather than a pg_notify() in each writer, for the same reason
-- DirectMessage_notify is one (20260913060000_dm_notify): the writers are
-- spread across all three packages — the web actions in
-- web/app/(desk)/gm/turns/actions.js, the turn-end push in
-- db/lib/stagedPush.js, the caving pass, db/lib/moveEconomy.js, the Dev Panel —
-- and the next one is one create() away. NOTIFY is transactional, so a
-- listener never reads a row that has not committed.
--
-- The payload is a TYPE, an ID and whether the row is gone, and nothing else.
-- The hub does no read at all on this channel (web/lib/feedHub.js); the SSE
-- route re-reads what it is allowed to send through web/lib/deskRows.js, which
-- is the same discipline the presence channel follows — a notification is a
-- nudge, never an authorisation.
--
-- THE ACTION TRIGGER IS COLUMN-SCOPED on purpose. Action is written on every
-- filing, every travel stub and the whole turn-end push; firing the desk's
-- channel for a `confirmDmMessageId` or a `craftBudget` write would wake every
-- open desk for something no desk row draws. The columns below are exactly the
-- ones web/lib/moveRows.js#moveRow reads that can change after filing. An
-- INSERT or a DELETE always fires — a new Move belongs on the queue and a
-- rejected one has to leave it — because UPDATE OF only narrows UPDATE.
--
-- Prisma does not model triggers. Like the trgm indexes and DirectMessage_notify,
-- these four exist only in migration SQL and `prisma migrate diff` never
-- mentions them. The channel name is db/lib/deskNotify.js#DESK_CHANNEL.
CREATE OR REPLACE FUNCTION bascinet_desk_notify() RETURNS trigger AS $$
DECLARE
  row_id text;
BEGIN
  -- NEW is unassigned in a DELETE trigger and reading it raises, so branch on
  -- TG_OP rather than COALESCE the two together.
  IF TG_OP = 'DELETE' THEN
    row_id := OLD.id;
  ELSE
    row_id := NEW.id;
  END IF;
  PERFORM pg_notify(
    'bascinet_desk',
    json_build_object(
      't', TG_ARGV[0],
      'id', row_id,
      'op', CASE TG_OP WHEN 'DELETE' THEN 'gone' ELSE 'row' END
    )::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "StagedEffect_notify" ON "StagedEffect";
CREATE TRIGGER "StagedEffect_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "StagedEffect"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('effect');

DROP TRIGGER IF EXISTS "StagedMessage_notify" ON "StagedMessage";
CREATE TRIGGER "StagedMessage_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "StagedMessage"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('message');

DROP TRIGGER IF EXISTS "CavingRoll_notify" ON "CavingRoll";
CREATE TRIGGER "CavingRoll_notify"
  AFTER INSERT OR UPDATE OR DELETE ON "CavingRoll"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('caving');

DROP TRIGGER IF EXISTS "Action_notify" ON "Action";
DROP TRIGGER IF EXISTS "Action_notify_update" ON "Action";
CREATE TRIGGER "Action_notify"
  AFTER INSERT OR DELETE OR UPDATE OF
    "moveReviewStatus",
    "resultMessage",
    "moveKind",
    "reviewedByDiscordUserId",
    "lockedByDiscordUserId",
    "lockExpiresAt",
    "appliedEffects"
  ON "Action"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('move');
