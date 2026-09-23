// Where a day's work is Gather rather than Mine, and the words each verb wears.
//
// The Black Hills carry a mining coefficient the way the caves do, but nobody
// up there is breaking a seam: a day in the hills is spent turning over stones,
// checking the river and the snares, and what it turns up beside the ⬢ is
// something to eat rather than ore (db/lib/cavingLoot.js's GATHERING_TABLE,
// docs/systemdocs/MINING.md §3c). Same button, same pickaxe gate, same rate —
// only the verb and the loot table change, and this module is the one place
// the verb is decided, so the sheet's label, its confirm dialog, the refusal a
// bypassed request hits, the Action row and the audit line all agree.
//
// Zero requires, ever, like db/lib/dmKinds.js: the sheet's action registry is a
// client component and reads this for the button's label, and one require of
// @lifeweb/db here would drag PrismaClient into the browser bundle.

// Zone slugs (docs/zones.yaml) where the work is gathering. A zone not listed
// here mines, which is the right default: a new zone with a `mining:` value
// is a seam until somebody says otherwise.
const GATHERING_ZONE_SLUGS = ["hills"];

function isGatheringZone(zoneSlug) {
  return GATHERING_ZONE_SLUGS.includes(zoneSlug);
}

const WORK_VERBS = {
  mine: {
    key: "mine",
    label: "Mine",
    title: "Mine?",
    help: "Spend your turn mining in the caves, yielding resources and a small chance of ore.",
    confirm:
      "You spend the turn in the seam. You are paid immediately — and if you know what you are looking at, you might turn something up on top of it.",
    // The Action row's description, what the desk and the sheet's record print.
    description: "Working a seam.",
    nothingHere: "There's nothing to mine here.",
    needsPickaxe: "You need a pickaxe to break rock.",
    paid: (value) => `You worked the seam, producing ${value} ⬢.`,
    audit: "worked a seam",
    // The bold word Examine prints the place's quality under (db/lib/examineLocation.js).
    examineLabel: "Mining",
  },
  gather: {
    key: "gather",
    label: "Gather",
    title: "Gather?",
    help: "Spend your turn gathering in the hills, yielding resources and a chance of something to eat.",
    confirm:
      "You spend the turn working the hills — turning stones, checking the river and the snares. You are paid immediately, and you may come back with something for the pot.",
    description: "Gathering in the hills.",
    nothingHere: "There's nothing to gather here.",
    needsPickaxe: "You need a pickaxe to dig anything up out here.",
    paid: (value) => `You worked the hills, producing ${value} ⬢.`,
    audit: "gathered in the hills",
    examineLabel: "Gathering",
  },
};

// The verb for a place, by its zone's slug. Unknown or missing means Mine.
function workVerbFor(zoneSlug) {
  return isGatheringZone(zoneSlug) ? WORK_VERBS.gather : WORK_VERBS.mine;
}

// The verb by its own key, for a client that was handed the key rather than
// the zone (pools.workVerb on the sheet). Unknown or missing means Mine.
function workVerbByKey(key) {
  return WORK_VERBS[key] ?? WORK_VERBS.mine;
}

module.exports = {
  GATHERING_ZONE_SLUGS,
  WORK_VERBS,
  isGatheringZone,
  workVerbFor,
  workVerbByKey,
};
