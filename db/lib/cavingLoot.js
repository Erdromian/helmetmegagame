// TWO loot tables, both code rather than YAML, since this is mechanics (a weighted draw) rather than
// player-facing catalog data. Both work the same way: pick a tier by the standing zone's column, then
// pick uniformly among that tier's slugs. Slugs are validated against the live Tag catalog by
// validateCavingLoot() — call once at startup (bot/src/index.js, web's instrumentation hook), not
// per-roll, so a typo fails the deploy rather than a player's roll.
//
//   THE CAVING DIE (docs/systemdocs/CAVING.md) — drawn by db/lib/cavingPass.js on a roll of 6 at a
//   CAVE_LEVEL arrival. Junk, tools and the odd weapon: what the caves leave lying around.
//
//   THE PROSPECTING TABLE (docs/systemdocs/MINING.md) — drawn by db/lib/moveEffects.js on every Mine
//   press, by anybody; holding Prospecting only picks a richer column. Ore, metal and gemstones
//   only, all of it feeding Smithing and Trinkets.
//
// The two share this file on purpose. They were one weighted draw and one whole YAML-driven
// subsystem (MiningDropOption, a sync, a rarity module, an EV module, an audit script) until
// 2026-09-18, when the second was deleted and folded into the first. Keep them here together: a
// second copy of drawLoot is how they drift apart.
//
//   THE GATHERING TABLE (docs/systemdocs/MINING.md §3c) — drawn instead of the prospecting table when
//   the press happens in a zone db/lib/gathering.js calls a gathering zone (the Black Hills). Food
//   only, in small stacks: what a day of turning stones, checking the river and the snares brings home.
//   Prospecting does not touch it — the skill reads ore, and there is no ore up there.
//
// A zone with no column in a weights map simply does not roll on that table. That is what keeps Town
// out of every one of them — the absence IS the rule, not an oversight. The Black Hills used to be the
// example here, minable for ⬢ and never for loot; since 2026-09-22 they draw on the gathering table.

// Which zones gather is decided in one place, db/lib/gathering.js; the draw below asks it rather than
// reading the keys of GATHERING_WEIGHTS_BY_ZONE, so the button's word and the table can't disagree.
const { GATHERING_ZONE_SLUGS, isGatheringZone } = require("./gathering");

const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// Each column sums to 1 (checked by validateCavingLoot). Depths carries the old Aberrant Pits column
// unchanged, since it's the only deep place left on the map.
const WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.65,
    common: 0.25,
    uncommon: 0.08,
    rare: 0.0195,
    "extremely-rare": 0,
    "nearly-impossible": 0.0005,
  },
  depths: {
    ultracommon: 0.15,
    common: 0.22,
    uncommon: 0.28,
    rare: 0.25,
    "extremely-rare": 0.07,
    "nearly-impossible": 0.03,
  },
};

// Tier contents, by slug. Weapon/armor tiers pull representative slugs off SMITHING.md §3/§4's ladder
// rather than every entry in it.
const LOOT_TABLE = {
  // rock-salt is ultracommon on Bascinet's call (docs/systemdocs/COOKING.md) — the thing a cook can
  // always get and is never pleased to see.
  ultracommon: ["cave-fungus", "saltpeter", "purring-maggot", "rock", "rock-salt"],
  common: ["cudgel", "purse", "cracked-bone-club", "sling", "skinned-cave-rat", "old-coin"],
  uncommon: [
    "alcohol",
    "cleaning-powder",
    "bear-trap",
    "hatchet",
    "dagger",
    "padded-armor",
    "mail-coif",
    "prospectors-notes",
    "buckler",
    "spear",
    "rope",
    "work-knife",
    "knuckle-duster",
    "honey",
  ],
  rare: [
    "ravenheart-red",
    "salvage-plate",
    "supply-kit",
    "jewelry",
    "bliss",
    "gas-mask",
    "broadsword",
    "war-hammer",
    "convoy-directions",
    "instrument-kit",
    "mining-helmet",
    // The Baron's lift. It came off the Hand's starting tags, so this and the
    // Black Market terminal are how anybody else gets down to the Refuse Pit
    // without asking him (docs/tags.yaml#elevator-key).
    "elevator-key",
  ],
  "extremely-rare": [
    "emp-grenade",
    "smithing-gunpowder",
    "jester-outfit",
    "starting-wares",
    "military-autoinjector",
    "autocannon-shell",
    "zweihander",
    "crossbow",
    "ancient-keycard",
    "fragmentation-grenade",
    "neoclassic-duelista",
  ],
  "nearly-impossible": ["energy-shield", "power-fist", "neoclassic-rw10", "stepstone", "dark-eye-lenses", "motorcycle"],
};

