// The Deep Beast Horn: the trumpet's ugly cousin. Where a trumpet carries a few
// hops across the Location graph (db/lib/trumpet.js), the horn is heard in
// every surface Location in the game at once -- it is not a signal to the next
// valley, it is a war call to the whole barony.
//
// IT DOES NOT REACH THE CAVES. `zoneKinds: ["SURFACE"]` is the whole rule: a
// horn sounded up top is not heard down a cave level, and one sounded IN a cave
// still only reaches the surface, which is the same asymmetry a bell has no
// business having and the reason this is not db/lib/soundBroadcast.js -- that
// module is range-gated from an origin and symmetric about it. This one has no
// origin at all, like the nuke.
//
// Takes `prisma` as a parameter, off the @lifeweb/db barrel (db/lib/dm.js
// convention); require it by path.
const { ambientEverywhere } = require("./worldBroadcast");
const { BELL_COOLDOWN_MS } = require("./bell");
const { SFX } = require("./sfx");

const HORN_COOLDOWN_MS = BELL_COOLDOWN_MS;

// Bascinet's line. Nothing in it says who blew it or where from -- that is the
// point of a horn nobody can place.
const HORN_LINE = "You hear a deep, booming horn.";

async function broadcastDeepBeastHorn(prisma) {
  // `signed: false` is how the nuke's own world lines are filed too: nothing
  // about a horn nobody can place should be attributed to anyone.
  return ambientEverywhere(prisma, HORN_LINE, { signed: false, zoneKinds: ["SURFACE"], sfx: SFX.HORN });
}

module.exports = { HORN_COOLDOWN_MS, HORN_LINE, broadcastDeepBeastHorn };
