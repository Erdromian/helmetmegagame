// What the Den's jukebox can play — the `room` layer of the music bus
// (docs/systemdocs/SOUND.md §3 and "The Den's jukebox"). Each entry names a file under
// web/public/assets/den/, encoded by scripts/audio/build-assets.sh (its DEN list) from
// assets/osw-sounds/den/ and measured into web/app/components/musicGain.js at the
// -26 LUFS tier.
//
// No requires in this file, ever — the jukebox dialog in Chat is a client component and
// reads this list, and one require of @lifeweb/db here would drag PrismaClient into the
// browser bundle. Same rule as db/lib/instrumentSongs.js.
//
// In the design document's order, and named the way it names them: Song 1 to Song 11
// (docs/sounds.yaml, class `jukebox`). Bascinet's call — the player sees the number, not
// the recording's real title.
//
// `key` is stable: Room.jukeboxSongKey names a song by key, so renaming one would silence
// a jukebox that is playing it. `seconds` is the served file's own duration, rounded to
// 0.1, for the picker — the loop itself runs off the element's real `duration`.
const JUKEBOX_SONGS = Object.freeze([
  { key: "blue-monday", name: "Song 1", src: "/assets/den/blue-monday.ogg", seconds: 273.0 },
  { key: "into-the-void", name: "Song 2", src: "/assets/den/into-the-void.ogg", seconds: 210.9 },
  { key: "red-blood", name: "Song 3", src: "/assets/den/red-blood.ogg", seconds: 244.1 },
  {
    key: "change-in-the-house-of-flies",
    name: "Song 4",
    src: "/assets/den/change-in-the-house-of-flies.ogg",
    seconds: 299.5,
  },
  { key: "i-love-you-mary-jane", name: "Song 5", src: "/assets/den/i-love-you-mary-jane.ogg", seconds: 232.4 },
  { key: "hardly-wait", name: "Song 6", src: "/assets/den/hardly-wait.ogg", seconds: 196.5 },
  { key: "navy-light", name: "Song 7", src: "/assets/den/navy-light.ogg", seconds: 189.4 },
  { key: "lsd-truth", name: "Song 8", src: "/assets/den/lsd-truth.ogg", seconds: 268.1 },
  { key: "it-kills", name: "Song 9", src: "/assets/den/it-kills.ogg", seconds: 268.1 },
  { key: "loose-ends", name: "Song 10", src: "/assets/den/loose-ends.ogg", seconds: 119.8 },
  { key: "night-creature", name: "Song 11", src: "/assets/den/night-creature.ogg", seconds: 131.8 },
]);

/** One song by its key, or null — a retired or mistyped key plays nothing, not the wrong song. */
function jukeboxSongByKey(key) {
  return JUKEBOX_SONGS.find((song) => song.key === key) ?? null;
}

/** What a player reads for a song: "Song 1". */
function jukeboxSongLabel(song) {
  return song?.name ?? "";
}

module.exports = { JUKEBOX_SONGS, jukeboxSongByKey, jukeboxSongLabel };
