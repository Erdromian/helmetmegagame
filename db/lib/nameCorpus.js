// The pool the "Randomize" button and the /character Bio panel draw from. Kept in code, not YAML, so a client component can import it. Pure: no prisma, no node: builtins, no I/O.
// Central/Eastern European, Iberian, and British given names and surnames from OpenXcom's SoldierName/*.nam files (GPL-3.0).
const SLAVIC_WEST = "slavic-west"; // Polish, Czech, Slovak
const HUNGARIAN = "hungarian";
const ROMANIAN = "romanian";
const SLAVIC_SOUTH = "slavic-south";
const RUTHENIAN = "ruthenian";
const BALTIC = "baltic";
const IBERIAN = "iberian";
const BRITISH = "british";
const ARABIC = "arabic";

// `[region, ...names]` rows, expanded below.
function expand(rows) {
  return Object.freeze(
    rows.flatMap(([region, ...names]) => names.map((name) => Object.freeze({ name, region }))),
  );
}

const MEDIEVAL_MALE = expand([
  [SLAVIC_WEST, "Jan", "Piotr", "Tomasz", "Marek", "Ales", "David", "Filip", "Vojtech", "Andrej", "Jakub", "Milan", "Peter"],
  [HUNGARIAN, "Adam", "Andras", "Attila", "Balazs", "Gabor", "Istvan", "Laszlo", "Zoltan"],
  [ROMANIAN, "Adrian", "Alexandru", "Andrei", "Bogdan", "Constantin", "Mihai", "Vlad"],
  [SLAVIC_SOUTH, "Aleksandar", "Dimitar", "Georgi", "Ivan", "Nikola", "Stoyan"],
  [RUTHENIAN, "Aleksandr", "Andrey", "Boris", "Ivan", "Nikolay", "Sergey", "Vladimir"],
  [BALTIC, "Mindaugas", "Gediminas", "Vytautas", "Kęstutis"],
  [IBERIAN, "Alejandro", "Diego", "Javier", "Miguel", "Afonso", "Joao", "Rui", "Vasco"],
  [BRITISH, "Alexander", "Andrew", "Charles", "James", "Thomas", "William"],
]);

const MEDIEVAL_FEMALE = expand([
  [SLAVIC_WEST, "Anna", "Katarzyna", "Barbara", "Ewa", "Adela", "Eva", "Hana", "Tereza", "Andrea", "Lenka", "Natalia", "Zuzana"],
  [HUNGARIAN, "Agnes", "Alexandra", "Aniko", "Erzsebet", "Ilona", "Judit", "Katalin", "Zsofia"],
  [ROMANIAN, "Alexandra", "Ana", "Andreea", "Carmen", "Elena", "Ioana", "Maria"],
  [SLAVIC_SOUTH, "Ana", "Boyana", "Ivana", "Maya", "Svetlana", "Yana"],
  [RUTHENIAN, "Anna", "Ekaterina", "Irina", "Natalya", "Olga", "Svetlana", "Tatyana"],
  [BALTIC, "Birutė", "Aldona", "Danutė", "Gražina"],
  [IBERIAN, "Ana", "Carmen", "Isabel", "Sofia", "Beatriz", "Catarina", "Ines", "Mariana"],
  [BRITISH, "Alice", "Elizabeth", "Emma", "Hannah", "Margaret", "Victoria"],
]);

const MEDIEVAL_SURNAMES = expand([
  [SLAVIC_WEST, "Nowak", "Kowalski", "Wisniewski", "Wojcik", "Dvorak", "Novak", "Svoboda", "Kral", "Baca", "Horvath", "Nagy", "Varga", "Kovac", "Simek"],
  [HUNGARIAN, "Nagy", "Kovacs", "Toth", "Szabo", "Horvath", "Varga", "Kiss", "Molnar", "Farkas", "Balogh"],
  [ROMANIAN, "Popescu", "Ionescu", "Constantin", "Dumitru", "Stanescu", "Radu", "Munteanu", "Georgescu"],
  [SLAVIC_SOUTH, "Ivanov", "Petrov", "Dimitrov", "Georgiev", "Todorov", "Hristov", "Nikolaev", "Markov"],
  [RUTHENIAN, "Ivanov", "Petrov", "Smirnov", "Volkov", "Kuznetsov", "Sokolov", "Popov", "Morozov"],
  [BALTIC, "Radvila", "Sapieha", "Goštautas"],
  [IBERIAN, "Garcia", "Rodriguez", "Martinez", "Fernandez", "Silva", "Ferreira", "Pereira", "Costa", "Mendoza", "Almeida"],
  [BRITISH, "Adams", "Anderson", "Baker", "Clarke", "Fraser", "Mackenzie", "Taylor", "Wallace"],
]);

