// The Charon: the ship above the Keep, and the only way out of the barony that
// is not a grave. docs/systemdocs/CHARON.md is the doc; this is the mechanism,
// and both faces call into it so a button on Discord and a button on the web
// can never disagree about whether the ship has gone.
//
// Four places worth knowing before reading anything below:
//
//   * There is no road to it. The Charon has no LocationLink, on purpose, so
//     locationTravel.js#performLocationMove — which validates an edge — is the
//     wrong door and would refuse. Every move here is a RAW relocation, the
//     db/lib/riteEffects.js#summoning pattern: write locationId/zoneId inside a
//     transaction, then run applyLocationMoveSideEffects OUTSIDE it.
//   * Characters stand in Locations, never in Rooms. So "six people aboard" is
//     a count of Character.locationId, and the Cockpit and the Habitation are
//     just two threads hanging off the place they are all standing in.
//   * The launch is irreversible in the strongest sense the game has: the
//     ground Location is retired, and nothing in any surface can put it back.
//   * The ship's ROOMS travel. completeLaunch repoints them at the orbit
//     Location rather than authoring a second pair, so the butter, the threads
//     and whatever anybody left aboard all go up with it.
//
// Takes `prisma` as a parameter rather than requiring db/index.js back — that
// would resolve to a partial exports object (the db/lib/dm.js convention).

const { applyLocationMoveSideEffects } = require("./locationMove");
const { releaseEntanglements } = require("./characterDeath");
const { broadcastEverywhere } = require("./soundBroadcast");
const { grantTagSlugs } = require("./tagWrites");
const { sceneLineAt } = require("./scene");
const { SFX } = require("./sfx");

// Where the ship is, off ./charonPlaces.js — kept in its own zero-require file
// so db/lib/placeAffordances.js can draw the buttons without importing this
// module and the whole move pipeline behind it. Re-exported below, so a caller
// that wants the mechanism and the places has one import.
const {
  CHARON_SLUG,
  CHARON_SPACE_SLUG,
  KEEP_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
} = require("./charonPlaces");

/** What the Habitation's Sleep button leaves on the sheet. NOT `asleep`, which is ordinary sleep. */
const ASLEEP_TAG_SLUG = "charon-asleep";

/** Six seats, and the sixth is the last one. */
const CAPACITY = 6;

/** Thirty seconds from the press to the launch, with a beat at fifteen. */
const COUNTDOWN_MS = 30_000;
const SECOND_BEAT_MS = 15_000;

// Bascinet's words, verbatim. Nothing here is composed at a call site.
const LINES = {
  full: "The Charon can only fit six people.",
  alreadyLaunched: "The Charon already launched.",
  alreadyLaunchedTerminal: "The Charon was already launched.",
  first: "The magnetic locks disengage. The Charon will launch in 30 seconds.",
  second: "The Charon will launch in 15 seconds.",
  third: "The Charon is launching.",
  cancelled: "The launch sequence was cancelled.",
  world: "You hear a distant rumbling, and then a spaceship takes off from the Keep.",
  underground: "You hear a distant rumbling.",
};

// ---------------------------------------------------------------- state

/**
 * The one CharonLaunch row, created lazily. Everything else here reads through
 * this, so "no row yet" and "a row that has never been pressed" are the same
 * answer and neither needs a special case.
 */
async function launchRow(prisma) {
  const existing = await prisma.charonLaunch.findFirst();
  if (existing) return existing;
  return prisma.charonLaunch.create({ data: {} });
}

/** `{ launched, countingDown, launchAt, launchedAt }`. */
async function charonState(prisma) {
  const row = await launchRow(prisma);
  return {
    launched: Boolean(row.launchedAt),
    countingDown: Boolean(row.launchAt) && !row.launchedAt,
    launchAt: row.launchAt ?? null,
    launchedAt: row.launchedAt ?? null,
  };
}

// ---------------------------------------------------------------- moving

async function placeBySlug(prisma, slug) {
  return prisma.location.findUnique({
    where: { slug },
    select: { id: true, name: true, zoneId: true, retiredAt: true },
  });
}

/**
 * The raw relocation both doors share. Writes the two columns in a transaction
 * and runs the Discord/carry/visit side effects outside it, because
 * applyLocationMoveSideEffects talks to Discord and must never be holding one
 * open while it does.
 *
 * `guard` runs INSIDE the transaction, holding the same client that is about to
 * write. That is what makes the capacity check honest: six people pressing at
 * once cannot make seven, because the count and the write are the same statement.
 */
async function relocate(prisma, character, target, guard = null) {
  const from = character.locationId ?? null;

  const refused = await prisma.$transaction(async (tx) => {
    if (guard) {
      const reason = await guard(tx);
      if (reason) return reason;
    }
    await tx.character.update({
      where: { id: character.id },
      data: { locationId: target.id, zoneId: target.zoneId, escortedById: null },
    });
    return null;
  });
  if (refused) return refused;

  await applyLocationMoveSideEffects(prisma, {
    characterId: character.id,
    fromLocationId: from,
    toLocationId: target.id,
  }).catch((err) => console.error(`Charon: side effects for ${character.id} failed:`, err.message ?? err));

  return null;
}

