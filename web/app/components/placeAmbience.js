"use client";

// What a PLACE sounds like: the beds that may play there, most specific first, and the spots
// laid over them. musicConductor.js decides WHEN one plays; this file only answers WHAT
// could. See SOUND.md §4b.
//
// EVERY PLACEMENT BELOW COMES OUT OF docs/sounds.yaml, which is Bascinet's two "Music and
// Sounds" documents. A use case is quoted beside each one, because the sentence is the
// reason the file is here and the filename is not: `ambimine.ogg` sounds like it belongs in
// a mine and the document puts it in space, which is the sort of thing this file used to get
// wrong. `npm run sounds:report` is what notices when a placement drifts from its sentence.
//
// THE PLACEMENT RULES are the new document's opening paragraphs (`placement:` in
// docs/sounds.yaml), and this file is those rules in code:
//
//   - ONLY ambience that refers to space plays in space. Nothing else follows you up there.
//   - "General ambience" is for the Town, the Undertown, the Keep, the Black Hills, the
//     Caves and the Depths — not space, not anywhere else.
//   - "The fortress" means every location in the Keep, the Town and the Undertown. The Keep
//     is the zone called `fortress`; "the underfort" is the Undertown.
//   - Anything for the caves/depths is for the Black Hills too.
//   - The most specific track wins, "with some variation": the Inn has its own, but general
//     and fortress ambience may play there as well.
//
// So a place is not one pool but a stack of TIERS, most specific first — what the listener
// is, then the room, the Location, the zone, the fortress, and the general ambience at the
// bottom — and musicSchedule.js#pickTiered leans hard on the top one without ever making the
// bottom ones impossible.
//
// A piece is one of two things, and the difference is whether the file has an end.
//
// A file that has an END plays once, start to finish. The Cathedral's organ room, a drip in
// the Lifeweb, a six-minute drone. Short or long does not matter.
//
// A file that is a TEXTURE — a three-second fire, a wind gust, an idling engine — has no
// end of its own, so it loops for a minute or two and then fades out. That fade is the end
// it was always going to have, not an interruption.
//
// Beds are class `ambience`, one at a time on the `ambient` layer. Spots are class `atop`,
// "short sounds which add to the atmosphere", played OVER the bed on the `spot` layer.
//
// NO PIECE CARRIES A LEVEL unless there is a reason. Each file's measured loudness lives in
// musicGain.js, and is applied underneath — so a `gain` here means "and this one a little
// under that".

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

// --------------------------------------------------------------------------- the spots
//
// "Played atop ambience in hallowed places", and the one alternative and one different pitch
// the document gives them. The Cathedral's tone arrives over the stone, it is not the stone.
const CHAPEL_SPOTS = ["ambicha2.ogg", "ambicha3.ogg", "ambicha4.ogg", "ambicha1.ogg"].map((f) => once(f));

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

// "Played atop silence in space".
const SPACE_SPOTS = [once("ambigen12.ogg")];

// There is no fire anywhere on purpose. `newfireloop.ogg` is far too intense for a hearth or
// a brazier, so it is kept for a fire that is out of control (docs/sounds.yaml, `needs`).

// --------------------------------------------------------------------------- the beds

// "General Ambience", eleven times over. The bottom tier of every place in the six zones
// that are not space.
const GENERAL = [
  once("after-the-party.ogg"),
  once("a-curved-blade.ogg"),
  once("an-atrementous-city.ogg"),
  once("floor-6-please.ogg"),
  once("sorry-sir-wrong-room.ogg"),
  once("underground-troubles.ogg"),
  once("there-will-be-lies.ogg"),
  once("restless-dreams.ogg"),
  once("contaminated.ogg"),
  once("heliopolis.ogg"),
  once("auldale.ogg"),
];

// "Ambience in the fortress" — the Keep, the Town and the Undertown alike.
const FORTRESS = [
  loop("loop_airy1.ogg", { spanMs: [120_000, 240_000] }),
  once("the-dark-mother.ogg"),
  once("laudanum.ogg"),
  once("the-great-order-of-things.ogg"),
  once("dust-are-all-her-beauties.ogg"),
  once("subway-suspense.ogg"),
  once("fear2-city-ambience.ogg"),
];

// "Ambience in the caves".
const CAVES = [once("to_hell.ogg"), once("from-chasms-reborn.ogg"), once("horns-of-eden.ogg")];

