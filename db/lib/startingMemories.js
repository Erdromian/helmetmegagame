// What a character already knows of the map on the day they are made. Each
// seat gets the places its life would have taught it: the home cluster plus
// the specific road that seat's work actually walks. A slug here is a Location
// slug — globally unique (schema.prisma), no zone/location parsing. These are
// `stood` memories.
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

// The Undertown a resident walks without knowing a secret: the Slums off the
// Square, the Den off the Slums, the Poorhouse, the freight platform and the
// Merchant's berth beside it, and the sewers everybody knows are down there.
const UNDERTOWN_COMMON = [
  "undertown-a", // Slums
  "undertown-8", // Den
  "undertown-7", // Poorhouse
  "undertown-5", // Depot
  "undertown-6", // Merchant
  "undertown-4", // Sewer
];

// Down the Den's stairs, for the people who work in the basement. The stair is
// `locked: den-key` rather than hidden, so it is already a sighting for anyone
// standing in the Den — this only upgrades it to somewhere they have been.
const DEN_HOUSE = [...UNDERTOWN_COMMON, "undertown-9"];

// NEVER put one of these in a table. The Alleys sit behind `hidden: tunnel-rat`
// and are the one real leak this file has available to it; the Hole in the Wall
// is Bascinet's ruling. `db/test/startingMemories.test.js` asserts it rather
// than trusting this comment.
//
// Two places are called "Alleys", and they are not the same place. `town-5` is
// the town's, it is in TOWN_ALL, and it is safe. `undertown-d` is this one.
const UNDERTOWN_SECRET = ["undertown-d", "undertown-f"];

// Order Chambers, Basements, Nook and Island. Named on the barony2 plate and
// real Locations, but Bascinet wrote them into the game live at /gm/dev/zones
// and docs/zones.yaml still carries them as skeletons with no edges at all — so
// from here there is no way to tell which of them is an ordinary street and
// which is behind a hidden crawl. They are held out of every tier until
// somebody who can read the live graph says otherwise. Moving one into
// UNDERTOWN_COMMON is a one-line change; guessing wrong the other way hands out
// a secret, so the fog is the safe default.
const UNDERTOWN_UNCLASSIFIED = ["undertown-b", "undertown-e", "undertown-g", "undertown-h"];

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

// Where the Factory's goods go. A Factory seat runs the Squeeze to the freight
// platform and sells through the counter beside it, whether or not they have
// ever been further into the Undertown than that.
const TRADE_END = ["undertown-5", "undertown-6"];

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
  // mortus: the vow, always knows the way down to the Tower.
  mortus: [...RAVENHEART, "undertown-3"],
  // prospector: the seams are out past the bridge and down the cave mouth, and
  // digging them is the whole of the seat.
  prospector: [...RAVENHEART, "bridge", "caves-1", "caves-2"],

  // The Undertown. The Bum sleeps in the Slums; the Den's four seats work the
  // basement under it. The Exactor also gets the Lake, because his own back
  // door out of the Den Interior is `hidden: strong-swimmer` and the sighting
  // write will therefore never paint it for him — the man who owns the cellar
  // knows where his escape comes out.
  bum: [...RAVENHEART, ...UNDERTOWN_COMMON],
  exactor: [...RAVENHEART, ...DEN_HOUSE, "undertown-c"],
  pusher: [...RAVENHEART, ...DEN_HOUSE],
  courtesan: [...RAVENHEART, ...DEN_HOUSE],
  goon: [...RAVENHEART, ...DEN_HOUSE],
  slave: [...RAVENHEART, ...DEN_HOUSE],

  // The trade. Both of these run the freight platform, and both walk the road
  // out to the Factory whose goods they move.
  merchant: [...RAVENHEART, ...UNDERTOWN_COMMON, ...CAVE_MOUTH, ...FACTORY_ROAD],
  docker: [...RAVENHEART, ...UNDERTOWN_COMMON, ...CAVE_MOUTH, ...FACTORY_ROAD],

  // The Factory. The road up to town, and the two places the Squeeze is sold.
  banneret: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...TRADE_END, ...RAVENHEART],
  geschef: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...TRADE_END, ...RAVENHEART],
  refugee: [...FACTORY_CLUSTER, ...FACTORY_ROAD, ...TRADE_END, ...RAVENHEART],

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
  UNDERTOWN_SECRET,
  UNDERTOWN_UNCLASSIFIED,
};