/**
 * The Panic Room's button. Returns null on success, or the sentence to say.
 *
 * Both refusals are re-checked here rather than trusted off the UI, the way
 * every server action in this repo re-checks its own gate: the button is a
 * hint, not a lock.
 */
async function enterCharon(prisma, character) {
  const state = await charonState(prisma);
  if (state.launched) return LINES.alreadyLaunched;

  const ship = await placeBySlug(prisma, CHARON_SLUG);
  // No ship in this database at all — a game stood up before the Charon
  // existed. Say the launched line rather than throwing: from where the player
  // is standing, a door that does not open is a door that does not open.
  if (!ship || ship.retiredAt) return LINES.alreadyLaunched;
  if (character.locationId === ship.id) return null;

  return relocate(prisma, character, ship, async (tx) => {
    const aboard = await tx.character.count({ where: { locationId: ship.id, status: "ALIVE" } });
    return aboard >= CAPACITY ? LINES.full : null;
  });
}

/** The Charon's own Leave button. Only ever offered on the ground. */
async function leaveCharon(prisma, character) {
  const keep = await placeBySlug(prisma, KEEP_SLUG);
  if (!keep) return null;
  if (character.locationId === keep.id) return null;
  return relocate(prisma, character, keep);
}

// ---------------------------------------------------------------- launching

/**
 * Where the ship's feed IS right now: the ground Location while it is still on
 * the ground, the orbit one once it has gone.
 *
 * The retired check is load-bearing. completeLaunch RETIRES the ground Location
 * rather than deleting it, so it is still perfectly findable by slug afterwards
 * — and a line written into it would land in a feed nobody can open, which is
 * indistinguishable from the line never being written at all.
 */
async function shipPlace(prisma) {
  const ground = await placeBySlug(prisma, CHARON_SLUG);
  if (ground && !ground.retiredAt) return ground;
  const orbit = await placeBySlug(prisma, CHARON_SPACE_SLUG);
  if (orbit && !orbit.retiredAt) return orbit;
  return null;
}

/** One line into the Charon's feed, wherever the Charon currently is. */
async function shipLine(prisma, text, sfx = null) {
  const ship = await shipPlace(prisma);
  if (!ship) return;
  await sceneLineAt(prisma, { locationId: ship.id, text, sfx });
}

/**
 * The Cockpit's one button, which does all three things depending on where the
 * ship is in its own story. Returns `{ text, sfx }` for the presser, or null
 * when the answer is the line the whole room just heard instead.
 */
async function pressLaunch(prisma, character) {
  const row = await launchRow(prisma);

  if (row.launchedAt) return { text: LINES.alreadyLaunchedTerminal, sfx: SFX.CONSOLE_REFUSE };

  if (row.launchAt) {
    // Cancel. Cleared conditionally so two people pressing at the same instant
    // cancel once between them rather than one of them cancelling a countdown
    // the other already stopped.
    const cleared = await prisma.charonLaunch.updateMany({
      where: { id: row.id, launchAt: { not: null }, launchedAt: null },
      data: { launchAt: null, launchedBy: null },
    });
    if (cleared.count === 0) return { text: LINES.alreadyLaunchedTerminal, sfx: SFX.CONSOLE_REFUSE };
    await shipLine(prisma, LINES.cancelled, SFX.AIRLOCK);
    await audit(prisma, character, "charon_launch_cancelled");
    return null;
  }

  // Begin. Same conditional shape, same reason.
  const started = await prisma.charonLaunch.updateMany({
    where: { id: row.id, launchAt: null, launchedAt: null },
    data: { launchAt: new Date(Date.now() + COUNTDOWN_MS), launchedBy: character?.name ?? null },
  });
  if (started.count === 0) return { text: LINES.alreadyLaunchedTerminal, sfx: SFX.CONSOLE_REFUSE };
  await shipLine(prisma, LINES.first, SFX.AIRLOCK_FORCE);
  await audit(prisma, character, "charon_launch_started");
  return null;
}

/**
 * The irreversible half, run by db/lib/charonSweep.js when the clock runs out.
 *
 * Claimed conditionally before anything else happens, so two sweeps overlapping
 * — a bot restarting into a tick, say — cannot launch the same ship twice.
 */
