-- A DM can carry a sound now. The token is from db/lib/sfx.js and is validated on the
-- READ side (web/lib/dmThread.js#playerDmRow), the same door ArchiveEntry.sfx goes
-- through, so a row carrying junk plays nothing rather than fetching something.
--
-- No trigger change: DirectMessage_notify (20260913060000_dm_notify) sends only the id
-- and the account, and web/lib/feedHub.js re-reads the row.
ALTER TABLE "DirectMessage" ADD COLUMN "sfx" TEXT;
