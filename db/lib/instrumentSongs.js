// What a lute, an accordion or a boombox can play — the `player`/`room` layers of the
// music bus (docs/systemdocs/SOUND.md §3). Each entry names a file under
// web/public/assets/instruments/<instrument>/, encoded by scripts/audio/build-assets.sh
// from assets/osw-sounds/instruments/<instrument>/ and measured into
// web/app/components/musicGain.js at the -26 LUFS tier (music, a jukebox, an instrument).
//
// No requires in this file, ever — it is reachable from a client component (the song
// picker for a jukebox or an instrument), and one require of @lifeweb/db here would drag
// PrismaClient into the browser bundle. Same rule as db/lib/dmKinds.js and db/lib/sfx.js.
//
// `key` is stable and unique across every instrument (never just within one), because a
// `player`/`room` layer step names a song by key alone with no instrument alongside it.
// `seconds` is the file's own duration (ffprobe, rounded to 0.1) — musicProgram.js's
// step runner reads `fadeOutMs` off `duration` once metadata lands rather than trusting a
// hand-typed number, but a picker UI showing "3:57" before the element has loaded needs
// this.

// EVERY `name` BELOW IS BASCINET'S OWN, out of the design document by way of
// docs/sounds.yaml, and carried across verbatim rather than title-cased. They used to be
// derived from the filename — "B1", "Bard 3", "Newbar 46" — which told a player nothing
// about what they were about to play. `key` is untouched: a Performance row names a song by
// key, so renaming one would orphan a live performance.
const INSTRUMENT_SONGS = {
  accordion: [
    { key: "b1", name: "Salar song, Korobeiniki", src: "/assets/instruments/accordion/b1.ogg", seconds: 97.4 },
    { key: "b2", name: "Mortal Kombat theme", src: "/assets/instruments/accordion/b2.ogg", seconds: 50.8 },
    { key: "b3", name: "Wistful tune", src: "/assets/instruments/accordion/b3.ogg", seconds: 133.0 },
    { key: "b4", name: "Carnival Waltz", src: "/assets/instruments/accordion/b4.ogg", seconds: 142.6 },
    { key: "b5", name: "Caver Shanty", src: "/assets/instruments/accordion/b5.ogg", seconds: 113.0 },
    { key: "b6", name: "Sounds like shit", src: "/assets/instruments/accordion/b6.ogg", seconds: 17.4 },
    { key: "b7", name: "Song of heroism", src: "/assets/instruments/accordion/b7.ogg", seconds: 93.5 },
    { key: "b8", name: "Merry Dance", src: "/assets/instruments/accordion/b8.ogg", seconds: 42.8 },
  ],

  // Six files, which is exactly what the document's lute table lists. `song_game` used to
  // be a seventh, borrowed out of web/public/assets/music/; the document gives that file to
  // the inn instead ("Ambience within the inn"), so it is the inn's now and not the lute's.
  lute: [
    {
      key: "balalaika1",
      name: "A rising salar tune for dance",
      src: "/assets/instruments/lute/balalaika1.ogg",
      seconds: 90.2,
    },
    { key: "bard1", name: "A soothing melody", src: "/assets/instruments/lute/bard1.ogg", seconds: 38.2 },
    { key: "bard2", name: "Every strum cuts deep", src: "/assets/instruments/lute/bard2.ogg", seconds: 40.5 },
    { key: "bard3", name: "Peaceful sleep takes all", src: "/assets/instruments/lute/bard3.ogg", seconds: 36.5 },
    { key: "bard4", name: "A lively serenade", src: "/assets/instruments/lute/bard4.ogg", seconds: 25.6 },
    {
      key: "bard5",
      name: "Compelling schemes and revelations",
      src: "/assets/instruments/lute/bard5.ogg",
      seconds: 105.2,
    },
  ],

  // A boombox is the one instrument playing somebody ELSE's recording rather than a
  // performance of its own, so its catalog is songs rather than instrument samples — and
  // the document names them from inside the setting, which is why a real-world title like
  // Space Oddity reads here as "A tape floating in space".
  boombox: [
    { key: "newbar3", name: "Dance hall groove", src: "/assets/instruments/boombox/newbar3.ogg", seconds: 165.1 },
    { key: "newbar46", name: "Den song", src: "/assets/instruments/boombox/newbar46.ogg", seconds: 187.5 },
    {
      key: "newbar59",
      name: "All Pigs Must Die, Den song",
      src: "/assets/instruments/boombox/newbar59.ogg",
      seconds: 180.0,
    },
    { key: "newbar9", name: "Den song", src: "/assets/instruments/boombox/newbar9.ogg", seconds: 242.6 },
    { key: "ainda-e-cedo", name: "Blackstone pop", src: "/assets/instruments/boombox/ainda-e-cedo.ogg", seconds: 237.8 },
    {
      key: "boate-azul",
      name: "Blackstone romantic song",
      src: "/assets/instruments/boombox/boate-azul.ogg",
      seconds: 200.2,
    },
    {
      key: "como-eu-quero",
      name: "Blackstone soft rock",
      src: "/assets/instruments/boombox/como-eu-quero.ogg",
      seconds: 252.3,
    },
    {
      key: "cowboy-fora-da-lei",
      name: "Blackstone Country",
      src: "/assets/instruments/boombox/cowboy-fora-da-lei.ogg",
      seconds: 214.9,
    },
    {
      key: "fixacao",
      name: "Blackstone mainstream slop",
      src: "/assets/instruments/boombox/fixacao.ogg",
      seconds: 381.5,
    },
    {
      key: "metamorfose-ambulante",
      name: "Blackstone strumming",
      src: "/assets/instruments/boombox/metamorfose-ambulante.ogg",
      seconds: 227.6,
    },
    {
      key: "solidao-de-volta",
      name: "Blackstone Overdose",
      src: "/assets/instruments/boombox/solidao-de-volta.ogg",
      seconds: 162.1,
    },
    { key: "boombox10", name: "A country deluge", src: "/assets/instruments/boombox/boombox10.ogg", seconds: 193.6 },
    { key: "boombox3", name: "A decrepit tape", src: "/assets/instruments/boombox/boombox3.ogg", seconds: 127.8 },
    { key: "boombox4", name: "Lord of the Game", src: "/assets/instruments/boombox/boombox4.ogg", seconds: 202.1 },
    { key: "boombox8", name: "Gahan Techno", src: "/assets/instruments/boombox/boombox8.ogg", seconds: 200.9 },
    {
      key: "space_asshole",
      name: "A long forgotten song, amongst the stars",
      src: "/assets/instruments/boombox/space_asshole.ogg",
      seconds: 256.2,
    },
    {
      key: "space_oddity",
      name: "A tape floating in space",
      src: "/assets/instruments/boombox/space_oddity.ogg",
      seconds: 318.0,
    },
    {
      key: "title1",
      name: "Another day on the station",
      src: "/assets/instruments/boombox/title1.ogg",
      seconds: 150.6,
    },
    { key: "csrio", name: "Blackstone Hooliganry", src: "/assets/instruments/boombox/csrio.ogg", seconds: 166.0 },
    { key: "clown", name: "Honk", src: "/assets/instruments/boombox/clown.ogg", seconds: 107.3 },
    { key: "clouds", name: "Heretical New wave", src: "/assets/instruments/boombox/clouds.ogg", seconds: 176.3 },
    {
      key: "fuckup",
      name: "Experimental Ginkese music",
      src: "/assets/instruments/boombox/fuckup.ogg",
      seconds: 335.7,
    },
    { key: "indihome", name: "Rahalian brainrot", src: "/assets/instruments/boombox/indihome.ogg", seconds: 30.7 },
  ],
};

/** One song by its key, regardless of which instrument's list it lives in. Null if no
 * song carries that key — a step naming a retired or mistyped key should play nothing,
 * not the wrong song. */
function songByKey(key) {
  for (const instrument of Object.keys(INSTRUMENT_SONGS)) {
    const song = INSTRUMENT_SONGS[instrument].find((entry) => entry.key === key);
    if (song) return { ...song, instrument };
  }
  return null;
}

/** Every song for the given instrument slug(s), each carrying its own `instrument` —
 * flattened, so a picker over several instruments (or a single one) gets one list. An
 * unknown slug contributes nothing rather than throwing. */
function songsFor(slugs) {
  const list = Array.isArray(slugs) ? slugs : [slugs];
  const out = [];
  for (const instrument of list) {
    const songs = INSTRUMENT_SONGS[instrument];
    if (!songs) continue;
    for (const song of songs) out.push({ ...song, instrument });
  }
  return out;
}

module.exports = { INSTRUMENT_SONGS, songByKey, songsFor };
