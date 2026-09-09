const cron = require("node-cron");
const { ActivityType, Events } = require("discord.js");
const { prisma, resumeTurnSideEffects } = require("@lifeweb/db");
const {
  getInvalidResponseStats,
  loadBreakerState,
  recordInvalidResponse,
} = require("@lifeweb/db/lib/discordRest");
const { syncNicknamesForGuild } = require("../lib/nickname");
const { advanceTurn } = require("../lib/turnEngine");
const { ensureTurnsConsole } = require("../lib/turnsConsole");
const { ensureReportAnchor } = require("../lib/reportChannel");
const { refreshLocationChannels } = require("../lib/channels");
const { startFeedOutbox } = require("../lib/feedOutbox");
const { runWhisperPoll } = require("../lib/whisperPoll");
const { runLobbySweep } = require("@lifeweb/db/lib/lobbySweep");
const { runRiteSweep } = require("@lifeweb/db/lib/riteSweep");
const { getGameState } = require("@lifeweb/db/lib/gameState");
const { startDeathSmell } = require("../lib/deathSmell");
const { registerCommands } = require("../lib/commands");
const { catchUpMissedMessages } = require("../lib/messageCatchUp");

// Vars this process reads behind a truthiness guard — `if (process.env.X)`,
// `?? null`, `.filter(Boolean)`. A missing one is not an error, it is a
// feature that is off with nothing in the log to say so, which is how
// DISCORD_CURSED_ROLE_ID sat unset on the bot (and set on web) through a whole
// playtest while every rite and turn-clock death skipped the Cursed role.
//
// DATABASE_URL and DISCORD_TOKEN are deliberately absent: without either, this
// line is never reached at all.
const REQUIRED_ENV = [
  ["DISCORD_GUILD_ID", "every REST call"],
  ["DISCORD_CLIENT_ID", "the doctor's check that no zone role outranks the bot"],
  ["DISCORD_GM_ROLE_ID", "the standing GM seat — the gate narrows to Trial GMs"],
  ["DISCORD_TURN_PING_ROLE_ID", "the turn ping"],
  ["WEB_BASE_URL", "every link the bot writes into a DM"],
  ["AUTH_SECRET", "the hood tokens behind Who's here?"],
  ["VAPID_PUBLIC_KEY", "web push from the bot"],
  ["VAPID_PRIVATE_KEY", "web push from the bot"],
  ["VAPID_SUBJECT", "web push from the bot"],
];

