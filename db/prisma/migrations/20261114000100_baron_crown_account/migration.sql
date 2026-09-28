-- The Baron's account is the Vault itself: at any infoterminal it holds every
-- obol in the Vault, and the Baron can take out as much as is there
-- (docs/systemdocs/DEPOT.md §0g, db/lib/bankAccounts.js).
--
-- The seat, so the next Baron created opens a CROWN account. Roles are not
-- re-synced on deploy (db:sync-deploy runs tags, desires and documents only),
-- so this is what reaches a running game; docs/roles.yaml says the same thing
-- for the next Restart Game. A crown account opens with nothing — its balance
-- is the Vault — so the starting balance goes to 0.
UPDATE "Role"
SET "bankAccountClass" = 'CROWN', "startingAccountObols" = 0
WHERE "slug" = 'baron';

-- Every account already opened for a Baron, living or dead. A dead Baron's
-- ring still opens it with the PIN, the way any account's ring does, and the
-- Vault is what it opens onto now.
--
-- `balanceObols` is left exactly as it is. The Crown's balance is read off the
-- Vault and the column is never written again, so whatever the Baron held
-- stays there frozen — which keeps the ledger's sum for this account equal to
-- its stored balance (ECONOMY.md §3), where zeroing it here would leave a
-- drift with no ledger row to explain it. It also drops out of the claims the
-- Vault backs (every reader filters on TREASURY), which is right: the Baron no
-- longer has a claim on the pile, they have the pile.
UPDATE "BankAccount" AS b
SET "class" = 'CROWN', "updatedAt" = NOW()
FROM "Character" AS c
JOIN "Role" AS r ON r."id" = c."roleId"
WHERE b."characterId" = c."id"
AND r."slug" = 'baron'
AND b."class" <> 'CROWN';
