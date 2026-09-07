-- A general antagonist comfort-level survey (docs/systemdocs/CHARACTERS.md):
-- solo vs. leader, deliberately not tied to any specific seat in
-- db/lib/threats.js.

ALTER TABLE "Character" ADD COLUMN "antagonistOpenToSolo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Character" ADD COLUMN "antagonistOpenToLeader" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlayerPreference" ADD COLUMN "antagonistOpenToSolo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlayerPreference" ADD COLUMN "antagonistOpenToLeader" BOOLEAN NOT NULL DEFAULT false;