// Printed, never thrown: guard() in bot/src/index.js would abort the whole
// ready chain — doctor, nickname sync, cron registration — over a missing
// turn-ping role.
function reportMissingEnv() {
  const missing = REQUIRED_ENV.filter(([name]) => !process.env[name]);
  if (missing.length === 0) return;
  console.error(
    `Missing env on the bot — these are silently OFF:\n` +
      missing.map(([name, what]) => `  ${name} — ${what}`).join("\n"),
  );
}

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    // Awaited, and BEFORE the listener below: the fire-and-forget load inside
    // recordInvalidResponse marks itself done the moment it starts, so a
    // response arriving first would leave this call returning empty-handed.
    // The whole point of the health line below is to report what the LAST
    // process left behind.
    await loadBreakerState();

    reportMissingEnv();

    // discord.js runs its own REST manager, so everything the gateway client
    // does — the ~130 nickname syncs below, every channel permission edit,
    // every proxy send — was invisible to the breaker, which only ever saw
    // db/lib/discordRest.js's traffic. Both halves share one egress IP and one
    // Cloudflare counter, so counting half of it against a whole-IP ceiling
    // was always going to under-report.
    //
    // discord.js clones the Response when anything is listening on this event.
    // That is a real per-request cost, and it is paid deliberately: only the
    // status is read, never the body, and knowing the true count is worth more
    // than the clone. The `rateLimited` event would be free but fires on
    // pre-emptive waits that never produced a 429, which is the wrong number.
    client.rest.on("response", (request, response) => {
      const status = response?.status;
      if (status === 401 || status === 403 || status === 429) {
        recordInvalidResponse(status, request?.path ?? request?.route ?? "unknown");
      }
    });

    // Printed on every connect so a climbing invalid-response count is visible
    // while it is still a number, not after it has become an hour-long
    // Cloudflare IP ban. A non-zero value here right after startup means the
    // previous process died mid-burst — see db/lib/discordRest.js.
    const restStats = getInvalidResponseStats();
    console.log(
      `Discord REST health: ${restStats.invalidInWindow}/${restStats.limit} invalid responses in the last 10m` +
        (restStats.breakerOpen ? ` — BREAKER OPEN until ${restStats.breakerOpenUntil}` : ""),
    );

    client.user.setPresence({
      // Discord renders no markdown and makes no links in a custom status, so
      // the Handbook is written as a bare URL players can read and type.
      activities: [
        {
          name: "status",
          type: ActivityType.Custom,
          state: "#questions | ravenheart.quest/handbook",
        },
      ],
      status: "online",
    });

    await prisma.gameConfig
      .upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      })
      .catch((err) => console.error("Failed to upsert GameConfig:", err));
    // Same for the per-game row: a brand-new database starts CLOSED, in Game 1.
    await getGameState(prisma).catch((err) => console.error("Failed to upsert GameState:", err));

    await refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err));

    // The web feed's Discord half: listen for messages typed into /chat and
    // post them into their Location channel, plus a catch-up sweep for
    // anything sent while the bot was down. After refreshLocationChannels so
    // the channel ids it resolves are the current ones. Never throws.
    await startFeedOutbox().catch((err) => console.error("Failed to start the feed outbox:", err));

    // The cheap reconciliation pass: role membership (zone, turn-ping,
    // cursed) and structural drift, repaired against the DB. A
    // handful of requests regardless of roster size, so it's safe on every
    // restart — this is what catches whatever a wipe, a crash or a
    // rate-limited swap left behind (db/lib/channelDoctor.js).
    {
      const { runChannelDoctor } = require("@lifeweb/db/lib/channelDoctor");
      await runChannelDoctor(prisma, { apply: true, scope: "cheap" })
        .then((r) => {
          if (r.findings.length > 0) {
            console.log(`Channel doctor: ${r.findings.length} finding(s), ${r.repaired} repaired.`);
          }
        })
        .catch((err) => console.error("Channel doctor pass failed:", err));
    }

    // Every GM's zone view, materialized as "GM: <Zone>" roles. This is what
    // seats a BRAND NEW GM without them having to find the control first:
    // no GmZoneView rows means every zone, and this is what actually hands
    // them the roles that say so. Also repairs anyone whose grant failed
    // mid-rate-limit, and anyone who left and came back (Discord strips every
    // role with the membership). See db/lib/gmZoneRoles.js.
    {
      const { syncAllGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");
      const { hasGmRole } = require("@lifeweb/db/lib/roleIds");
      const { listGuildMembers } = require("@lifeweb/db/lib/discordRest");
      await listGuildMembers()
        .then((members) =>
          syncAllGmZoneRoles(
            prisma,
            members.filter((m) => hasGmRole(m.roles)).map((m) => m.user.id),
          ),
        )
        .then((touched) => {
          if (touched > 0) console.log(`GM zone views: ${touched} gamemaster(s) re-seated.`);
        })
        .catch((err) => console.error("GM zone view pass failed:", err));
    }

    for (const guild of client.guilds.cache.values()) {
      await syncNicknamesForGuild(guild).catch((err) => console.error("Failed to sync nicknames:", err));
      // Departures the bot slept through: guildMemberRemove only fires while
      // the gateway is up, so this diff against live membership is the ONLY
      // thing that catches a player who left during a restart. Deliberately
      // after the channel doctor above — its REST burst finishes before this
      // posts anything, and the two can't fight over a leaver in either
      // order (the doctor skips users absent from the member map). See
      // bot/src/lib/leaveReconcile.js for the mass-flag safety rail.
      {
        const { reconcileDepartures } = require("../lib/leaveReconcile");
        await reconcileDepartures(client, guild).catch((err) =>
          console.error("Leave reconcile failed:", err),
        );
      }
      await ensureTurnsConsole(guild).catch((err) => console.error("Failed to ensure turns console:", err));
      await ensureReportAnchor(guild).catch((err) => console.error("Failed to ensure report anchor:", err));
      // Warms client.channels.cache with every active thread, private ones
      // included. GUILD_CREATE only ships a thread the bot is already a
      // member of, so without this a fresh boot never learns about a private
      // thread it hasn't posted in since — and a reaction on it never fires
      // messageReactionAdd at all (Partials.Channel resolves an uncached id
      // to a typeless payload, which ChannelManager can't turn into a
      // channel). A thread created after this boot still needs the
      // per-reaction fallback in messageReactionAdd.js.
      await guild.channels.fetchActiveThreads().catch((err) => console.error("Failed to warm thread cache:", err));
    }

    // Global, not per-guild: a guild command can never appear in the bot's
    // DMs. The cost is propagation — a new or renamed command can take up to
    // an hour to show up. See bot/src/lib/commands.js.
    await registerCommands(client).catch((err) => console.error("Failed to register slash commands:", err));

    // Anything typed while we were not listening. Backgrounded on purpose —
    // it walks every active thread in the guild, and a slow sweep must never
    // hold up the bot answering an interaction.
    //
    // Resolved here rather than reusing the loop above: that `guild` is a
    // for-of binding whose scope ended, and Bascinet runs in one guild anyway.
    const homeGuild =
      client.guilds.cache.get(process.env.DISCORD_GUILD_ID) ?? client.guilds.cache.first() ?? null;
    if (homeGuild) {
      void catchUpMissedMessages(client, homeGuild, { reason: "startup" }).catch((err) =>
        console.error("Message catch-up failed:", err),
      );

      // And again whenever the gateway hands us a FRESH session.
      //
      // This listener is registered here, inside `ready`, for a reason worth
      // keeping: shardReady fires BEFORE ready on the first connect, so by the
      // time this line runs the opening one is already past. Every shardReady
      // we see from here is therefore a RE-identify — which is exactly the case
      // that loses messages.
      //
      // The distinction that matters: a RESUME replays the dispatches missed
      // while the socket was away, so messageCreate fires for all of them and
      // there is nothing to recover. An IDENTIFY is a new session and those
      // dispatches are gone for good. Only the second one emits shardReady.
      //
      // Deliberately just this pass, not the whole burst above: running the
      // channel doctor and a guild-wide nickname sync on every network blip
      // would be a new load problem rather than a fix. catchUpMissedMessages
      // holds its own single-flight guard, so a flapping connection cannot
      // stack sweeps.
      client.on(Events.ShardReady, (shardId) => {
        console.log(`Shard ${shardId} re-identified; checking for messages missed while it was away.`);
        void catchUpMissedMessages(client, homeGuild, { reason: "reconnect" }).catch((err) =>
          console.error("Message catch-up failed after reconnect:", err),
        );
      });
    }

    // The web app closes a turn and then fans out to Discord from a deferred
    // after() callback, which a redeploy can kill halfway. That happened on
    // 2026-09-08: the bomb detonated, twelve characters died in the database,
    // and the fireball and the Game Ended post were never posted at all. The
    // bot coming back up is the earliest signal available that somebody's
    // process just died, so finishing an unsaid turn is one of the catch-up
    // passes now — waiting for the 04:00 cron is no use to a game that ended
    // at 22:00. Idempotent and leased: it stands down if a live run holds the
    // turn, and does nothing at all when there is nothing outstanding.
    void resumeTurnSideEffects(prisma).catch((err) =>
      console.error("Resuming an unfinished turn's side effects failed:", err),
    );

    const runAdvanceTurn = () => {
      console.log("Turn-advance cron fired.");
      advanceTurn()
        .then((turn) =>
          // Null when a GM's Dev Panel advance won the race — the turn moved,
          // just not here. Not a failure, so don't log it as one.
          console.log(turn ? `Turn advanced to #${turn.number} (${turn.phase})` : "Turn already advanced elsewhere; skipped."),
        )
        .catch((err) => console.error("Failed to advance turn:", err));
    };
    // Midnight Chicago time, once a day — one turn per real day. The
    // staged-arbitration push rides the turn advance, and midnight is the hour
    // fewest players are mid-scene when the message wipe runs. There used to be a
    // second job at noon; a turn was half a day then. db/lib/turnClock.js
    // derives every deadline from this same boundary, so the two must agree.
    cron.schedule("0 0 * * *", runAdvanceTurn, { timezone: "America/Chicago" });

    // Every Room hears who has been whispering in the Conversations linked to
    // it, aliased, on a stateless 15-minute lookback
    // (bot/src/lib/whisperPoll.js). Runs on the bot rather than the web app
    // because it is a plain cron with no request behind it.
    // A rotten body nags the Location it is in, on a randomized 4-10 hour
    // timer rather than a cron — the unpredictability is the feature. Self-
    // rescheduling; see bot/src/lib/deathSmell.js.
    startDeathSmell(prisma);

    // The Thanati's rites fire two minutes after their last requirement lands
    // and expire twelve hours after their first chant (db/lib/riteSweep.js).
    // Every minute, so "two minutes" means two or three rather than up to
    // seventeen.
    // One sweep in flight at a time: a slow one (Summoning walks every
    // cultist through Discord) must not overlap the next tick.
    let riteSweepRunning = false;
    cron.schedule("* * * * *", () => {
      if (riteSweepRunning) return;
      riteSweepRunning = true;
      runRiteSweep(prisma)
        .then(({ expired, fired }) => {
          if (expired || fired) console.log(`Rite sweep: ${fired} fired, ${expired} expired.`);
        })
        .catch((err) => console.error("Rite sweep failed:", err))
        .finally(() => {
          riteSweepRunning = false;
        });
    });

    cron.schedule("*/15 * * * *", () => {
      runWhisperPoll(prisma)
        .then((posted) => {
          if (posted > 0) console.log(`Whisper poll: ${posted} room(s) told.`);
        })
        .catch((err) => console.error("Whisper poll failed:", err));
      // The creation window's reminders and expiries (db/lib/lobbySweep.js).
      runLobbySweep(prisma)
        .then(({ resent, reminded, expired }) => {
          if (resent || reminded || expired) console.log(`Lobby sweep: ${resent} resent, ${reminded} reminded, ${expired} expired.`);
        })
        .catch((err) => console.error("Lobby sweep failed:", err));
    });
  },
};
