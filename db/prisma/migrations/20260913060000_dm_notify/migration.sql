-- Every DirectMessage insert announces itself, so the Hall's Bascinet
-- conversation (docs/systemdocs/HALL.md §2b) updates live. A trigger rather
-- than a call in each writer: there are four of them across three packages,
-- and a fifth is one sendDm() away. NOTIFY is transactional — Postgres
-- delivers it at COMMIT — so a listener never looks up a row that is not
-- there yet. Prisma does not model triggers; like the trgm indexes, this
-- exists only in migration SQL and `prisma migrate diff` never mentions it.
-- The channel name is db/lib/dmNotify.js#DM_CHANNEL; the listener is
-- web/lib/feedHub.js.
CREATE OR REPLACE FUNCTION bascinet_dm_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'bascinet_dm',
    json_build_object('id', NEW.id, 'discordUserId', NEW."discordUserId")::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DirectMessage_notify" ON "DirectMessage";
CREATE TRIGGER "DirectMessage_notify"
  AFTER INSERT ON "DirectMessage"
  FOR EACH ROW EXECUTE FUNCTION bascinet_dm_notify();
