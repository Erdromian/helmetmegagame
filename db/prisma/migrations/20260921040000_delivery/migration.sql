-- One row per send of a staged message (docs/systemdocs/ADJUDICATION.md §1a).
-- The schema comment on model Delivery says why it exists; the short version
-- is that the push's old record of progress was a step key on the Turn that
-- was written whether or not the DM actually arrived.
--
-- No backfill. Every StagedMessage already pushed keeps its sentAt and its
-- deliveryFailures blob, and the desk still reads both — an old turn simply
-- has no Delivery rows, and nothing asks it for any.

CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'IN_FLIGHT', 'SENT', 'FAILED');

CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "stagedMessageId" TEXT NOT NULL,
    "characterId" TEXT,
    "discordUserId" TEXT,
    "name" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "state" "DeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "discordMessageId" TEXT,
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- The identity of a delivery attempt, and the whole anti-double-send rule:
-- the push creates rows with skipDuplicates on this, so a resumed pass adds
-- nothing, and a Resend claims the row that is already here.
CREATE UNIQUE INDEX "Delivery_dedupeKey_key" ON "Delivery"("dedupeKey");
CREATE INDEX "Delivery_stagedMessageId_idx" ON "Delivery"("stagedMessageId");
CREATE INDEX "Delivery_state_idx" ON "Delivery"("state");

ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_stagedMessageId_fkey"
    FOREIGN KEY ("stagedMessageId") REFERENCES "StagedMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The desk's live channel (20260921030000_desk_notify). A Delivery gets NO
-- channel of its own: no desk row is a Delivery, so announcing one as a new
-- type would give every listener an id it has nothing to do with. It announces
-- its PARENT instead, under the message type the desk already knows, and
-- web/lib/deskRows.js re-reads the StagedMessage with its deliveries included.
--
-- Without this, the per-recipient state on a second GM's screen would only
-- move when StagedMessage itself was next written — which for the middle of a
-- long push is minutes.
CREATE OR REPLACE FUNCTION bascinet_delivery_notify() RETURNS trigger AS $$
DECLARE
  parent_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."stagedMessageId";
  ELSE
    parent_id := NEW."stagedMessageId";
  END IF;
  PERFORM pg_notify(
    'bascinet_desk',
    json_build_object('t', 'message', 'id', parent_id, 'op', 'row')::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Delivery_notify" ON "Delivery";
CREATE TRIGGER "Delivery_notify"
  AFTER INSERT OR UPDATE OF "state", "sentAt", "lastError" OR DELETE ON "Delivery"
  FOR EACH ROW EXECUTE FUNCTION bascinet_delivery_notify();
