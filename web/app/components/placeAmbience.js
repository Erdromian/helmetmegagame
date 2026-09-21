"use client";

// What a PLACE sounds like. The tapes here are walked by musicProgram.js#runProgram, the
// same runner the phase tapes use — see its header for the step vocabulary.
//
// Two shapes, and the difference between them is the whole design.
//
// A BED is a long file, looped, very quiet, held for minutes and then crossfaded into a
// sibling. It is what a room with a sound of its own gets: the Depths hum, the Factory
// grinds, the Keep's fire crackles. You should be able to forget a bed is on. If you
// notice it, it is too loud.
//
// A SPOT is a short file and then minutes of NOTHING. The Cathedral's organ room every
// few minutes; a drip in the Lifeweb. It is the older, better trick — a sound that
// arrives out of silence is heard properly, where the same sound on a loop stops being
// heard at all after the second pass. SS13 has run its generic ambience this way for
// years and it is still the thing people remember about the sound of that game.
//
// WHICH SHAPE A FILE WANTS IS DECIDED BY HOW LONG IT IS, and the rule is written down so
// the next person does not have to guess:
//
//   under 20 s   a SPOT, with a 3-7 minute gap. Short means it cannot loop without the
//                seam showing, and a thing you hear every five minutes stays a thing.
//   20-60 s      one pass, then 60-150 s of nothing. Long enough to sit in, too short to
//                live under a conversation.
//   60 s and up  a BED. Loop it, hold it for minutes, crossfade to a sibling.
//
// EVERY GAP IS A RANGE, never a number. The Cathedral exactly every five minutes is a
// clock, and scenery must not sound like a clock. `roll()` in musicProgram.js is what
// makes a range a range.
//
// NO STEP CARRIES A LEVEL unless there is a reason. Each file's measured loudness lives
// in musicGain.js and is applied underneath, so a `gain` here means "and this one a
// little under that" — see that file's header for the tiers.
//
// SOME PLACES GET NO MUSIC, and that is a design decision rather than an oversight.
// `music: false` says the general rotation does not play here at all: the Caves, the
// Depths, the Lifeweb and Space. Their whole feel is that nothing is keeping you company
// down there, and a tune arriving every few minutes says the opposite. Everywhere else
// gets the rotation over the top of its bed.

const A = "/assets/ambience/";

// --------------------------------------------------------------------------- the shapes

/** A long file, looped quietly, swapped for a sibling every few minutes. */
function bed(id, files, { holdMs = [240_000, 420_000], gain, music = true } = {}) {
  return {
    music,
    program: {
      id,
      layer: "ambient",
      steps: [
        {
          id: `${id}-bed`,
          pick: files.map((f) => `${A}${f}`),
          loop: true,
          gain,
          fadeInMs: 4000,
          holdMs,
          fadeOutMs: 4000,
          // Fetched while the current bed is still playing, so the crossfade into the
          // next one is a crossfade and not a pause with a fade on either side of it.
          warmAtMs: [180_000, 200_000],
        },
        { goto: 0 },
      ],
    },
  };
}

/** One short file, then minutes of nothing, then another. */
function spots(id, files, { silenceMs = [180_000, 420_000], gain, music = true } = {}) {
  return {
    music,
    program: {
      id,
      layer: "ambient",
      steps: [
        {
          id: `${id}-spot`,
          pick: files.map((f) => `${A}${f}`),
          // A range, so the same drip is not always the same distance away.
          gain: gain ?? [0.75, 1],
          fadeInMs: 1500,
          fadeOutMs: 2000,
        },
        { silenceMs, fadeOutMs: 2000 },
        { goto: 0 },
      ],
    },
  };
}

/** A medium file: one pass, a gap, another. Between a bed and a spot. */
function passes(id, files, { silenceMs = [60_000, 150_000], gain, music = true } = {}) {
  return {
    music,
    program: {
      id,
      layer: "ambient",
      steps: [
        {
          id: `${id}-pass`,
          pick: files.map((f) => `${A}${f}`),
          loop: true,
          gain,
          fadeInMs: 3000,
          // Four to six times round a thirty-second loop, then let it go.
          holdMs: [120_000, 180_000],
          fadeOutMs: 4000,
        },
        { silenceMs, fadeOutMs: 4000 },
        { goto: 0 },
      ],
    },
  };
}