// "Ambience in the caves/depths", and "Ambience in treacherous locations", which is what
// spookymaint1 has always been read as down there.
const CAVES_AND_DEPTHS = [
  once("introspectre.ogg"),
  once("rivers-of-glass.ogg"),
  once("shes-afraid-of-you.ogg"),
  loop("spookymaint1.ogg"),
];

// "Ambience in space", "Ambience in space and the underfort", "Quiet ambience in space",
// "More quiet ambience in space". The only beds that may play there, and the only tier.
// spookyspace1 and spookyspace2 used to be the Caves' and the Depths'; their own sentences
// say space, and the new rules say space means space.
const SPACE = [
  once("ambispace.ogg"),
  once("ambimine.ogg"),
  once("spookyspace1.ogg"),
  once("spookyspace2.ogg"),
  once("ager-sonus-lost.ogg"),
  once("derelict-approach.ogg"),
  once("industrial-district.ogg"),
  once("departure.ogg"),
  once("the-hierophant.ogg"),
];

// What a ZONE sounds like on its own, above the fortress and the general tiers.
const BY_ZONE = {
  // "Ambience in the keep". The Keep is the whole `fortress` zone, the way the document uses
  // the word — its own sentence lists the keep beside the town and the undertown.
  fortress: { beds: [once("slower.ogg")], spots: WIND_SPOTS },
  // "Ambience while walking around town/underfort".
  town: { beds: [loop("ambigen6.ogg")], spots: WIND_SPOTS },
  // "Ambience in the underfort", five times, plus the town/underfort walk. Industrial
  // District is "in space and the underfort", so it is in both.
  undertown: {
    beds: [
      loop("loop_altar.ogg"),
      loop("ambigen6.ogg"),
      once("industrial-district.ogg"),
      once("darkwood-untitled-2.ogg"),
      once("fear-insertion.ogg"),
      once("shes-afraid-of-you.ogg"),
      once("garden-music.ogg"),
    ],
  },
  // The two cave levels are their own Zone rows (kind CAVE_LEVEL) under `underground`.
  caves: { beds: [...CAVES, ...CAVES_AND_DEPTHS] },
  depths: { beds: CAVES_AND_DEPTHS },
  // "Tracks described as for use in the caves/depths are also for use in the black hills."
  hills: { beds: [...CAVES, ...CAVES_AND_DEPTHS], spots: WIND_SPOTS },
};

const FORTRESS_ZONES = new Set(["fortress", "town", "undertown"]);
const GENERAL_ZONES = new Set(["fortress", "town", "undertown", "hills", "caves", "depths"]);

// What a LOCATION sounds like, where it differs from its zone. Slugs are from
// docs/zones.yaml, and a slug never moves.
const BY_LOCATION = {
  // "Ambience within the inn", and "Ambience in the inn".
  "town-7": { beds: [once(`${M}song_game.ogg`), once("feast-of-the-night.ogg")] },

  // "Ambience within the cathedral". The Order Chambers are the same stone and the same
  // silence, so they get the same pool.
  "town-4": { beds: [once("sacred_dagger.ogg")], spots: CHAPEL_SPOTS },
  "undertown-b": { beds: [once("sacred_dagger.ogg")], spots: CHAPEL_SPOTS },

  // "Ambience" — the one music-folder file the document leaves unqualified, and the
  // Sanctuary is where it has always played.
  "town-9": { beds: [once("pathologic.ogg")] },

  // "Ambience in proximity to shore and body of water".
  "undertown-c": { beds: [loop("shore.ogg")] },

  // "Ambience in proximity to the lifeweb as it feeds." No music of its own kind here: how
  // much Blood is in the Tower is the secret the place is built around.
  "undertown-3": { beds: [once("lifeweb2b.ogg")] },

  // "Ambience of a running steam engine." Bascinet's note: this one runs hot, so it takes a
  // trim on top of its measured level.
  factory: { beds: [loop("ambieng1.ogg", { gain: 0.9 })] },
};

// "Looping sound of moving train" — only while the train is actually standing at the
// platform, which is `trainFresh` in web/lib/gamePhase.js. Rails empty, the Depot is the
// Undertown like anywhere else down there.
const DEPOT = "undertown-5";
const DEPOT_TRAIN = { beds: [loop("train_loop.ogg", { spanMs: [60_000, 110_000] })] };

// Ordered, not an object: a Location may carry several attributes and the order is the
// answer. Keys are from db/lib/locationAttributes.js. A Location attribute sits at the
// Location's tier.
const BY_ATTRIBUTE = [
  // "Ambience in proximity to charon". The ship on the ground only: in orbit it is space, and
  // this sentence does not say space.
  ["offMap", { beds: [loop("charon_loop.ogg")] }],
];

