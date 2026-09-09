// Shared Prisma client for the bot, the web app, and every script. Strips
// stray .env quotes from DATABASE_URL before @prisma/client is required,
// since the generated client snapshots its datasource env at load time.
function normalizedDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  const unquoted = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  if (unquoted !== raw) process.env.DATABASE_URL = unquoted;
  return unquoted;
}

const databaseUrl = normalizedDatabaseUrl();

const { PrismaClient, Prisma } = require("@prisma/client");
const { buildTurnAnnouncement } = require("./turnCalendar");
const { nextTurnBanner } = require("./lib/turnBanner");
const { postTurnsAnnouncement } = require("./lib/turnAnnouncement");
const { expiryFrom } = require("./lib/turnFormat");
const { runCorpseRotPass } = require("./lib/corpseRotPass");
const { reconcileCorpses } = require("./lib/corpseFollow");
const { runTravelArrivalPass } = require("./lib/travelArrivalPass");
const { runTagExpiryPass } = require("./lib/tagExpiryPass");
// By path, not the barrel — same reason as db/lib/dm.js below.
const { runMessageWipe } = require("./lib/messageWipe");
const {
  runHungerPass,
  hungerDm,
  DYING_DM,
} = require("./lib/hungerPass");
const { runCarryPass } = require("./lib/carryPass");
const { runFearPass } = require("./lib/fearPass");
const { runDawnAfflictionPass } = require("./lib/dawnAfflictionPass");
const { runDepotPass } = require("./lib/depotPass");
const { runGatehouseTurretPass } = require("./lib/gatehouseTurret");
const { getGameState, readGameState } = require("./lib/gameState");
const { GHOST_ROLE_ID } = require("./lib/roleIds");
const { announceTurretBurst } = require("./lib/turretBurst");
const { ambientLine } = require("./lib/ambientLine");
const { deliverCarryDrop } = require("./lib/carry");
const { runCatatonicPass } = require("./lib/catatonicPass");
const { runCatatonicDeathPass } = require("./lib/catatonicDeathPass");
const { runVisionDecayPass } = require("./lib/visionDecayPass");
const { runDyingDeathPass } = require("./lib/dyingDeathPass");
const { runNukeExplosionPass } = require("./lib/nukeExplosionPass");
const { runAscensionPass } = require("./lib/ascensionPass");
const { endGameInDb, postGameEnded } = require("./lib/gameEnd");
const { syncSpectatorAccess } = require("./lib/spectatorAccess");
const { broadcastToZones } = require("./lib/worldBroadcast");
const { runBirdPass } = require("./lib/birdPass");
const { runHorseUpkeepPass } = require("./lib/horseUpkeepPass");
// By path, not the barrel — see the note at the top of db/lib/accessSweep.js.
const { revokeAllCharacterAccess } = require("./lib/accessSweep");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("./lib/constants");
const { runAutoLaborPass } = require("./lib/autoLaborPass");
const { runLaborYieldPass } = require("./lib/laborYield");
const { runStagedPushPass } = require("./lib/stagedPush");
const { runLessonPass } = require("./lib/lessonPass");
const { runResearchPass } = require("./lib/researchPass");
const { runConfessionPass } = require("./lib/confessionPass");
// Required by path, not through the barrel: see db/lib/dm.js for why there
// are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { recordArchiveMessage, recordArchiveEvent } = require("./lib/archive");
const { sceneLineAt } = require("./lib/scene");
const { loadForcedName } = require("./lib/presentedIdentity");
const {
  postAsCharacter,
  postMessage,
  postMessageBatched,
  attachBreakerStore,
  patchGuildRole,
  deleteGuildRole,
  addMemberRole,
  getGuildMember,
  setGuildNickname,
} = require("./lib/discordRest");
const { bumpBlood, LIFEWEB_SPUTTER_THRESHOLD } = require("./lib/lifeweb");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncZonesFromYaml, refreshLiveRooms } = require("./lib/syncZones");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { deleteCharacterRow } = require("./lib/deleteCharacter");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { DM_KIND } = require("./lib/dmKinds");
const { syncDesiresFromYaml } = require("./lib/syncDesires");
const { syncDocumentsFromYaml } = require("./lib/syncDocuments");
const {
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
} = require("./lib/specialChannels");
const { syncSpecialChannels } = require("./lib/syncSpecialChannels");

const globalForPrisma = globalThis;

// Cached unconditionally (not gated on NODE_ENV): Turbopack bundles this
// module into two separate chunks/registries in the web build, and gating
// the cache meant two PrismaClients per container. transactionOptions raises
// Prisma's defaults (2s/5s) because the per-character transactions in
// db/lib/autoLaborPass.js compete for pool slots at turn rollover.
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    transactionOptions: { maxWait: 5000, timeout: 15000 },
    // Character.avatarData is a 10-25 KB blob served out-of-band by the
    // avatar route; omitting it globally stops it riding along on every
    // `include`. An explicit `select: { avatarData: true }` still overrides.
    omit: { character: { avatarData: true } },
  });

globalForPrisma.prisma = prisma;

// The fear dial DMs a player when their band changes, from hooks deep inside
// tag writes that have no DM plumbing of their own. Hand it the logged REST
// sender once, here, where both faces load the client (db/lib/fear.js).
require("./lib/fear").setFearDmSender((discordUserId, content) => sendDm(prisma, discordUserId, content));

// Hands the Discord circuit breaker somewhere durable to keep its counters.
// discordRest.js has no prisma dependency (this file requires IT), so the
// two functions are passed in rather than required back.
attachBreakerStore({
  read: () =>
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: {
        restInvalidCount: true,
        restInvalidWindowStart: true,
        restBreakerOpenUntil: true,
      },
    }),
  // updateMany, not update: on a brand-new database GameConfig may not exist
  // yet, and a rate-limit count shouldn't create it as a side effect.
  write: (data) => prisma.gameConfig.updateMany({ where: { id: 1 }, data }),
});

// The stackable half of resolveNeeds()' expiry sweep: each expired stack
// loses one unit and the remainder's clock restarts from the tag's catalog
// duration, so a stack sheds one unit at a time rather than all at once.
// `model` is "characterTag" or "roomTag": a stack lying in a Room sheds
// exactly the way one in a pocket does (docs/systemdocs/CARRY.md).
async function sweepExpiredStacks(turn, model = "characterTag") {
  const expired = await prisma[model].findMany({
    where: { expiresTurn: { lte: turn.number }, tag: { stackable: true } },
    select: {
      id: true,
      quantity: true,
      tag: { select: { defaultDurationTurns: true } },
    },
  });
  if (expired.length === 0) return;

  const spent = [];
  // new expiresTurn -> ids landing on it
  const rescheduled = new Map();
  for (const ct of expired) {
    if (ct.quantity <= 1) {
      spent.push(ct.id);
      continue;
    }
    const next = expiryFrom(turn.number + 1, ct.tag.defaultDurationTurns ?? 1);
    if (!rescheduled.has(next)) rescheduled.set(next, []);
    rescheduled.get(next).push(ct.id);
  }

  await prisma.$transaction([
    ...(spent.length
      ? [prisma[model].deleteMany({ where: { id: { in: spent } } })]
      : []),
    // decrement, not a computed literal, so a concurrent grant on the same
    // row can't be clobbered between the read above and this write.
    ...[...rescheduled].map(([expiresTurn, ids]) =>
      prisma[model].updateMany({
        where: { id: { in: ids } },
        data: { quantity: { decrement: 1 }, expiresTurn },
      }),
    ),
  ]);
}

