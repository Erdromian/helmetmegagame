-- The two RequestType values for the Nuclear Device's Arm and Disarm buttons.
--
-- Enum-only and in its own migration, the reason the crucify and disguise
-- migrations both give: Postgres will not let a value be USED in the same
-- transaction that added it, and Prisma runs each migration file in one
-- transaction. The columns those requests touch land in the NEXT file.
--
-- Dated past 20260910200000 on purpose. The folder names in this directory run
-- ahead of the calendar, and a migration dated today would sort before ones
-- already applied, which breaks replay.
ALTER TYPE "RequestType" ADD VALUE 'ARM_NUKE';
ALTER TYPE "RequestType" ADD VALUE 'DISARM_NUKE';