// The prospecting table's own columns. Thinner than the Caving Die's at the top and steeper at the
// bottom: a day's dig should mostly turn up rock, and the Depths should be where anything worth
// having comes from. There is deliberately no `hills` column (see the header).
//
// TWO sets, because Prospecting stopped gating the draw and became a boost to it. Anybody holding a
// pickaxe draws on the plain column; the skill moves you to the skilled one. That is the "precious
// metal yield" half of what the skill buys — the ⬢ half is the 1.7x in db/lib/mining.js.
const PROSPECTING_WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.62,
    common: 0.26,
    uncommon: 0.09,
    rare: 0.028,
    "extremely-rare": 0.0015,
    "nearly-impossible": 0.0005,
  },
  depths: {
    ultracommon: 0.18,
    common: 0.24,
    uncommon: 0.28,
    rare: 0.22,
    "extremely-rare": 0.06,
    "nearly-impossible": 0.02,
  },
};

// Roughly 20% better across the board. Caves is exactly that: every tier above ultracommon times
// 1.2, with the remainder taken off ultracommon. Depths is hand-set instead of computed, because a
// straight 1.2 there lands ultracommon at 1.6% — the arithmetic is right and the result reads as a
// bug, since 82% of that column is already above ultracommon. 5% is the smallest number that still
// looks deliberate.
const PROSPECTING_SKILLED_WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.544,
    common: 0.312,
    uncommon: 0.108,
    rare: 0.0336,
    "extremely-rare": 0.0018,
    "nearly-impossible": 0.0006,
  },
  depths: {
    ultracommon: 0.05,
    common: 0.25,
    uncommon: 0.32,
    rare: 0.27,
    "extremely-rare": 0.08,
    "nearly-impossible": 0.03,
  },
};

// Ore, metal and stones, plus four things that are not ingredients at all (purse, supply-kit,
// mining-helmet, jewelry, lockbox) sitting at the rare and extremely-rare rungs so the table has
// something in it besides inlay values. The three ores are ultracommon and nearly worthless raw —
// their whole value is on the far side of a smelt (docs/tags.yaml's Mining catalog comment).
const PROSPECTING_TABLE = {
  ultracommon: ["hematite", "malachite", "garnierite"],
  common: ["citrine", "milk-quartz", "onyx", "moonstone", "pyrite", "white-jade"],
  uncommon: ["silver", "fire-opal", "sphalerite", "tetrahedrite", "old-coin"],
  rare: ["opal", "topaz", "amethyst", "kunzite", "purse", "supply-kit"],
  "extremely-rare": ["platinum", "lockbox", "mining-helmet", "jewelry"],
  "nearly-impossible": ["star-sapphire", "black-diamond", "arkenstone"],
};

// What a day in the hills brings home. Every entry is FOOD — a raw ingredient a cook turns into a
// dish (docs/systemdocs/COOKING.md §11) or something edible as it is — and most come as a small stack,
// because one mushroom is not a day's work. An entry is `{ slug, quantity }`; the two tables above are
// bare slugs, and drawFrom reads either shape. Boar Loin and Deer Liver had no source at all before
// this (the Hunting tier they came from is gone, MINING.md §0), so the rare rungs are where they
// live now. The egg at the bottom is a wild arelitz clutch — carry it to a stable and it hatches
// (ARELITZ.md §4). The weights are one column, `hills`, plain and skilled alike.
const GATHERING_TABLE = {
  ultracommon: [
    { slug: "cave-fungus", quantity: 2 },
    // Wild produce, which is Foodstuffs now that the separate crops are gone
    // (the Soilery Rework doc). Two small finds rather than one bigger one,
    // so a day comes up Foodstuffs as often as it did onions or carrots.
    { slug: "foodstuffs", quantity: 2 },
    { slug: "foodstuffs", quantity: 3 },
  ],
  common: [
    { slug: "crayfish", quantity: 2 },
    { slug: "meat", quantity: 1 },
    { slug: "skinned-cave-rat", quantity: 1 },
  ],
  uncommon: [
    { slug: "deep-morel", quantity: 1 },
    { slug: "honey", quantity: 1 },
    { slug: "meat", quantity: 2 },
  ],
  rare: [
    { slug: "boar-loin", quantity: 1 },
    { slug: "deer-liver", quantity: 1 },
  ],
  "extremely-rare": [
    { slug: "boar-loin", quantity: 2 },
    { slug: "deer-liver", quantity: 2 },
  ],
  "nearly-impossible": [{ slug: "arelitz-egg", quantity: 1 }],
};

// Bottom-heavy on purpose: most days are fungus and roots, a good day is meat or a fish, and the
// hunted cuts are a story to tell. Sums to 1 like every other column here.
const GATHERING_WEIGHTS_BY_ZONE = {
  hills: {
    ultracommon: 0.5,
    common: 0.3,
    uncommon: 0.14,
    rare: 0.045,
    "extremely-rare": 0.01,
    "nearly-impossible": 0.005,
  },
};

// An entry is a bare slug or `{ slug, quantity }`; this is the one place that reads either.
function entrySlug(entry) {
  return typeof entry === "string" ? entry : entry?.slug;
}

function entryQuantity(entry) {
  const q = typeof entry === "string" ? 1 : Number(entry?.quantity ?? 1);
  return Number.isInteger(q) && q > 0 ? q : 1;
}

