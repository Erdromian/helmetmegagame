// The Den's jukebox (docs/systemdocs/SOUND.md, "The Den's jukebox"): who may work it, what
// a change writes and who hears about it, and what a listener standing somewhere is told. A
// fake prisma records the writes; nothing here needs a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { JUKEBOX_SONGS, jukeboxSongByKey, jukeboxSongLabel } = require("../lib/jukeboxSongs");
const { JUKEBOX_ROOM_SLUG, JUKEBOX_LOCATION_SLUGS, JUKEBOX_TEXT } = require("../lib/jukeboxText");
const { setJukebox, jukeboxAt } = require("../lib/jukebox");

const ROOT = path.resolve(__dirname, "..", "..");
const BAR = { id: "bar", locationId: "den", accessTagSlugs: [], discordThreadId: null };
const DEN = { id: "den", slug: "undertown-8" };
const BASEMENT = { id: "basement", slug: "undertown-9" };
const STREET = { id: "street", slug: "undertown-a" };

function fakePrisma({ character = { id: "c1", locationId: "den", tags: [] }, bar = {}, fail = false } = {}) {
  const state = { ...BAR, jukeboxSongKey: null, jukeboxStartedAt: null, ...bar };
  const calls = { updates: [], audits: [], notifies: [] };
  const locations = { den: DEN, basement: BASEMENT, street: STREET };
  const soundproof = { basement: [{ id: "office" }] };
  const db = {
    character: { findFirst: async () => character },
    room: {
      findUnique: async ({ where }) => (where.slug === JUKEBOX_ROOM_SLUG || where.id === "bar" ? { ...state } : null),
      update: async ({ data }) => {
        if (fail) throw new Error("boom");
        calls.updates.push(data);
        Object.assign(state, data);
        return state;
      },
    },
    location: {
      findMany: async ({ where }) =>
        Object.values(locations).filter((l) => where.slug.in.includes(l.slug)).map((l) => ({ id: l.id })),
      findUnique: async ({ where }) => {
        const l = locations[where.id];
        return l ? { slug: l.slug, rooms: soundproof[l.id] ?? [] } : null;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        calls.audits.push(data);
        return { id: `a${calls.audits.length}`, ...data };
      },
    },
    // The archive filing logAudit does; nothing here reads it back.
    archiveEntry: { create: async () => ({}) },
    characterTag: { findMany: async () => [] },
    roomGuest: { findMany: async () => [] },
    quest: { findMany: async () => [] },
    gameState: { findUnique: async () => null, findFirst: async () => null },
    $transaction: async (fn) => fn(db),
    $executeRaw: async (strings, channel, payload) => {
      calls.notifies.push(JSON.parse(payload).placeKey);
    },
    $queryRaw: async () => [],
  };
  return { db, calls, state };
}

test("the catalog is the document's eleven songs, each served and unique", () => {
  assert.equal(JUKEBOX_SONGS.length, 11);
  const keys = new Set(JUKEBOX_SONGS.map((s) => s.key));
  assert.equal(keys.size, JUKEBOX_SONGS.length, "song keys must be unique");
  for (const song of JUKEBOX_SONGS) {
    assert.ok(song.src.startsWith("/assets/den/"), `${song.key} is served from ${song.src}`);
    assert.ok(fs.existsSync(path.join(ROOT, "web", "public", song.src)), `${song.src} is missing`);
    assert.ok(song.seconds > 0);
  }
});

test("every song has a measured gain", () => {
  const gains = fs.readFileSync(path.join(ROOT, "web", "app", "components", "musicGain.js"), "utf8");
  for (const song of JUKEBOX_SONGS) {
    const name = song.src.slice(song.src.lastIndexOf("/") + 1);
    assert.ok(gains.includes(`"${name}":`), `${name} is not in musicGain.js`);
  }
});

test("a song is named by its number in the document", () => {
  assert.deepEqual(JUKEBOX_SONGS.map(jukeboxSongLabel), JUKEBOX_SONGS.map((_, i) => `Song ${i + 1}`));
  assert.equal(jukeboxSongLabel(jukeboxSongByKey("blue-monday")), "Song 1");
  assert.equal(jukeboxSongByKey("nope"), null);
});

