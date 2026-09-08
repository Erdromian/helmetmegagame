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
// zone/location parsing. These are `stood` memories, so each also paints its
// visible neighbours as bare sightings via recordArrival.
//
// TWO SLUGS ARE DELIBERATELY IN NOBODY'S LIST. `caves-brooding-grounds` is the
// far end of the smugglers' crawl, and `hills-mountain` has no edge to the rest
// of the Black Hills at all — only the two mountaineering climbs. Handing
// either one out for free would give away a way in.
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

const CAVE_MOUTH = ["customs", "caves-approach", "caves-abandoned-camp"];

// The two ways down off the mountain, as the people who walk them know them.
const FORTRESS_TO_TOWN = ["forest-northern-road", "north-gate"];
const MARSHES_TO_TOWN = [
  "hills-waterway",
  "hills-west",
  "hills-underlocks",
  "hills-shadowed-grove",
  "forest-embankment",
  "forest-northern-road",
  "north-gate",
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
  merchant: [...CAVE_MOUTH, "forest-south", "south-gate", "square"],
  mercenary: [...CAVE_MOUTH, "forest-south"],
  docker: CAVE_MOUTH,
  migrant: CAVE_MOUTH,

  // --- Marshes ----------------------------------------------------------
  fisherman: MARSHES_ALL,
  geschef: ["factory", "marshes-village", "marshes-south", "marshes-woods", "marshes-north"],
  refugee: ["factory", "marshes-village", "marshes-south", "marshes-woods"],
  // The longest list in the table, and it earns it: he is the seat that rides
  // the Squeeze up to town, so he knows every step of that road.
  banneret: [...MARSHES_ALL, ...MARSHES_TO_TOWN, "square"],

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

// The union of a seat's memories and any kit route its tags name. Deduped, and
// empty for a role nobody wrote a line for — which is a blank map, exactly what
// the old behaviour was, not an error.
function startingMemorySlugs(roleSlug, tagSlugs = []) {
  const out = new Set(ROLE_MEMORIES[roleSlug] ?? []);
  for (const slug of tagSlugs) {
    for (const location of KIT_MEMORIES[slug] ?? []) out.add(location);
  }
  return [...out];
}

module.exports = { startingMemorySlugs, ROLE_MEMORIES, KIT_MEMORIES };
