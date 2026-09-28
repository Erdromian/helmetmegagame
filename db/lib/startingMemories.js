// The places a character has already STOOD in on the day they are made. Each
// seat gets the places its life would have taught it: the home cluster plus
// the specific road that seat's work actually walks. A slug here is a Location
// slug — globally unique (schema.prisma), no zone/location parsing. These are
// `stood` memories.
//
// This is the layer ON TOP now. Underneath it, db/lib/mapMemory.js hands every
// seat but the outsiders a sighting of every place outside the Caves and the
// Depths (Map.docx) — so what this table still decides is where a seat has
// been, which is what shows a place's description and rooms, and what an
// outsider knows at all.
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

// The Undercroft is the inner circle's alone — the Baron's Vault is down
// there, and a Squire who has never been told does not get to know. It is a
// Fortress Location again (2026-09-23), down the Court's stair; the slug is
// its cell on the Undertown plate and never moved.
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

// The way between the fortress and the town: one manned gate, at the top of
// the Residences' stairs.
const FORTRESS_TO_TOWN = ["fortress-2", "town-8"];

// The floor for anybody who LIVES in Ravenheart, whichever seat they hold: the
// whole of the town, and the gate up to the fortress above it. There is no
// version of a life here that does not teach you the Square and the Cathedral,
// so the town is not something the fog is for. Only the outsiders — the
// Migrant, the Mercenary, the Tribunal and the Bastard's party — start without
// it.
const RAVENHEART = [...TOWN_ALL, ...FORTRESS_TO_TOWN];

// The Undertown's ordinary streets: everywhere down there with a plain way in,
// which is most of it now that the place is built out. Somebody whose life is
// the Undertown walks all of this without knowing a single secret.
const UNDERTOWN_STREETS = [
  "undertown-a", // Slums
  "undertown-8", // Den
  "undertown-7", // Poorhouse
  "undertown-6", // Merchant
  "undertown-5", // Depot
  "undertown-4", // Sewer
  "undertown-c", // Lake
  "undertown-e", // Basements
  "undertown-d", // Hollows
];

// Down the Den's stairs, for the people who work in the basement. The stair is
// `locked: den-key` rather than hidden, so it is already a sighting for anyone
// standing in the Den — this only upgrades it to somewhere they have been.
const DEN_HOUSE = [...UNDERTOWN_STREETS, "undertown-9"];

// What a surface trade seat touches of the Undertown and no more: the freight
// platform, the counter beside it, and the Slums they come up through.
const UNDERTOWN_TRADE = ["undertown-5", "undertown-6", "undertown-a"];

// NEVER put one of these in a table, each for its own reason.
//
//   undertown-f  Hole in the Wall — `hidden: tunnel-rat` off the Poorhouse, and
//                a caving climb up out of the Depths. The one place down here a
//                table could really leak, since a hidden way is the only thing
//                omission actually protects.
//   undertown-h  Island — across the water behind Strong Swimmer. A hideaway
//                rather than a street.
//   undertown-b  Order Chambers — the Order's own, behind their key. Everybody
//                already sees it hollow off the Cathedral next door; nobody
//                starts out having been inside.
//
// db/test/startingMemories.test.js asserts this rather than trusting the
// comment, and also asserts each slug still names a real place — the Nook used
// to be listed here and was deleted from the game, which left a dead slug
// guarding nothing.
//
// Two places here are easy to reconcile wrongly. `town-5` is the town's Alleys,
// it is in TOWN_ALL, and it is safe. `undertown-d` is the Hollows, which USED
// to be called the Alleys — it is an ordinary street off the Slums now, and it
// is not on this list.
const UNDERTOWN_WITHHELD = ["undertown-f", "undertown-h", "undertown-b"];

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
// the Migrant, who lives there, gets it below. Both ends of the crossing out
// of the caves: the Depot is the freight platform the Entrance lets onto, and
// the Merchant's berth one hop past it is the shop somebody working customs
// would actually have reason to know.
const CAVE_MOUTH = ["caves-1", "caves-2", "undertown-5", "undertown-6"];

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

// Three people know there is a ship (docs/systemdocs/CHARON.md), and this table
// is the ONLY way anybody learns it: the Charon has no LocationLink, so it is
// never anybody's listed neighbour and the sighting write the header describes
// can never reach it. Leave a seat off this list and that seat cannot see the
// Charon on the map at all — which is the whole arrangement, and why the Heir,
// the Successor and the Arbiter keep plain FORTRESS_INNER below despite sitting
// in the same rooms.
const FORTRESS_ESCAPE = [...FORTRESS_INNER, "fortress-6"];