// Applies per-turn Needs decay to the turn being closed, shared by the bot's
// cron advance and the GM dashboard's manual close-turn. Returns Discord work
// (posts/DMs) for the caller's runSideEffects() rather than sending it here.
const TURN_PASSES = [
  "autoLabor",
  "lessons",
  // Research (db/lib/researchPass.js): same slot as Lessons, and right after
  // it for the same reason lessons follows autoLabor — after only because it
  // shares the slot, not because either depends on the other's result.
  "research",
  "confessions",
  "stagedPush",
  "tagExpiry",
  // Counts Damaged Vision stacks and turns 5 of them into Blind. After
  // tagExpiry so a stack that grew this turn is counted, before the sweep so
  // the rows it deletes are its own. See db/lib/visionDecayPass.js.
  "visionDecay",
  "dyingDeath",
  // ASCENSION BEFORE THE BOMB, deliberately. Both can come due on one close,
  // and the rite is called off by its leader dying — so with the bomb first
  // the blast killed that leader and the cult silently lost a game it had won.
  // Ascension still sits after the staged push and dyingDeath, so a leader
  // killed by another character this turn does stop it; only the blast, which
  // is simultaneous rather than earlier, no longer does.
  "ascension",
  "nukeExplosion",
  // Corpses turn before the sweep, and the order is load-bearing: the sweep
  // is a blind deleteMany over expiresTurn, so a body that reached its clock
  // would be deleted instead of rotting. See db/lib/corpseRotPass.js.
  "corpseRot",
  "expirySweep",
  // After the sweep, and it has nothing to do with it: a notice is on a board
  // rather than on a sheet, so nothing above can see one.
  "noticeboard",
  "catatonic",
  "catatonicDeath",
  "bird",
  // The horse's feed. Immediately BEFORE hunger, and the order is
  // load-bearing: auto-labor has already paid the day's income, and the animal
  // eats before the rider does — a character down to their last ⬢ feeds the
  // horse and goes Hungry. See db/lib/horseUpkeepPass.js.
  "horseUpkeep",
  "hunger",
  // Guilt Ridden and Insomniac's nightly chance of waking Exhausted. After
  // hunger so it sees the final sheet. See db/lib/dawnAfflictionPass.js.
  "dawnAfflictions",
  "carry",
  // The fear dial's nightly settle: the place each character sleeps in, the
  // decay, hunger, a body in the room, a noble's missed dinner. After hunger
  // (it reads the final streak) and carry (the final sheet), and before
  // travelArrival, so a traveller pays the night where they set out from.
  // See db/lib/fearPass.js and docs/systemdocs/FEAR.md.
  "fear",
  // After "carry", because the overflow drop can put a corpse on a floor.
  // Pull-based, so it just re-reads where every body's tag ended up.
  "corpseFollow",
  // The map's own weather. Late on purpose: it must land AFTER "autoLabor" so
  // a day is paid at the coefficients that were live during it, and what this
  // writes is what the next turn's labor is worth.
  "laborYield",
  "lifewebDecay",
  // The Depot's hardware: the generator burns a turn of fuel, the shuttle's
  // six-turn clock runs out, and the turret sweeps whoever is standing in the
  // room. Last, so the turret fires on the sheet everything else left behind —
  // in particular the armour the carry pass may have made someone drop.
  "depot",
  // The Gatehouse gun, for the same reason and in the same breath. Separate
  // from "depot" so a failed Depot pass cannot swallow it, and so a resume
  // re-runs exactly the one that did not finish.
  "gatehouseTurret",
  // Journeys landing (db/lib/travelArrivalPass.js). LAST, and the order is
  // load-bearing: every pass above settles the turn that just ended, and a
  // traveller spent that turn walking. Auto-labor pays them where they left
  // from, and neither turret shoots somebody still on the road.
  "travelArrival",
];

// How long a resume lease is honoured before another advance may take it
// over — long enough not to steal a live resume, short enough that a killed
// process doesn't wedge the turn.
const RESUME_LEASE_MS = 30 * 60 * 1000;

