-- The fourth specialised labor type: Prospecting (docs/systemdocs/LABORING.md).
-- Same shape as Hunting/Farming/Fishing — a LocationYield row per Location
-- that supports it, gated behind the new laboring-prospecting tag.
ALTER TYPE "LaborKind" ADD VALUE 'PROSPECTING';
