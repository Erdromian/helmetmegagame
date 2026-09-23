// Where every item a recipe needs comes from, and how hard that is.
//
// A recipe can ask for three kinds of special thing besides ⬢ and a skill:
//   - a SPENT ingredient      (requirement.items, the default)
//   - a KEPT ingredient       (`keep: true`, or a `group:` — held, not used up)
//   - standing equipment      (Workshop Equipment, for smithing and builder recipes)
// This module works out, for each of them, every route by which a player can
// come to hold one, and ranks the easiest route. A recipe is then only as easy
// as its hardest gate.
//
// Everything is read from the repo: docs/tags.yaml (prices, recipes, container
// items), docs/roles.yaml (starting kits), docs/zones.yaml (room stashes) and
// the db/lib rule modules (loot tables, butchering, godflesh). What no file
// states is listed in RULES below, with where it comes from.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const cavingLoot = require("../../../lib/cavingLoot");
const corpses = require("../../../lib/corpses");
const mutilate = require("../../../lib/mutilate");
const godflesh = require("../../../lib/godflesh");
const soilery = require("../../../lib/soilery");
const refinery = require("../../../lib/refinery");
const { ARELITZ_EGG_SLUG, ARELITZ_SLUG } = require("../../../lib/constants");

const REPO = path.resolve(__dirname, "../../../..");

// 1 is easiest. The ranks answer "how hard is it to get ONE of these":
const RANKS = [
  { id: 1, label: "Open", meaning: "Anyone can do it now: the general Depot shelf, or a free action" },
  { id: 2, label: "Skilled", meaning: "Needs a skill or a craft chain, all of it obtainable" },
  { id: 3, label: "Gated", meaning: "Needs a key, chip or licence someone else must hand over" },
  { id: 4, label: "Scarce", meaning: "A rare drop, a finite stash, a starting kit or a corpse" },
  { id: 5, label: "None known", meaning: "No route in the data. Granted by a GM, or by code this report cannot see" },
];
const rankLabel = (r) => RANKS.find((x) => x.id === r)?.label ?? "?";

// Facts about the rules that no file states as a number.
const RULES = {
  // docs/systemdocs/CAVING.md §2: the Die rolls on arrival, and only a 6 finds.
  cavingFindChance: 1 / 6,
  // A drop below this chance per attempt is called Scarce.
  scarceBelow: 0.02,
  // What counts as "extremely common" for the easy-recipe shortlists: an ore
  // that turns up on at least a tenth of Prospecting presses, or a cave find
  // on at least one arrival in fifty. Everything else needs the Depot, a farm
  // or an easy craft chain.
  commonOre: 0.1,
  commonFind: 0.02,
  // Butcher's three monster corpses, read out of corpses.js (see monsterYields).
  // Mirrors web/lib/tagRequests.js#needsWorkshop.
  workshopPrefixes: ["smithing", "builder"],
  workshopSlug: "workshop-equipment",
  // What opens each Depot shelf (DEPOT.md §0e).
  shelfGate: { general: null, "black-market": "silver-chip", merchant: "merchants-license" },
};

function readYaml(rel) {
  return yaml.load(fs.readFileSync(path.join(REPO, rel), "utf8"));
}

// corpses.js keeps MONSTER_YIELDS private. Read the literal rather than copy
// it, and fail loudly if the file is reshaped so this cannot go quietly stale.
function monsterYields() {
  const src = fs.readFileSync(path.join(REPO, "db/lib/corpses.js"), "utf8");
  const block = src.match(/const MONSTER_YIELDS = \{([^}]*)\}/);
  if (!block) throw new Error("sources.js: could not find MONSTER_YIELDS in db/lib/corpses.js");
  const out = {};
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) out[m[1]] = m[2];
  if (!Object.keys(out).length) throw new Error("sources.js: MONSTER_YIELDS parsed empty");
  return out;
}

