// One line into #turns when a session opens or closes. In db/lib rather than bot/src because BOTH faces send it: the bot's
// per-minute clock when a schedule comes due, and a superadmin's Start now / Close now on /gm/dev. REST-only, the
// ARCHITECTURE.md twin convention.
//
// One line into #turns when a session opens or closes. Subtext, through db/lib/ambientLine.js, because it is the world
// speaking rather than a person (CLAUDE.md, "Bot message style") — and deliberately NOT a rewrite of the rolling turn
// announcement, which stays where it is: the announcement is the turn, and a session is a thing that happens to it.
const { getGuildChannels, postMessage } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { isTurnsChannel } = require("./turnsChannelAccess");
const { postSessionToGame } = require("./gameChannel");

// Takes the whole result db/lib/session.js hands back — `{ line, open }` — rather than the sentence
// alone: the web's Game channel wants the FACT, and re-reading it out of the words would be one
// string away from a line that says the opposite of what happened.
//
// The web write goes FIRST, and above the Discord guards below. A checkout with no bot token is
// still a game somebody is reading on the web, and returning early there used to mean the notice
// reached nobody at all.
async function speakIntoTurns(prisma, notice) {
  const line = notice?.line;
  if (!line) return;
  await postSessionToGame(prisma, { open: Boolean(notice.open) }).catch((err) =>
    console.error("Session notice: the Game channel write failed:", err),
  );
  if (!process.env.DISCORD_GUILD_ID || !process.env.DISCORD_TOKEN) return;
  const channels = await getGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);
  if (!turnsChannel) return;
  await postMessage(turnsChannel.id, { content: ambientLine(line) });
}

module.exports = { speakIntoTurns };
