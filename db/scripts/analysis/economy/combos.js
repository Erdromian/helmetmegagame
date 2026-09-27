// Combined activities: what somebody can earn by MIXING day-verbs.
//
// Each verb is rationed by something different, so they can fill each other's
// gaps:
//   - the MOVE: one per turn. Mine, Farm and Refine each take all of it
//     (web/lib/moveSpend.js refuses a second Action), and crafts share it in
//     fractions, so a turn is one day-verb OR a craft mix, never both;
//   - FATIGUE: Mine, Farm and Refine all climb the same Tired/Exhausted ladder
//     (fatigue.js), so none can fill another's locked turns; crafts, which never
//     tire, can;
//   - SKILL POINTS AND TOOLS: Farm needs Soilery and Mine needs a held pickaxe
//     (Prospecting is optional, and multiplies the yield). Refine and cutting
//     Godflesh need nothing;
//   - PLACE: each verb has a home zone. Hops inside a zone are free, and every
//     turn allows some free TRAVEL (GameConfig.freeZoneMovesPerTurn). A crossing
//     between the town zones costs ½ of it, any other crossing 1
//     (db/lib/crossingCost.js), and an equipped mount's rides each cover one
//     crossing of either kind. One crossing past the allowance costs the Move.
//
// The planner is exact: dynamic programming over (turn, zone, fatigue state),
// with the game's own gates and grants from fatigue.js. It does not guess a
// pattern; it finds the best schedule. Values are per action, from the model.
//
// Not modelled, and named in the report: carrying goods to the Depot to sell
// them, the weight of what you carry, the die on a Godflesh cut, Godflesh stock,
// forge access for smithing, and how many other players want the same spot.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { VERBS, closeTurn } = require("./fatigue");
const { crossingCost } = require("../../../lib/crossingCost");

const REPO = path.resolve(__dirname, "../../../..");
const FATIGUE_BY_ID = Object.fromEntries(VERBS.map((v) => [v.id, v]));

// ---------------------------------------------------------------------------
// The map: which zone each workplace is in, and which zones touch
// ---------------------------------------------------------------------------
function loadMap() {
  const doc = yaml.load(fs.readFileSync(path.join(REPO, "docs/zones.yaml"), "utf8"));
  const zoneOf = new Map();
  const attrs = new Map();
  const walkLocations = (zoneKey, locations) => {
    for (const [slug, loc] of Object.entries(locations ?? {})) {
      zoneOf.set(slug, zoneKey);
      attrs.set(slug, { ...(loc.attributes ?? {}), mining: loc.mining });
    }
  };
  for (const [zk, zv] of Object.entries(doc.zones)) {
    walkLocations(zk, zv.locations);
    for (const [lk, lv] of Object.entries(zv.levels ?? {})) walkLocations(lk, lv.locations);
  }
  const adj = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
    adj.set(b, (adj.get(b) ?? new Set()).add(a));
  };
  for (const c of doc.connections) {
    const pair = Array.isArray(c) ? c : c.pair;
    if (!pair) continue;
    link(zoneOf.get(pair[0].split("/").pop()), zoneOf.get(pair[1].split("/").pop()));
  }
  const zoneWith = (attr) => [...new Set([...attrs].filter(([, a]) => a[attr] === true).map(([slug]) => zoneOf.get(slug)))];
  return {
    adj,
    zones: [...adj.keys()].sort(),
    zoneOfLocation: (slug) => zoneOf.get(slug),
    sites: { farm: zoneWith("soilery"), refine: zoneWith("refinery"), cut: zoneWith("godflesh"), depot: zoneWith("depot") },
  };
}