// A ROOM is heard only while Chat has it open (heardPlace.js), because a character stands in
// a Location and READS a room — there is no room column to ask. Only rooms that sound
// different belong in this table, and today none do: it was built for the fire in the Inn's
// Bar, the Throne Room and the Firepit, and the fire came out of the ambience altogether.
const BY_ROOM = {};

// --------------------------------------------------------------------------- the listener
//
// WHAT THE LISTENER IS, rather than where they are. The document writes these as conditions
// on the person, so they are the most specific tier of all — but a tier, not a wall: the
// place still gets a word in.

// "Ambience while in pain shock or sedated".
const IMPAIRED = [loop("ambi2.ogg")];
// "Ambience while hallucinating", twice.
const HALLUCINATING = [once("parhelic-triangle.ogg"), once("fools-village.ogg")];
// "Ambience while wearing thanati robes".
const ROBED = [once("abyssus-abyssum-invocat.ogg")];
// "Ambience in town when character mood is low."
const TOWN_LOW = [loop("loop_airy4.ogg")];

// BEING ON A DRUG. One song per drug, and each song is two things: the "ambience
// interrupting sfx" that cuts in the moment the dose is taken (MusicDirector.js), and then
// the listener's own bed for as long as the high lasts. Keyed by the drug, not the state tag
// — web/lib/drugHighs.js is the way from one to the other. A drug missing here is simply
// silent; no song belongs to two drugs (placeAmbience.test.mjs holds that).
//
// The pairings are a reading of the documents' sentences, and Bascinet's to change:
export const BY_DRUG = {
  // "Ambience interrupting sfx which plays after smoking marijuana". Raw fungus is the
  // game's mild, cheap High.
  "cave-fungus": once("hishmaliin.ogg"),
  // "Ambience while hallucinating". Refined fungus: Euphoric, "you could do this for the
  // rest of your life".
  bliss: once("fools-village.ogg"),
  // "Ambience interrupting sfx which plays after taking DOB or other hardcore drug."
  heroin: once("mature-raver.ogg"),
  // "Ambience interrupting sfx when having a drug induced bad trip, VERY LOUD, lower the
  // volume on this one before using." Changa High: "You are losing your mind and going
  // crazy. You might die." Its measured level is in musicGain.js, and on top of that it
  // plays at half the volume of the other tracks: Bascinet's call, for the document's "lower
  // the volume". Its bursts swing ten LU either side of its average level.
  changa: once("oval-sky.ogg", { gain: 0.5 }),
  // "Ambience while hallucinating". A tablet that causes dissociation.
  "eth-lod": once("parhelic-triangle.ogg"),
};

// A GHOST is not anywhere. "Ambience while a ghost", "Ambience interrupting sound effect of
// becoming a ghost, and also ambience while a ghost", "Ambience for ghosts".
export const GHOST = {
  id: "ghost",
  tiers: [[once("consciousness-dissolves.ogg"), once("geist.ogg"), once("we-fear-no-evil.ogg")]],
  spots: [],
};

// The two things that cut whatever is playing (musicConductor.js#interrupt). The document
// calls Geist an "Ambience interrupting sound effect of becoming a ghost", and Locus Meropis
// "Sound and ambience that plays immediately after the charon has taken off" — immediately,
// so it does not wait for the bed in the air to finish.
export const INTERRUPTS = {
  ghost: once("geist.ogg"),
  charonLaunch: once("locus-meropis.ogg"),
};

// Every pool in this file, for tooling. scripts/audio/sound-report.mjs reads it to tell a
// BED from a SPOT, which it cannot do by looking at the source: both are `once()`/`loop()`
// calls and only which list they sit in says which. This file imports nothing, so a plain
// Node script can load it the way sim-schedule.mjs loads musicSchedule.js.
export const ALL_PLACES = [
  { id: "general", pieces: GENERAL, spots: [] },
  { id: "fortress", pieces: FORTRESS, spots: [] },
  { id: "space", pieces: SPACE, spots: SPACE_SPOTS },
  ...Object.entries(BY_ZONE).map(([id, z]) => ({ id, pieces: z.beds, spots: z.spots ?? [] })),
  ...Object.entries(BY_LOCATION).map(([id, l]) => ({ id, pieces: l.beds, spots: l.spots ?? [] })),
  ...BY_ATTRIBUTE.map(([id, a]) => ({ id, pieces: a.beds, spots: [] })),
  { id: "depot-train", pieces: DEPOT_TRAIN.beds, spots: [] },
  { id: "impaired", pieces: IMPAIRED, spots: [] },
  { id: "hallucinating", pieces: HALLUCINATING, spots: [] },
  { id: "robed", pieces: ROBED, spots: [] },
  ...Object.entries(BY_DRUG).map(([id, p]) => ({ id: `drug:${id}`, pieces: [p], spots: [] })),
  { id: "town-low", pieces: TOWN_LOW, spots: WIND_SPOTS },
  { id: "ghost", pieces: GHOST.tiers[0], spots: [] },
  { id: "interrupts", pieces: Object.values(INTERRUPTS), spots: [] },
];

