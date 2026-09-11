// What a character already knows of the map on the day they are made.
//
// Before this, everybody woke up blind: LocationVisit was written only on
// arrival, so a new character knew the one place they were standing in and
// nothing else. That is right for a stranger and wrong for everybody else — a
// Headman has taxed the Farms his whole life, a Banneret has ridden the road to
// town a hundred times, and both of them opened /map to a black plate.
//
// So each seat gets the places its life would have taught it: the home
// cluster, plus the specific road that seat's work actually walks. Nothing
// more. The fog is still most of the map on day one, and it is still the only
// thing that makes finding a place feel like anything.
//
// A slug here is a Location slug — globally unique (schema.prisma), so no
// zone/location parsing. These are `stood` memories.
//
// A TABLE ENTRY CANNOT WITHHOLD A PLACE, only decline to hand it over directly.
// `recordArrival` paints every *listed* neighbour of a seeded Location as a
// sighting, and locked ways are listed — that is the game's own rule (you can
// see a mountain from the road and understand perfectly well you cannot climb
// it). So leaving a slug out of the lists below is not a guarantee it stays
// dark: `hills-mountain` reaches all thirteen Fortress seats through the locked
// `servant-wing` climb, and does so correctly.
//
// The one thing leaving a slug out really does protect is a HIDDEN way, because
// `travelOptions` drops those before the sighting write ever sees them. So the
// smugglers' crawl `depot -> caves-brooding-grounds` cannot leak here no
// matter what this table says — but `caves-abandoned-camp` is a plain open road
// away from the same place, which is why the three seats that only work the
// cargo bay do not get it.
//
// Data-as-code rather than a `starting_memories:` key in docs/roles.yaml: the
// YAML would need a Role column, a migration and a db:sync-roles run, and the
// kit half of the table below has no home in roles.yaml anyway.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.

const FORTRESS_CORE = [
  "keep",
  "garrison",
  "gatehouse",
  "servant-wing",
  "lifeweb",
  "road",
  "manors",
];

// The Undercroft is the inner circle's alone — the Baron's elevator starts
// there, and a Squire who has never been told does not get to know.
const FORTRESS_INNER = [...FORTRESS_CORE, "undercroft"];

const TOWN_ALL = [
  "square",
  "old-cock-inn",
  "north-gate",
  "cathedral",
  "sanctuary",
  "underquarter",
  "south-gate",
];

const MARSHES_ALL = [
  "marshes-village",
  "factory",
  "marshes-north",
  "marshes-west",
  "marshes-woods",
  "marshes-drowned",
  "marshes-south",
];

const HILLS_ALL = [
  "hills-underlocks",
  "hills-shadowed-grove",
  "hills-west",
  "hills-north",
  "hills-waterway",
  "hills-gullies",
  "hills-grand-ravine",
  "hills-cliffs",
];

// The sentry post, the shop one hop east of it, and the road up to the gate —
// as much of the caves as somebody who works customs has reason to know.
// NOT the abandoned camp: that is one open road from the brooding grounds and
// two from the mouth of the Depths, and handing a Merchant all three on his
// first morning is a bigger reveal than a trade seat has earned. The Migrant,
// who actually lives in the camp, gets it below.
const CAVE_MOUTH = ["customs", "depot", "caves-approach"];

// The way down off the mountain, as the people who walk it know it.
const FORTRESS_TO_TOWN = ["forest-northern-road", "north-gate"];

// The one open road from the cave mouth to the Factory — every other way
// there is either locked (the three climbs) or a caving crawl, and neither
// belongs in a starting memory (see the header's HIDDEN-way rule). Picked up
// at forest-south, which CAVE_MOUTH already borders, and run the same
// hills/embankment stretch banneret's own road already uses below, so the
// two tables agree on what that stretch looks like.
const FACTORY_ROAD = [
  "forest-riverbend",
  "forest-deep-forest",
  "forest-creekside",
  "forest-headwaters",
  "forest-cliffs",
  "forest-northern-road",
  "forest-embankment",
  "hills-shadowed-grove",
  "hills-underlocks",
  "hills-west",
  "hills-waterway",
  "marshes-west",
  "marshes-woods",
  "factory",
];
const ROLE_MEMORIES = {
  // --- Fortress ---------------------------------------------------------
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
  // The tithe run: he is the Baron's taxperson and the Headman is his contact.
  meister: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN, "square"],
  minstrel: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN, "square", "old-cock-inn"],
  censor: [...FORTRESS_CORE, ...FORTRESS_TO_TOWN],
  // Both town gates and the one in the cave mouth — the Cerberon man all three.
  cerberus: [
    ...FORTRESS_CORE,
    ...FORTRESS_TO_TOWN,
    "square",
    "south-gate",
    "forest-south",
    "customs",
  ],

  // --- Town -------------------------------------------------------------
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
  sheriff: [...TOWN_ALL, "forest-south", "forest-northern-road"],
  // He walks out to the farms to collect, and up the road to hand it over.
  headman: [...TOWN_ALL, "forest-south", "farms", "forest-northern-road"],
  // The vow: whatever else a Mortus does, he knows the way to the Lifeweb.
  mortus: [...TOWN_ALL, "forest-northern-road", "manors", "road", "gatehouse", "lifeweb"],
  // Plus whichever kit route KIT_MEMORIES adds below.
  commoner: TOWN_ALL,

  // --- Caves ------------------------------------------------------------
  // Both trade the Factory's goods, so both know the one open road there —
  // the Merchant deals in them, and the Docker is the one who actually moves
  // the crates (Bascinet, 2026-09-11).
  merchant: [...CAVE_MOUTH, "forest-south", "south-gate", "square", ...FACTORY_ROAD],
  mercenary: [...CAVE_MOUTH, "forest-south"],
  docker: [...CAVE_MOUTH, "forest-south", ...FACTORY_ROAD],
  migrant: [...CAVE_MOUTH, "caves-abandoned-camp"],

  // --- Marshes ----------------------------------------------------------
  fisherman: MARSHES_ALL,
  geschef: ["factory", "marshes-village", "marshes-south", "marshes-woods", "marshes-north"],
  refugee: ["factory", "marshes-village", "marshes-south", "marshes-woods"],
  // The longest list in the table, and it earns it: he is the seat that rides
  // the Squeeze up to town, so he knows every step of that road.
  banneret: [
    ...MARSHES_ALL,
    "hills-waterway",
    "hills-west",
    "hills-underlocks",
    "hills-shadowed-grove",
    "forest-embankment",
    "forest-northern-road",
    "north-gate",
    "square",
  ],

  // --- Black Hills ------------------------------------------------------
  "tribunal-ordinator": HILLS_ALL,
  tribune: HILLS_ALL,
  brigand: HILLS_ALL,
  "brigand-leader": [...HILLS_ALL, "forest-embankment"],
};

// A Commoner's trade decides which road out of town they have walked. Keyed by
// the kit crate, not by the laboring tag inside it, because the crate is what
// exists at creation — it is unpacked later, by hand.
const KIT_MEMORIES = {
  "commoner-farmer": ["forest-south", "farms"],
  "commoner-fisherman": ["forest-northern-road", "forest-embankment", "forest-east-river"],
  "commoner-hunter": ["forest-northern-road", "forest-embankment", "hills-shadowed-grove"],
};

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