function distances(adj) {
  const dist = new Map();
  for (const start of adj.keys()) {
    const d = new Map([[start, 0]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) for (const nb of adj.get(queue[i])) if (!d.has(nb)) (d.set(nb, d.get(queue[i]) + 1), queue.push(nb));
    dist.set(start, d);
  }
  return dist;
}

// What getting from one zone to another costs in TRAVEL, the game's own unit: each crossing at crossingCost
// (½ inside the town, 1 anywhere else), cheapest path, with `rides` crossings a mount carries for nothing
// (CARRY.md §2a: a ride covers any crossing, and the rides go first). Dijkstra over (zone, rides left).
function travelCosts(adj, rides = 0) {
  const out = new Map();
  for (const start of adj.keys()) {
    const best = new Map([[`${start}|${rides}`, 0]]);
    const queue = [[0, start, rides]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [cost, zone, left] = queue.shift();
      if (cost > best.get(`${zone}|${left}`)) continue;
      for (const nb of adj.get(zone)) {
        const steps = [[cost + crossingCost(zone, nb), left]];
        if (left > 0) steps.push([cost, left - 1]);
        for (const [c, l] of steps) {
          const key = `${nb}|${l}`;
          if (c < (best.get(key) ?? Infinity)) (best.set(key, c), queue.push([c, nb, l]));
        }
      }
    }
    const d = new Map();
    for (const [key, c] of best) {
      const zone = key.slice(0, key.lastIndexOf("|"));
      if (c < (d.get(zone) ?? Infinity)) d.set(zone, c);
    }
    out.set(start, d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------
// verbs: [{ id, letter, zone (or null = anywhere), value, fatigue: 'mine' | 'farm' | null }]
function makePlanner({ verbs, map, dist, free, dur, into, refineChance = 1 }) {
  const fatigueRefuses = new Map(); // "T|E" -> { mine, farm }
  const refusal = (held, n, id) => {
    const key = `${held.has("tired") ? held.get("tired") - n : "x"}|${held.has("exhausted") ? held.get("exhausted") - n : "x"}|${id}`;
    if (!fatigueRefuses.has(key)) fatigueRefuses.set(key, FATIGUE_BY_ID[id].refused([...held.keys()]));
    return fatigueRefuses.get(key);
  };

  function solve(horizon, startZone) {
    const memo = new Map();
    function best(n, zone, held) {
      if (n > horizon) return { value: 0 };
      const key = `${n}|${zone}|${held.has("tired") ? held.get("tired") - n : "x"}|${held.has("exhausted") ? held.get("exhausted") - n : "x"}`;
      const hit = memo.get(key);
      if (hit) return hit;
      // The Factory floor holds a few people a turn. `refineChance` is how often a seat is free
      // when you press; a refused press costs no Move, so you fall back to the best other move.
      const evaluate = (seatFree) => {
      let top = { value: -Infinity };
      const consider = (dest, verb, note) => {
        const nextHeld = new Map(held);
        closeTurn(nextHeld, n, verb?.fatigue ? FATIGUE_BY_ID[verb.fatigue] : null, dur, into);
        const later = best(n + 1, dest, nextHeld);
        const value = (verb?.value ?? 0) + later.value;
        // Ties go to working now over resting, and to staying put over wandering.
        if (value > top.value + 1e-9 || (Math.abs(value - top.value) <= 1e-9 && verb && !top.verb)) top = { value, verb, zone: dest, note, next: later };
      };
      for (const dest of [zone, ...map.zones.filter((z) => z !== zone)]) {
        const d = dist.get(zone).get(dest) ?? Infinity;
        if (d <= free + 1e-9) {
          consider(dest, null, d ? "cross" : "rest");
          for (const v of verbs) {
            if (v.factory && !seatFree) continue;
            if (v.zone && v.zone !== dest) continue;
            if (v.fatigue && refusal(held, n, v.fatigue)) continue;
            consider(dest, v, d ? "cross" : "stay");
          }
        } else if (d <= free + 1 + 1e-9) {
          consider(dest, null, "paid crossing"); // the Move goes on the journey: one crossing past the allowance
        }
      }
      return top;
      };
      const open = evaluate(true);
      let result = open;
      if (refineChance < 1 && verbs.some((v) => v.factory)) {
        const shut = evaluate(false);
        result = { ...open, value: refineChance * open.value + (1 - refineChance) * shut.value };
      }
      memo.set(key, result);
      return result;
    }
    return best(1, startZone, new Map());
  }

  return function plan(horizon) {
    let best = null;
    for (const zone of map.zones) {
      const r = solve(horizon, zone);
      const better = !best || r.value > best.value + 1e-9 || (Math.abs(r.value - best.value) <= 1e-9 && r.verb && !best.verb);
      if (better) best = { ...r, start: zone };
    }
    return best;
  };
}

function readPath(node, start, turns) {
  const rows = [];
  let zone = start;
  for (let i = 0; i < turns && node && node.zone; i++, node = node.next) {
    rows.push({ verb: node.verb?.letter ?? (node.note === "paid crossing" ? ">" : "·"), zone: node.zone, from: zone, note: node.note });
    zone = node.zone;
  }
  return rows;
}

const zoneLetter = (z) => ({ town: "T", hills: "H", undertown: "U", caves: "C", depths: "D", fortress: "F", space: "S" })[z] ?? z[0].toUpperCase();

function summarise(planFor, gameTurns, patternTurns = 15) {
  const total = planFor(gameTurns).value;
  const long = planFor(120);
  const mid = planFor(60);
  const rate = (long.value - mid.value) / 60;
  // Skip the opening turns so the pattern shown is the long-run rhythm, not the start-up.
  const shown = readPath(mid, mid.start, 12 + patternTurns).slice(12);
  return {
    rate,
    total,
    start: mid.start,
    pattern: shown.map((r) => r.verb).join(" "),
    zones: shown.map((r) => zoneLetter(r.zone)).join(" "),
    // The same turns as zone slugs and verb letters, for the selling-trip budget (travel.js).
    zoneSlugs: shown.map((r) => r.zone),
    letters: shown.map((r) => r.verb),
  };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------
// `seats` is how many people may refine in a turn (db/lib/refinery.js). The main tables assume
// you can always get one; `seatSensitivity` shows what a crowd does to that.
function buildCombos({ activities, fatigue, bySlug, params, gameTurns = 30, free = 1, rides = 0, seats = 5, trinkets = null }) {
  const map = loadMap();
  const dist = distances(map.adj);
  const cost = travelCosts(map.adj, rides);
  const dur = fatigue.durations;
  const into = fatigue.into;

  const chainSet = (slug, out = new Set()) => {
    const t = bySlug.get(slug);
    if (!t || out.has(slug)) return out;
    out.add(slug);
    chainSet(t.parentTag, out);
    chainSet(t.requiredTag, out);
    return out;
  };
  const pointsOf = (set) => [...set].reduce((sum, s) => sum + (bySlug.get(s)?.pointCost ?? 0), 0);

  // ---- verbs, with values straight from the model's activities ----
  const zoneForMine = (a) => (/Caves/.test(a.name) ? "caves" : "depths");
  const mineVerbs = activities
    .filter((a) => a.kind === "mine")
    .map((a) => ({
      id: a.id,
      letter: "M",
      label: a.name,
      zone: zoneForMine(a),
      value: a.perAction,
      fatigue: "mine",
      needs: a.skillPoints > 0 ? ["prospecting"] : [],
      pick: true, // the gate is a held pickaxe: a creation pick (its pointCost), or a smith makes their own
    }));
  // Nothing left to farm for cash: the Soilery rework left exactly one crop, Foodstuffs, and it never
  // sells — every farm row is `foodValued` now (Ration Box parity with no cap on demand, a ceiling), so
  // Farm no longer competes for a Move in this ¢-mixing planner, the same reason a dish never has
  // (below, craftPool). `farmZone` is still the map site other tabs (transport.js) place the harvest at.
  const farmZone = map.sites.farm[0];
  const refineAct = activities.find((a) => a.id === "factory:refine-supplied");
  const refineZone = map.sites.refine[0];
  // A cut and a refine must share a zone: the lump is cut the same turn it is refined.
  if (!map.sites.cut.includes(refineZone)) throw new Error("combos.js: Godflesh is cut somewhere other than the Factory's zone");
  const refineVerb = { id: refineAct.id, letter: "R", label: "Refine (cut a lump first)", zone: refineZone, value: refineAct.perAction, fatigue: "refine", needs: [], factory: true };

  // ---- crafts: the best easy recipe the loadout can make ----
  const oreLimited = (a) => (a.oreNeeds ?? []).some((o) => o.prospectors > 2);
  // A crafter pays for ⬢ whichever way is cheaper: importing at the Depot's buy price, or, where the game
  // lets a family pay in obols (smithing, today), one obol a ⬢. Ask the model, which reads the source.
  const craftValue = (a) => Math.max(a.netPerTurnBuy ?? -Infinity, a.parPayable ? a.netPerTurnObols ?? -Infinity : -Infinity);
  // A Trinket bought at the shelf needs a Merchant's licence, which is not "easy", but it is a craft anybody with the coin can make.
  // A dish is left out: its worth is Ration Box parity with no cap on how much the town eats, a ceiling, so it does not
  // compete for a Move.
  // A ceiling-priced drink (Alcohol: sold to players at the shelf price, never to the counter) is left out for the same reason.
  const craftPool = activities.filter((a) => a.kind === "craft" && a.family !== "cooking" && !a.ceiling && (a.easy || a.trinket) && !a.copy && !oreLimited(a) && a.totalMoves > 0 && craftValue(a) > 0);
  const craftFor = (skillSet) =>
    craftPool
      .filter((a) => a.skill.split(", ").every((s) => skillSet.has(s)))
      .sort((x, y) => craftValue(y) - craftValue(x))[0] ?? null;

  const planCache = new Map();
  function run(verbList, factory, key, refineChance = 1) {
    const full = `${key}|${factory}|${refineChance}`;
    if (planCache.has(full)) return planCache.get(full);
    const list = verbList.filter((v) => factory || !v.factory);
    const planner = makePlanner({ verbs: list, map, dist: cost, free, dur, into, refineChance });
    const out = summarise(planner, gameTurns);
    planCache.set(full, out);
    return out;
  }

  // ---- each verb on its own ----
  const bestMine = mineVerbs.filter((v) => v.needs.length).sort((a, b) => b.value - a.value)[0];
  const aloneRows = [
    { label: "Refine only", verbs: [refineVerb] },
    { label: `Mine only (${bestMine.label.replace("Mine — ", "")})`, verbs: [bestMine] },
  ];
  // The same seam worked by a Smithing smith who forges what drops, on the rest turn.
  const forgeRow = trinkets?.prospector?.[`${bestMine.zone}:skilled`]?.skilled;
  if (forgeRow && forgeRow.net > 0) aloneRows.push({ label: `Mine only (${bestMine.label.replace("Mine — ", "")}), forging the stones (Smithing II)`, verbs: [{ ...bestMine, value: bestMine.value + forgeRow.net }] });
  const bestCraftOverall = craftFor(new Set(["smithing", "smithing-skilled", "crafting"]));
  if (bestCraftOverall) aloneRows.push({ label: `Craft only (${bestCraftOverall.name})`, verbs: [{ id: "craft", letter: "C", zone: null, value: craftValue(bestCraftOverall), fatigue: null }] });
  const alone = aloneRows.map((r) => ({ label: r.label, ...run(r.verbs, true, `alone:${r.label}`) }));

  // ---- loadouts ----
  const tiers = {
    smithing: [[], ["smithing"], ["smithing-skilled"]],
    // Distilling (3 points on top of Brewing II) doubles Alcohol and Moonshine; the rung is here so the
    // planner can say whether it ever pays, given what the drinks actually fetch at the counter.
    brewing: [[], ["brewing-basic"], ["brewing-skilled"], ["brewing-skilled", "brewing-distilling"]],
  };
  const loadouts = [];
  const verbsOf = new Map();
  // Soilery is not one of the dimensions any more: it earns food, not ¢, so it has nothing to add to a
  // ¢-mixing loadout (see the comment on farmZone above).
  for (const pickaxe of [0, 1])
   for (const prospecting of [0, 1])
      for (const crafting of [0, 1])
        for (const smith of [0, 1, 2])
          for (const brew of [0, 1, 2, 3]) {
            const picked = [
              ...(pickaxe ? ["pickaxe"] : []),
              ...(prospecting ? ["prospecting"] : []),
              ...(crafting ? ["crafting"] : []),
              ...tiers.smithing[smith],
              ...tiers.brewing[brew],
            ];
            const skillSet = new Set();
            for (const s of picked) chainSet(s, skillSet);
            const points = pointsOf(skillSet);
            const craft = craftFor(skillSet);
            const hasPick = skillSet.has("pickaxe") || skillSet.has("smithing");
            // A smith who mines can forge what they dig up on the rest turn a miner has anyway. The extra per press is
            // the Trinkets' profit over selling the stones raw, less the rest-turn Moves they take, which the smith
            // would otherwise spend on their best craft.
            let forged = false;
            const forgeHolder = smith === 2 ? "skilled" : "apprentice";
            const mined = mineVerbs
              .filter((v) => (!v.pick || hasPick) && v.needs.every((n) => skillSet.has(n)))
              .map((v) => {
                if (!smith || !trinkets) return v;
                const row = trinkets.prospector[`${v.zone}:${v.needs.length ? "skilled" : "plain"}`]?.[forgeHolder];
                if (!row) return v;
                const extra = row.net - row.trinkets * (craft ? craftValue(craft) : 0);
                if (!(extra > 0)) return v;
                forged = true;
                return { ...v, value: v.value + extra, label: `${v.label} + forged stones` };
              });
            const verbList = [
              ...mined,
              refineVerb,
              ...(craft ? [{ id: "craft", letter: "C", zone: null, value: craftValue(craft), fatigue: null }] : []),
            ];
            const key = `${prospecting}${hasPick ? 1 : 0}|${craft?.slug ?? "-"}|f${forged ? smith : 0}`;
            verbsOf.set(picked.join("+"), { verbList, key });
            loadouts.push({
              skills: picked.length ? picked.map((s) => bySlug.get(s)?.name ?? s) : ["no skills"],
              picked,
              points,
              // Every tag the loadout holds, prerequisites included, at its own catalog pointCost.
              tagCosts: [...skillSet].map((s) => ({ slug: s, name: bySlug.get(s)?.name ?? s, points: bySlug.get(s)?.pointCost ?? 0 })).filter((t) => t.points),
              craft: craft ? { name: craft.name, value: craftValue(craft), skill: craft.skill } : null,
              forgesStones: forged,
              withFactory: run(verbList, true, key),
              noFactory: run(verbList, false, key),
            });
          }

  // ---- best loadout for each point budget ----
  const budgets = [...new Set([0, 2, 5, 7, 8, 9, 10, 12, 14, 15, 17, 19, 21])];
  const staircase = budgets.map((b) => {
    const fit = loadouts.filter((l) => l.points <= b);
    const pick = (key) => fit.slice().sort((x, y) => y[key].rate - x[key].rate || x.points - y.points)[0];
    return { points: b, withFactory: pick("withFactory"), noFactory: pick("noFactory") };
  });

  // ---- what a crowd at the Factory does ----
  // K people each try for a seat every turn: a given person gets one about seats/K of the time.
  const sensitivityOf = (picked) => {
    const entry = verbsOf.get(picked.join("+"));
    const found = loadouts.find((l) => l.picked.join("+") === picked.join("+"));
    if (!entry || !found) return null;
    return { skills: found.skills, points: found.points };
  };
  const crowd = [seats, seats * 2, seats * 4, seats * 10, seats * 20];
  const seatSensitivity = [[], ["crafting"], ["prospecting", "smithing-skilled"]]
    .map((picked) => ({ info: sensitivityOf(picked), entry: verbsOf.get(picked.join("+")) }))
    .filter((x) => x.info)
    .map(({ info, entry }) => ({
      skills: info.skills,
      points: info.points,
      byCrowd: crowd.map((k) => {
        const p = Math.min(1, seats / k);
        const out = run(entry.verbList, true, entry.key, p);
        return { people: k, chance: p, rate: out.rate };
      }),
      noFactory: run(entry.verbList, false, entry.key).rate,
    }));

  const between = (a, b) => cost.get(a)?.get(b);
  return {
    free,
    rides,
    gameTurns,
    seats,
    zones: map.zones,
    adjacency: Object.fromEntries([...map.adj].map(([k, v]) => [k, [...v].sort()])),
    sites: { farm: farmZone, refine: refineZone, cut: map.sites.cut[0], depot: map.sites.depot[0] ?? null, caves: "caves", depths: "depths" },
    // Zone-to-zone crossings on the map, the planner's own breadth-first distances.
    hops: Object.fromEntries([...dist].map(([a, m]) => [a, Object.fromEntries(m)])),
    // The same in TRAVEL (½ a town crossing, 1 any other, less the mount's rides): what the planner walks by.
    travel: Object.fromEntries([...cost].map(([a, m]) => [a, Object.fromEntries(m)])),
    crossings: {
      "Farm to Factory": between(farmZone, refineZone),
      "Factory to the Caves": between(refineZone, "caves"),
      "Factory to the Depths": between(refineZone, "depths"),
      "Farm to the Caves": between(farmZone, "caves"),
      "Farm to the Depths": between(farmZone, "depths"),
      "Farm to the Depot": between(farmZone, "undertown"),
      "Factory to the Depot": between(refineZone, "undertown"),
    },
    // Farm is not here: it earns food, not ¢, so it has no real-money value for this table any more
    // (see the comment on farmZone above). Its skill points and fatigue cycle are on the Food page instead.
    verbs: [refineVerb, ...mineVerbs].map((v) => ({ id: v.id, label: v.label, zone: v.zone, value: v.value, fatigue: v.fatigue, needs: v.needs })),
    alone,
    loadouts,
    staircase,
    seatSensitivity,
    dedupedSolves: planCache.size,
  };
}

module.exports = { buildCombos };