async function resolveNeeds(turn, config) {
  // Passes already applied — non-empty only when a previous advance died
  // part-way through. See Turn.resolvedPasses in the schema.
  const done = new Set(
    Array.isArray(turn.resolvedPasses) ? turn.resolvedPasses : [],
  );

  async function markDone(name) {
    done.add(name);
    await prisma.turn
      .update({ where: { id: turn.id }, data: { resolvedPasses: [...done] } })
      .catch((err) =>
        console.error(`Failed to record completed pass "${name}":`, err),
      );
  }

  // A failed pass leaves the turn advancing anyway, logged and left
  // unrecorded so the next advance retries it.
  async function passFailed(name, err) {
    console.error(`${name} pass failed:`, err);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "turn_pass_failed",
          details: {
            turnNumber: turn.number,
            pass: name,
            error: String(err?.message ?? err),
          },
        },
      })
      .catch((logErr) =>
        console.error(
          "Failed to log turn_pass_failed — this failure now has no record:",
          logErr,
        ),
      );
  }

  // Auto-labor first: income has to land before Hunger's upkeep charge, and it
  // must run while the turn is still the one being closed. It also has to run
  // BEFORE the yield drift pass below, so a day's payouts use the coefficients
  // that were live during that day.
  let autoLabor = null;
  if (!done.has("autoLabor")) {
    autoLabor = await runAutoLaborPass(prisma, turn).catch(async (err) => {
      await passFailed("Auto-labor", err);
      return null;
    });
    if (autoLabor) await markDone("autoLabor");
  }
  const { dms: autoLaborDms = [], ...autoLaborSummary } = autoLabor ?? {};
  if (autoLabor?.filed) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "auto_labor_resolved",
          details: autoLaborSummary,
        },
      })
      .catch((err) => console.error("Auto-labor audit log failed:", err));
  }

  // Lessons (db/lib/lessonPass.js): the learner's Gambit is SOLVED here,
  // before the push closes it, and PENDING offers expire. After autoLabor
  // only so a learner who never accepted still worked their day.
  let lessons = null;
  if (!done.has("lessons")) {
    lessons = await runLessonPass(prisma, turn).catch(async (err) => {
      await passFailed("Lessons", err);
      return null;
    });
    if (lessons) await markDone("lessons");
  }
  const { dms: lessonDms = [], ...lessonSummary } = lessons ?? {};
  if (lessons && (lessons.resolved || lessons.expired || lessons.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "lessons_resolved",
          details: lessonSummary,
        },
      })
      .catch((err) => console.error("Lessons audit log failed:", err));
  }

  // Research (db/lib/researchPass.js): a filed research Gambit is SOLVED
  // here, same slot as Lessons and right after it. The D5 ledger row
  // (research_revealed) is written inside the pass itself, per character,
  // not here — this summary row is only the turn-wide tally.
  let research = null;
  if (!done.has("research")) {
    research = await runResearchPass(prisma, turn).catch(async (err) => {
      await passFailed("Research", err);
      return null;
    });
    if (research) await markDone("research");
  }
  const { dms: researchDms = [], ...researchSummary } = research ?? {};
  if (research && (research.resolved || research.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "research_resolved",
          details: researchSummary,
        },
      })
      .catch((err) => console.error("Research audit log failed:", err));
  }

  // Confessions (db/lib/confessionPass.js): same slot and the same reason as
  // lessons, and AFTER them, because the lesson pass is what expires every
  // PENDING offer on the turn — confessions included.
  let confessions = null;
  if (!done.has("confessions")) {
    confessions = await runConfessionPass(prisma, turn).catch(async (err) => {
      await passFailed("Confessions", err);
      return null;
    });
    if (confessions) await markDone("confessions");
  }
  const { dms: confessionDms = [], ...confessionSummary } = confessions ?? {};
  if (confessions && (confessions.resolved || confessions.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "confessions_resolved",
          details: confessionSummary,
        },
      })
      .catch((err) => console.error("Confessions audit log failed:", err));
  }

  // The staged-arbitration push (db/lib/stagedPush.js). Slot is
  // load-bearing: after autoLabor (which stamps appliedEffects), before
  // tagExpiry/expirySweep (a staged grant/cure must land first), and before
  // hunger (deferred Routine/Labor income must land before upkeep).
  let stagedPush = null;
  if (!done.has("stagedPush")) {
    stagedPush = await runStagedPushPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Staged push", err);
        return null;
      },
    );
    if (stagedPush) await markDone("stagedPush");
  }
  const {
    privateDeliveries = [],
    publicPosts = [],
    zoneMoves = [],
    routineNotices = [],
    gambitRollNotices = [],
    ...stagedPushSummary
  } = stagedPush ?? {};
  if (stagedPush) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "staged_push_resolved",
          details: {
            turnNumber: turn.number,
            ...stagedPushSummary,
            privateMessages: privateDeliveries.length,
            publicPosts: publicPosts.length,
            routineNotices: routineNotices.length,
            gambitRollNotices: gambitRollNotices.length,
          },
        },
      })
      .catch((err) => console.error("Staged push audit log failed:", err));
  }

  // Sweeps turn-scoped tag expiry. Progression runs first (grants what an
  // expiring tag turns into), then the sweep deletes exactly what it read.
  // See db/lib/tagExpiryPass.js.
  let progressed = null;
  if (!done.has("tagExpiry")) {
    progressed = await runTagExpiryPass(prisma, turn).catch(async (err) => {
      await passFailed("Tag expiry", err);
      return null;
    });
    if (progressed) await markDone("tagExpiry");
  }
  const { dms: tagExpiryDmsFromProgression = [], ...tagExpirySummary } =
    progressed ?? {};
  const tagExpiryDms = [...tagExpiryDmsFromProgression];
  if (progressed) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "tag_expiry_resolved",
          details: tagExpirySummary,
        },
      })
      .catch((err) => console.error("Tag expiry audit log failed:", err));
  }

  // Moonshine's slow bill. Rides the tagExpiry DM channel rather than
  // threading a variable of its own through runSideEffects — it is the same
  // kind of notice, "a tag on your sheet became a different tag".
  let visionDecay = null;
  if (!done.has("visionDecay")) {
    visionDecay = await runVisionDecayPass(prisma, turn).catch(async (err) => {
      await passFailed("Vision decay", err);
      return null;
    });
    if (visionDecay) await markDone("visionDecay");
  }
  if (visionDecay) {
    tagExpiryDms.push(...(visionDecay.dms ?? []));
    if (visionDecay.blinded > 0) {
      const { dms: _visionDms, ...visionSummary } = visionDecay;
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "vision_decay_resolved",
            details: visionSummary,
          },
        })
        .catch((err) => console.error("Vision decay audit log failed:", err));
    }
  }

  // Dying death — the engine's second auto-kill, run down from the Dying
  // tag's one-turn clock. After stagedPush/tagExpiry, before the sweep.
  // See db/lib/dyingDeathPass.js.
  let dyingDeath = null;
  if (!done.has("dyingDeath")) {
    dyingDeath = await runDyingDeathPass(prisma, turn).catch(async (err) => {
      await passFailed("Dying death", err);
      return null;
    });
    if (dyingDeath) await markDone("dyingDeath");
  }
  const {
    deaths: dyingDeaths = [],
    warnings: dyingDeathWarnings = [],
    ...dyingDeathSummary
  } = dyingDeath ?? {};
  if (dyingDeath) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "dying_deaths_resolved",
          details: dyingDeathSummary,
        },
      })
      .catch((err) => console.error("Dying death audit log failed:", err));
  }

  // The Rite of Ascension. After the staged push and dyingDeath, so a leader
  // killed by another character this turn calls it off — and BEFORE the bomb,
  // which is the tiebreak when both doomsdays come due on one close. With the
  // bomb first, its blast killed the cult's leader and the rite cancelled
  // itself, so the cult always lost a race it had already won.
  // See db/lib/ascensionPass.js.
  let ascension = null;
  if (!done.has("ascension")) {
    ascension = await runAscensionPass(prisma, turn).catch(async (err) => {
      await passFailed("Ascension", err);
      return null;
    });
    if (ascension) await markDone("ascension");
  }
  const { broadcast: ascensionBroadcast = null, ...ascensionSummary } = ascension ?? {};
  // Declared here, with the first of the two endings, and shared with the
  // bomb below: whichever fires first writes the epilogue, and endGameInDb is
  // a no-op on a state that is already ENDED.
  let gameEndedPost = null;
  if (ascension?.fired || ascension?.cancelled) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: ascension.fired ? "ascension_fired" : "ascension_cancelled",
          details: ascensionSummary,
        },
      })
      .catch((err) => console.error("Ascension audit log failed:", err));
  }
  // The second way a game ends. Unlike the bomb it kills nobody — there is
  // simply nothing left to play in, so the clock stops and the archive opens.
  // Running before the bomb means that when both land together the epilogue
  // is the cult's; the blast still kills everyone above ground either way.
  if (ascension?.fired) {
    try {
      const ended = await endGameInDb(prisma, {
        closingNote: `The cult finished its work at the close of turn ${turn.number}. Ravenheart burned. ‡`,
        reason: "ascension",
      });
      if (ended.ended) gameEndedPost = ended.post;
    } catch (err) {
      console.error("Ending the game after the ascension failed:", err);
    }
  }

  // The bomb. Sits here for the reason dyingDeath sits here: after the staged
  // push and tagExpiry, so a Disarm filed this turn (or a GM defusing it from
  // /gm/dev) beats the clock, and before the sweep, with its siblings.
  // See db/lib/nukeExplosionPass.js.
  let nukeExplosion = null;
  if (!done.has("nukeExplosion")) {
    nukeExplosion = await runNukeExplosionPass(prisma, turn).catch(async (err) => {
      await passFailed("Nuke explosion", err);
      return null;
    });
    if (nukeExplosion) await markDone("nukeExplosion");
  }
  const {
    deaths: nukeDeaths = [],
    broadcast: nukeBroadcast = null,
    ...nukeSummary
  } = nukeExplosion ?? {};
  // The bomb ends the game (docs/systemdocs/LOBBY.md §7): the clock stops
  // after this advance, the archive opens, and the reveal follows the
  // fireball into #turns. The new turn still opens below so the banner has
  // somewhere to hang. Ended locks only the clock — the survivors in the
  // caves keep playing until the wipe.
  if (nukeExplosion?.detonated) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "nuke_detonated",
          details: nukeSummary,
        },
      })
      .catch((err) => console.error("Nuke audit log failed:", err));
    try {
      const ended = await endGameInDb(prisma, {
        closingNote: `The device went off at the close of turn ${turn.number}. Everyone above ground died. ‡`,
        reason: "nuke",
      });
      if (ended.ended) gameEndedPost = ended.post;
    } catch (err) {
      console.error("Ending the game after the detonation failed:", err);
    }
  }

  // The Bird's stranded letters (db/lib/birdPass.js), after both auto-kills
  // so a sender who died this turn is already dead when the notice composes.
  let birdResult = null;
  if (!done.has("bird")) {
    birdResult = await runBirdPass(prisma, turn).catch(async (err) => {
      await passFailed("Bird", err);
      return null;
    });
    if (birdResult) await markDone("bird");
  }
  const { notices: birdNotices = [], ...birdSummary } = birdResult ?? {};
  if (birdResult && birdSummary.undelivered > 0) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "bird_messages_undelivered",
          details: birdSummary,
        },
      })
      .catch((err) => console.error("Bird audit log failed:", err));
  }

  // Bodies turn. Must precede the sweep below — see db/lib/corpseRotPass.js.
  if (!done.has("corpseRot")) {
    const rot = await runCorpseRotPass(prisma, turn).catch(async (err) => {
      await passFailed("Corpse rot", err);
      return null;
    });
    if (rot) {
      await markDone("corpseRot");
      if (rot.rotted > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "corpses_rotted",
              details: rot,
            },
          })
          .catch((err) => console.error("Corpse rot audit log failed:", err));
      }
    }
  }

  if (!done.has("expirySweep")) {
    try {
      await prisma.characterTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn);
      // A stashed tag sheds on the same clock. The one progression that
      // reaches a floor is the corpse rot above, which has already nulled
      // expiresTurn on anything it turned, so this cannot see it.
      await prisma.roomTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn, "roomTag");

      // A worn-off disguise takes its catalog row with it. The row is minted
      // per disguise (db/lib/disguiseMint.js) and nothing else will ever hold
      // it, so leaving it behind is an orphan waiting for the next Restart
      // Game — the accumulation Tag.ephemeral exists to stop, exactly as the
      // noticeboard block below says. It also matters functionally: Tag.name
      // is @unique, so an orphan "Disguised (John)" would burn that alias for
      // the rest of the game.
      //
      // `ephemeral` AND the slug prefix, so this can never reach a catalog
      // tag, and `characters: { none: {} }` so a row still on somebody's sheet
      // is left alone — the deleteMany above only cleared the ones that
      // actually expired. Also guards against deleting a live disguise if this
      // pass is ever re-run out of order.
      await prisma.tag.deleteMany({
        where: {
          ephemeral: true,
          slug: { startsWith: "custom-disguise-" },
          characters: { none: {} },
          roomTags: { none: {} },
        },
      });
      await markDone("expirySweep");
    } catch (err) {
      await passFailed("Expiry sweep", err);
    }
  }

  // Noticeboards. A paper nobody took down blows away, and it takes the paper
  // with it — that is what expiring MEANS here, and it is why a notice is
  // worth tearing down rather than leaving. See docs/systemdocs/PAPERWORK.md.
  //
  // The Tag row goes too. Nothing else can reference it (NoticePost.tagId is
  // @unique, and the paper left its holder's sheet when it went up), so
  // leaving it would be an orphan waiting for the next Restart Game — which
  // is exactly the accumulation Tag.ephemeral was added to stop.
  if (!done.has("noticeboard")) {
    try {
      const blown = await prisma.noticePost.findMany({
        where: { expiresTurn: { lte: turn.number } },
        select: { id: true, tagId: true },
      });
      if (blown.length > 0) {
        const ids = blown.map((p) => p.id);
        const tagIds = blown.map((p) => p.tagId);
        await prisma.noticePost.deleteMany({ where: { id: { in: ids } } });
        // Only the runtime paper rows, never a catalog tag that somehow found
        // its way onto a board — `ephemeral` is the whole guard.
        await prisma.tag.deleteMany({
          where: { id: { in: tagIds }, ephemeral: true },
        });
      }
      await markDone("noticeboard");
    } catch (err) {
      await passFailed("Noticeboards", err);
    }
  }

  // Catatonic (AFK), checked against GameConfig.catatonicTurns. See
  // db/lib/catatonicPass.js.
  let catatonic = null;
  if (!done.has("catatonic")) {
    catatonic = await runCatatonicPass(prisma, turn).catch(async (err) => {
      await passFailed("Catatonic", err);
      return null;
    });
    if (catatonic) await markDone("catatonic");
  }
  const {
    dms: catatonicDms = [],
    roleUpdates: catatonicRoleUpdates = [],
    ...catatonicSummary
  } = catatonic ?? {};
  if (catatonic) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "catatonic_resolved",
          details: catatonicSummary,
        },
      })
      .catch((err) => console.error("Catatonic audit log failed:", err));
  }

  // Catatonic death — the engine's one auto-kill from inactivity. Its own
  // pass (not a branch of the one above) so a resume can't half-kill.
  // See db/lib/catatonicDeathPass.js.
  let catatonicDeath = null;
  if (!done.has("catatonicDeath")) {
    catatonicDeath = await runCatatonicDeathPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Catatonic death", err);
        return null;
      },
    );
    if (catatonicDeath) await markDone("catatonicDeath");
  }
  const {
    deaths: catatonicDeaths = [],
    warnings: catatonicDeathWarnings = [],
    ...catatonicDeathSummary
  } = catatonicDeath ?? {};
  if (catatonicDeath) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "catatonic_deaths_resolved",
          details: catatonicDeathSummary,
        },
      })
      .catch((err) => console.error("Catatonic death audit log failed:", err));
  }

  // The horse eats first (db/lib/horseUpkeepPass.js). Held, not equipped, and
  // a character who cannot afford the 1 ⬢ pays nothing and keeps the animal.
  let horseUpkeep = null;
  if (!done.has("horseUpkeep")) {
    horseUpkeep = await runHorseUpkeepPass(prisma, turn).catch(async (err) => {
      await passFailed("Horse upkeep", err);
      return null;
    });
    if (horseUpkeep) await markDone("horseUpkeep");
  }
  if (horseUpkeep) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "horse_upkeep",
          details: horseUpkeep,
        },
      })
      .catch((err) => console.error("Horse upkeep audit log failed:", err));
  }

  // Hunger upkeep runs after the sweep, so a Hunger granted last close is
  // cleared before this pass can grant a fresh one — otherwise the re-grant
  // collides with @@unique([characterId, tagId]) and gets dropped. See
  // db/lib/hungerPass.js.
  let hunger = null;
  if (!done.has("hunger")) {
    hunger = await runHungerPass(prisma, turn).catch(async (err) => {
      await passFailed("Hunger", err);
      return null;
    });
    if (hunger) await markDone("hunger");
  }

  const {
    hungerNotices = [],
    fearDms: hungerFearDms = [],
    ...summary
  } = hunger ?? {};
  if (hunger) {
    // Starving into Dying moved the fear dial; the band DM is a tag notice.
    tagExpiryDms.push(...hungerFearDms);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "hunger_resolved",
          details: summary,
        },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // Dawn afflictions: Guilt Ridden and Insomniac each carry a nightly chance
  // of waking Exhausted. After hunger so it sees the final sheet, same as
  // carry below. See db/lib/dawnAfflictionPass.js.
  let dawnAfflictions = null;
  if (!done.has("dawnAfflictions")) {
    dawnAfflictions = await runDawnAfflictionPass(prisma, turn).catch(async (err) => {
      await passFailed("Dawn afflictions", err);
      return null;
    });
    if (dawnAfflictions) await markDone("dawnAfflictions");
  }
  const { notices: dawnAfflictionNotices = [], ...dawnAfflictionSummary } = dawnAfflictions ?? {};
  if (dawnAfflictions) {
    // Rides the tagExpiry DM channel rather than threading a variable of its
    // own through runSideEffects/advanceTurn — it is the same kind of notice
    // ("a tag on your sheet changed"), same as visionDecay above.
    tagExpiryDms.push(...dawnAfflictionNotices);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "dawn_afflictions_resolved",
          details: dawnAfflictionSummary,
        },
      })
      .catch((err) => console.error("Dawn afflictions audit log failed:", err));
  }

  // Carry caps: Overburdened on and off, and overflow drops for anyone whose
  // Cart or Pack Mule left during the turn. After hunger so it sees the
  // final sheet. See db/lib/carryPass.js, CARRY.md.
  let carry = null;
  if (!done.has("carry")) {
    carry = await runCarryPass(prisma, turn).catch(async (err) => {
      await passFailed("Carry", err);
      return null;
    });
    if (carry) await markDone("carry");
  }
  const { drops: carryDrops = [], ...carrySummary } = carry ?? {};
  if (carry) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "carry_resolved",
          details: carrySummary,
        },
      })
      .catch((err) => console.error("Carry audit log failed:", err));
  }

  // The fear dial's nightly settle (docs/systemdocs/FEAR.md): every ALIVE
  // character pays or earns the night for where they stand, decays a little,
  // and has the band tag on their sheet re-projected. See db/lib/fearPass.js.
  let fear = null;
  if (!done.has("fear")) {
    fear = await runFearPass(prisma, turn).catch(async (err) => {
      await passFailed("Fear", err);
      return null;
    });
    if (fear) await markDone("fear");
  }
  if (fear) {
    // "You are now Stressed." is a tag notice like any other; same channel.
    const { dms: fearDms = [], ...fearSummary } = fear;
    tagExpiryDms.push(...fearDms);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "fear_resolved",
          details: fearSummary,
        },
      })
      .catch((err) => console.error("Fear audit log failed:", err));
  }

  // Every dead sheet catches up with wherever its corpse ended up. Last of
  // the inventory-shaped passes, so it sees the carry drop above.
  if (!done.has("corpseFollow")) {
    const followed = await reconcileCorpses(prisma).catch(async (err) => {
      await passFailed("Corpse follow", err);
      return null;
    });
    if (followed) {
      await markDone("corpseFollow");
      if (followed.length > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "corpses_followed",
              details: { moved: followed.length },
            },
          })
          .catch((err) =>
            console.error("Corpse follow audit log failed:", err),
          );
      }
    }
  }

  // Drift every Location's yield coefficients one turn forward
  // (db/lib/laborYield.js). Random and therefore NOT idempotent, which is
  // exactly why it is a named pass: markDone stops a resumed advance from
  // drifting the whole map twice.
  if (!done.has("laborYield")) {
    const yields = await runLaborYieldPass(prisma, turn).catch(async (err) => {
      await passFailed("Labor yield drift", err);
      return null;
    });
    if (yields) {
      await markDone("laborYield");
      if (yields.drifted) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "labor_yields_drifted",
              details: yields,
            },
          })
          .catch((err) => console.error("Labor yield audit log failed:", err));
      }
    }
  }

  // bumpBlood rather than a computed literal off `config`: that snapshot
  // predates the passes above, so a donation made during the advance would
  // otherwise be discarded by the write-back.
  let lifewebBlood = (await readGameState(prisma, { lifewebBlood: true }))?.lifewebBlood ?? 100;
  if (!done.has("lifewebDecay")) {
    try {
      const moved = await bumpBlood(
        prisma,
        -(config?.lifewebDecayPerTurn ?? 10),
      );
      lifewebBlood = moved.after;
      await markDone("lifewebDecay");
    } catch (err) {
      await passFailed("Lifeweb decay", err);
    }
  } else {
    const fresh = await readGameState(prisma, { lifewebBlood: true });
    lifewebBlood = fresh?.lifewebBlood ?? lifewebBlood;
  }

  // The Depot's hardware. Returns the ambient lines and DMs it owes rather
  // than speaking them — see TURN-ENGINE.md §3.
  let depot = null;
  if (!done.has("depot")) {
    depot = await runDepotPass(prisma, turn).catch(async (err) => {
      await passFailed("Depot", err);
      return null;
    });
    if (depot) await markDone("depot");
  }
  let gatehouse = null;
  if (!done.has("gatehouseTurret")) {
    gatehouse = await runGatehouseTurretPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Gatehouse turret", err);
        return null;
      },
    );
    if (gatehouse) await markDone("gatehouseTurret");
  }
  if (gatehouse?.turretShots) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "gatehouse_turret_fired",
          details: {
            turretShots: gatehouse.turretShots,
            turretOutcomes: gatehouse.turretOutcomes,
          },
        },
      })
      .catch((err) => console.error("Gatehouse turret audit log failed:", err));
  }

  if (
    depot &&
    (depot.turretShots || depot.generatorDied || depot.shuttleDeparted)
  ) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "depot_resolved",
          details: {
            fuelBurned: depot.fuelBurned,
            generatorDied: depot.generatorDied,
            shuttleDeparted: depot.shuttleDeparted,
            turretShots: depot.turretShots,
            turretOutcomes: depot.turretOutcomes,
          },
        },
      })
      .catch((err) => console.error("Depot audit log failed:", err));
  }

  // Everyone who set out last turn arrives. Discord work is deliberately not
  // done here — the rows go out with zoneMoves and runSideEffects swaps the
  // roles and rolls the Caving Die, which needs the NEXT turn open anyway.
  let travelArrivals = [];
  if (!done.has("travelArrival")) {
    const arrived = await runTravelArrivalPass(prisma, config).catch(
      async (err) => {
        await passFailed("Travel arrival", err);
        return null;
      },
    );
    if (arrived) {
      await markDone("travelArrival");
      travelArrivals = arrived;
      if (arrived.length > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "travellers_arrived",
              details: {
                arrived: arrived.map((a) => ({ name: a.name, to: a.toLocationName })),
              },
            },
          })
          .catch((err) => console.error("Travel arrival audit log failed:", err));
      }
    }
  }

  // needsResolvedAt is the sole selector for advanceTurn()'s resume query,
  // so it's only stamped once every pass in TURN_PASSES has run.
  const outstanding = TURN_PASSES.filter((name) => !done.has(name));
  if (outstanding.length === 0) {
    await prisma.turn
      .update({ where: { id: turn.id }, data: { needsResolvedAt: new Date() } })
      .catch((err) => console.error("Failed to stamp needsResolvedAt:", err));
  } else {
    console.error(
      `Turn #${turn.number} finished with ${outstanding.length} pass(es) unapplied: ` +
        `${outstanding.join(", ")}. Leaving needsResolvedAt null so the next advance retries them.`,
    );
  }

  await prisma.turn
    .update({ where: { id: turn.id }, data: { needsResumeClaimedAt: null } })
    .catch((err) => console.error("Failed to release the resume lease:", err));

  return {
    lifewebBlood,
    hungerNotices,
    autoLaborDms,
    lessonDms,
    researchDms,
    confessionDms,
    tagExpiryDms,
    catatonicDms,
    catatonicRoleUpdates,
    catatonicDeaths,
    catatonicDeathWarnings,
    dyingDeaths,
    dyingDeathWarnings,
    nukeDeaths,
    nukeBroadcast,
    ascensionBroadcast,
    gameEndedPost,
    birdNotices,
    carryDrops,
    privateDeliveries,
    publicPosts,
    zoneMoves,
    travelArrivals,
    routineNotices,
    gambitRollNotices,
    depotLines: depot?.lines ?? [],
    // Both guns' DMs, delivered by one loop. It was `depotDms` when there was
    // only the one turret.
    turretDms: [...(depot?.dms ?? []), ...(gatehouse?.dms ?? [])],
    // Both guns' kills, for the same teardown every other death gets. Until
    // this was carried up, a turret-killed character kept their personal role,
    // every channel overwrite and their nickname, and never got the ghost seat.
    turretDeaths: [...(depot?.deaths ?? []), ...(gatehouse?.deaths ?? [])],
    depotLocationId: depot?.locationId ?? null,
    // Where each gun fired, if either did. Two entries rather than one, because
    // both can go off in the same turn and each is heard by its own zone.
    turretBursts: [depot?.burstLocationId, gatehouse?.burstLocationId].filter(Boolean),
  };
}

