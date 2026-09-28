-- The Baron's bank account becomes the Vault itself (docs/systemdocs/DEPOT.md
-- §0g, db/lib/bankAccounts.js): a new class beside TREASURY and OFFSHORE.
--
-- Alone in its own migration, the convention every other enum change here
-- follows: Postgres will not let a value added by ALTER TYPE ... ADD VALUE be
-- USED by another statement in the same transaction, and Prisma runs one
-- migration.sql per transaction. The next migration moves the Baron onto it.
ALTER TYPE "BankAccountClass" ADD VALUE IF NOT EXISTS 'CROWN';
