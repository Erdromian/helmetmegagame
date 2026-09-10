-- The Oracle's playtest switch (docs/systemdocs/ORACLE.md §12).
--
-- Two separate questions, so two separate columns: oracleEnabled decides
-- whether a chronicle is DRAFTED at turn close, and this decides who may READ
-- one. On, the desk is superadmin-only, so a turn can be drafted and reviewed
-- before the other gamemasters ever see a page.
ALTER TABLE "GameConfig" ADD COLUMN "oraclePlaytest" BOOLEAN NOT NULL DEFAULT false;
