-- The Keep's Vault is stocked as a share of the town's starting bank balances
-- rather than a fixed pile: each new character's starting balance puts this
-- percentage of it into the Vault as coin (docs/systemdocs/DEPOT.md §0g). A
-- knob on /gm/dev (db/lib/gameConfigFields.js), 25 by default.
--
-- NOT NULL DEFAULT 25, so `migrate deploy` fills the one GameConfig row with
-- no pass deciding anything by hand.
ALTER TABLE "GameConfig" ADD COLUMN "vaultReservePercent" INTEGER NOT NULL DEFAULT 25;