// THE BASTARD'S PARTY names itself out of three registers and nothing else: this
// Arabic-flavoured pool, the Hungarian rows of the medieval pool above, and the
// object/noun nicknames below. They came over the hills from somewhere that is
// not Ravenheart, and a party of Kowalskis and Andersons read as locals with a
// grievance rather than as outsiders. Deliberately archaic and a little
// invented rather than modern-Arabic: the register is a desert people three
// centuries from anywhere, not a place on a map.
//
// Forty given names, 26 men and 14 women. The split is lopsided because four of
// the six party seats are men (docs/roles.yaml `gender: MAN`) and only the
// Healer and the Engineer roll a woman at all.
const ARABIC_MALE = expand([
  [ARABIC, "Ghanim", "Harith", "Jubayr", "Mudhir", "Nasif", "Qasim", "Rashad", "Sadiq", "Tahir",
    "Uthman", "Zahir", "Amjad", "Bashir", "Dhiyab", "Faris", "Hamdan", "Ilyas", "Jamal", "Khalaf",
    "Marwan", "Nadhir", "Rafiq", "Sabir", "Suhail", "Talib", "Yusar"],
]);

const ARABIC_FEMALE = expand([
  [ARABIC, "Alima", "Basma", "Dhala", "Farida", "Hanaa", "Jamila", "Khadra", "Layan", "Munira",
    "Nawar", "Rahma", "Sahar", "Thurayya", "Zaynab"],
]);

// Tribal and place-name surnames rather than patronymics, so a party arriving
// together reads as one people from one dry place.
const ARABIC_SURNAMES = expand([
  [ARABIC, "al-Hadid", "al-Qamar", "al-Ghurab", "al-Mirzam", "al-Suhayl", "al-Dahna", "al-Nafud",
    "al-Rimal", "al-Wadi", "al-Sakhra", "al-Bidayn", "ibn Sarraj", "ibn Qurash", "ibn Marid"],
]);

// The non-medieval pool: cosmopolitan given names and object/noun nicknames, including RimWorld colonist nicknames (rimworldwiki.com/wiki/User:Paintsimmon/NameinGame). These carry no region — pairing with a regional surname is the point.
function freezeNames(names) {
  return Object.freeze(names.map((name) => Object.freeze({ name, region: null })));
}

const FLAVOUR_NEUTRAL_NAMES = [
  "Bastion", "Blade", "Bomb", "Bond", "Bones", "Bookworm", "Boomer", "Boots", "Bramble", "Bravo",
  "Bubbles", "Buck", "Buddy", "Bugsy", "Bull", "Buster", "Butcher", "Cadet", "Cake", "Cannon",
  "Canyon", "Cash", "Castle", "Chef", "Chief", "Chili", "Chopper", "Cobra", "Coffee", "Colonel",
  "Comrade", "Cookie", "Cornbread", "Corporal", "Cosmic", "Dagger", "Dapper", "Dash", "Diesel", "Duke",
  "Echo", "Falcon", "Ferret", "Flint", "Fox", "Fury", "Hammer", "Havoc", "Hawk", "Honey",
  "Hound", "Husky", "Justice", "Legend", "Lucky", "Lynx", "Maestro", "Magpie", "Mantis", "Maverick",
  "Meerkat", "Nova", "Ocelot", "Onyx", "Peaches", "Pepper", "Phoenix", "Pickle", "Possum", "Preacher",
  "Puma", "Raccoon", "Ranger", "Rebel", "Reckless", "Rogue", "Rowdy", "Rutabaga", "Sarge", "Scout",
  "Sensei", "Shadow", "Shark", "Sharp", "Skipper", "Slate", "Smokey", "Spark", "Sparrow", "Static",
  "Storm", "Swift", "Thistle", "Thunder", "Toucan", "Turtle", "Weasel", "Wolf", "Wombat", "Zero",
  // Kenshi's shared male/female column (kenshi.fandom.com/wiki/Random_Names_List).
  "Bark", "Burn", "Claw", "Dirt", "Fade", "Fish", "Flick", "Gecko", "Gills", "Hex",
  "Ice", "Knife", "Patch", "Plank", "Ribs", "Saint", "Sand", "Scratch", "Slick", "Spade",
  "Squint", "Stone", "Stork", "Streak", "Twitch",
  "Rusty", "Trigger", "Moth", "Snake", "Wingnut", "Tweak", "Pyro", "Shorty", "Shrike", "Stalker",
  "Laser", "Steel", "Twig", "Killjoy", "Doom", "Snow", "Blue", "Ginger", "Styx", "Ninja",
  "DJ", "VV", "AJ", "MJ", "TJ",
];

