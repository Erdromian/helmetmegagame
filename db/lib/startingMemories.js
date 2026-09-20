// What a character already knows of the map on the day they are made. Each
// seat gets the places its life would have taught it: the home cluster plus
// the specific road that seat's work actually walks. Fog still covers most
// of the map on day one. A slug here is a Location slug — globally unique
// (schema.prisma), no zone/location parsing. These are `stood` memories.
//
// A TABLE ENTRY CANNOT WITHHOLD A PLACE, only decline to hand it over
// directly: `recordArrival` paints every *listed* neighbour of a seeded
// Location as a sighting, and locked ways are listed (you can see a mountain
// from the road). The one thing leaving a slug out really protects is a
// HIDDEN way — `travelOptions` drops those before the sighting write ever sees them.
//
// Data-as-code rather than a `starting_memories:` key in docs/roles.yaml: the
// YAML would need a Role column, a migration and a db:sync-roles run, and the
// kit half of the table has no home in roles.yaml anyway. Deliberately NOT on
// the @lifeweb/db barrel; require it by path.

// Every slug below is a MAP CODE (docs/zones.yaml) — `town-4` is the
// Cathedral, `fortress-5` the Tower. A place can be renamed without this
// table going stale, which is the point of coding them.

const FORTRESS_CORE = ["fortress-1", "fortress-2", "fortress-3", "fortress-4", "fortress-5"];

// The Undercroft is the inner circle's alone — the Baron's elevator starts
// there, and a Squire who has never been told does not get to know. It sits
// in the Undertown now, at the bottom of the Keep's lift.
const FORTRESS_INNER = [...FORTRESS_CORE, "undertown-1"];

// All ten of the town's places. It is one walled town underground now, so
// everybody who lives in it knows the whole of it.
const TOWN_ALL = [
  "town-1", // Gatehouse
  "town-2", // Square
  "town-3", // Soilery
  "town-4", // Cathedral
  "town-5", // Alleys
  "town-6", // Smithies
  "town-7", // The Old Cock Inn
  "town-8", // Residences
  "town-9", // Sanctuary
  "town-a", // Graveyard
];

const HILLS_ALL = [
  "bridge",
  "west-river",
  "passageway",
  "refuse-pit",
  "sparse-fields",
  "cliffs",
  "gullies",
  "grand-ravine",
  "east-river",
];

// The Marshes were deleted with the surface. The Factory came over into the
// Black Hills, so the seats whose whole life was the Factory know it and the
// water around it rather than a zone that no longer exists.
const FACTORY_CLUSTER = ["factory", "east-river", "cliffs", "gullies", "grand-ravine"];

// As much of the caves as somebody who works customs has reason to know. NOT
// the abandoned camp — that's a bigger reveal than a trade seat has earned;
// the Migrant, who lives there, gets it below. The Depot moved into the
// Undertown but it is still the shop on the other side of the sentry post.
const CAVE_MOUTH = ["customs", "caves-approach", "undertown-5"];

// The way between the fortress and the town: one manned gate, at the top of
// the Residences' stairs.
const FORTRESS_TO_TOWN = ["fortress-2", "town-8"];

// The one open road from the town out to the Factory — every other way is
// locked or a caving crawl, neither belonging in a starting memory.
const FACTORY_ROAD = [
  "town-1",
  "bridge",
  "east-river",
  "gullies",
  "cliffs",
  "factory",
];
const ROLE_MEMORIES = {
  // Fortress
  baron: FORTRESS_INNER,
  baroness: FORTRESS_INNER,
  heir: FORTRESS_INNER,
  successor: FORTRESS_INNER,
  hand: FORTRESS_INNER,
  arbiter: FORTRESS_INNER,
  courtier: FORTRESS_CORE,
  servant: FORTRESS_CORE,
  incarn: FORTRESS_CORE,
  squire: FORTRESS_CORE,
  // meister: the tithe run. cerberus: the Cerberon man the town gate and the cave-mouth one.
  meister: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN, "town-2"],
  minstrel: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN, "town-2", "town-7"],
  censor: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN],
  cerberus: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN, "town-1", "town-2", "bridge", "customs"],

  // Town
  bishop: TOWN_ALL,
  chaplain: TOWN_ALL,
  scholastic: TOWN_ALL,
  esculap: TOWN_ALL,
  serpent: TOWN_ALL,
  inquisitor: TOWN_ALL,
  practicus: TOWN_ALL,
  preacher: TOWN_ALL,
  metalsmith: TOWN_ALL,
  bum: TOWN_ALL,
  pusher: TOWN_ALL,
  innkeeper: TOWN_ALL,
  "inn-staff": TOWN_ALL,
  sheriff: [...TOWN_ALL, ...FORTRESS_TO_TOWN, "bridge"],
  // headman: collects from the Soilery, which is inside the walls now. mortus:
  // the vow, always knows the way down to the Tower.
  headman: [...TOWN_ALL, ...FORTRESS_TO_TOWN],
  mortus: [...TOWN_ALL, ...FORTRESS_TO_TOWN, "undertown-3"],

  // Caves. merchant: trades the Factory's goods.
  merchant: [...CAVE_MOUTH, "town-2", ...FACTORY_ROAD],
  mercenary: [...CAVE_MOUTH],
  docker: [...CAVE_MOUTH, ...FACTORY_ROAD],
  migrant: [...CAVE_MOUTH, "caves-abandoned-camp"],

  // The Factory
  geschef: FACTORY_CLUSTER,
  refugee: ["factory", "east-river", "cliffs"],
  // banneret rides the Squeeze up to town, so he knows every step.
  banneret: [...FACTORY_CLUSTER, ...FACTORY_ROAD, "town-2"],

  // Black Hills
  "tribunal-ordinator": HILLS_ALL,
  tribune: HILLS_ALL,
  brigand: HILLS_ALL,
  "brigand-leader": [...HILLS_ALL, "factory"],
};

// A tag a character starts with can add roads they have walked, on top of
// whatever their role knows.
const KIT_MEMORIES = {};

// Empty for a role nobody wrote a line for — a blank map, exactly what the old
// behaviour was, not an error.
function startingMemorySlugs(roleSlug, tagSlugs = []) {
  const out = new Set(ROLE_MEMORIES[roleSlug] ?? []);
  for (const slug of tagSlugs) {
    for (const location of KIT_MEMORIES[slug] ?? []) out.add(location);
  }
  return [...out];
}

module.exports = { startingMemorySlugs };
