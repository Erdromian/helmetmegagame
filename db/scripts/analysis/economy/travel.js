// The selling trip the planner leaves out. The planner (combos.js) finds the best schedule of Moves and fatigue, but
// it sells nothing: production only becomes ¢ once it reaches the Depot's zone. This charges each loadout for that,
// after the fact, by one stated rule:
//   - one sale trip per production cycle, out from the furthest zone the pattern works in and back; the cycle is the
//     laddered verb's (a press one turn in 1 ÷ duty), or one turn for a pattern of crafts alone;
//   - a load a bare carrier cannot take in one trip (the Factory's cubes, per transport.js) takes that many trips;
//   - the crossings are paid first out of the free allowance a turn (GameConfig.freeZoneMovesPerTurn) that the
//     pattern is not already spending on its own moves; a crossing past that costs the Move of that turn
//     (db/lib/locationTravel.js). A rest turn's Move is idle anyway, so one paid crossing on each rest turn costs
//     nothing; any crossing beyond those takes a working turn's Move and stretches the cycle by a turn.
// A craft is done wherever the crafter stands, and a crafter who needs no fixed workshop is taken to stand at the Depot.
// A verb's zone comes from the planner's own path, never from a name.

const LADDERED = new Set(["M", "F", "R"]);

function buildTravel({ combos, params, transport, free }) {
  const depot = combos.sites.depot;
  const hops = (a, b) => (a && b ? combos.hops[a]?.[b] ?? 0 : 0);
  const refineTrips = Math.max(1, transport?.squeezeFlow?.carriers?.find((c) => c.carrier === "Bare")?.trips ?? 1);
  const dutyOf = { M: params.mineDuty, F: params.farmDuty, R: params.refineDuty };

  const adjust = (plan) => {
    const letters = plan.letters ?? [];
    const zones = plan.zoneSlugs ?? [];
    const n = letters.length || 1;
    // Where the work happens, and the most any of it is from the Depot.
    const workZones = [...new Set(letters.map((l, i) => (LADDERED.has(l) ? zones[i] : l === "C" ? depot : null)).filter(Boolean))];
    const far = workZones.reduce((m, z) => Math.max(m, hops(z, depot)), 0);
    const laddered = letters.filter((l) => LADDERED.has(l));
    const cycle = laddered.length ? 1 / Math.min(...laddered.map((l) => dutyOf[l])) : 1;
    const trips = letters.includes("R") ? refineTrips : 1;
    // The crossings the pattern already makes, a turn: every change of zone between consecutive turns.
    const own = zones.slice(1).reduce((c, z, i) => c + hops(zones[i], z), 0) / n;
    // Per production cycle: the crossings a sale needs, the free ones left over, and the rest turns' idle Moves.
    const needed = letters.some((l) => LADDERED.has(l) || l === "C") ? 2 * far * trips : 0;
    const spare = Math.max(0, free - own);
    const idle = (letters.filter((l) => l === "·").length / n) * cycle;
    const lostMoves = Math.max(0, needed - spare * cycle - idle); // working Moves a cycle the trips take
    const after = plan.rate * (cycle / (cycle + lostMoves));
    return { workZones, sellZone: depot, far, cycle, trips, own, needed, spare, idle, lostMoves, rate: plan.rate, after };
  };

  // The loadout rides along unlisted, so model.json carries the key and the figures, not a second copy of the planner.
  const rows = combos.loadouts.map((l) => Object.defineProperty({ key: l.picked.join("+"), skills: l.skills, withFactory: adjust(l.withFactory), noFactory: adjust(l.noFactory) }, "loadout", { value: l, enumerable: false }));
  return { free, depot, refineTrips, rows, byKey: new Map(rows.map((r) => [r.loadout.picked.join("+"), r])) };
}

module.exports = { buildTravel };