// ------------------------------------------------------------------------ what plays where
//
// Slugs are from docs/zones.yaml. A Location wins over its Zone, a Zone over a bare
// `indoors`. Add a place by adding a line; nothing below is a special case in code.

const BY_LOCATION = {
  // The Keep and the Inn both have a fire going, and it is the same fire. Three seconds
  // long and looped forever, which is exactly what a hearth does.
  "fortress-4": bed("keep", ["newfireloop.ogg"], { holdMs: [600_000, 900_000] }),
  "town-7": bed("inn", ["newfireloop.ogg"], { holdMs: [600_000, 900_000] }),

  // The Cathedral and the Order Chambers are the same stone and the same silence.
  "town-4": spots("cathedral", ["ambicha1.ogg", "ambicha2.ogg", "ambicha3.ogg", "ambicha4.ogg"]),
  "undertown-b": spots("order", ["ambicha1.ogg", "ambicha2.ogg", "ambicha3.ogg", "ambicha4.ogg"]),

  "town-9": bed("sanctuary", ["pathologic.ogg"], { holdMs: [180_000, 360_000] }),

  // The Lake. `shore` is a thirty-second loop, so it runs a handful of times and then
  // leaves you with the quiet — which is more like standing at water than a permanent
  // wash of it would be.
  "undertown-c": passes("lake", ["shore.ogg"]),

  // The Tower. No music here at all: how much Blood is in it is the secret the place is
  // built around, and a tune over that is a tune over the wrong thing.
  "undertown-3": spots("lifeweb", ["lifeweb2b.ogg"], {
    silenceMs: [120_000, 300_000],
    music: false,
  }),

  // The Godard Factory. Bascinet's note: this one runs hot, so it takes a trim on top of
  // its measured level.
  factory: bed("factory", ["ambieng1.ogg"], { gain: 0.9 }),

  // The Depot, only while the train is actually standing at the platform — see
  // `trainFresh` in web/lib/gamePhase.js. Twenty seconds of idling engine, four or five
  // times, then it settles. The last pass fades rather than stopping.
  "undertown-5": passes("depot-train", ["train_loop.ogg"], { silenceMs: [90_000, 210_000] }),
};

const BY_ZONE = {
  hills: bed("hills", ["ambimine.ogg", "ambi2.ogg"], { holdMs: [180_000, 300_000] }),
  // One location, off the map, and the longest file in the set. It just runs.
  space: bed("space", ["ambispace.ogg"], { holdMs: [600_000, 900_000], music: false }),
  // The two cave levels are their own Zone rows (kind CAVE_LEVEL) under `underground`.
  caves: bed("caves", ["spookymaint1.ogg", "ambi2.ogg", "spookyspace1.ogg", "beyondretrieval.ogg"], {
    music: false,
  }),
  depths: bed("depths", ["ambigen12.ogg", "ambigen11.ogg", "spookyspace2.ogg"], { music: false }),
};

// Ordered, not an object: a Location may carry several attributes and the order is the
// answer. Keys are from db/lib/locationAttributes.js.
const BY_ATTRIBUTE = [["offMap", BY_ZONE.space]];

const INDOORS = bed("indoors", ["outpost.ogg", "track3.ogg", "track13.ogg"]);

// The wind, which is also what the closed door plays. Short files, so they loop.
const OUTDOORS = bed(
  "outdoors",
  ["wind_4_2.ogg", "wind_5_1.ogg", "wind_4_1.ogg", "wind_2_2.ogg", "wind_3_1.ogg", "wind_2_1.ogg"],
  { holdMs: [120_000, 240_000] },
);

// The winds are served from /assets/music/ because the closed-door tape has always named
// them there. Rewriting their paths would have meant touching a tape this work has no
// business touching.
for (const step of OUTDOORS.program.steps) {
  if (step.pick) step.pick = step.pick.map((s) => s.replace(A, "/assets/music/"));
}

/**
 * The ambience for where somebody is standing: `{ program, music }`, or null if they are
 * standing nowhere (no character, or the payload has not landed).
 *
 * Most specific wins. The caller depends on `program.id`, never on this object — two
 * neighbouring caves resolve to the same tape, and a walk between them must not restart
 * the bed.
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