// --------------------------------------------------------------------------- resolving

// Built once per distinct answer, so the same place resolves to the very same object and a
// re-render never looks like a move.
const cache = new Map();

/**
 * The stack for where somebody is standing: `{ id, tiers, spots }`, most specific tier
 * first and no empty tiers, or null if they are standing nowhere (no character, or the
 * payload has not landed).
 *
 * `heardKey` is the place key Chat has open (`room:<id>`, `loc:<id>`, …) or null. It only
 * counts when it names a room at the Location they stand in — `standing.rooms` is exactly
 * those, id to slug — so a key left over from somewhere they have since walked out of
 * falls through to the Location.
 */
export function resolveAmbience(standing, heardKey = null) {
  if (!standing) return null;
  const {
    locationSlug,
    zoneSlug,
    attributes = [],
    trainFresh,
    moodTone,
    impaired,
    hallucinating,
    robed,
    drugs = [],
    rooms,
  } = standing;

  // SPACE IS SPACE. Only what refers to it, whoever you are and whatever you are wearing.
  if (zoneSlug === "space" || attributes.includes("space")) {
    return memo("space", () => ({ id: "space", tiers: [SPACE], spots: SPACE_SPOTS }));
  }

  const roomSlug = heardKey?.startsWith("room:") ? rooms?.[heardKey.slice("room:".length)] : null;
  const room = roomSlug ? BY_ROOM[roomSlug] : null;
  let location = locationSlug === DEPOT ? (trainFresh ? DEPOT_TRAIN : null) : BY_LOCATION[locationSlug];
  if (!location) location = BY_ATTRIBUTE.find(([key]) => attributes.includes(key))?.[1] ?? null;
  const zone = BY_ZONE[zoneSlug] ?? null;

  const listener = [
    impaired && "impaired",
    hallucinating && "hallucinating",
    robed && "robed",
    ...drugs.filter((d) => BY_DRUG[d.id]).map((d) => `drug:${d.id}`),
    moodTone === "bad" && zoneSlug === "town" && "town-low",
  ].filter(Boolean);

  const key = [listener.join("+"), roomSlug && room ? roomSlug : "", locationSlug ?? "", zoneSlug ?? ""].join("|");
  return memo(key, () => {
    const mine = [];
    if (listener.includes("impaired")) mine.push(...IMPAIRED);
    if (listener.includes("hallucinating")) mine.push(...HALLUCINATING);
    if (listener.includes("robed")) mine.push(...ROBED);
    for (const l of listener) {
      const p = l.startsWith("drug:") ? BY_DRUG[l.slice("drug:".length)] : null;
      // Bliss and hallucinating share Fool's Village; once in the pool is enough.
      if (p && !mine.some((m) => m.src === p.src)) mine.push(p);
    }
    if (listener.includes("town-low")) mine.push(...TOWN_LOW);
    const tiers = [
      mine,
      room?.beds ?? [],
      location?.beds ?? [],
      zone?.beds ?? [],
      FORTRESS_ZONES.has(zoneSlug) ? FORTRESS : [],
      GENERAL_ZONES.has(zoneSlug) ? GENERAL : [],
    ].filter((t) => t.length);
    // The most specific spots win outright: a spot is for "very specific circumstances",
    // and the chapel's tones over a wind that belongs to the street would be two places at
    // once. Mood-low town keeps the town's winds, which it always had.
    const spots = room?.spots ?? location?.spots ?? zone?.spots ?? [];
    return { id: key, tiers, spots };
  });
}

function memo(key, build) {
  let hit = cache.get(key);
  if (!hit) {
    hit = build();
    cache.set(key, hit);
  }
  return hit;
}

/** Whether `src` could be picked in this place at all — the test for fading it out on a move. */
export function placeHas(place, src) {
  return Boolean(place?.tiers?.some((tier) => tier.some((p) => p.src === src)));
}
