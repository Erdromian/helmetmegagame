"use client";

// What a PLACE sounds like: a bed for each place, and the spots laid over it.
// musicConductor.js decides WHEN one plays; this file only answers WHAT would play here.
// See SOUND.md §4b.
//
// EVERY PLACEMENT BELOW COMES OUT OF docs/sounds.yaml, which is Bascinet's "Music and
// Sounds" document. A use case is quoted beside each one, because the sentence is the
// reason the file is here and the filename is not: `ambimine.ogg` sounds like it belongs in
// a mine and the document puts it in space, which is the sort of thing this file used to get
// wrong. `npm run sounds:report` is what notices when a placement drifts from its sentence.
//
// A piece is one of two things, and the difference is whether the file has an end.
//
// A file that has an END plays once, start to finish, and is never cut off. The Cathedral's
// organ room, a drip in the Lifeweb, a six-minute drone. Short or long does not matter.
//
// A file that is a TEXTURE — a three-second fire, a wind gust, an idling engine — has no
// end of its own, so it loops for a minute or two and then fades out. That fade is the end
// it was always going to have, not an interruption.
//
// TWO KINDS OF POOL, and the split is the document's own:
//
//   `beds`  — class `ambience`. A longer track, seamlessly looped, with silence still most
//             of the background. One at a time, on the `ambient` layer.
//   `spots` — class `atop`. "Short sounds which add to the atmosphere, often suited for
//             very specific circumstances", played OVER the bed on the `spot` layer rather
//             than in place of it. A gull does not silence the shore.
//
// NO PIECE CARRIES A LEVEL unless there is a reason. Each file's measured loudness lives in
// musicGain.js, at the bed tier or four decibels up at the spot tier, and is applied
// underneath — so a `gain` here means "and this one a little under that".
//
// THERE IS NO `music: false` ANY MORE. It used to keep the general music rotation out of the
// Caves, the Depths, the Lifeweb and Space; there is no rotation to keep out, and each of
// those places has a bed of its own below.

const A = "/assets/ambience/";
const M = "/assets/music/";

// --------------------------------------------------------------------------- the pieces

/** A file with an end: plays once, all the way through. */
function once(file, { gain } = {}) {
  return { src: file.startsWith("/") ? file : `${A}${file}`, loop: false, gain };
}

/** A texture: loops for `spanMs`, then fades out over its tail. */
function loop(file, { gain, spanMs = [60_000, 150_000] } = {}) {
  return { src: file.startsWith("/") ? file : `${A}${file}`, loop: true, gain, spanMs };
}

/** A place's pool. Built once at module load, so a walk between two caves is one object. */
function place(id, beds, spots = []) {
  return { id, pieces: beds, spots };
}

// ------------------------------------------------------------------------ shared pools
//
// "Played atop ambience in hallowed places", and the one alternative and one different pitch
// the document gives them. Spots rather than beds: the Cathedral's tone arrives over the
// stone, it is not the stone.
const CHAPEL_SPOTS = ["ambicha2.ogg", "ambicha3.ogg", "ambicha4.ogg", "ambicha1.ogg"].map((f) => once(f));

// There is no fire here on purpose. `newfireloop.ogg` is far too intense for a hearth or a
// brazier, so it is kept for a fire that is out of control (docs/sounds.yaml, `needs`).

// "Played atop ambience, quiet wind" through to "moderately loud but high pitch wind".
// Served out of /assets/music/ because the closed-door tape has always named them there.
const WIND_SPOTS = [
  "wind_2_2.ogg",
  "wind_2_1.ogg",
  "wind_4_2.ogg",
  "wind_3_1.ogg",
  "wind_4_1.ogg",
  "wind_5_1.ogg",
].map((f) => loop(`${M}${f}`, { spanMs: [20_000, 45_000] }));

// ------------------------------------------------------------------------ what plays where
//
// Slugs are from docs/zones.yaml. A Room wins over its Location, a Location over its Zone,
// a Zone over a bare `indoors`. Add a place by adding a line; nothing below is a special case
// in code.

const BY_LOCATION = {
  // "Ambience within the inn". `song_game` used to be the lobby's song and was the lute's
  // as well; it is the inn's now, which is the only thing the document ever says about it.
  "town-7": place("inn", [once(`${M}song_game.ogg`)]),
  "fortress-4": place("keep", [loop("loop_airy1.ogg", { spanMs: [120_000, 240_000] })]),

  // "Ambience within the cathedral". The Order Chambers are the same stone and the same
  // silence, so they get the same pool.
  "town-4": place("cathedral", [once("sacred_dagger.ogg")], CHAPEL_SPOTS),
  "undertown-b": place("order", [once("sacred_dagger.ogg")], CHAPEL_SPOTS),

  // "Ambience" — the one music-folder file the document leaves unqualified, and the
  // Sanctuary is where it has always played.
  "town-9": place("sanctuary", [once("pathologic.ogg")]),

  // "Ambience in proximity to shore and body of water". It runs a handful of times and then
  // leaves you with the quiet, which is more like standing at water than a permanent wash
  // of it would be.
  "undertown-c": place("lake", [loop("shore.ogg")]),

  // "Ambience in proximity to the lifeweb as it feeds." No music of its own kind here: how
  // much Blood is in the Tower is the secret the place is built around.
  "undertown-3": place("lifeweb", [once("lifeweb2b.ogg")]),

  // "Ambience of a running steam engine." Bascinet's note: this one runs hot, so it takes a
  // trim on top of its measured level.
  factory: place("factory", [loop("ambieng1.ogg", { gain: 0.9 })]),

  // "Looping sound of moving train" — only while the train is actually standing at the
  // platform, which is `trainFresh` in web/lib/gamePhase.js.
  "undertown-5": place("depot-train", [loop("train_loop.ogg", { spanMs: [60_000, 110_000] })]),
};

