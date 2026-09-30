// The Den's jukebox (docs/systemdocs/SOUND.md, "The Den's jukebox"; the design text is
// docs/sounds.yaml's `jukebox:` rule). A box in the Den's Bar that anybody standing there
// can set playing, change or turn off. "Whichever song has been picked loops for all
// characters in the den until it is changed or turned off. It replaces any ambience while
// playing."
//
// The state is two columns on the Bar's Room row, Room.jukeboxSongKey and
// Room.jukeboxStartedAt. Every change raises the same music notify an instrument does
// (./performance.js#notifyMusic), once for the Den and once for the Den Interior, and the
// feed hub (web/lib/feedHub.js) sends each stream standing in either one a fresh `music`
// frame carrying jukeboxAt()'s answer. The browser does the rest on the `room` layer.
//
// Returns `{ ok: false, error }` rather than throwing, the db/lib/slotMachine.js
// convention, so a refusal reads the same on both faces. Takes `prisma` as a parameter
// and stays off the @lifeweb/db barrel (db/lib/dm.js); require it by path.

const { postMessage } = require("./discordRest");
const { sceneLineAt } = require("./scene");
const { ambientLine } = require("./ambientLine");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { blockerFor, ACT } = require("./incapacitation");
const { logAudit } = require("./auditLog");
const { notifyMusic } = require("./performance");
const { JUKEBOX_SONGS, jukeboxSongByKey, jukeboxSongLabel } = require("./jukeboxSongs");
const { JUKEBOX_ROOM_SLUG, JUKEBOX_LOCATION_SLUGS, JUKEBOX_TEXT } = require("./jukeboxText");

function fail(error) {
  return { ok: false, error };
}

// Alive, able to act, and standing in the Bar with the door open. Re-loaded on every
// press — a web dialog and a Discord picker both outlive somebody walking out.
async function jukeboxActor(prisma, discordUserId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, tags: { include: { tag: true } } },
  });
  if (!character) return fail(JUKEBOX_TEXT.noCharacter);

  const room = await prisma.room.findUnique({
    where: { slug: JUKEBOX_ROOM_SLUG },
    select: {
      id: true,
      locationId: true,
      accessTagSlugs: true,
      discordThreadId: true,
      jukeboxSongKey: true,
      jukeboxStartedAt: true,
    },
  });
  if (!room) return fail(JUKEBOX_TEXT.noJukebox);
  if (character.locationId !== room.locationId) return fail(JUKEBOX_TEXT.notHere);

  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(JUKEBOX_TEXT.cantAct(blocker.name));

  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail(JUKEBOX_TEXT.noDoor);
  }
  return { ok: true, character, room };
}

// The Den and the Den Interior, by id — the two places a change has to reach.
async function denLocationIds(prisma) {
  const rows = await prisma.location.findMany({
    where: { slug: { in: [...JUKEBOX_LOCATION_SLUGS] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Put a song on, or turn the box off (`songKey` null). `roomId` is the room the dialog or
 * button was drawn against, checked rather than trusted; `turn` is the open Turn row, for
 * the audit stamp. Resolves to { ok, songKey, line } — `line` is what the player is told.
 */
async function setJukebox(prisma, discordUserId, { roomId = null, songKey = null, turn = null } = {}) {
  const actor = await jukeboxActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  if (roomId && roomId !== room.id) return fail(JUKEBOX_TEXT.noJukebox);

  const song = songKey ? jukeboxSongByKey(songKey) : null;
  if (songKey && !song) return fail(JUKEBOX_TEXT.noSong);
  const playing = room.jukeboxSongKey ? jukeboxSongByKey(room.jukeboxSongKey) : null;
  if (song && playing?.key === song.key) return fail(JUKEBOX_TEXT.alreadyPlaying);
  if (!song && !playing) return fail(JUKEBOX_TEXT.alreadyOff);

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: room.id },
        data: { jukeboxSongKey: song?.key ?? null, jukeboxStartedAt: song ? now : null },
      });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: song ? "jukebox_played" : "jukebox_stopped",
        targetCharacterId: character.id,
        turnId: turn?.id ?? null,
        details: { song: song?.key ?? null, title: song?.title ?? null, was: playing?.key ?? null },
        place: { locationId: room.locationId, roomId: room.id },
      });
    });
  } catch (err) {
    console.error("Jukebox write failed:", err);
    return fail(JUKEBOX_TEXT.jammed);
  }

  // The music first: the line is scenery, the song is the thing people came for.
  for (const locationId of await denLocationIds(prisma).catch(() => [])) await notifyMusic(prisma, locationId);

  const label = song ? jukeboxSongLabel(song) : null;
  const text = song ? JUKEBOX_TEXT.started(label) : JUKEBOX_TEXT.stopped;
  await sceneLineAt(prisma, { roomId: room.id, text }).catch(() => {});
  if (room.discordThreadId) {
    await postMessage(room.discordThreadId, ambientLine(text), undefined, { parse: [] }).catch(() => {});
  }

  return {
    ok: true,
    songKey: song?.key ?? null,
    line: song ? JUKEBOX_TEXT.youStarted(label) : JUKEBOX_TEXT.youStopped,
  };
}

/**
 * What the jukebox is playing for somebody standing at `locationId`: { songKey,
 * startedAt (epoch ms), quietRoomIds } in the Den or the Den Interior while a song is on,
 * null anywhere else and while it is off. `quietRoomIds` are that Location's soundproof
 * rooms, where it is heard through the wall.
 */
async function jukeboxAt(prisma, locationId) {
  if (!locationId || !prisma?.room) return null;
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { slug: true, rooms: { where: { soundproof: true }, select: { id: true } } },
  });
  if (!location || !JUKEBOX_LOCATION_SLUGS.includes(location.slug)) return null;

  const on = await songOn(prisma);
  if (!on) return null;
  return { ...on, quietRoomIds: (location.rooms ?? []).map((room) => room.id) };
}

// What the Bar's box has on, as { songKey, startedAt }, or null while it is off.
async function songOn(prisma) {
  const bar = await prisma.room.findUnique({
    where: { slug: JUKEBOX_ROOM_SLUG },
    select: { jukeboxSongKey: true, jukeboxStartedAt: true },
  });
  const song = bar?.jukeboxSongKey ? jukeboxSongByKey(bar.jukeboxSongKey) : null;
  if (!song || !bar.jukeboxStartedAt) return null;
  return { songKey: song.key, startedAt: bar.jukeboxStartedAt.getTime() };
}

/**
 * The jukebox as a GM hears it: not from where a character stands, but from whichever
 * place they have open in Chat (SOUND.md, "The Den's jukebox"). The same { songKey,
 * startedAt, quietRoomIds } as jukeboxAt, with `quietRoomIds` covering the soundproof
 * rooms of BOTH Den Locations, since a GM can be looking at either. Null while it is off.
 * The browser decides whether the place on screen is in the Den.
 */
async function denJukebox(prisma) {
  if (!prisma?.room) return null;
  const on = await songOn(prisma);
  if (!on) return null;
  const rooms = await prisma.room.findMany({
    where: { soundproof: true, location: { slug: { in: [...JUKEBOX_LOCATION_SLUGS] } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return { ...on, quietRoomIds: rooms.map((room) => room.id) };
}

module.exports = {
  JUKEBOX_ROOM_SLUG,
  JUKEBOX_LOCATION_SLUGS,
  JUKEBOX_SONGS,
  jukeboxActor,
  setJukebox,
  jukeboxAt,
  denJukebox,
  denLocationIds,
};
