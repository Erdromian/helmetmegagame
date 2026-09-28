// Corpse Sense: the nose Corpse Salts gives you, and the minute sweep behind it
// (docs/systemdocs/CORPSES.md). While a character holds the corpse-sense tag,
// every twenty real minutes they are DM'd which way the nearest HUMAN corpse
// lies. Takes `db` as a parameter, the db/lib/dm.js convention, and stays off
// the @lifeweb/db barrel — require it by path.
//
// THE DIRECTION RULE IS SHOUT'S, deliberately and to the letter: soundRange
// gives back the hearer's OWN neighbour one hop back toward the thing, never
// the thing's own Location, and gives back nothing at all when that step
// crossed a hidden way. A smell that named the room a body was in, from four
// Locations off, would be a better search tool than walking there.
//
// THERE IS NO STATE COLUMN. The twenty-minute clock is replayed from the
// AuditLog rows each ping already writes, the same trick db/lib/speechRateLimit.js
// uses for shout's cooldown: it survives a bot restart, it is shared across both
// faces, it costs no schema, and it puts every ping on /gm/audit for free.
const { CORPSE_GROUP_SLUG, CORPSE_SENSE_SLUG } = require("./constants");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { soundRange } = require("./locationGraph");
const { sendDm } = require("./dm");

// Seven hops, against shout's three: a smell hangs around long after the noise
// that made it has gone.
const CORPSE_SENSE_HOPS = 7;
const CORPSE_SENSE_INTERVAL_MS = 20 * 60_000;
const CORPSE_SENSE_PING = "corpse_sense_ping";

// How far back the clock is read. Anything older than this is as good as never
// having pinged, and the tag itself never lives a fraction that long.
const CLOCK_WINDOW_MS = 24 * 60 * 60_000;

// Pure, so the wording is testable with no database — same posture as
// shoutParts. `here` is the own-Location answer ({ roomName } when they can get
// into the room, { hidden: true } when they cannot); `viaName` is the step
// toward a body further off, null across a hidden way.
function corpseSenseLine({ here = null, viaName = null } = {}) {
  if (here) {
    if (here.roomName) return `You smell a corpse in ${here.roomName}.`;
    return "You smell a corpse nearby, but you don't know where.";
  }
  // The same fallback wording shout uses for the same case (db/lib/shout.js).
  if (!viaName) return "You smell a corpse somewhere nearby.";
  return `You smell a corpse in the direction of ${viaName}.`;
}

// Every human corpse lying in a Room, grouped by Location. ONE query for the
// whole game, shared by every holder in a sweep: `corpseOfCharacterId` is a
// real column, so "a person's body" (isHumanCorpse) filters in Postgres rather
// than in JS, and what comes back is a few dozen rows at worst.
//
// A corpse in a LIVING character's pack does not count, on purpose. It sits at
// a Location but in no Room, so it could only ever produce "nearby, but you
// don't know where" — a worse line that would also mask a real body in a room
// you can actually walk into. It would also turn a smell into a people-tracker:
// at seven hops, a courier carrying a body would be a beacon re-pinging every
// twenty minutes to everyone who had taken salts.
async function corpseRooms(db) {
  const rows = await db.roomTag.findMany({
    where: {
      tag: { group: { slug: CORPSE_GROUP_SLUG }, corpseOfCharacterId: { not: null } },
    },
    select: {
      room: {
        select: { id: true, name: true, kind: true, accessTagSlugs: true, locationId: true },
      },
    },
  });

  const byLocation = new Map();
  for (const { room } of rows) {
    if (!room?.locationId) continue;
    if (!byLocation.has(room.locationId)) byLocation.set(room.locationId, []);
    const list = byLocation.get(room.locationId);
    if (!list.some((r) => r.id === room.id)) list.push(room);
  }
  return byLocation;
}

// What this character's nose reports right now, or null for nothing in range.
// `reach` is soundRange's rows for their Location, already nearest-first and
// tie-broken deterministically (locationGraph sorts its adjacency by slug for
// exactly that reason), so taking the FIRST match gives the same answer every
// twenty minutes for the same map and the same bodies.
async function senseFor(db, character, reach, byLocation) {
  for (const row of reach) {
    const rooms = byLocation.get(row.locationId);
    if (!rooms?.length) continue;

    if (row.distance === 0) {
      // The only per-character query, and it fires only when a body is
      // actually underfoot, so it stays off the common path.
      const { heldSlugs, guestRoomIds, allowedRoomIds } = await roomAccessKeys(db, character.id);
      const open = accessibleRooms(rooms, heldSlugs, guestRoomIds, allowedRoomIds);
      return { here: open.length ? { roomName: open[0].name } : { hidden: true } };
    }
    // Nearest wins even when its direction is withheld: this withholds rather
    // than pointing at a farther body whose way it could name.
    return { viaName: row.viaName };
  }
  return null;
}

