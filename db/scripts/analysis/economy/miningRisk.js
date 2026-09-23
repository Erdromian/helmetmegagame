// Mining: pay, risk and the walk. For every mine and gather row, what it pays a turn against what getting there and
// back costs: the Caving Die on each arrival in a cave level, and the mood of being underground or in the wild.
//
// Everything is read from the model: the hops from the planner's map (combos.js), the cave levels from the map,
// the die's cost per arrival from the Caving tab (wounds at their cure cost and the trouble's mood), and the ambient
// terms from db/lib/mood.js through caving.js. The assumptions are named in the lede and here:
//   - one selling trip per mining cycle: a press one turn in 1 ÷ mineDuty, so a trip that often, in and out;
//   - one arrival for each hop into a zone where the die rolls, both ways;
//   - the miner sleeps where they work every turn, so the nightly place term lands each turn;
//   - Lifeweb failure and the seam drift are not modelled.

function buildMiningRisk({ activities, caving, combos, params }) {
  const depot = combos.sites.depot;
  const adj = combos.adjacency;
  const hopsFrom = (a, b) => combos.hops[a]?.[b] ?? null;
  // The zones walked through from the Depot to `zone`, not counting the start: each step goes to a neighbour one
  // hop further out, which is a shortest path on the planner's own map.
  const pathTo = (zone) => {
    const out = [];
    let cur = zone;
    while (cur && cur !== depot) {
      out.unshift(cur);
      const d = hopsFrom(depot, cur);
      cur = (adj[cur] ?? []).find((nb) => hopsFrom(depot, nb) === d - 1) ?? null;
    }
    return out;
  };
  const rolls = (zone) => params.caveLevels.includes(zone);
  const perArrival = (zone) => caving.perZone[zone]?.base ?? null;
  const tripsPerTurn = params.mineDuty;
  const free = params.freeZoneMoves;

  const rows = activities
    .filter((a) => a.kind === "mine" || a.kind === "gather")
    .map((a) => {
      const zone = a.zone;
      const hops = hopsFrom(depot, zone);
      const inward = pathTo(zone);
      // Out again: every zone on the way back except the Depot's own, in reverse, starting from the one before `zone`.
      const outward = inward.slice(0, -1).reverse();
      const arrivalsRolling = [...inward, ...outward].filter(rolls);
      const dieRiskTrip = arrivalsRolling.reduce((n, z) => n + (perArrival(z)?.danger ?? 0), 0);
      const deathsTrip = arrivalsRolling.reduce((n, z) => n + (perArrival(z)?.deathsPerArrival ?? 0), 0);
      const trouble = arrivalsRolling.length ? perArrival(arrivalsRolling[0])?.pTrouble ?? null : null;
      const dangerPerArrival = arrivalsRolling.length ? dieRiskTrip / arrivalsRolling.length : 0;
      // The ambient mood: the nightly place term every turn, and the arrival term on each arrival of a trip.
      const cls = rolls(zone) ? "CAVE" : "WILDERNESS";
      const amb = caving.ambient[cls];
      const arrivalsPlace = [...inward, ...outward].filter((z) => (cls === "CAVE" ? rolls(z) : z === zone)).length;
      const immune = cls === "CAVE" ? "spelunker" : "outsider";
      const moodTurn = (who) => amb.night[who] + amb.arrival[who] * arrivalsPlace * tripsPerTurn;
      const dieRiskTurn = dieRiskTrip * tripsPerTurn;
      return {
        id: a.id,
        name: a.name,
        zone,
        net: a.netPerTurn,
        hops,
        free,
        paidCrossingsTrip: Math.max(0, 2 * hops - free),
        arrivalsRolling: arrivalsRolling.length,
        trouble,
        dangerPerArrival,
        deathsTrip,
        dieRiskTurn,
        placeClass: cls,
        immuneTag: immune,
        moodTurn: moodTurn("plain"),
        moodTurnImmune: moodTurn(immune),
        moodTurnBrave: moodTurn("brave"),
        payLessRisk: a.netPerTurn - dieRiskTurn - moodTurn("plain"),
      };
    });
  return { depot, tripsPerTurn, free, rows };
}

module.exports = { buildMiningRisk };
