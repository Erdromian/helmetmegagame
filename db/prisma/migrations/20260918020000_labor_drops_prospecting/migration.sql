-- The labor drop die now rolls for a Prospecting Labor too
-- (docs/systemdocs/LABORDROPS.md, db/lib/laborDrops.js#TIER_TO_LABOR_DROP_TYPE).
ALTER TYPE "LaborDropLaborType" ADD VALUE 'PROSPECTING';
