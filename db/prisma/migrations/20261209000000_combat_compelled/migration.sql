-- A fight the game started for a Bloodcrazed or Wight Vampire
-- (db/lib/vampireCompulsion.js). Set on the Vampire's own participant row:
-- they can't call it off, and the GM desk heads their card with the line
-- saying they must feed this turn.
ALTER TABLE "CombatParticipant" ADD COLUMN "compelled" BOOLEAN NOT NULL DEFAULT false;