async function completeLaunch(prisma) {
  const row = await launchRow(prisma);
  if (row.launchedAt || !row.launchAt) return { launched: false };

  const claimed = await prisma.charonLaunch.updateMany({
    where: { id: row.id, launchedAt: null, launchAt: { not: null } },
    data: { launchedAt: new Date(), launchAt: null },
  });
  if (claimed.count === 0) return { launched: false };

  const ship = await placeBySlug(prisma, CHARON_SLUG);
  const orbit = await placeBySlug(prisma, CHARON_SPACE_SLUG);
  if (!ship || !orbit) {
    console.error("Charon: launched with no ship or no orbit to put it in.");
    return { launched: true, moved: [] };
  }

  const aboard = await prisma.character.findMany({
    where: { locationId: ship.id },
    select: { id: true, name: true, locationId: true },
  });

  await prisma.$transaction(async (tx) => {
    // The rooms go up with the ship — the whole reason there is no second pair
    // of them authored in orbit. Their stash, their threads and anything left
    // on the floor travel by coming along rather than by being copied.
    await tx.room.updateMany({ where: { locationId: ship.id }, data: { locationId: orbit.id } });
    await tx.character.updateMany({
      where: { locationId: ship.id },
      data: { locationId: orbit.id, zoneId: orbit.zoneId },
    });
    // Retired, not deleted: db/lib/placeDeletable.js#hardDeletePlace refuses
    // while anything at all still points at a Location, and plenty does — a
    // Vantage, an old CavingRoll, an AuditLog. Retiring takes it off the map
    // and out of the travel graph, which is the whole of what a player can see.
    //
    // Its DISCORD channel is deliberately left alone here. The database is the
    // master and db/lib/discordMirror/ is what makes Discord match it
    // (docs/systemdocs/MIRROR.md); deleting the channel from inside a game
    // action would take the ship's two threads with it and leave nothing in
    // their place until somebody ran a mirror pass. The mirror moves them under
    // the orbit Location's channel, starter rows and all — and those rows come
    // out different there, because roomStarterRow now reads the Location
    // (Launch on the ground, Sleep in orbit).
    await tx.location.update({ where: { id: ship.id }, data: { retiredAt: new Date() } });
  });

  for (const who of aboard) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: who.id,
      fromLocationId: ship.id,
      toLocationId: orbit.id,
    }).catch((err) => console.error(`Charon: lifting ${who.name} failed:`, err.message ?? err));
  }

  // Everybody, everywhere. The Caves and the Depths get the shorter line, and
  // get it because they are underground rather than because of how far away
  // they are — broadcastEverywhere is a separate function from broadcastSound
  // for exactly that reason.
  await broadcastEverywhere(prisma, {
    text: LINES.world,
    undergroundText: LINES.underground,
    sfx: SFX.AIRLOCK_FORCE,
  }).catch((err) => console.error("Charon: the world did not hear it:", err.message ?? err));

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system:charon",
        actionType: "charon_launched",
        details: { aboard: aboard.map((w) => w.name), pressedBy: row.launchedBy ?? null },
      },
    })
    .catch((err) => console.error("Charon: audit failed:", err.message ?? err));

  return { launched: true, moved: aboard.map((w) => w.name) };
}

// ---------------------------------------------------------------- sleeping

/**
 * The Habitation's Sleep button, in orbit only.
 *
 * NOT a death. No corpse, no death mask, nobody frightened, and — the point of
 * the whole button — no curse, so the player may roll again at once. What makes
 * that true is db/lib/bodies.js: ASLEEP is neither alive nor a body, so
 * curse.js skips over the row and ghost.js gives it no seat among the dead.
 *
 * What it DOES share with dying is releaseEntanglements: a party must stop
 * following somebody who has left the game, and a prisoner must not stay pinned
 * by a hand that is now in orbit.
 */
async function sleepAboard(prisma, character) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  const claimed = await prisma.$transaction(async (tx) => {
    const won = await tx.character.updateMany({
      where: { id: character.id, status: "ALIVE" },
      data: { status: "ASLEEP", discordRoleId: null, catatonicSinceTurn: null },
    });
    if (won.count === 0) return false;
    await grantTagSlugs(tx, character.id, [ASLEEP_TAG_SLUG], turn?.number ?? null);
    return true;
  });
  if (!claimed) return false;

  await releaseEntanglements(prisma, character.id);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "system:charon",
        actionType: "charon_slept",
        targetCharacterId: character.id,
        details: { name: character.name },
      },
    })
    .catch((err) => console.error("Charon: sleep audit failed:", err.message ?? err));

  return true;
}

// ---------------------------------------------------------------- shared

async function audit(prisma, character, actionType) {
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character?.discordUserId ?? "system:charon",
        actionType,
        targetCharacterId: character?.id ?? null,
        details: { name: character?.name ?? null },
      },
    })
    .catch((err) => console.error(`Charon: ${actionType} audit failed:`, err.message ?? err));
}

module.exports = {
  CHARON_SLUG,
  CHARON_SPACE_SLUG,
  PANIC_ROOM_SLUG,
  COCKPIT_SLUG,
  HABITATION_SLUG,
  KEEP_SLUG,
  ASLEEP_TAG_SLUG,
  CAPACITY,
  COUNTDOWN_MS,
  SECOND_BEAT_MS,
  LINES,
  charonState,
  enterCharon,
  leaveCharon,
  pressLaunch,
  completeLaunch,
  sleepAboard,
  shipLine,
  shipPlace,
};