const FLAVOUR_MALE = freezeNames([
  "Ernö", "Santiago", "Aurel", "Zoltán", "Kasimir", "Stellan",
  "Emeric", "Tibor", "Rui", "Nikodem", "Marek", "Cosmin",
  "Cog", "Sprite", "Kid", "Bishop",
  "Codsworth", "Freeman", "Rockatansky", "Halloway",
  "Bigwig", "Buckthorn", "Woundwort", "Strong", "Brick", "Rook", "Ghost", "Scooter", "Domino",
  "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
  // Kenshi's male-only column.
  "Arkh", "Barth", "Brecht", "Carp", "Garr", "Harp", "Hesric", "Krup", "Nines",
  "Stenn", "Thoke", "Voth", "Zepp", "Zimm",
  ...FLAVOUR_NEUTRAL_NAMES,
]);

const FLAVOUR_FEMALE = freezeNames([
  "Klaasje", "Marienne", "Annika", "Ilse", "Zsóka", "Věra",
  "Renata", "Solveig", "Pilar", "Nadia", "Lenka", "Mirela",
  "Kit", "Pip", "Dita", "Bibi",
  "Holly", "Clover", "Bluebell", "Ivy", "Red",
  "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
  "Osgood", "Vermeer", "Ashby",
  // Kenshi's female-only column.
  "Adi", "Kat", "Liff", "Nat", "Nei", "Pins", "Rin", "Slink", "Trepp", "Wish",
  ...FLAVOUR_NEUTRAL_NAMES,
]);

// Tags a given name as belonging to the Witcher batch, so randomCharacterName reaches for FLAVOUR_WITCHER_SURNAMES instead of a medieval one.
const WITCHER = "witcher";

// Three Hearts of Stone (DLC) characters, kept as their own category.
const FLAVOUR_WITCHER = Object.freeze(
  ["Olgierd", "Vlodimir", "Gaunter"].map((name) => Object.freeze({ name, region: WITCHER })),
);
const FLAVOUR_WITCHER_SURNAMES = Object.freeze(["von Everec", "O'Dimm"]);

const NAME_CORPUS = Object.freeze({
  medieval: Object.freeze({
    male: MEDIEVAL_MALE,
    female: MEDIEVAL_FEMALE,
    surnames: MEDIEVAL_SURNAMES,
  }),
  flavour: Object.freeze({
    male: FLAVOUR_MALE,
    female: FLAVOUR_FEMALE,
    witcher: FLAVOUR_WITCHER,
  }),
  arabic: Object.freeze({
    male: ARABIC_MALE,
    female: ARABIC_FEMALE,
    surnames: ARABIC_SURNAMES,
  }),
});

// --- The Bastard's party --------------------------------------------------
// Which seats name themselves out of the invaders' three registers. Kept here
// as slugs rather than a Role column, for the reason db/lib/roleIds.js and
// db/lib/lateJoin.js give: a fixed value that can never differ per
// environment, and a column would only add a way to drift from
// docs/roles.yaml. Same six slugs as LATE_JOIN_ROLE_SLUGS, and they must stay
// in step -- a seat added to the party wants its names as well as its chair.
const BASTARD_CULTURE = "bastard";
const BASTARD_ROLE_SLUGS = Object.freeze([
  "bastard",
  "bastard-infantry",
  "bastard-heavy-infantry",
  "bastard-rifleman",
  "bastard-healer",
  "bastard-engineer",
]);

// Null for everybody else, which is what keeps the ordinary roll untouched.
function cultureForRole(slug) {
  return BASTARD_ROLE_SLUGS.includes(slug) ? BASTARD_CULTURE : null;
}

const HUNGARIAN_MALE = MEDIEVAL_MALE.filter((n) => n.region === HUNGARIAN);
const HUNGARIAN_FEMALE = MEDIEVAL_FEMALE.filter((n) => n.region === HUNGARIAN);
const HUNGARIAN_SURNAMES = MEDIEVAL_SURNAMES.filter((n) => n.region === HUNGARIAN);

