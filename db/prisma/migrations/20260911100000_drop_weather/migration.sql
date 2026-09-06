-- Weather is gone. It rolled a per-turn state that gated no mechanic: it added
-- a sentence to the turn announcement and picked which of eight banners #turns
-- posted. The banners stay, keyed on nothing but the phase now, so the column
-- weather occupied becomes the chosen banner's filename.
--
-- The folder is hand-named 20260911100000 rather than dated today on purpose.
-- These directory names run ahead of the calendar, and a 20260906 folder would
-- replay BEFORE 20260911050000_game_state_lobby, which creates GameState with a
-- "Weather" column — dropping the type first makes that migration fail with
-- `type "Weather" does not exist` on every shadow-database replay and every
-- fresh bootstrap.

ALTER TABLE "Turn" DROP COLUMN "weather";
ALTER TABLE "Turn" ADD COLUMN "banner" TEXT;

ALTER TABLE "GameState" DROP COLUMN "nextWeather";

-- Last, so both columns using the type are gone before the type is.
DROP TYPE "Weather";