async function getConfig() {
  return prisma.gameConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

// Resolves the OPEN turn and opens the next, alternating DAWN/DUSK. Shared
// by the bot's cron advance and the GM "End Turn" action. Discord side
// effects are returned as a `runSideEffects()` thunk rather than run here —
// the message wipe can take minutes, so a caller awaits it only where safe
// (the bot's cron inline; the web action via next/server's after()).
//
// Returns { advanced, previousTurn, newTurn, note, runSideEffects }.
// `advanced` is false when another caller won the race to close the open
// turn; callers must check it before using `newTurn`. It is also false, with
// `refused: "NOT_RUNNING"`, outside the RUNNING phase: a game in the lobby or
// already ended has no clock (docs/systemdocs/LOBBY.md §1), and both callers
// — the bot's cron and the Dev Panel's End turn — land here, so this is the
// one gate rather than two.
async function advanceTurn() {
  const config = await getConfig();
  const state = await getGameState(prisma);
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  if (state.phase !== "RUNNING") {
    return {
      advanced: false,
      refused: "NOT_RUNNING",
      previousTurn: null,
      newTurn: openTurn,
      note: null,
      runSideEffects: async () => {},
    };
  }

  let lifewebBlood = state.lifewebBlood;
  let hungerNotices = [];
  let autoLaborDms = [];
  let lessonDms = [];
  let researchDms = [];
  let confessionDms = [];
  let tagExpiryDms = [];
  let depotLines = [];
  let turretDms = [];
  let turretDeaths = [];
  let depotLocationId = null;
  let turretBursts = [];
  let catatonicDms = [];
  let catatonicRoleUpdates = [];
  let catatonicDeaths = [];
  let catatonicDeathWarnings = [];
  let dyingDeaths = [];
  let nukeDeaths = [];
  let nukeBroadcast = null;
  let ascensionBroadcast = null;
  let gameEndedPost = null;
  let dyingDeathWarnings = [];
  let birdNotices = [];
  let carryDrops = [];
  let privateDeliveries = [];
  let publicPosts = [];
  let zoneMoves = [];
  let travelArrivals = [];
  let routineNotices = [];
  let gambitRollNotices = [];
  if (openTurn) {
    // Close the turn first, conditioned on it still being OPEN — Postgres
    // serializes the updateMany, so exactly one racing caller sees count===1
    // and the loser bails rather than double-resolving Needs.
    const closed = await prisma.turn.updateMany({
      where: { id: openTurn.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (closed.count === 0) {
      const winner = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      return {
        advanced: false,
        previousTurn: null,
        newTurn: winner,
        note: null,
        runSideEffects: async () => {},
      };
    }

    ({
      lifewebBlood,
      hungerNotices,
      autoLaborDms,
      lessonDms,
      researchDms,
      confessionDms,
      tagExpiryDms,
      catatonicDms,
      catatonicRoleUpdates,
      catatonicDeaths,
      catatonicDeathWarnings,
      dyingDeaths,
      dyingDeathWarnings,
      nukeDeaths,
      nukeBroadcast,
      ascensionBroadcast,
      gameEndedPost,
      birdNotices,
      carryDrops,
      privateDeliveries,
      publicPosts,
      zoneMoves,
      travelArrivals,
      routineNotices,
      gambitRollNotices,
      depotLines,
      turretDms,
      turretDeaths,
      depotLocationId,
      turretBursts,
    } = await resolveNeeds(openTurn, config));
  } else {
    // No OPEN turn: either this is the first turn ever, or a previous advance
    // claimed the turn and died before creating the next one. A RESOLVED
    // turn with no needsResolvedAt is that crash; finish only its remaining
    // passes.
    const unfinished = await prisma.turn.findFirst({
      where: { status: "RESOLVED", needsResolvedAt: null },
      orderBy: { number: "desc" },
    });
    if (unfinished) {
      // Same compare-and-swap as the normal path, on needsResumeClaimedAt
      // (resolvedPasses is last-write-wins, not a lock). Stale claims are
      // recoverable via RESUME_LEASE_MS.
      const staleBefore = new Date(Date.now() - RESUME_LEASE_MS);
      const claimed = await prisma.turn.updateMany({
        where: {
          id: unfinished.id,
          needsResolvedAt: null,
          OR: [
            { needsResumeClaimedAt: null },
            { needsResumeClaimedAt: { lt: staleBefore } },
          ],
        },
        data: { needsResumeClaimedAt: new Date() },
      });

      if (claimed.count === 0) {
        console.warn(
          `Turn #${unfinished.number} is already being resumed by another advance — standing down.`,
        );
        return {
          advanced: false,
          previousTurn: null,
          newTurn: null,
          note: null,
          runSideEffects: async () => {},
        };
      }

      console.warn(
        `Turn #${unfinished.number} was claimed but never finished resolving — resuming its outstanding passes.`,
      );
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "turn_resume",
            details: {
              turnNumber: unfinished.number,
              alreadyApplied: unfinished.resolvedPasses ?? [],
            },
          },
        })
        .catch((logErr) =>
          console.error(
            "Failed to log turn_resume — the resume now has no record:",
            logErr,
          ),
        );
      ({
        lifewebBlood,
        hungerNotices,
        autoLaborDms,
        lessonDms,
        confessionDms,
        tagExpiryDms,
        catatonicDms,
        catatonicRoleUpdates,
        catatonicDeaths,
        catatonicDeathWarnings,
        dyingDeaths,
        dyingDeathWarnings,
        nukeDeaths,
        nukeBroadcast,
        ascensionBroadcast,
        gameEndedPost,
        birdNotices,
        carryDrops,
        privateDeliveries,
        publicPosts,
        zoneMoves,
        travelArrivals,
        routineNotices,
        gambitRollNotices,
        depotLines,
        turretDms,
        depotLocationId,
      } = await resolveNeeds(unfinished, config));
    }
  }

  const lastTurn =
    openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // Picked once, here, and remembered on the Turn row — a repost of the
  // announcement must show the same picture, not roll a new one.
  const banner = await nextTurnBanner(prisma, phase);
  const lifewebFlavor =
    lifewebBlood <= LIFEWEB_SPUTTER_THRESHOLD
      ? "The Lifeweb sputters, failing."
      : null;
  const note =
    [lifewebFlavor, state.nextTurnNote].filter(Boolean).join("\n\n") || null;

  const newTurn = await prisma.turn.create({
    data: {
      number: (lastTurn?.number ?? 0) + 1,
      phase,
      banner,
      gameDate: new Date(),
      status: "OPEN",
    },
  });

  await prisma.gameState.update({
    where: { id: 1 },
    data: { nextTurnNote: null },
  });

  // One row per zone rather than one for the game, so every zone's feed on
  // /play carries the day line (HALL.md §5). /archive folds them back into the
  // single sticky day divider it always drew — a TURN_START row is never
  // rendered as a row, and the divider keys on the day.
  const turnStartContent = [
    `Day ${Math.ceil(newTurn.number / 2)} — ${newTurn.phase}`,
    note,
  ]
    .filter(Boolean)
    .join("\n");
  const turnStartZones = await prisma.zone
    .findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } })
    .catch(() => []);
  for (const zone of turnStartZones) {
    await recordArchiveEvent(prisma, {
      kind: "TURN_START",
      turn: newTurn,
      content: turnStartContent,
      zoneId: zone.id,
      zoneName: zone.name,
      placeKey: `zone:${zone.id}`,
    });
  }
  if (turnStartZones.length === 0) {
    await recordArchiveEvent(prisma, {
      kind: "TURN_START",
      turn: newTurn,
      content: turnStartContent,
    });
  }

  // Everything below this line is the only place in the turn-advance path
  // that talks to Discord; every resolveNeeds() pass hands back posts/DMs
  // instead of sending them.
  const runSideEffects = async () => {
    // Cutoff for the message wipe below, taken before the first Discord call so
    // nothing posted by this thunk gets swept. See db/lib/messageWipe.js.
    const sideEffectsStartedAt = Date.now();

    for (const dm of autoLaborDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Auto-labor DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of lessonDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Lesson DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of researchDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Research DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of confessionDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Confession DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of tagExpiryDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Tag progression DM to ${dm.discordUserId} failed:`, err),
      );
    }

    // A gun going off is heard well past the room it is in. Before the DMs
    // below rather than after, so the zone hears the burst at about the moment
    // the people it hit are told what it did to them.
    for (const burstLocationId of turretBursts) {
      await announceTurretBurst(prisma, burstLocationId).catch((err) =>
        console.error("Turret burst failed:", err.message ?? err),
      );
    }

    // The Depot's hardware, speaking for itself: the generator dying and the
    // shuttle leaving on its own clock are both things the room witnesses.
    if (depotLocationId && depotLines.length) {
      const depotLocation = await prisma.location
        .findUnique({
          where: { id: depotLocationId },
          select: { discordChannelId: true },
        })
        .catch(() => null);
      if (depotLocation?.discordChannelId) {
        for (const line of depotLines) {
          await postMessage(
            depotLocation.discordChannelId,
            ambientLine(line.text, [], { signed: line.signed }),
          ).catch((err) => console.error("Depot ambient line failed:", err));
        }
      }
    }

    // The Landing Pad's starter message says whether the shuttle is sitting on
    // it (db/lib/roomLive.js), and the shuttle may have left on its own clock
    // this turn. Hash-guarded, so a turn that did not move it edits nothing.
    if (depotLocationId) {
      await refreshLiveRooms(prisma, "shuttle").catch((err) =>
        console.error("Landing pad refresh failed:", err.message),
      );
    }

    for (const dm of turretDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Turret DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const dm of birdNotices) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Bird failure DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const result of carryDrops) {
      await deliverCarryDrop(prisma, result).catch((err) =>
        console.error(
          `Carry drop delivery for ${result.characterId} failed:`,
          err,
        ),
      );
    }

    for (const dm of catatonicDms) {
      await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
        console.error(`Catatonic DM to ${dm.discordUserId} failed:`, err),
      );
    }

    for (const update of catatonicRoleUpdates) {
      await patchGuildRole(update.roleId, {
        name: update.name,
        color: update.color,
      }).catch((err) =>
        console.error(`Catatonic role rename for ${update.name} failed:`, err),
      );
    }

    for (const warning of [...catatonicDeathWarnings, ...dyingDeathWarnings]) {
      await sendDm(prisma, warning.discordUserId, warning.content).catch(
        (err) =>
          console.error(
            `Death warning DM to ${warning.discordUserId} failed:`,
            err,
          ),
      );
    }

    const turnDeaths = [...catatonicDeaths, ...dyingDeaths, ...nukeDeaths, ...turretDeaths];

    // Same teardown web/lib/discordGuild.js#killCharacter performs, plus a
    // membership check up front so a departed player's steps don't just 403
    // into the REST breaker's tally.
    for (const death of turnDeaths) {
      const member = await getGuildMember(death.discordUserId).catch((err) => {
        console.error(`Membership check for ${death.name} failed:`, err);
        return null;
      });

      // `id` spread in because every pass builds its death entry with
      // `characterId`, and revokeAllCharacterAccess reads `character.id` to
      // clear private-Room door grants. Without it that deleteMany matched
      // nothing and a corpse kept every door somebody had held open for them —
      // silently, since the rest of the revoke worked fine.
      const revoked = await revokeAllCharacterAccess(prisma, {
        ...death,
        id: death.id ?? death.characterId,
      }).catch(
        (err) => {
          console.error(
            `Failed to revoke access for ${death.name} on an automatic death:`,
            err,
          );
          return null;
        },
      );
      if (!revoked || revoked.failed > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "access_revoke_incomplete",
              targetCharacterId: death.characterId,
              targetName: death.name,
              details: {
                failed: revoked?.failed ?? null,
                attempted: revoked?.attempted ?? null,
              },
            },
          })
          .catch((err) =>
            console.error("Failed to log an incomplete access revoke:", err),
          );
      }

      if (death.discordRoleId) {
        await deleteGuildRole(death.discordRoleId).catch((err) =>
          console.error(
            `Failed to delete ${death.name}'s role on an automatic death:`,
            err.message,
          ),
        );
      }

      if (member) {
        await addMemberRole(death.discordUserId, GHOST_ROLE_ID).catch((err) =>
          console.error(
            `Failed to grant the ghost seat to ${death.discordUserId}:`,
            err.message,
          ),
        );
        await setGuildNickname(death.discordUserId, null).catch((err) =>
          console.error(
            `Failed to clear ${death.name}'s nickname:`,
            err.message,
          ),
        );
        // A turret says it better than this loop can, and already has — its
        // own DM went out with the burst, in the second person and in the
        // gun's voice. Sending a generic notice after it would be the same
        // news twice. Everything else above still runs: the teardown is what
        // a turret kill was missing, not the words.
        if (!death.ownDm) {
          await sendDm(
            prisma,
            death.discordUserId,
            `You have died. ${death.reason}`,
          ).catch((err) =>
            console.error(`Death DM to ${death.discordUserId} failed:`, err),
          );
        }
      }
    }
    if (turnDeaths.length > 0) {
      await postMessage(
        LEAVE_ANNOUNCE_CHANNEL_ID,
        turnDeaths
          .map((death) => `${death.name} has died — ${death.reason}`)
          .join("\n"),
      ).catch((err) =>
        console.error("Automatic-death alert to #leave failed:", err),
      );
    }

    for (const notice of hungerNotices) {
      await sendDm(prisma, notice.discordUserId, hungerDm(notice)).catch(
        (err) =>
          console.error(`Hunger DM to ${notice.discordUserId} failed:`, err),
      );
      if (notice.justDied) {
        await sendDm(prisma, notice.discordUserId, DYING_DM).catch((err) =>
          console.error(`Dying DM to ${notice.discordUserId} failed:`, err),
        );
      }
    }

    const { applyLocationMoveSideEffects } = require("./lib/locationMove");
    const { rollCavingOnArrival } = require("./lib/cavingPass");
    // Two kinds of relocation land in the same breath and want the identical
    // Discord work: a GM's staged "Relocate to" (zoneMoves) and a player's
    // paid crossing finally arriving (travelArrivals, MAP.md §3).
    for (const move of [...zoneMoves, ...travelArrivals]) {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(
          `Relocation side effects failed for ${move.characterId}:`,
          err,
        ),
      );

      // The traveller pressed Confirm a turn ago and has heard nothing since,
      // so arriving is the one thing that has to be told. A dragged corpse
      // gets no letter; `alive` is only set by the travel pass.
      if (move.toLocationName && move.alive && move.discordUserId) {
        await sendDm(
          prisma,
          move.discordUserId,
          `» You arrive at **${move.toLocationName}**. ‡`,
          { kind: DM_KIND.QUIET },
        ).catch((err) =>
          console.error(`Arrival DM to ${move.discordUserId} failed:`, err),
        );
      }

      // The Caving Die, for a GM's staged "Relocate to". It could not run
      // inside applyOneStagedEffect — rollCaving opens its own transaction and
      // that function is already in one — but out here the write has committed
      // and this is the same post-commit half every other DM goes out from.
      //
      // It has to happen SOMEWHERE, and this is the only place left: the
      // turn-start pass used to sweep up anyone a GM had dropped underground,
      // and with that pass gone a staged relocation into the Depths would
      // otherwise roll nothing at all until the character walked. Being
      // *dropped* into the dark being the one free walk in is exactly how the
      // die first looked broken (CAVING.md §2).
      const landed = move.toLocationId
        ? await prisma.location
            .findUnique({ where: { id: move.toLocationId }, include: { zone: true } })
            .catch(() => null)
        : null;
      if (landed && move.alive !== false) {
        const dm = await rollCavingOnArrival(prisma, { id: move.characterId, discordUserId: move.discordUserId }, landed);
        if (dm) {
          await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
            console.error(`Arrival caving DM to ${dm.discordUserId} failed:`, err),
          );
        }
      }
    }

    // Staged-arbitration deliveries (docs/systemdocs/ADJUDICATION.md).
    // sentAt is stamped only after sends were attempted, so a crash partway
    // leaves the remainder visibly unsent instead of falsely delivered.
    const deliveryFailures = [];
    for (const delivery of privateDeliveries) {
      const failed = [];
      for (const recipient of delivery.recipients) {
        try {
          await sendDm(prisma, recipient.discordUserId, delivery.content, {
            authorDiscordUserId: delivery.createdByDiscordUserId ?? null,
            source: "staged_push",
            // A turn result is GM-authored prose, just delivered in bulk.
            kind: DM_KIND.CONVERSATION,
          });
        } catch (err) {
          failed.push({
            characterId: recipient.characterId,
            name: recipient.name,
            error: String(err?.message ?? err),
          });
        }
      }
      await prisma.stagedMessage
        .update({
          where: { id: delivery.stagedMessageId },
          data: {
            sentAt: new Date(),
            deliveryFailures: failed.length ? failed : Prisma.DbNull,
          },
        })
        .catch((err) =>
          console.error(
            `Failed to stamp staged message ${delivery.stagedMessageId} sent:`,
            err,
          ),
        );
      if (failed.length)
        deliveryFailures.push({
          stagedMessageId: delivery.stagedMessageId,
          failed,
        });
    }

    for (const notice of routineNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(
          `Passed-Routine DM to ${notice.discordUserId} failed:`,
          err,
        ),
      );
    }

    for (const notice of gambitRollNotices) {
      await sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
        console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
      );
    }

    // The fireball, into every zone's #summary. Last of the announcements and
    // after the deaths above, so nobody reads that the sky is on fire before
    // their own character has actually died. It carries a real @everyone —
    // the one message in the game that should wake somebody who is asleep.
    if (nukeBroadcast) {
      const { sent, failed } = await broadcastToZones(prisma, nukeBroadcast.content, {
        mentionEveryone: nukeBroadcast.mentionEveryone,
      }).catch((err) => {
        console.error("Nuke broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Nuke broadcast: ${sent} zones, ${failed.length} failed.`);
    }

    // The hellfire, same fan-out, no @everyone: the town was warned two turns
    // ago and that was the message worth waking somebody for.
    if (ascensionBroadcast) {
      const { sent, failed } = await broadcastToZones(prisma, ascensionBroadcast.content).catch((err) => {
        console.error("Ascension broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Ascension broadcast: ${sent} zones, ${failed.length} failed.`);
    }

    // The reveal, after the sky and before anything else — the game is over.
    if (gameEndedPost) {
      await postGameEnded(prisma, gameEndedPost).catch((err) => console.error("Game Ended post failed:", err));
      // A phase change, so the spectator seat is re-checked like any other.
      await syncSpectatorAccess(prisma).catch((err) => console.error("Spectator sweep failed:", err));
    }

    for (const post of publicPosts) {
      const targetChannelId = post.zoneSummaryChannelId;
      if (!targetChannelId) {
        console.error(
          `Public declaration ${post.stagedMessageId} skipped: its zone has no summary channel.`,
        );
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: {
              deliveryFailures: [{ error: "no summary channel configured" }],
            },
          })
          .catch((err) =>
            console.error(
              `Failed to mark public post ${post.stagedMessageId}:`,
              err,
            ),
          );
        deliveryFailures.push({
          stagedMessageId: post.stagedMessageId,
          failed: [{ error: "no summary channel configured" }],
        });
        continue;
      }
      try {
        // Batched: a declaration over 2000 characters posts as several
        // messages in order rather than being rejected. See ADJUDICATION.md §1.
        await postMessageBatched(targetChannelId, post.content);
        // The Hall's half: one SYSTEM row in the zone's feed, beside the post.
        // The declaration is GM-authored and already signed, so it is not
        // signed again.
        await sceneLineAt(prisma, { zoneId: post.zoneId, text: post.content, signed: false });
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: { sentAt: new Date(), deliveryFailures: Prisma.DbNull },
          })
          .catch((err) =>
            console.error(
              `Failed to stamp public post ${post.stagedMessageId} sent:`,
              err,
            ),
          );
      } catch (err) {
        console.error(
          `Public declaration ${post.stagedMessageId} failed to post:`,
          err,
        );
        await prisma.stagedMessage
          .update({
            where: { id: post.stagedMessageId },
            data: {
              deliveryFailures: [{ error: String(err?.message ?? err) }],
            },
          })
          .catch((markErr) =>
            console.error(
              `Failed to mark public post ${post.stagedMessageId}:`,
              markErr,
            ),
          );
        deliveryFailures.push({
          stagedMessageId: post.stagedMessageId,
          failed: [{ error: String(err?.message ?? err) }],
        });
      }
    }

    if (deliveryFailures.length) {
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "staged_push_delivery_failed",
            details: { failures: deliveryFailures },
          },
        })
        .catch((err) =>
          console.error("Failed to log staged_push_delivery_failed:", err),
        );
    }

    await postTurnsAnnouncement(prisma, newTurn, note).catch((err) =>
      console.error("Failed to post turn announcement:", err),
    );

    // The wipe runs on EVERY turn now. A turn is one real day, and Dawn/Dusk
    // alternate, so the old Dawn gate meant a Room scene ran for 48 hours.
    // Only the zone summaries keep that slower life — CHANNELS.md §8.
    // `messageWipeEnabled` is no longer a GM knob; the column stays as a
    // hand-flippable escape hatch if Discord starts rate-limiting.
    if (config.messageWipeEnabled) {
      const wipeSummaries = newTurn.phase === "DAWN";
      // The web's half of the same wipe, and it goes FIRST: the watermark is
      // the newest row as the pass begins, which is the same instant
      // `cutoffMs` names on the Discord side. Taking it afterwards would put
      // everything said during the wipe below the floor — deleted from
      // Discord's view and hidden from the Hall's, for no reason but that the
      // sweep was slow. See db/lib/feedWipe.js and HALL.md §7.
      const { markFeedWiped } = require("./lib/feedWipe");
      await markFeedWiped(prisma, { summaries: wipeSummaries });
      await runMessageWipe(prisma, { cutoffMs: sideEffectsStartedAt, wipeSummaries }).catch(
        (err) => console.error("Message wipe failed:", err),
      );
    }

    // The channel doctor's cheap reconcile — roles and membership only, a
    // handful of requests. It used to sit behind autoReconcileEnabled, a
    // switch nobody ever turned on; keeping Discord in step with the database
    // after a turn moves people around is not a thing to opt into.
    const { runChannelDoctor } = require("./lib/channelDoctor");
    await runChannelDoctor(prisma, { apply: true, scope: "cheap" }).catch(
      (err) => console.error("Post-turn channel doctor failed:", err),
    );
  };

  return {
    advanced: true,
    previousTurn: openTurn,
    newTurn,
    note,
    runSideEffects,
  };
}

