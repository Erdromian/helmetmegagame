-- The structural-edge system is gone: no authored edge ever used it, and the
-- Bridge (the one structure that needed it) left the catalog with it. A
-- Structure no longer holds a LocationLink open or shut, and a LocationLink
-- is never structure-controlled. authoredOpen stays — ordinary modular gates
-- still reset to it on a Restart Game wipe.
ALTER TABLE "Structure" DROP CONSTRAINT "Structure_linkId_fkey";
DROP INDEX "Structure_linkId_idx";
ALTER TABLE "Structure" DROP COLUMN "linkId";
ALTER TABLE "LocationLink" DROP COLUMN "structural";
