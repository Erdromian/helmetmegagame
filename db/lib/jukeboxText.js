// The Den's jukebox — where it stands, who hears it, and its words, on both the Discord
// picker and the Chat dialog (docs/systemdocs/SOUND.md, "The Den's jukebox").
//
// Zero requires, on purpose, like db/lib/slotText.js: web/app/(app)/chat/PlacePanel.js
// is a client component, and db/lib/jukebox.js requires Prisma-side modules — importing
// the jukebox from the browser would drag PrismaClient into the bundle.

// The Den's Bar (docs/zones.yaml), where the box stands. Here rather than in jukebox.js so
// db/lib/placeAffordances.js can name the room without pulling the rest in behind it.
const JUKEBOX_ROOM_SLUG = "undertown-8-1";

// Who hears it: "Whichever song has been picked loops for all characters in the den"
// (docs/sounds.yaml). The Den and the basement under it, the Den Interior — every room in
// both. A soundproof room hears it through the wall, quieter and darker
// (web/app/components/InstrumentListener.js).
const JUKEBOX_LOCATION_SLUGS = Object.freeze(["undertown-8", "undertown-9"]);

const JUKEBOX_TEXT = Object.freeze({
  button: "Jukebox",
  title: "Jukebox",
  noCharacter: "You don't have a living character.",
  noJukebox: "There's no jukebox here.",
  notHere: "You're not standing in the Den's Bar.",
  noDoor: "You can't get in there.",
  cantAct: (what) => `You can't do that now — you're ${what}.`,
  noSong: "The jukebox doesn't have that song.",
  alreadyPlaying: "That song is already playing.",
  alreadyOff: "The jukebox is already off.",
  jammed: "The jukebox jammed. Try again.",

  nowPlaying: (label) => `Now playing: ${label}`,
  silent: "The jukebox is off.",
  play: "Play",
  playing: "Playing",
  turnOff: "Turn off",
  pickPrompt: "Pick a song to play on repeat.",
  pickPlaceholder: "Pick a song…",

  // What the Bar reads. Nobody is named: a box that starts playing is a thing everybody
  // in the room hears, not a thing anybody is seen doing.
  started: (label) => `The jukebox starts playing ${label}.`,
  stopped: "The jukebox goes quiet.",
  youStarted: (label) => `You put on ${label}.`,
  youStopped: "You turn the jukebox off.",
});

module.exports = { JUKEBOX_ROOM_SLUG, JUKEBOX_LOCATION_SLUGS, JUKEBOX_TEXT };