test("putting a song on writes it, audits it and tells both Den Locations", async () => {
  const { db, calls, state } = fakePrisma();
  const res = await setJukebox(db, "u1", { roomId: "bar", songKey: "it-kills" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.line, JUKEBOX_TEXT.youStarted("Song 9"));
  assert.equal(state.jukeboxSongKey, "it-kills");
  assert.ok(state.jukeboxStartedAt instanceof Date);
  assert.equal(calls.audits[0].actionType, "jukebox_played");
  assert.deepEqual(calls.notifies.sort(), ["loc:basement", "loc:den"]);
});

test("changing the song restarts its clock", async () => {
  const before = new Date(Date.now() - 60_000);
  const { db, state } = fakePrisma({ bar: { jukeboxSongKey: "blue-monday", jukeboxStartedAt: before } });
  const res = await setJukebox(db, "u1", { roomId: "bar", songKey: "red-blood" });
  assert.equal(res.ok, true);
  assert.equal(state.jukeboxSongKey, "red-blood");
  assert.ok(state.jukeboxStartedAt > before);
});

test("turning it off clears both columns", async () => {
  const { db, calls, state } = fakePrisma({ bar: { jukeboxSongKey: "blue-monday", jukeboxStartedAt: new Date() } });
  const res = await setJukebox(db, "u1", { roomId: "bar", songKey: null });
  assert.equal(res.ok, true);
  assert.equal(res.line, JUKEBOX_TEXT.youStopped);
  assert.equal(state.jukeboxSongKey, null);
  assert.equal(state.jukeboxStartedAt, null);
  assert.equal(calls.audits[0].actionType, "jukebox_stopped");
});

test("refusals write nothing", async () => {
  const cases = [
    [{ bar: { jukeboxSongKey: "blue-monday", jukeboxStartedAt: new Date() } }, { songKey: "blue-monday" }, JUKEBOX_TEXT.alreadyPlaying],
    [{}, { songKey: null }, JUKEBOX_TEXT.alreadyOff],
    [{}, { songKey: "not-a-song" }, JUKEBOX_TEXT.noSong],
    [{ character: null }, { songKey: "it-kills" }, JUKEBOX_TEXT.noCharacter],
    [{ character: { id: "c1", locationId: "street", tags: [] } }, { songKey: "it-kills" }, JUKEBOX_TEXT.notHere],
    [{}, { roomId: "casino", songKey: "it-kills" }, JUKEBOX_TEXT.noJukebox],
  ];
  for (const [setup, args, error] of cases) {
    const { db, calls } = fakePrisma(setup);
    const res = await setJukebox(db, "u1", { roomId: "bar", ...args });
    assert.deepEqual(res, { ok: false, error }, JSON.stringify(args));
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.notifies.length, 0);
  }
});

test("a failed write is a jam, and nobody is told", async () => {
  const { db, calls } = fakePrisma({ fail: true });
  const res = await setJukebox(db, "u1", { roomId: "bar", songKey: "it-kills" });
  assert.deepEqual(res, { ok: false, error: JUKEBOX_TEXT.jammed });
  assert.equal(calls.notifies.length, 0);
});

test("it is heard in the Den and the Den Interior, and nowhere else", async () => {
  const startedAt = new Date("2026-09-28T20:00:00Z");
  const { db } = fakePrisma({ bar: { jukeboxSongKey: "navy-light", jukeboxStartedAt: startedAt } });
  assert.deepEqual(await jukeboxAt(db, "den"), { songKey: "navy-light", startedAt: startedAt.getTime(), quietRoomIds: [] });
  // The Exactor's Office is soundproof: heard through the wall.
  assert.deepEqual((await jukeboxAt(db, "basement")).quietRoomIds, ["office"]);
  assert.equal(await jukeboxAt(db, "street"), null);
  assert.equal(await jukeboxAt(db, null), null);
  assert.deepEqual([...JUKEBOX_LOCATION_SLUGS], [DEN.slug, BASEMENT.slug]);
});

test("off, or a key that is no longer a song, is silence", async () => {
  assert.equal(await jukeboxAt(fakePrisma().db, "den"), null);
  const { db } = fakePrisma({ bar: { jukeboxSongKey: "retired", jukeboxStartedAt: new Date() } });
  assert.equal(await jukeboxAt(db, "den"), null);
});