// One character's ping. Sends nothing and writes nothing when no body is in
// range — so the clock does not advance on a turn with nothing to say, and the
// moment one comes into reach they are told on the next minute.
async function pingCorpseSense(db, who, byLocation = null, reach = null) {
  // Callers hand over whatever they have. The sweep passes a row it already
  // selected the three fields from; the consume hook passes its acting
  // character, whose select is somebody else's business, so anything short is
  // re-read here rather than silently doing nothing.
  let character = who;
  if (character?.id && (!character.discordUserId || !character.locationId)) {
    character = await db.character.findUnique({
      where: { id: character.id },
      select: { id: true, name: true, discordUserId: true, locationId: true },
    });
  }
  if (!character?.discordUserId || !character.locationId) return false;

  const rooms = byLocation ?? (await corpseRooms(db));
  if (!rooms.size) return false;

  const heard = reach ?? (await soundRange(db, character.locationId, CORPSE_SENSE_HOPS));
  const sense = await senseFor(db, character, heard, rooms);
  if (!sense) return false;

  await sendDm(db, character.discordUserId, corpseSenseLine(sense));
  await db.auditLog.create({
    data: {
      actorDiscordUserId: character.discordUserId,
      actionType: CORPSE_SENSE_PING,
      targetCharacterId: character.id,
      locationId: character.locationId,
    },
  });
  return true;
}

// The minute sweep. Run every minute rather than every twenty: the interval is
// per-character and stored, so a per-minute tick is self-healing across a
// restart instead of drifting by however long the bot was gone.
async function runCorpseSenseSweep(db) {
  const holders = await db.characterTag.findMany({
    where: {
      tag: { slug: CORPSE_SENSE_SLUG },
      character: { status: "ALIVE" },
    },
    select: {
      character: {
        select: { id: true, name: true, discordUserId: true, locationId: true },
      },
    },
  });
  // The ordinary minute stops here, one query in.
  if (!holders.length) return { pinged: 0 };

  const characters = holders.map((h) => h.character).filter((c) => c?.locationId);
  if (!characters.length) return { pinged: 0 };

  const now = Date.now();
  const last = await db.auditLog.groupBy({
    by: ["targetCharacterId"],
    _max: { createdAt: true },
    where: {
      actionType: CORPSE_SENSE_PING,
      targetCharacterId: { in: characters.map((c) => c.id) },
      createdAt: { gte: new Date(now - CLOCK_WINDOW_MS) },
    },
  });
  const lastAt = new Map(last.map((r) => [r.targetCharacterId, r._max.createdAt?.getTime() ?? 0]));
  // No row at all means due now — which is also what catches a tag a GM handed
  // out, where no consume ever ran the first ping.
  const due = characters.filter(
    (c) => now - (lastAt.get(c.id) ?? 0) >= CORPSE_SENSE_INTERVAL_MS,
  );
  if (!due.length) return { pinged: 0 };

  const byLocation = await corpseRooms(db);
  if (!byLocation.size) return { pinged: 0 };

  // soundRange reads the whole link and location tables per call, so it is paid
  // once per distinct Location in the sweep, not once per character.
  const reachBy = new Map();
  const reachFor = async (locationId) => {
    if (!reachBy.has(locationId)) {
      reachBy.set(locationId, await soundRange(db, locationId, CORPSE_SENSE_HOPS));
    }
    return reachBy.get(locationId);
  };

  let pinged = 0;
  // Sequential, and each holder in its own try/catch — the deliverShout
  // discipline: one dead DM is one player short, not a failed sweep.
  for (const character of due) {
    try {
      const reach = await reachFor(character.locationId);
      if (await pingCorpseSense(db, character, byLocation, reach)) pinged += 1;
    } catch (err) {
      console.error(`Corpse sense ping failed for ${character.name}:`, err);
    }
  }
  return { pinged };
}

module.exports = {
  CORPSE_SENSE_HOPS,
  CORPSE_SENSE_INTERVAL_MS,
  CORPSE_SENSE_PING,
  corpseSenseLine,
  pingCorpseSense,
  runCorpseSenseSweep,
};
