-- Fate Slot Logic.docx: Bum and Migrant leave the lobby's priority list, and a
-- player the roll cannot seat chooses Spawn as Bum, Spawn as Migrant or Return
-- to lobby (docs/systemdocs/LOBBY.md §3). Additive, and safe to apply ahead of
-- the code that writes it.

-- ADD VALUE cannot run inside a transaction block on older Postgres, hence
-- IF NOT EXISTS rather than a guarded DO block.
ALTER TYPE "JoblessRole" ADD VALUE IF NOT EXISTS 'BUM';
