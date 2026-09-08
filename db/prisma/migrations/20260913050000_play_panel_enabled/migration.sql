-- The Hall switch (docs/systemdocs/HALL.md §5). On by default.
ALTER TABLE "GameConfig" ADD COLUMN "playPanelEnabled" BOOLEAN NOT NULL DEFAULT true;
