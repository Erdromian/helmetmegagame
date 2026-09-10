-- The 27.065 radio net: a second special channel under the shared "radio"
-- category. See db/lib/specialChannels.js.
ALTER TABLE "GameConfig" ADD COLUMN "freq27065ChannelId" TEXT;
