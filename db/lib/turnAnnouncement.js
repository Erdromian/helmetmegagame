// REST-only turn announcement, called from db/index.js#advanceTurn() — the
// single implementation for both the bot's cron path and the web Dev
// Panel's manual "End Turn" button. Takes `prisma` as a parameter rather
// than `require("../index")`, since db/index.js is the one importing this
// module — requiring it back would be a circular require resolving to a
// partial (prisma-less) exports object.
const fs = require("node:fs");
const path = require("node:path");
const { getGuildChannels, postMessage, deleteMessage, postAttachment } = require("./discordRest");
const { buildTurnAnnouncement } = require("../turnCalendar");
const { clockFrozen, readGameState } = require("./gameState");
const { TURNS_CONSOLE_ROW, CONSOLE_TEXT } = require("./turnsConsoleRow");
const { docsPath } = require("./repoPaths");
const { clearMessagesExcept } = require("./dawnWipe");
const { isTurnsChannel } = require("./turnsChannelAccess");
const { TURN_BANNER_DIR, turnBannerPath } = require("./turnBanner");

// #turns is ONE rolling message: the turn announcement, the banner and
// the player console on a single post, deleted and reposted each turn — one
// message has no ordering problem to solve. Discord renders content, then
// attachments, then components, which is exactly the wanted layout:
//
//   DAY 4 · DUSK                 <- content
//   [ turn banner ]              <- attachment
//   Travel   Move   Speak        <- components, always last
//
// and the buttons are at the bottom of the channel by construction.
async function postTurnsAnnouncement(prisma, newTurn, note) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  const channels = await getGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);
  if (!turnsChannel) return;

  // The Move-cutoff clause is omitted when the clock is frozen — auto-advance
  // paused, or the game not running — since there is then no scheduled end to
  // count back from (db/lib/turnClock.js).
  const text = [
    buildTurnAnnouncement(newTurn, note, { clockFrozen: await clockFrozen(prisma) }),
    CONSOLE_TEXT,
  ].join("\n");

  const [config, state] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma, { nukeDetonatedTurn: true }),
  ]);
  const sent = await postTurnsConsole(prisma, turnsChannel.id, text, newTurn, config, state);
  if (!sent) console.error("Turn announcement: nothing could be posted to #turns");
}

// Posts the rolling message and records its id, replacing whatever was there.
// Shared with the bot's cold-start path (bot/src/lib/turnsConsole.js) so the
// console can never exist in two shapes.
async function postTurnsConsole(prisma, channelId, text, turn, config, state = null) {
  if (config?.turnsConsoleChannelId === channelId && config.turnsConsoleMessageId) {
    await deleteMessage(channelId, config.turnsConsoleMessageId).catch(() => {});
  }

  // A missing asset must cost the guild its banner, never its announcement —
  // but it must not do so SILENTLY. Both failure modes are logged and
  // distinguished: absent from disk is a deploy problem, a rejected upload is
  // a permissions or payload problem.
  const bannerFile = turnBannerPath(turn, state);
  if (turn && !bannerFile) {
    console.error(
      `Turn announcement: no banner for ${turn.banner ?? "(unset)"}/${turn.phase} in ${TURN_BANNER_DIR}`,
    );
  }

  let sent = null;
  if (bannerFile) {
    sent = await postAttachment(channelId, bannerFile, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: banner upload failed:", err);
      return null;
    });
  }
  // No banner, or the upload failed: the announcement and the buttons still go
  // out, just without the picture.
  if (!sent) {
    sent = await postMessage(channelId, text, [TURNS_CONSOLE_ROW]).catch((err) => {
      console.error("Turn announcement: post failed:", err);
      return null;
    });
  }

  if (sent) {
    await prisma.gameConfig.update({
      where: { id: 1 },
      data: { turnsConsoleChannelId: channelId, turnsConsoleMessageId: sent.id },
    });
    // Sweep anything else that landed in #turns since the last turn — a
    // stray GM message, an orphaned console from before a config reset.
    // #turns is not in SPECIAL_CHANNELS, so the Dawn wipe never reaches it;
    // this is that channel's only cleanup, and it runs every turn, not just
    // at Dawn. Best-effort: a sweep failure must not cost the turn
    // announcement that already went out.
    await clearMessagesExcept(channelId, sent.id).catch((err) => {
      console.error("Turn announcement: #turns sweep failed:", err);
    });
  }
  return sent;
}

module.exports = { postTurnsAnnouncement, postTurnsConsole };