// A noun carries no surname of its own, so it borrows one from the party's
// other two registers -- the same cross-pairing the flavour pool already does.
const BASTARD_SURNAMES = Object.freeze([...ARABIC_SURNAMES, ...HUNGARIAN_SURNAMES]);
const NOUN_NAMES = freezeNames(FLAVOUR_NEUTRAL_NAMES);

// Even thirds. The noun register is the one that makes the party read as a
// warband rather than a nation, so it is not a rare garnish.
function bastardRegister(random) {
  const roll = random();
  if (roll < 1 / 3) return "arabic";
  if (roll < 2 / 3) return "hungarian";
  return "noun";
}

// How often a roll reaches for the flavour pool instead of the medieval one.
const FLAVOUR_CHANCE = 1 / 3;

// Of a flavour roll, how often it narrows to the three-name Witcher batch.
const WITCHER_SHARE_OF_FLAVOUR = 1 / 10;

// How often a medieval given name is paired with a surname from a different region.
const CROSS_REGION_CHANCE = 0.15;

// Which given-name pool a character's gender implies.
// `male`/`female` override the two defaults, which is how the Bastard's party
// borrows the NEUTRAL-draws-from-both rule without restating it.
function poolsFor(gender, medieval, male = null, female = null) {
  const men = male ?? (medieval ? MEDIEVAL_MALE : FLAVOUR_MALE);
  const women = female ?? (medieval ? MEDIEVAL_FEMALE : FLAVOUR_FEMALE);
  switch (gender) {
    case "MAN":
      return [men];
    case "WOMAN":
      return [women];
    // NEUTRAL draws from both.
    default:
      return [men, women];
  }
}

// `random` is injectable so the distribution is testable without stubbing globals; `lastName` is null when `lastNameLocked` (see db/lib/dynasty.js).
function randomCharacterName({
  gender = "NEUTRAL",
  random = Math.random,
  lastNameLocked = false,
  culture = null,
} = {}) {
  const pick = (arr) => arr[Math.floor(random() * arr.length)];

  // The Bastard's party never reaches the ordinary pools at all -- no medieval
  // roll, no flavour roll, no Witcher. Three registers and out.
  if (culture === BASTARD_CULTURE) {
    const register = bastardRegister(random);
    const given =
      register === "noun"
        ? pick(NOUN_NAMES)
        : register === "arabic"
          ? pick(pick(poolsFor(gender, false, ARABIC_MALE, ARABIC_FEMALE)))
          : pick(pick(poolsFor(gender, false, HUNGARIAN_MALE, HUNGARIAN_FEMALE)));
    if (lastNameLocked) return { firstName: given.name, lastName: null };
    const surnames =
      register === "arabic"
        ? ARABIC_SURNAMES
        : register === "hungarian"
          ? HUNGARIAN_SURNAMES
          : BASTARD_SURNAMES;
    return { firstName: given.name, lastName: pick(surnames).name };
  }

  const useFlavour = random() < FLAVOUR_CHANCE;
  // The three Witcher names are all masculine.
  const useWitcher = useFlavour && gender !== "WOMAN" && random() < WITCHER_SHARE_OF_FLAVOUR;
  const given = useWitcher ? pick(FLAVOUR_WITCHER) : pick(pick(poolsFor(gender, !useFlavour)));

  if (lastNameLocked) return { firstName: given.name, lastName: null };

  if (given.region === WITCHER) {
    return { firstName: given.name, lastName: pick(FLAVOUR_WITCHER_SURNAMES) };
  }

  // A flavour name carries no region, so it always takes the cross-region path.
  const matching =
    given.region && random() >= CROSS_REGION_CHANCE
      ? MEDIEVAL_SURNAMES.filter((s) => s.region === given.region)
      : [];

  // Fallback is currently unreachable; guards a future region with no surnames.
  return {
    firstName: given.name,
    lastName: pick(matching.length ? matching : MEDIEVAL_SURNAMES).name,
  };
}

module.exports = {
  NAME_CORPUS,
  BASTARD_CULTURE,
  BASTARD_ROLE_SLUGS,
  cultureForRole,
  FLAVOUR_CHANCE,
  CROSS_REGION_CHANCE,
  WITCHER_SHARE_OF_FLAVOUR,
  randomCharacterName,
};