function withSeededRandom(seed, fn) {
  const real = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// The real loot functions, sampled under a fixed seed: slug -> chance per draw.
function lootDistribution(draw, zone, n = 300000) {
  return withSeededRandom(4242, () => {
    const counts = new Map();
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const d = draw(zone);
      if (!d) continue;
      hits++;
      counts.set(d.slug, (counts.get(d.slug) ?? 0) + 1);
    }
    const dist = new Map();
    for (const [slug, c] of counts) dist.set(slug, c / n);
    return { dist, hitRate: hits / n };
  });
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------
function buildSources({ list, bySlug, players }) {
  const get = (s) => bySlug.get(s);

  // ---- routes that come from data files ---------------------------------
  const rolesDoc = readYaml("docs/roles.yaml");
  const nameToSlugs = new Map();
  for (const t of list) {
    const k = t.name.toLowerCase();
    nameToSlugs.set(k, [...(nameToSlugs.get(k) ?? []), t.slug]);
  }
  const resolveTagRef = (raw) => {
    const m = String(raw).match(/^(.*?)(?:\s+x(\d+))?$/i);
    const ref = m[1].trim();
    const qty = m[2] ? Number(m[2]) : 1;
    if (bySlug.has(ref)) return { slug: ref, qty };
    const cands = nameToSlugs.get(ref.toLowerCase()) ?? [];
    const pick = cands.find((s) => get(s).catalog !== "secret") ?? cands[0];
    return pick ? { slug: pick, qty } : null;
  };
  const startingBy = new Map(); // slug -> [{role, qty, seats}]
  (function walk(node, key) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.starting_tags)) {
      for (const raw of node.starting_tags) {
        const ref = resolveTagRef(raw);
        if (!ref) continue;
        const arr = startingBy.get(ref.slug) ?? [];
        arr.push({ role: node.name ?? key, qty: ref.qty, unique: node.multiple === false });
        startingBy.set(ref.slug, arr);
      }
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object" && !Array.isArray(v)) walk(v, k);
  })(rolesDoc, "");

  const zonesDoc = readYaml("docs/zones.yaml");
  const stashBy = new Map(); // slug -> [{room, qty}]
  (function walk(node, trail) {
    if (!node || typeof node !== "object") return;
    if (node.stash?.items && typeof node.stash.items === "object") {
      for (const [slug, qty] of Object.entries(node.stash.items)) {
        const arr = stashBy.get(slug) ?? [];
        arr.push({ room: trail[trail.length - 1], qty: typeof qty === "number" ? qty : 1, access: node.access ?? [] });
        stashBy.set(slug, arr);
      }
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object" && !Array.isArray(v)) walk(v, [...trail, k]);
  })(zonesDoc, []);

  // Container tags: opening one grants another tag.
  const containerOf = new Map(); // slug -> [container slugs]
  for (const t of list) {
    for (const entry of t.consumesInto ?? []) {
      const slugs = typeof entry === "string" ? [entry] : entry.oneOf ? entry.oneOf.map((o) => (typeof o === "string" ? o : o.slug)) : [entry.slug];
      for (const s of slugs.filter(Boolean)) containerOf.set(s, [...new Set([...(containerOf.get(s) ?? []), t.slug])]);
    }
  }

  // Loot: real functions, sampled.
  // Mining draws from a plain column for anyone with a pickaxe and a richer one with Prospecting.
  const plainDraw = (z) => cavingLoot.drawProspectingLoot(z, { prospecting: false });
  const skilledDraw = (z) => cavingLoot.drawProspectingLoot(z, { prospecting: true });
  const prospecting = {
    caves: { plain: lootDistribution(plainDraw, "caves"), skilled: lootDistribution(skilledDraw, "caves") },
    depths: { plain: lootDistribution(plainDraw, "depths"), skilled: lootDistribution(skilledDraw, "depths") },
  };
  const caving = {
    caves: lootDistribution(cavingLoot.drawLoot, "caves"),
    depths: lootDistribution(cavingLoot.drawLoot, "depths"),
  };

  const monster = monsterYields(); // corpse slug -> yield slug
  const monsterOutputs = new Map(Object.entries(monster).map(([corpse, out]) => [out, corpse]));
  const livestock = corpses.LIVESTOCK_YIELDS; // livestock slug -> [{slug, quantity}]
  const livestockOutputs = new Map();
  for (const [animal, outs] of Object.entries(livestock)) for (const o of outs) livestockOutputs.set(o.slug, [...(livestockOutputs.get(o.slug) ?? []), animal]);
  const organSlugs = new Set(mutilate.MUTILATE_PARTS.map((p) => p.itemSlug));
  const cropSlugs = new Set(soilery.CROPS.map((c) => c.crop));
  const corpseGroup = list.filter((t) => t.group === "items-corpse").map((t) => t.slug);

  // Which slugs may cut Godflesh? Ask the game's own function.
  const extractTools = list
    .map((t) => t.slug)
    .filter((slug) => godflesh.extractToolFor([{ equipped: true, tag: { slug } }]) != null);

  // ---- the ranking, recursive over crafts and containers ------------------
  const memo = new Map();
  const codeRefs = lazyCodeRefs();

  function routesFor(slug, stack = []) {
    if (memo.has(slug)) return memo.get(slug);
    if (stack.includes(slug)) return [];
    const t = get(slug);
    const routes = [];
    const here = [...stack, slug];
    const sub = (s) => bestRank(s, here);

    if (!t) {
      routes.push({ kind: "unknown", label: "not in the catalog", rank: 5 });
      return routes;
    }

    // Depot
    if (t.depotPrice != null) {
      const shelf = t.manifest ?? "merchant";
      const gate = RULES.shelfGate[shelf] ?? null;
      // A shelf that needs a licence or chip is Gated: somebody holds the gate
      // and can order for you. Only an unsourced gate item makes it worse.
      const gateRank = gate ? Math.max(3, sub(gate) === 5 ? 5 : 3) : 1;
      routes.push({
        kind: "depot",
        label: `Depot, ${shelf} shelf, ${t.depotPrice} ¢${gate ? ` (needs ${get(gate)?.name ?? gate})` : ""}`,
        rank: gateRank,
        cost: t.depotPrice,
      });
    }

    // Creation pick and store
    if (t.purchasable && (t.pointCost ?? 0) > 0) {
      routes.push({
        kind: "points",
        label: t.purchasableAfterStart ? `points store, ${t.pointCost} pt` : `creation pick only, ${t.pointCost} pt`,
        rank: t.purchasableAfterStart ? 2 : 4,
      });
    }

    // Crafting
    if (t.craftable && t.requirement) {
      const r = t.requirement;
      const gates = [];
      let rank = (r.skills ?? []).length ? 2 : 1;
      for (const it of normaliseItems(r.items)) {
        const rk = itemRank(it, here);
        gates.push(`${it.label}${rk > 2 ? ` [${rankLabel(rk)}]` : ""}`);
        rank = Math.max(rank, rk);
      }
      if (needsWorkshop(t)) {
        const rk = sub(RULES.workshopSlug);
        gates.push(`Workshop Equipment${rk > 2 ? ` [${rankLabel(rk)}]` : ""}`);
        rank = Math.max(rank, rk);
      }
      const selfRef = normaliseItems(r.items).some((it) => it.slugs.includes(slug));
      routes.push({
        kind: "craft",
        label: `craft (${(r.skills ?? []).join(", ") || "no skill"})${gates.length ? ` from ${gates.join(", ")}` : ""}${selfRef ? ", needs one already" : ""}`,
        rank: selfRef ? 5 : rank,
      });
    }

    // Loot
    for (const [zone, label] of [["caves", "Caves"], ["depths", "Depths"]]) {
      const plain = prospecting[zone].plain.dist.get(slug) ?? 0;
      const skilled = prospecting[zone].skilled.dist.get(slug) ?? 0;
      if (plain || skilled) {
        routes.push({
          kind: "prospecting",
          label: `Mine at the ${label} (needs a pickaxe): ${pct(plain)} of presses, ${pct(skilled)} with Prospecting`,
          rank: Math.max(plain, skilled) >= RULES.scarceBelow ? 2 : 4,
          // What anyone with a pickaxe gets; the skilled column only when the plain one has none.
          rate: plain || skilled,
        });
      }
      const q = caving[zone].dist.get(slug);
      if (q) {
        const perArrival = q * RULES.cavingFindChance;
        routes.push({
          kind: "caving",
          label: `Caving Die, ${label}: ${pct(perArrival)} of arrivals`,
          rank: perArrival >= RULES.scarceBelow ? 1 : 4,
          rate: perArrival,
        });
      }
    }

    // Bodies
    if (corpseGroup.includes(slug)) {
      routes.push({ kind: "death", label: "a death (a body in reach)", rank: 4 });
    }
    if (monsterOutputs.has(slug)) {
      routes.push({ kind: "butcher", label: `Butcher a ${get(monsterOutputs.get(slug))?.name ?? monsterOutputs.get(slug)}`, rank: Math.max(sub("butcher"), 4) });
    }
    if (slug === "human-flesh") {
      routes.push({ kind: "butcher", label: "Butcher any human corpse", rank: Math.max(sub("butcher"), 4) });
    }
    if (organSlugs.has(slug)) {
      routes.push({ kind: "butcher", label: "Butcher or Mutilate a human body", rank: 4 });
    }
    if (livestockOutputs.has(slug)) {
      routes.push({
        kind: "butcher",
        label: `Butcher livestock (${livestockOutputs.get(slug).map((s) => get(s)?.name ?? s).join(" / ")})`,
        rank: Math.max(sub("butcher"), Math.min(...livestockOutputs.get(slug).map((s) => sub(s)))),
      });
    }

    // Producers
    if (cropSlugs.has(slug)) {
      routes.push({ kind: "farm", label: `Farm (Soilery), seed bag ${get(`${slug}-seed-bag`)?.depotPrice ?? "?"} ¢`, rank: 2 });
    }
    if (slug === godflesh.GODFLESH_SLUG) {
      const toolRank = Math.min(...extractTools.map((s) => sub(s)));
      routes.push({ kind: "cut", label: `Harvest Godflesh at the Refuse Pit (needs ${extractTools.map((s) => get(s)?.name ?? s).join(" / ")})`, rank: Math.max(1, toolRank) });
    }
    if (slug === refinery.REFINERY_OUTPUT_SLUG) {
      routes.push({ kind: "refine", label: "Refine Godflesh at the Factory", rank: Math.max(1, sub(godflesh.GODFLESH_SLUG)) });
    }

    if (slug === ARELITZ_EGG_SLUG) {
      routes.push({
        kind: "stable",
        label: "an adult arelitz in a stable lays them (stablePass)",
        rank: Math.max(2, sub(ARELITZ_SLUG)),
      });
    }

    // Starting kits and stashes
    if (startingBy.has(slug)) {
      const roles = startingBy.get(slug);
      routes.push({
        kind: "starting",
        label: `starting kit: ${roles.map((r) => r.role).join(", ")}`,
        rank: 4,
        roles: roles.map((r) => r.role),
      });
    }
    if (stashBy.has(slug)) {
      const rooms = stashBy.get(slug);
      routes.push({ kind: "stash", label: `room stash: ${rooms.map((r) => `${r.room} ×${r.qty}`).join(", ")}`, rank: 4 });
    }

    // Containers
    for (const c of containerOf.get(slug) ?? []) {
      if (c === slug) continue;
      routes.push({ kind: "container", label: `open a ${get(c)?.name ?? c}`, rank: sub(c) });
    }

    if (!routes.length) {
      const refs = codeRefs(slug);
      routes.push({
        kind: "unsourced",
        label: refs.length ? `no data route; named in code: ${refs.join(", ")}` : "no data route and no code reference",
        rank: 5,
      });
    }
    if (!stack.length) memo.set(slug, routes);
    return routes;
  }

  const bestRank = (slug, stack) => {
    const r = routesFor(slug, stack);
    return r.length ? Math.min(...r.map((x) => x.rank)) : 5;
  };

  // ---- "easy": buyable off the general shelf, farmed, or extremely common ---------
  const easyMemo = new Map();
  function easyOf(slug, stack = []) {
    if (easyMemo.has(slug)) return easyMemo.get(slug);
    if (stack.includes(slug)) return null;
    const t = get(slug);
    if (!t) return null;
    const here = [...stack, slug];
    const options = [];
    for (const r of routesFor(slug)) {
      if (r.kind === "depot" && r.rank === 1) options.push({ pri: 1, kind: "depot", via: "Depot, general shelf" });
      else if (r.kind === "farm") options.push({ pri: 2, kind: "farm", via: "Farm" });
      else if (r.kind === "prospecting" && r.rate >= RULES.commonOre) options.push({ pri: 4, kind: "ore", via: `Ore, ${pct(r.rate)} of Caves presses`, rate: r.rate });
      else if (r.kind === "caving" && r.rate >= RULES.commonFind) options.push({ pri: 5, kind: "find", via: `Cave find, ${pct(r.rate)} of arrivals`, rate: r.rate });
    }
    if (t.craftable && t.requirement && !options.length) {
      const its = normaliseItems(t.requirement.items);
      if (its.every((it) => it.slugs.some((x) => easyOf(x, here)))) options.push({ pri: 3, kind: "craft", via: "Craft from easy inputs" });
    }
    for (const c of containerOf.get(slug) ?? []) {
      if (c !== slug && easyOf(c, here) && !options.length) options.push({ pri: 3, kind: "container", via: `Open a ${get(c)?.name ?? c}` });
    }
    const best = options.sort((a, b) => a.pri - b.pri)[0] ?? null;
    if (!stack.length) easyMemo.set(slug, best);
    return best;
  }

  // ---- items as a recipe states them ----------------------------------------
  function normaliseItems(items) {
    const out = [];
    for (const raw of items ?? []) {
      if (typeof raw === "string") out.push({ kind: "spent", slugs: [raw], count: 1, label: nameOf(raw) });
      else if (raw.anyOf) {
        const slugs = raw.anyOf.map((o) => (typeof o === "string" ? o : o.tag ?? o.customOf));
        out.push({ kind: "spent", slugs, count: 1, label: `one of ${slugs.map(nameOf).join(" / ")}`, anyOf: true });
      } else if (raw.group) {
        const members = list.filter((t) => t.group === raw.group).map((t) => t.slug);
        out.push({ kind: "kept", slugs: members, count: 1, label: `any ${raw.group}`, group: raw.group });
      } else if (raw.customOf) {
        out.push({ kind: "spent", slugs: [raw.customOf], count: raw.count ?? 1, label: `${raw.count ?? 1}× ${nameOf(raw.customOf)} (cooked)`, dish: true });
      } else {
        out.push({
          kind: raw.keep ? "kept" : "spent",
          slugs: [raw.tag],
          count: raw.count ?? 1,
          label: `${(raw.count ?? 1) > 1 ? `${raw.count}× ` : ""}${nameOf(raw.tag)}${raw.keep ? " (kept)" : ""}`,
        });
      }
    }
    return out;
  }
  const nameOf = (s) => get(s)?.name ?? s;
  function itemRank(it, stack) {
    return Math.min(...it.slugs.map((s) => bestRank(s, stack)));
  }
  function needsWorkshop(t) {
    if (t.slug === RULES.workshopSlug) return false;
    const skills = t.requirement?.skills ?? [];
    if (skills.includes("crafting")) return false;
    return skills.some((s) => RULES.workshopPrefixes.some((p) => s === p || s.startsWith(`${p}-`)));
  }

  // ---- per recipe ----------------------------------------------------------------
  const recipes = [];
  for (const t of list) {
    if (!t.craftable || !t.requirement) continue;
    const r = t.requirement;
    const items = normaliseItems(r.items).map((it) => {
      const best = it.slugs
        .map((s) => ({ slug: s, routes: routesFor(s) }))
        .map((x) => ({ ...x, rank: x.routes.length ? Math.min(...x.routes.map((y) => y.rank)) : 5 }))
        .sort((a, b) => a.rank - b.rank)[0];
      const route = best.routes.slice().sort((a, b) => a.rank - b.rank || (a.cost ?? 0) - (b.cost ?? 0))[0];
      const easy = it.slugs.map((sl) => easyOf(sl)).filter(Boolean).sort((a, b) => a.pri - b.pri)[0] ?? null;
      return { ...it, rank: best.rank, via: best.slug, route: route?.label ?? "none", easy: easy?.via ?? null, easyKind: easy?.kind ?? null, easyRate: easy?.rate ?? null };
    });
    const workshop = needsWorkshop(t);
    const wsRank = workshop ? bestRank(RULES.workshopSlug, []) : null;
    const gateRanks = [...items.map((i) => i.rank), ...(workshop ? [wsRank] : [])];
    const hardest = gateRanks.length ? Math.max(...gateRanks) : 0;
    const hardestItem = gateRanks.length
      ? [...items.map((i) => ({ name: i.label, rank: i.rank })), ...(workshop ? [{ name: "Workshop Equipment", rank: wsRank }] : [])].sort((a, b) => b.rank - a.rank)[0].name
      : null;
    const hidden = items.some((i) => i.slugs.some((s) => (get(s)?.catalog ?? "all") !== "all")) && !r.recipePublic;
    // Two recipes are the same line when everything that goes in and everything the maker is paid is the
    // same: the whole requirement (skills, Moves, ⬢, items, ingredient slots, yield and any per-turn cap),
    // the standing equipment, and the sell price. A dish also carries the hunger and mood it gives, since
    // that is what a cook is paid in. `recipePublic` only says who may see the recipe, so it stays out.
    const { recipePublic: _visible, ...inputs } = r;
    const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
    const sig = JSON.stringify(stable({ inputs, workshop, sell: t.sellablePrice ?? null, meal: [t.mealHunger ?? null, t.mealMood ?? null] }));
    recipes.push({
      slug: t.slug,
      sig,
      name: t.name,
      skill: (r.skills ?? []).join(", ") || "—",
      moves: r.turnsCost ?? 0,
      resourceCost: r.resourceCost ?? 0,
      sellablePrice: t.sellablePrice ?? null,
      items,
      workshop,
      easy: items.every((i) => i.easy),
      special: items.length > 0 || workshop,
      hardest,
      hardestItem,
      // A recipe that needs one of its own product kept is a COPY: it duplicates
      // something you already hold, so it is not a barrier to getting the first.
      copy: items.some((i) => i.slugs.includes(t.slug)),
      secretRecipe: (t.catalog ?? "all") !== "all",
      hiddenUntilHeld: hidden,
    });
  }

  // ---- per item ------------------------------------------------------------------
  const used = new Map(); // slug -> recipes
  const touch = (slug, recipe) => used.set(slug, [...(used.get(slug) ?? []), recipe]);
  for (const rec of recipes) {
    for (const it of rec.items) for (const s of it.slugs) touch(s, rec.slug);
    if (rec.workshop) touch(RULES.workshopSlug, rec.slug);
  }
  const itemRows = [...used.entries()].map(([slug, recs]) => {
    const routes = routesFor(slug).slice().sort((a, b) => a.rank - b.rank || (a.cost ?? 0) - (b.cost ?? 0));
    const t = get(slug);
    return {
      slug,
      name: nameOf(slug),
      recipes: [...new Set(recs)],
      recipeCount: new Set(recs).size,
      rank: routes.length ? routes[0].rank : 5,
      best: routes[0]?.label ?? "none",
      routes: routes.map((r) => r.label),
      routeKinds: [...new Set(routes.map((r) => r.kind))],
      buy: t?.depotPrice ?? null,
      sell: t?.sellablePrice ?? null,
      easy: easyOf(slug)?.via ?? null,
      easyKind: easyOf(slug)?.kind ?? null,
    };
  });
  itemRows.sort((a, b) => b.recipeCount - a.recipeCount || b.rank - a.rank);

  return {
    ranks: RANKS,
    recipes,
    items: itemRows,
    // Every route to one of ANY slug, ranked, for a caller pricing something that is not a recipe
    // input (equipment.js prices the creation picks this way). Memoised above, so it is cheap.
    routesFor: (slug) => routesFor(slug).slice().sort((a, b) => a.rank - b.rank || (a.cost ?? 0) - (b.cost ?? 0)),
    drops: { prospecting, caving },
    monsterYields: monster,
    livestockAdultSlug: ARELITZ_SLUG,
    livestockYoungSlug: "arelitz-youngling",
    summary: {
      recipes: recipes.length,
      special: recipes.filter((r) => r.special).length,
      copies: recipes.filter((r) => r.copy).length,
      byHardest: Object.fromEntries([0, 1, 2, 3, 4, 5].map((k) => [k, recipes.filter((r) => !r.copy && r.hardest === k).length])),
      extractTools,
    },
  };
}

const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.001 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(2)}%`);

// Scan the source for a quoted slug, only when the data has no route for it.
function lazyCodeRefs() {
  let files = null;
  return (slug) => {
    if (!files) {
      files = [];
      for (const dir of ["db/lib", "web/lib", "web/app", "bot/src"]) {
        (function walk(d) {
          let entries = [];
          try {
            entries = fs.readdirSync(path.join(REPO, d), { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (e.name === "node_modules" || e.name === ".next") continue;
            const rel = `${d}/${e.name}`;
            if (e.isDirectory()) walk(rel);
            else if (/\.(js|mjs)$/.test(e.name)) files.push({ rel, text: fs.readFileSync(path.join(REPO, rel), "utf8") });
          }
        })(dir);
      }
    }
    const hits = files.filter((f) => f.text.includes(`"${slug}"`) || f.text.includes(`'${slug}'`)).map((f) => f.rel.split("/").pop());
    return [...new Set(hits)].slice(0, 3);
  };
}

module.exports = { buildSources, RANKS, rankLabel, RULES };
