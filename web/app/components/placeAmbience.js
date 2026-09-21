"use client";

// What a PLACE sounds like: a pool of pieces for each place. musicConductor.js decides
// WHEN one plays; this file only answers WHAT would play here. See SOUND.md §4b.
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
// NO PIECE CARRIES A LEVEL unless there is a reason. Each file's measured loudness lives
// in musicGain.js and is applied underneath, so a `gain` here means "and this one a
// little under that" — see that file's header for the tiers.
//
// SOME PLACES GET NO MUSIC, and that is a design decision rather than an oversight.
// `music: false` says the game's music does not play here at all: the Caves, the Depths,
// the Lifeweb and Space. Their whole feel is that nothing is keeping you company down
// there, and a tune turning up says the opposite.

const A = "/assets/ambience/";

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
function place(id, pieces, { music = true } = {}) {
  return { id, music, pieces };
}

const CHAPEL = ["ambicha1.ogg", "ambicha2.ogg", "ambicha3.ogg", "ambicha4.ogg"].map((f) => once(f));

// ------------------------------------------------------------------------ what plays where
//
// Slugs are from docs/zones.yaml. A Location wins over its Zone, a Zone over a bare
// `indoors`. Add a place by adding a line; nothing below is a special case in code.

const BY_LOCATION = {
  // The Keep and the Inn both have a fire going, and it is the same fire.
  "fortress-4": place("keep", [loop("newfireloop.ogg", { spanMs: [120_000, 240_000] })]),
  "town-7": place("inn", [loop("newfireloop.ogg", { spanMs: [120_000, 240_000] })]),

  // The Cathedral and the Order Chambers are the same stone and the same silence.
  "town-4": place("cathedral", CHAPEL),
  "undertown-b": place("order", CHAPEL),

  "town-9": place("sanctuary", [once("pathologic.ogg")]),

  // The Lake. `shore` runs a handful of times and then leaves you with the quiet, which
  // is more like standing at water than a permanent wash of it would be.
  "undertown-c": place("lake", [loop("shore.ogg")]),

  // The Tower. No music here at all: how much Blood is in it is the secret the place is
  // built around, and a tune over that is a tune over the wrong thing.
  "undertown-3": place("lifeweb", [once("lifeweb2b.ogg")], { music: false }),

  // The Godard Factory. Bascinet's note: this one runs hot, so it takes a trim on top of
  // its measured level.
  factory: place("factory", [loop("ambieng1.ogg", { gain: 0.9 })]),

  // The Depot, only while the train is actually standing at the platform — see
  // `trainFresh` in web/lib/gamePhase.js.
  "undertown-5": place("depot-train", [loop("train_loop.ogg", { spanMs: [60_000, 110_000] })]),
};

const BY_ZONE = {
  hills: place("hills", [once("ambimine.ogg"), loop("ambi2.ogg")]),
  // One location, off the map.
  space: place("space", [once("ambispace.ogg")], { music: false }),
  // The two cave levels are their own Zone rows (kind CAVE_LEVEL) under `underground`.
  caves: place(
    "caves",
    [loop("spookymaint1.ogg"), loop("ambi2.ogg"), once("spookyspace1.ogg"), once("beyondretrieval.ogg")],
    { music: false },
  ),
  depths: place("depths", [loop("ambigen12.ogg"), loop("ambigen11.ogg"), once("spookyspace2.ogg")], {
    music: false,
  }),
};

// Ordered, not an object: a Location may carry several attributes and the order is the
// answer. Keys are from db/lib/locationAttributes.js.
const BY_ATTRIBUTE = [["offMap", BY_ZONE.space]];

const INDOORS = place("indoors", [once("outpost.ogg"), once("track3.ogg"), once("track13.ogg")]);

// The wind. Served from /assets/music/ because the closed-door tape has always named the
// files there.
const OUTDOORS = place(
  "outdoors",
  ["wind_4_2.ogg", "wind_5_1.ogg", "wind_4_1.ogg", "wind_2_2.ogg", "wind_3_1.ogg", "wind_2_1.ogg"].map(
    (f) => loop(`/assets/music/${f}`, { spanMs: [40_000, 90_000] }),
  ),
);

/**
 * The pool for where somebody is standing: `{ id, music, pieces }`, or null if they are
 * standing nowhere (no character, or the payload has not landed). Most specific wins.
 */
export function resolveAmbience(standing) {
  if (!standing) return null;
  const { locationSlug, zoneSlug, indoors, attributes = [], trainFresh } = standing;

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
