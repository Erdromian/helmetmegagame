-- The Discord half of a turn advance is now recorded the way the database half
-- already was, so a fan-out killed by a redeploy is finished on the next
-- advance instead of being lost. See db/lib/turnSideEffects.js.
ALTER TABLE "Turn" ADD COLUMN "sideEffectPayload" JSONB;
ALTER TABLE "Turn" ADD COLUMN "sideEffectSteps" JSONB;
ALTER TABLE "Turn" ADD COLUMN "sideEffectsDoneAt" TIMESTAMP(3);
ALTER TABLE "Turn" ADD COLUMN "sideEffectClaimedAt" TIMESTAMP(3);

-- Every turn that already closed is done; only rows created from here on can
-- have an unfinished fan-out, and a null payload is what marks them ineligible.
