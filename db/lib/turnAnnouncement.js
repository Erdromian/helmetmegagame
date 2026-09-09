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
const { clearMessagesExcept } = require("./discordRest");
const { isTurnsChannel } = require("./turnsChannelAccess");
const { TURN_BANNER_DIR, turnBannerPath } = require("./turnBanner");
const { pushToUser, vapidPublicKey } = require("./webPush");

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
    readGameState(prisma, {
      game: { select: { nukeDetonatedTurn: true, ascensionFiredTurn: true } },
    }),
  ]);
  const sent = await postTurnsConsole(prisma, turnsChannel.id, text, newTurn, config, state);
  if (!sent) console.error("Turn announcement: nothing could be posted to #turns");

  // AFTER the announcement, never before it: a turn opens whether or not
  // anybody's browser hears about it. Best-effort throughout — an unconfigured
  // deployment is a no-op (db/lib/webPush.js) and nothing here can throw.
  await pushTurnOpen(prisma, text).catch((err) =>
    console.error("Turn announcement: push failed:", err),
  );
}

// Between one push and the next, so a hundred players do not become a hundred
// requests in the same instant. The turn has already opened by the time this
// runs, so a few seconds spent walking the list costs nobody anything.
const TURN_PUSH_GAP_MS = 40;

// Every player holding a living character, told the day has turned. One query
// for the distinct Discord accounts, then one send each — db/lib/webPush.js
// returns early for an account with no subscribed browser, which is most of
// them.
async function pushTurnOpen(prisma, text) {
  // Asked once, before the roster: without VAPID keys every send below is a
  // no-op and the gap between them would be four wasted seconds on the turn.
  if (!vapidPublicKey()) return;
  // The banner's first line is the day and the phase ("DAY 4 · DUSK"), which
  // is the whole of what a notification needs to say.
  const firstLine = String(text ?? "").split("\n").find((line) => line.trim()) ?? "";
  const players = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { discordUserId: true },
    distinct: ["discordUserId"],
  });
  for (const player of players) {
    if (!player.discordUserId) continue;
    await pushToUser(prisma, player.discordUserId, {
      title: "The turn has opened",
      body: firstLine,
      url: "/play#gm",
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, TURN_PUSH_GAP_MS));
  }
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
    // #turns is not in SPECIAL_CHANNELS, so the message wipe never reaches it;
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
