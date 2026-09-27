// The starting economy: what each role begins with, and how long it lasts.
//
// Everything is read from the masters, not typed in here. A role's seat, coin, bank balance and starting
// tags come from docs/roles.yaml (the same parser the sync uses for "Obol x5"), the rooms a key opens and
// what sits in them from docs/zones.yaml, and hunger from db/lib/hunger.js. The food a thing gives is the
// number the rest of the report already uses.
//
// Two honest limits. Roles start with a few skills and gear FREE, but a player spends more points on
// top of that, so a key or skill bought with points is not counted. And a locked room is one many
// people may be able to open: the totals here say what a role COULD reach, not what it gets alone.
//
// Money is ¢ (an obol is one ¢). ⬢ is Resources, the crafting material.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { parseStartingTag } = require("../../../lib/startingTags");
const hunger = require("../../../lib/hunger");
const { FAST_METABOLISM_SLUG, HUNGERLESS_SLUG, FOODSTUFFS_SLUG } = require("../../../lib/constants");
const { ALL_GROUPS } = require("../../../lib/roleGroups");
const { median } = require("./stats");
const { fateCapacity, fateSeatsFor } = require("../../../lib/fateCapacity");
const { ringName } = require("../../../lib/rings");

const REPO = path.resolve(__dirname, "../../../..");
const readYaml = (rel) => yaml.load(fs.readFileSync(path.join(REPO, rel), "utf8"));
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

const OBOL = "obol";
const RESOURCES = "resources";

// ---- the map: every room, what is in it, and what opens it ----------------------------------------------
function readRooms() {
  const doc = readYaml("docs/zones.yaml");
  const rooms = [];
  const locNames = new Map();
  const walk = (zoneId, locs) => {
    for (const [locId, loc] of Object.entries(locs ?? {})) {
      locNames.set(locId, loc.name ?? locId);
      for (const [roomId, room] of Object.entries(loc.rooms ?? {})) {
        const stash = room.stash;
        const norm = Array.isArray(stash)
          ? { resources: 0, items: Object.fromEntries(stash.map((s) => [s, 1])), hidden: {} }
          : stash
            ? { resources: stash.resources ?? 0, items: stash.items ?? {}, hidden: stash.hidden ?? {} }
            : { resources: 0, items: {}, hidden: {} };
        rooms.push({
          id: roomId,
          name: room.name ?? roomId,
          locationId: locId,
          location: loc.name ?? locId,
          zone: zoneId,
          access: Array.isArray(room.access) && room.access.length ? room.access : null,
          stash: norm,
          hasStash: Boolean(stash),
        });
      }
    }
  };
  for (const [zoneId, zone] of Object.entries(doc.zones ?? {})) {
    walk(zoneId, zone.locations);
    for (const [levelId, level] of Object.entries(zone.levels ?? {})) walk(`${zoneId}/${levelId}`, level.locations);
  }
  const doors = (doc.connections ?? [])
    .filter((c) => !Array.isArray(c) && (c.locked || c.hidden))
    .map((c) => ({ pair: c.pair, tag: c.locked ?? c.hidden, hidden: Boolean(c.hidden) }));
  return { rooms, doors, locNames };
}

