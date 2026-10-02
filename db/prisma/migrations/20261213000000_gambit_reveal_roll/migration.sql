-- A GM can now withhold a Gambit's die from its player. The desk's "Roll to
-- player" switch writes this; the turn-end push reads it before sending the
-- "Your Gambit for turn N" DM (db/lib/stagedPush.js). Default true, so every
-- existing and in-flight Gambit keeps its reveal exactly as before. A constant
-- default makes this a metadata-only add — no table rewrite on the live game.
ALTER TABLE "Action" ADD COLUMN "revealRoll" BOOLEAN NOT NULL DEFAULT true;

-- Action_notify is column-scoped, so a flip of the switch would not wake a
-- second GM's desk unless the column is in its UPDATE OF list. Recreated
-- exactly as 20261002000000_strip_laboring left it, plus "revealRoll".
DROP TRIGGER IF EXISTS "Action_notify" ON "Action";
CREATE TRIGGER "Action_notify"
  AFTER INSERT OR DELETE OR UPDATE OF
    "moveReviewStatus",
    "resultMessage",
    "moveKind",
    "revealRoll",
    "reviewedByDiscordUserId",
    "lockedByDiscordUserId",
    "lockExpiresAt",
    "appliedEffects"
  ON "Action"
  FOR EACH ROW EXECUTE FUNCTION bascinet_desk_notify('move');
