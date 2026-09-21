// node --test over db/lib/instrumentSongs.js: every song's `src` has to resolve to a
// real file under web/public (the URL path IS the served path), and every one of those
// files has to carry a musicGain.js entry — an instrument with no measured gain plays at
// its step gain alone (musicGain.js's fallback is 1), which is the "obviously wrong"
// case that table's header exists to avoid. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { INSTRUMENT_SONGS, songByKey, songsFor } = require("../lib/instrumentSongs");

const WEB_PUBLIC = path.join(__dirname, "..", "..", "web", "public");

// musicGain.js is "use client" and JS, not JSON — read the MUSIC_GAIN object's own keys
// out of it rather than duplicating the table by hand.
const MUSIC_GAIN_SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "web", "app", "components", "musicGain.js"),
  "utf8"
);
const MUSIC_GAIN = {};
for (const m of MUSIC_GAIN_SRC.matchAll(/"([^"]+\.ogg)":\s*([0-9.]+)/g)) {
  MUSIC_GAIN[m[1]] = Number(m[2]);
}

function allSongs() {
  const out = [];
  for (const instrument of Object.keys(INSTRUMENT_SONGS)) {
    for (const song of INSTRUMENT_SONGS[instrument]) out.push({ ...song, instrument });
  }
  return out;
}

test("every instrument exists as a served file under web/public", () => {
  for (const song of allSongs()) {
    const onDisk = path.join(WEB_PUBLIC, song.src.replace(/^\//, ""));
    assert.ok(
      fs.existsSync(onDisk),
      `${song.instrument}/${song.key}: no file at web/public${song.src}`
    );
  }
});

test("every instrument has a musicGain.js entry", () => {
  for (const song of allSongs()) {
    const basename = song.src.slice(song.src.lastIndexOf("/") + 1);
    assert.ok(
      basename in MUSIC_GAIN,
      `${song.instrument}/${song.key}: "${basename}" is missing from MUSIC_GAIN`
    );
    assert.ok(
      MUSIC_GAIN[basename] > 0 && MUSIC_GAIN[basename] <= 1,
      `${song.instrument}/${song.key}: "${basename}"'s gain ${MUSIC_GAIN[basename]} is out of range`
    );
  }
});

test("keys are unique across every instrument", () => {
  const seen = new Set();
  for (const song of allSongs()) {
    assert.ok(!seen.has(song.key), `duplicate key "${song.key}"`);
    seen.add(song.key);
  }
});

test("seconds is a plausible, positive duration", () => {
  for (const song of allSongs()) {
    assert.ok(
      typeof song.seconds === "number" && song.seconds > 0,
      `${song.instrument}/${song.key}: seconds must be a positive number`
    );
  }
});

test("songByKey finds a song regardless of which instrument it belongs to", () => {
  const found = songByKey("bard1");
  assert.ok(found);
  assert.equal(found.instrument, "lute");
  assert.equal(found.name, "Bard 1");

  assert.equal(songByKey("no-such-key"), null);
});

test("songsFor flattens one or several instruments, and ignores an unknown slug", () => {
  const accordionOnly = songsFor("accordion");
  assert.equal(accordionOnly.length, INSTRUMENT_SONGS.accordion.length);
  assert.ok(accordionOnly.every((s) => s.instrument === "accordion"));

  const both = songsFor(["accordion", "lute"]);
  assert.equal(
    both.length,
    INSTRUMENT_SONGS.accordion.length + INSTRUMENT_SONGS.lute.length
  );

  assert.deepEqual(songsFor(["not-an-instrument"]), []);
});

test("the lute catalog reuses song_game.ogg rather than a private copy", () => {
  const songGame = INSTRUMENT_SONGS.lute.find((s) => s.key === "song_game");
  assert.ok(songGame);
  assert.equal(songGame.src, "/assets/music/song_game.ogg");
});