const BY_ZONE = {
  // "Ambience in the fortress."
  fortress: place("fortress", [loop("loop_airy1.ogg")], WIND_SPOTS),

  // "Ambience while walking around town/underfort", which is both of these, and "Ambience
  // in the underfort" for the one below the other.
  town: place("town", [loop("ambigen6.ogg")], WIND_SPOTS),
  undertown: place("undertown", [loop("loop_altar.ogg"), loop("ambigen6.ogg")]),

  // "Ambience in space" — twice, for two files. ambimine is here and not in the mine: the
  // mine was a reading of its filename.
  space: place("space", [once("ambispace.ogg"), once("ambimine.ogg")], [once("ambigen12.ogg")]),

  // The two cave levels are their own Zone rows (kind CAVE_LEVEL) under `underground`.
  // "Ambience in the caves" and "Ambience in treacherous locations".
  caves: place("caves", [once("to_hell.ogg"), loop("spookymaint1.ogg"), once("spookyspace1.ogg")]),
  depths: place("depths", [once("spookyspace2.ogg"), loop("spookymaint1.ogg")], [once("ambigen11.ogg")]),

  // Nothing is keeping you company down there. The Hills have no bed of their own in the
  // document, so they get the surface's.
  hills: place("hills", [once(`${M}surfacing.ogg`)], WIND_SPOTS),
};

// A ROOM is heard only while Chat has it open (heardPlace.js), because a character stands in
// a Location and READS a room — there is no room column to ask. So a room here is a pool
// that replaces its Location's while you are reading it, and every other room at the
// Location keeps the Location's. Only rooms that sound different belong in this table.
//
// Empty for now. It was built for the fire in the Inn's Bar, the Throne Room and the Firepit,
// and the fire came out of the ambience altogether (see above).
const BY_ROOM = {};

// Ordered, not an object: a Location may carry several attributes and the order is the
// answer. Keys are from db/lib/locationAttributes.js.
const BY_ATTRIBUTE = [
  ["offMap", place("charon", [loop("charon_loop.ogg")])], // "Ambience in proximity to charon"
  ["space", BY_ZONE.space],
];

// "Played atop ambience underground" has no bed of its own, so indoors keeps the underfort's.
const INDOORS = place("indoors", [loop("ambigen6.ogg"), loop("loop_altar.ogg")]);

// "Ambience on the surface", with the winds over it.
const OUTDOORS = place("outdoors", [once(`${M}surfacing.ogg`)], WIND_SPOTS);

// WHAT THE LISTENER IS, rather than where they are. Both of these outrank the place, because
// the document writes them as conditions on the person: "Ambience while in pain shock or
// sedated" is true wherever they are standing.
const IMPAIRED = place("impaired", [loop("ambi2.ogg")]);
// "Ambience in town when character mood is low."
const TOWN_LOW = place("town-low", [loop("loop_airy4.ogg")], WIND_SPOTS);

// Every pool in this file, for tooling. scripts/audio/sound-report.mjs reads it to tell a
// BED from a SPOT, which it cannot do by looking at the source: both are `once()`/`loop()`
// calls and only their position in `place()` says which. This file imports nothing, so a
// plain Node script can load it the way sim-schedule.mjs loads musicSchedule.js.
export const ALL_PLACES = [
  ...Object.values(BY_ROOM),
  ...Object.values(BY_LOCATION),
  ...Object.values(BY_ZONE),
  ...BY_ATTRIBUTE.map(([, p]) => p),
  INDOORS,
  OUTDOORS,
  IMPAIRED,
  TOWN_LOW,
];

/**
 * The pool for where somebody is standing: `{ id, pieces, spots }`, or null if they are
 * standing nowhere (no character, or the payload has not landed). Most specific wins, and
 * what the listener IS wins over that.
 *
 * `heardKey` is the place key Chat has open (`room:<id>`, `loc:<id>`, …) or null. It only
 * counts when it names a room at the Location they stand in — `standing.rooms` is exactly
 * those, id to slug — so a key left over from somewhere they have since walked out of
 * falls through to the Location.
 */
export function resolveAmbience(standing, heardKey = null) {
  if (!standing) return null;
  const { locationSlug, zoneSlug, indoors, attributes = [], trainFresh, moodTone, impaired, rooms } = standing;

  // Read first: a character in pain shock hears that and not the room.
  if (impaired) return IMPAIRED;
  if (moodTone === "bad" && zoneSlug === "town") return TOWN_LOW;

  const roomSlug = heardKey?.startsWith("room:") ? rooms?.[heardKey.slice("room:".length)] : null;
  if (roomSlug && BY_ROOM[roomSlug]) return BY_ROOM[roomSlug];

  if (locationSlug === "undertown-5" && !trainFresh) {
    // The rails are empty. The Depot is indoors and gets what any cellar gets.
    return INDOORS;
  }
  if (locationSlug && BY_LOCATION[locationSlug]) return BY_LOCATION[locationSlug];
  for (const [key, answer] of BY_ATTRIBUTE) {
    if (attributes.includes(key)) return answer;
  }
  if (zoneSlug && BY_ZONE[zoneSlug]) return BY_ZONE[zoneSlug];
  return indoors ? INDOORS : OUTDOORS;
}