module.exports = {
  prisma,
  // Prisma.DbNull is the only way to write a SQL NULL into a nullable Json
  // column — a plain null is a validation error.
  Prisma,
  resolveNeeds,
  advanceTurn,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncTagsFromYaml,
  deleteCharacterRow,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncSpecialChannels,
  ...require("./lib/placeKey"),
  // archive.js is deliberately NOT spread whole (it takes prisma by
  // parameter and its writers are meant to be required by path); these two
  // are pure shape helpers with no prisma in them, and both faces render the
  // wire row.
  feedRowShape: require("./lib/archive").feedRowShape,
  FEED_ROW_SELECT: require("./lib/archive").FEED_ROW_SELECT,
  ...require("./lib/seatZone"),
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./turnCalendar"),
  ...require("./lib/constants"),
  ...require("./lib/roleIds"),
  ...require("./lib/gmZoneView"),
  ...require("./lib/roleColor"),
  ...require("./lib/characterRoleAppearance"),
  ...require("./lib/characterName"),
  ...require("./lib/titles"),
  ...require("./lib/nameCorpus"),
  ...require("./lib/dynasty"),
  ...require("./lib/concealedIdentity"),
  ...require("./lib/presentedIdentity"),
  ...require("./lib/threats"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/gameState"),
  ...require("./lib/gameConfigFields"),
  ...require("./lib/production"),
  ...require("./lib/depot"),
  ...require("./lib/depotState"),
  ...require("./lib/depotTurret"),
  ...require("./lib/turretBurst"),
  ...require("./lib/depotCrates"),
  ...require("./lib/startingTags"),
  ...require("./lib/locationAttributes"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/armorValue"),
  ...require("./lib/formatTagArmor"),
  ...require("./lib/turnFormat"),
  ...require("./lib/turnClock"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
  ...require("./lib/laborAccess"),
  ...require("./lib/laborYield"),
  // Only the pure helper — the revoke functions take prisma as a parameter
  // and are kept off the barrel; require db/lib/accessSweep.js by path.
  zoneChannelIds: require("./lib/accessSweep").zoneChannelIds,
};