// Validated once at process startup (bot/src/index.js, web's instrumentation.js), not per roll —
// throwing here means the loot table references something absent from docs/tags.yaml.
async function validateCavingLoot(prisma) {
  const tables = { LOOT_TABLE, PROSPECTING_TABLE, GATHERING_TABLE };
  const slugsOf = (table) => Object.values(table).flat().map(entrySlug);
  const allSlugs = new Set(Object.values(tables).flatMap(slugsOf));
  const found = await prisma.tag.findMany({ where: { slug: { in: [...allSlugs] } }, select: { slug: true } });
  const foundSlugs = new Set(found.map((t) => t.slug));
  for (const [name, table] of Object.entries(tables)) {
    const missing = [...new Set(slugsOf(table))].filter((s) => !foundSlugs.has(s));
    if (missing.length) {
      throw new Error(`db/lib/cavingLoot.js: ${name} references unknown tag slug(s): ${missing.join(", ")}`);
    }
  }
  const maps = { WEIGHTS_BY_ZONE, PROSPECTING_WEIGHTS_BY_ZONE, PROSPECTING_SKILLED_WEIGHTS_BY_ZONE, GATHERING_WEIGHTS_BY_ZONE };
  for (const [name, map] of Object.entries(maps)) {
    for (const [zoneSlug, weights] of Object.entries(map)) {
      const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
      if (Math.abs(sum - 1) > 1e-6) {
        throw new Error(`db/lib/cavingLoot.js: ${name}["${zoneSlug}"] sums to ${sum}, not 1`);
      }
    }
  }
  // A gathering zone with no column would say Gather and hand back nothing, so it fails the boot instead.
  const unweighted = GATHERING_ZONE_SLUGS.filter((slug) => !GATHERING_WEIGHTS_BY_ZONE[slug]);
  if (unweighted.length) {
    throw new Error(`db/lib/cavingLoot.js: gathering zone(s) with no GATHERING_WEIGHTS_BY_ZONE column: ${unweighted.join(", ")}`);
  }
}

// The shared draw: land on a tier by cumulative weight, then pick uniformly inside it.
function drawFrom(weights, table) {
  let roll = Math.random();
  let tier = TIERS[TIERS.length - 1];
  for (const t of TIERS) {
    const w = weights[t] ?? 0;
    if (roll < w) {
      tier = t;
      break;
    }
    roll -= w;
  }
  const pool = table[tier];
  const entry = pool[Math.floor(Math.random() * pool.length)];
  // `quantity` is 1 for the two bare-slug tables; only the gathering table stacks a find.
  return { tier, slug: entrySlug(entry), quantity: entryQuantity(entry) };
}

// Draws for the given cave-level zone slug (caves/depths). THROWS on an unknown zone, because
// cavingPass only ever calls it after establishing the Location is CAVE_LEVEL — a zone with no
// column there is a bug, not a quiet no-result.
function drawLoot(zoneSlug) {
  const weights = WEIGHTS_BY_ZONE[zoneSlug];
  if (!weights) throw new Error(`db/lib/cavingLoot.js: no loot weights for zone "${zoneSlug}"`);
  return drawFrom(weights, LOOT_TABLE);
}

// The prospecting twin, and the one place the two differ: this returns NULL for a zone with no
// column rather than throwing. A press somewhere with a `mining:` value and no column ("you dug and
// found nothing") is an ordinary outcome, not a misconfiguration — for a prospector as much as for
// anybody else, so the skill does not buy a column where there is no column to have.
//
// A gathering zone draws on the GATHERING TABLE instead, skilled or not: what the Black Hills give
// up is food, and Prospecting reads ore.
//
// `lucky` draws twice and keeps the rarer tier, the loot-table shape of Lucky's two dice (MINING.md
// §3b). A tie keeps the first draw. It works on either table, since both are the one Mine press.
function drawProspectingLoot(zoneSlug, { prospecting = false, lucky = false } = {}) {
  let weights;
  let table;
  if (isGatheringZone(zoneSlug)) {
    weights = GATHERING_WEIGHTS_BY_ZONE[zoneSlug];
    table = GATHERING_TABLE;
  } else {
    weights = (prospecting ? PROSPECTING_SKILLED_WEIGHTS_BY_ZONE : PROSPECTING_WEIGHTS_BY_ZONE)[zoneSlug];
    table = PROSPECTING_TABLE;
  }
  if (!weights) return null;
  const first = drawFrom(weights, table);
  if (!lucky) return first;
  const second = drawFrom(weights, table);
  return TIERS.indexOf(second.tier) > TIERS.indexOf(first.tier) ? second : first;
}

module.exports = {
  LOOT_TABLE,
  PROSPECTING_TABLE,
  PROSPECTING_WEIGHTS_BY_ZONE,
  PROSPECTING_SKILLED_WEIGHTS_BY_ZONE,
  GATHERING_TABLE,
  GATHERING_WEIGHTS_BY_ZONE,
  validateCavingLoot,
  drawLoot,
  drawProspectingLoot,
};