const ROLE_MEMORIES = {
  // The Fortress. Every seat up here lives in Ravenheart, so every one of them
  // knows the town below as well as the rooms they work in.
  baron: [...FORTRESS_ESCAPE, ...RAVENHEART],
  baroness: [...FORTRESS_ESCAPE, ...RAVENHEART],
  hand: [...FORTRESS_ESCAPE, ...RAVENHEART],
  heir: [...FORTRESS_INNER, ...RAVENHEART],
  successor: [...FORTRESS_INNER, ...RAVENHEART],
  arbiter: [...FORTRESS_INNER, ...RAVENHEART],
  courtier: [...FORTRESS_CORE, ...RAVENHEART],
  servant: [...FORTRESS_CORE, ...RAVENHEART],
  minstrel: [...FORTRESS_CORE, ...RAVENHEART],
  meister: [...FORTRESS_CORE, ...RAVENHEART],

  // The Cerberon. The Cerberus mans both gates, so he knows the far side of
  // each: the bridge out to the hills and the mouth of the caves.
  censor: [...FORTRESS_CORE, ...RAVENHEART],
  incarn: [...FORTRESS_CORE, ...RAVENHEART],
  squire: [...FORTRESS_CORE, ...RAVENHEART],
  cerberus: [...FORTRESS_CORE, ...RAVENHEART, "bridge", "caves-1"],

  // The town.
  bishop: RAVENHEART,
  chaplain: RAVENHEART,
  inquisitor: RAVENHEART,
  practicus: RAVENHEART,
  preacher: RAVENHEART,
  esculap: RAVENHEART,
  serpent: RAVENHEART,
  metalsmith: RAVENHEART,
  innkeeper: RAVENHEART,
  "inn-staff": RAVENHEART,
  soiler: RAVENHEART,
  sheriff: [...RAVENHEART, "bridge"],
  // mortus: the vow, always knows the way down to the Tower — and the
  // maintenance tunnels out of it that the Lifeweb's own description promises,
  // which is a locked door rather than a secret one.
  mortus: [...RAVENHEART, "undertown-3", "undertown-4"],
  // prospector: the seams are out past the bridge and down the cave mouth, and
  // digging them is the whole of the seat.
  prospector: [...RAVENHEART, "bridge", "caves-1", "caves-2"],

  // The Undertown. The Bum sleeps rough across the whole of it and holds no
  // key to anybody's cellar; the Den's five seats work the basement under the
  // Slums and know the stair down as somewhere they have been rather than a
  // door they have seen.
  bum: [...RAVENHEART, ...UNDERTOWN_STREETS],
  exactor: [...RAVENHEART, ...DEN_HOUSE],
  pusher: [...RAVENHEART, ...DEN_HOUSE],
  courtesan: [...RAVENHEART, ...DEN_HOUSE],
  goon: [...RAVENHEART, ...DEN_HOUSE],
  slave: [...RAVENHEART, ...DEN_HOUSE],

  // The trade. Both of these live down here and run the freight platform, and
  // both walk the road out to the Factory whose goods they move.
  merchant: [...RAVENHEART, ...UNDERTOWN_STREETS, ...CAVE_MOUTH, ...FACTORY_ROAD],
  docker: [...RAVENHEART, ...UNDERTOWN_STREETS, ...CAVE_MOUTH, ...FACTORY_ROAD],

  // The Factory. The road up to town, and the end of the Undertown the Squeeze
  // is sold at — they come up to trade, not to live.
  banneret: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...UNDERTOWN_TRADE, ...RAVENHEART],
  geschef: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...UNDERTOWN_TRADE, ...RAVENHEART],
  refugee: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...UNDERTOWN_TRADE, ...RAVENHEART],

  // The outsiders, and the only seats the town is still fogged for. A Migrant
  // walking in has not seen Ravenheart yet — that is the whole of the seat.
  migrant: [...CAVE_MOUTH, "caves-5"],
  mercenary: [...CAVE_MOUTH],

  // The God-King's people and the Bastard's party both arrive into the Black
  // Hills. They marched there; a blank map of the ground they are standing on
  // would be a bug rather than a secret.
  "tribunal-ordinator": HILLS_ALL,
  tribune: HILLS_ALL,
  bastard: HILLS_ALL,
  "bastard-infantry": HILLS_ALL,
  "bastard-heavy-infantry": HILLS_ALL,
  "bastard-rifleman": HILLS_ALL,
  "bastard-healer": HILLS_ALL,
  "bastard-engineer": HILLS_ALL,

  // The Skinless (db/lib/skinless.js) come up out of the dark: every level of
  // the Caves and the Depths is home, and nothing above it is.
  skinless: [
    "caves-1", "caves-2", "caves-3", "caves-4", "caves-5",
    "depths-1", "depths-2", "depths-3", "depths-4", "depths-5", "depths-6", "depths-7",
  ],
};

// A tag a character starts with can add roads they have walked, on top of
// whatever their role knows.
//
// `ravenhearter` is the floor rather than the mechanism: the table above is
// what actually decides each seat, and six Undertown and Factory seats who
// plainly live here do not carry the tag. What this entry buys is that a role
// added to docs/roles.yaml which nobody remembers to add above degrades to
// "knows the town" instead of to a blank map — which is how the Soiler shipped
// unable to see the Soilery they farm.
const KIT_MEMORIES = {
  ravenhearter: TOWN_ALL,
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

module.exports = {
  startingMemorySlugs,
  ROLE_MEMORIES,
  KIT_MEMORIES,
  UNDERTOWN_WITHHELD,
};