function buildStarting({ list, get, foods, params, foodFloor, sources, players, cooking }) {
  const decayBase = params.hungerDecay;
  const start = params.hungerMax;
  const deathTurns = hunger.STARVING_DEATH_TURNS;
  const costPerPersonTurn = foodFloor?.anyone?.costPerPersonTurn ?? null; // ¢ to feed one person one turn, off the shelf
  const foodBy = new Map(foods.map((f) => [f.slug, f.hunger]));
  const recipeSlugs = new Set(sources.items.map((i) => i.slug));
  // Farmed crops go into the best crops-only Basic dish (COOKING.md §2a), which is what a starting stock of crops
  // turns into when a cook spends a turn on it.
  const cropDish = cooking.dishes.filter((d) => d.farmOnly && d.tier === "Basic").sort((a, b) => b.hungerPerUnit - a.hungerPerUnit)[0];
  const cookedPerCrop = cropDish?.hungerPerUnit ?? 0;
  const movesPerCrop = cropDish ? cropDish.moves / cropDish.units : 0;

  const byName = new Map();
  for (const t of list) {
    const k = String(t.name ?? "").toLowerCase();
    if (!byName.has(k)) byName.set(k, t);
  }
  const resolve = (id) => get(id) ?? byName.get(String(id).toLowerCase()) ?? null;
  const foodHungerOf = (t) => (foodBy.has(t.slug) ? foodBy.get(t.slug) : hunger.foodHungerFor(t));
  // The one crop the Soilery rework left: Foodstuffs. Kept as a set so the rest of this file's shape,
  // built around "a held crop" rather than one hardcoded slug, survives unchanged.
  const cropSlugs = new Set([FOODSTUFFS_SLUG]);
  const isKey = (slug) => /-key$|keycard$|^keycard/.test(slug) || slug === "depot-keycard" || slug === "ancient-keycard";

  const { rooms, doors, locNames } = readRooms();
  const placeName = (id) => locNames.get(id.split("/").pop()) ?? id.split("/").pop();
  const roleDoc = readYaml("docs/roles.yaml");

  // ---- what is in a stash, in the units that matter here ----------------------------------------------------
  function contents(stash) {
    let resources = stash.resources ?? 0;
    let coin = 0;
    let food = 0;
    let cracked = 0;
    const kit = [];
    const foods_ = [];
    // The floor, then the `hidden` block (SEARCH.md §9): in the same room, but found only by searching it.
    const entries = [...Object.entries(stash.items ?? {}).map(([slug, qty]) => [slug, qty, false]), ...Object.entries(stash.hidden ?? {}).map(([slug, qty]) => [slug, qty, true])];
    for (const [slug, rawQty, hidden] of entries) {
      const qty = typeof rawQty === "number" ? rawQty : 1;
      const mark = hidden ? " (hidden)" : "";
      if (slug === OBOL) {
        coin += qty;
        continue;
      }
      if (slug === RESOURCES) {
        resources += qty;
        continue;
      }
      const t = get(slug);
      if (!t) continue;
      const h = foodHungerOf(t);
      if (h > 0) {
        food += qty * h;
        foods_.push(`${t.name} ×${qty}${mark}`);
      }
      if (t.consumesIntoResources) cracked += qty * t.consumesIntoResources;
      // A food is counted as food, not kit, though Foodstuffs is also what a meal is cooked from.
      if (recipeSlugs.has(slug) && !isKey(slug) && !(h > 0)) kit.push(`${t.name}${qty > 1 ? ` ×${qty}` : ""}${mark}`);
    }
    return { resources, coin, food, cracked, kit, foods: foods_ };
  }

  // ---- roles ------------------------------------------------------------------------------------------------
  const unresolved = [];
  const roles = [];
  const groupName = new Map(ALL_GROUPS.map((g) => [g.slug, g.name]));
  for (const [groupSlug, group] of Object.entries(roleDoc.groups ?? {})) {
    for (const [slug, r] of Object.entries(group)) {
      const held = [];
      for (const entry of r.starting_tags ?? []) {
        const { slug: id, quantity } = parseStartingTag(entry);
        const t = resolve(id);
        if (!t) {
          unresolved.push(`${r.name}: ${entry}`);
          continue;
        }
        held.push({ tag: t, quantity });
      }
      const slugs = new Set(held.map((h) => h.tag.slug));
      const coinHand = held.filter((h) => h.tag.slug === OBOL).reduce((n, h) => n + h.quantity, 0);
      const resources = held.filter((h) => h.tag.slug === RESOURCES).reduce((n, h) => n + h.quantity, 0);
      const cracked = held.reduce((n, h) => n + (h.tag.consumesIntoResources && h.tag.slug !== RESOURCES ? h.quantity * h.tag.consumesIntoResources : 0), 0);
      const foodItems = held.filter((h) => foodHungerOf(h.tag) > 0);
      const food = foodItems.reduce((n, h) => n + h.quantity * foodHungerOf(h.tag), 0);
      // What the turn close will eat unasked (hunger.js#planAutoMeals): only plain food (autoEdible) no worse than
      // AUTO_EAT_MOOD_FLOOR, so never a Ration Box, which has to be opened by hand. Of that, Foodstuffs to hold off
      // Starving, and anything else only to keep the meter off 0.
      const autoEaten = foodItems.filter((h) => hunger.autoEdible(h.tag) && hunger.foodMoodFor(h.tag) >= hunger.AUTO_EAT_MOOD_FLOOR);
      const autoFood = autoEaten.reduce((n, h) => n + h.quantity * hunger.foodHungerFor(h.tag), 0);
      const foodstuffs = autoEaten.filter((h) => h.tag.slug === FOODSTUFFS_SLUG).reduce((n, h) => n + h.quantity * hunger.foodHungerFor(h.tag), 0);
      // Crops in the starting kit: eaten raw they are a few hunger a crop, cooked they are the crop dish's hunger a crop.
      const crops = held.filter((h) => cropSlugs.has(h.tag.slug)).reduce((n, h) => n + h.quantity, 0);
      const cropRawHunger = held.filter((h) => cropSlugs.has(h.tag.slug)).reduce((n, h) => n + h.quantity * foodHungerOf(h.tag), 0);
      const foodCooked = food - cropRawHunger + crops * cookedPerCrop;
      const kit = held.filter((h) => recipeSlugs.has(h.tag.slug) && !isKey(h.tag.slug) && h.tag.slug !== OBOL && h.tag.slug !== RESOURCES && !(foodHungerOf(h.tag) > 0)).map((h) => `${h.tag.name}${h.quantity > 1 ? ` ×${h.quantity}` : ""}`);
      // A seat's signet ring is its keys now (RINGS.md): worn, its `opens:` tokens count as held tags, and the
      // retired seat keys' slugs are still what every room's `access:` names. Only a ring that spawns is in hand.
      const ring = r.ring?.spawns ? r.ring : null;
      const ringTokens = ring ? (ring.opens ?? []).map(String) : [];
      const keys = [
        ...(ring ? [`${ring.name ?? ringName("")} (${ringTokens.length ? ringTokens.map((t) => get(t)?.name ?? t).join(", ") : "opens nothing"})`] : []),
        ...held.filter((h) => isKey(h.tag.slug) || h.tag.slug === "merchants-license").map((h) => h.tag.name),
      ];
      // What the free kit would have cost at character creation, point for point — a role's own
      // starting_tags against the same pointCost the point-buy store charges everyone else
      // (db/scripts/analysis/economy/power.js §"tag value"). Obols and Resources carry no pointCost,
      // so a purse does not inflate this; it is a skills-and-gear number.
      const tagPointValue = held.reduce((n, h) => n + (h.tag.pointCost ?? 0) * h.quantity, 0);
      const docElements = r.doc_elements ?? [];

      const bank = r.bank_account ? r.starting_account ?? 0 : 0;
      const decay = slugs.has(HUNGERLESS_SLUG) ? 0 : slugs.has(FAST_METABOLISM_SLUG) ? params.hungerDecayFast : decayBase;

      let seats = 1;
      let unlimited = false;
      if (r.multiple !== false) {
        if (r.weight === "unlimited") {
          unlimited = true;
          seats = null;
        } else {
          // The game's own rule (db/lib/fateCapacity.js): a share of the pool
          // left by `players` readied plus 10%, never below half its share.
          seats = fateCapacity({ weight: Number(r.weight ?? 1) }, fateSeatsFor(players));
        }
      }
      roles.push({
        slug,
        name: r.name,
        group: groupSlug,
        groupName: groupName.get(groupSlug) ?? groupSlug,
        seats,
        unlimited,
        multiple: r.multiple !== false,
        whitelist: Boolean(r.whitelist),
        startZone: r.starting_zone,
        startLocation: r.starting_location ?? null,
        account: r.bank_account ?? null,
        bank,
        coinHand,
        funds: bank + coinHand,
        resources,
        cracked,
        food,
        foodstuffs,
        autoFood,
        crops,
        dishes: crops / (cropDish?.units || 2),
        cookMoves: crops * movesPerCrop,
        foodCooked,
        foodItems: foodItems.map((h) => `${h.tag.name}${h.quantity > 1 ? ` ×${h.quantity}` : ""}`),
        kit,
        keys,
        tagSlugs: [...new Set([...slugs, ...ringTokens])],
        decay,
        extraPoints: r.extra_starting_points ?? 0,
        tagPointValue,
        docElements,
      });
    }
  }

  // ---- how long it lasts --------------------------------------------------------------------------------------
  // A meter of 100 falls by `decay` each close. Nobody is assumed to eat by hand: this is what the close does on its own
  // (hunger.js#planAutoMeals). It eats carried Foodstuffs to hold off Starving, so those add to the 100 for the Starving
  // turn; a meal, dish or raw ingredient it eats only when the meter would read 0, so everything it will eat adds to
  // the 100 for the Dying turn. A Ration Box counts for neither: the close cannot open one. Each band is the first close that leaves the meter at or under its threshold: Hungry at 66,
  // Starving at 33, and the close that takes it to 0 grants Dying (`deathTurns - 1` closes later, which is none today).
  // Hungry counts nothing carried, since the close eats nothing while a character is only Hungry.
  const closeAtOrUnder = (threshold) => (hungerPoints, decay) => (decay === 0 ? Infinity : Math.ceil((start + hungerPoints - threshold) / decay));
  const hungryTurn = closeAtOrUnder(hunger.HUNGRY_THRESHOLD);
  const startingTurn = closeAtOrUnder(hunger.STARVING_THRESHOLD);
  const zeroTurn = closeAtOrUnder(hunger.HUNGER_MIN);

  // ---- rooms a role can open ------------------------------------------------------------------------------------
  const roomView = rooms.map((room) => ({ ...room, ...contents(room.stash) }));
  const worth = (c) => c.resources + c.coin + c.food + c.cracked + c.kit.length;
  for (const role of roles) {
    const tags = new Set(role.tagSlugs);
    const opens = roomView.filter((room) => room.hasStash && room.access && room.access.some((a) => tags.has(a)));
    role.rooms = opens.filter((room) => worth(room) > 0);
    role.keyedResources = role.rooms.reduce((n, room) => n + room.resources, 0);
    role.keyedCracked = role.rooms.reduce((n, room) => n + room.cracked, 0);
    role.keyedCoin = role.rooms.reduce((n, room) => n + room.coin, 0);
    role.keyedFood = role.rooms.reduce((n, room) => n + room.food, 0);
    role.doors = doors.filter((d) => tags.has(d.tag)).map((d) => d.pair.map(placeName).join(" ↔ "));
    role.keyedKit = [...new Set(role.rooms.flatMap((room) => room.kit.map((k) => k.replace(/ ×\d+( \(hidden\))?$/, "$1"))))];

    const carried = role.food;
    role.hungryTurn = hungryTurn(0, role.decay);
    role.starveTurn = startingTurn(role.foodstuffs, role.decay);
    role.dyingTurn = zeroTurn(role.autoFood, role.decay) + deathTurns - 1;
    // What the coin buys off the shelf, at the price of a person-turn of ration, scaled to how fast this role burns.
    const costPerTurn = costPerPersonTurn == null ? null : costPerPersonTurn * (role.decay / decayBase);
    role.turnsFromFunds = costPerTurn ? (role.decay === 0 ? Infinity : role.funds / costPerTurn) : null;
    role.turnsCarried = role.decay === 0 ? Infinity : (start + carried) / role.decay;
    role.turnsWithFunds = role.decay === 0 ? Infinity : role.turnsCarried + (role.turnsFromFunds ?? 0);
    role.turnsWithKeyed = role.decay === 0 ? Infinity : role.turnsWithFunds + role.keyedFood / role.decay;
    role.turnsFromFundsRoundedStarve = role.decay === 0 ? Infinity : Math.ceil(role.turnsWithFunds);
  }

  // ---- who can open each room ---------------------------------------------------------------------------------------
  const roomsOut = roomView
    .filter((room) => room.hasStash)
    .map((room) => {
      const openers = room.access ? roles.filter((r) => room.access.some((a) => r.tagSlugs.includes(a))) : [];
      return {
        id: room.id,
        name: room.name,
        location: room.location,
        zone: room.zone,
        open: !room.access,
        access: room.access ?? [],
        openers: openers.map((r) => r.name),
        openerSeats: openers.reduce((n, r) => n + (r.seats ?? 0), 0),
        resources: room.resources,
        cracked: room.cracked,
        coin: room.coin,
        food: room.food,
        kit: room.kit,
        foods: room.foods,
      };
    })
    .filter((room) => room.resources + room.cracked + room.coin + room.food + room.kit.length > 0);

  // ---- the town at this size --------------------------------------------------------------------------------------------
  const seated = roles.filter((r) => r.seats > 0);
  const sum = (key) => seated.reduce((n, r) => n + r[key] * r.seats, 0);
  const seatTotal = seated.reduce((n, r) => n + r.seats, 0);
  // Seats by the close that leaves them Starving, with the soonest of those seats' Dying turns: the gap
  // between the two is the 33 points under the Starving line, so it is no fixed number of turns.
  const starveBy = new Map();
  for (const r of seated) {
    const row = starveBy.get(r.starveTurn) ?? { turn: r.starveTurn, seats: 0, dying: Infinity };
    row.seats += r.seats;
    row.dying = Math.min(row.dying, r.dyingTurn);
    starveBy.set(r.starveTurn, row);
  }
  const starveRows = [...starveBy.values()].sort((a, b) => a.turn - b.turn);
  const fundedRows = [
    { label: "Carry no food at all", seats: seated.filter((r) => r.food === 0).reduce((n, r) => n + r.seats, 0) },
    { label: "Have no coin in hand or bank", seats: seated.filter((r) => r.funds === 0).reduce((n, r) => n + r.seats, 0) },
    { label: "Have neither food nor coin", seats: seated.filter((r) => r.food === 0 && r.funds === 0).reduce((n, r) => n + r.seats, 0) },
    { label: "Could feed themselves 10+ turns from what they carry and hold", seats: seated.filter((r) => r.turnsWithFunds >= 10).reduce((n, r) => n + r.seats, 0) },
  ];

  const groups = ALL_GROUPS.map((g) => {
    const rs = seated.filter((r) => r.group === g.slug);
    if (!rs.length) return null;
    const seats = rs.reduce((n, r) => n + r.seats, 0);
    const tot = (key) => rs.reduce((n, r) => n + r[key] * r.seats, 0);
    return {
      slug: g.slug,
      name: g.name,
      roles: rs.length,
      seats,
      bank: tot("bank"),
      coinHand: tot("coinHand"),
      funds: tot("funds"),
      resources: tot("resources"),
      cracked: tot("cracked"),
      food: tot("food"),
      perSeatFunds: tot("funds") / seats,
      perSeatFood: tot("food") / seats,
      starveTurn: Math.min(...rs.map((r) => r.starveTurn)),
      medianStarve: median(rs.flatMap((r) => Array(r.seats).fill(r.starveTurn))),
    };
  }).filter(Boolean);

  // The Vault: the treasury claims are meant to fit inside it (docs/roles.yaml, `db:audit-vault-backing`).
  const vault = roomView.find((r) => r.id === "undertown-1-7");
  const treasuryClaims = seated.filter((r) => r.account === "treasury").reduce((n, r) => n + r.bank * r.seats, 0);
  const offshoreClaims = seated.filter((r) => r.account === "offshore").reduce((n, r) => n + r.bank * r.seats, 0);

  // What lies in open rooms, for anybody who walks in.
  const commons = roomView
    .filter((r) => r.hasStash && !r.access)
    .reduce((t, r) => ({ resources: t.resources + r.resources, cracked: t.cracked + r.cracked, coin: t.coin + r.coin, food: t.food + r.food, rooms: t.rooms + (worth(r) > 0 ? 1 : 0) }), { resources: 0, cracked: 0, coin: 0, food: 0, rooms: 0 });

  const unlimited = roles.filter((r) => r.unlimited);

  return {
    players,
    start,
    decay: decayBase,
    deathTurns,
    hungryAt: hunger.HUNGRY_THRESHOLD,
    starvingAt: hunger.STARVING_THRESHOLD,
    costPerPersonTurn,
    fastDecay: params.hungerDecayFast,
    noFoodHungry: hungryTurn(0, decayBase),
    noFoodStarve: startingTurn(0, decayBase),
    noFoodDying: zeroTurn(0, decayBase) + deathTurns - 1,
    roles,
    rooms: roomsOut,
    groups,
    starveRows,
    fundedRows,
    unlimited: unlimited.map((r) => r.name),
    town: {
      seats: seatTotal,
      bank: sum("bank"),
      coinHand: sum("coinHand"),
      funds: sum("funds"),
      resources: sum("resources"),
      cracked: sum("cracked"),
      food: sum("food"),
      dishes: seated.filter((r) => r.crops >= 20).reduce((n, r) => n + r.dishes * r.seats, 0),
      foodTurns: sum("food") / decayBase,
      cropTurns: seated.filter((r) => r.crops >= 20).reduce((n, r) => n + r.crops * r.seats * cookedPerCrop, 0) / decayBase,
      cookSeats: seated.filter((r) => r.crops >= 20).reduce((n, r) => n + r.seats, 0),
      // What one cooking seat starts with, and the meal everybody else carries: medians over the roles, for the prose.
      cookKit: (() => {
        const cooks = seated.filter((r) => r.crops >= 20);
        return cooks.length ? { crops: median(cooks.map((r) => r.crops)), dishes: median(cooks.map((r) => r.dishes)), moves: median(cooks.map((r) => r.cookMoves)) } : null;
      })(),
      mealHunger: median(seated.filter((r) => r.crops < 20 && r.food > 0).map((r) => r.food)),
      // The food most non-cooking seats carry, word for word off the roles, and how many seats that is.
      mealKit: (() => {
        const by = new Map();
        for (const r of seated.filter((r) => r.crops < 20 && r.food > 0)) {
          const k = r.foodItems.join(", ");
          by.set(k, (by.get(k) ?? 0) + r.seats);
        }
        const [kit, seats] = [...by.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
        return kit ? { kit, seats } : null;
      })(),
      needPerTurn: seatTotal * decayBase,
    },
    vault: vault ? { coin: vault.coin, resources: vault.resources } : null,
    treasuryClaims,
    offshoreClaims,
    commons,
    unresolved,
    checks: { unresolved },
  };
}

module.exports = { buildStarting };
