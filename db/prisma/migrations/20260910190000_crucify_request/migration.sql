-- One new RequestType value for the Crucify button on /character.
--
-- Enum-only, in its own migration on purpose. Postgres will not let a value
-- be USED in the same transaction that added it, and Prisma runs each
-- migration file in one transaction — so anything referencing this label in
-- SQL has to land in a later file. Nothing here does.
ALTER TYPE "RequestType" ADD VALUE 'CRUCIFY_CHARACTER';
