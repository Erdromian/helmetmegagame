// Transport: what is hard to carry.
//
// Every figure uses the game's own carry rules (db/lib/carry.js): the base cap is GameConfig.carryWeightLbs, a
// carrier's bonuses add to a multiplier (an equippable one, the Cart, only while it is equipped), the hard cap is
// the cap × HARD_CAP_RATIO, and past the cap you are Overburdened, which zeroes the free zone crossings (CARRY.md
// §2), so a crossing costs the Move. Past the hard cap nothing more can be picked up: an involuntary gain is set down
// where you stand. A crate weighs half of what went in, rounded up, never under 1 lb (db/lib/depotCrates.js), and can
// only be packed where Packaging Equipment is in reach; ⬢ and crates cannot go in a hand-packed crate
// (packageItemsRequestImpl), and the Depot ships its freight already crated. Zones are read off the map by attribute
// (refinery, godflesh, depot, soilery) and the rooms that stock the equipment, never by name; hops are the planner's.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const carry = require("../../../lib/carry");
const { crateWeight, RESOURCE_UNIT_LBS } = require("../../../lib/depotCrates");
const { PACKAGE_MAX_LBS, PACKAGE_MAX_UNITS, PACKAGING_EQUIPMENT_SLUG } = require("../../../lib/constants");
const refinery = require("../../../lib/refinery");

const REPO = path.resolve(__dirname, "../../../..");

// Every Location (and room) in the map, with its zone, attributes, `indoors`, the room's access and what it stocks.
function readPlaces() {
  const doc = yaml.load(fs.readFileSync(path.join(REPO, "docs/zones.yaml"), "utf8"));
  const places = [];
  const scan = (zone, locations) => {
    for (const [slug, loc] of Object.entries(locations ?? {})) {
      const stock = (st) => new Set([...(Array.isArray(st) ? st : []), ...Object.keys(st?.items ?? {}), ...(Array.isArray(st?.items) ? st.items : [])]);
      places.push({ zone, location: slug, room: null, name: loc.name, attributes: loc.attributes ?? {}, indoors: Boolean(loc.indoors), access: null, stocks: stock(loc.stash) });
      for (const [rslug, room] of Object.entries(loc.rooms ?? {})) {
        places.push({ zone, location: slug, room: rslug, name: room.name, attributes: {}, indoors: true, access: room.access ?? null, stocks: stock(room.stash) });
      }
    }
  };
  for (const [zk, zv] of Object.entries(doc.zones)) {
    scan(zk, zv.locations);
    for (const [lk, lv] of Object.entries(zv.levels ?? {})) scan(lk, lv.locations);
  }
  return places;
}

function buildTransport({ get, list, params, combos, activities, resourceBalance, producerDrops, schemaDefault }) {
  const places = readPlaces();
  const zoneWith = (attr) => places.find((p) => p.attributes[attr] === true)?.zone ?? null;
  const stocking = (slug) => places.filter((p) => p.stocks.has(slug));
  const hops = (a, b) => (a && b ? combos.hops[a]?.[b] ?? null : null);
  const packaging = stocking(PACKAGING_EQUIPMENT_SLUG);
  const packagingZones = new Set(packaging.map((p) => p.zone));
  const forgeZones = [...new Set(stocking("workshop-equipment").map((p) => p.zone))];
  const w = (slug) => get(slug)?.weight ?? 0;

  // The carriers: bare, and every positive carryBonus a player can pick, plus Cart with Pack Mule.
  const baseConfig = { carryWeightLbs: params.carryWeightLbs };
  const row = (slug) => ({ tag: get(slug), equipped: true });
  const picks = list.filter((t) => t.carryBonus > 0 && t.purchasable).sort((a, b) => a.carryBonus - b.carryBonus);
  const combo = [get("cart"), get("pack-mule")].every(Boolean) ? [{ label: `${get("cart").name} + ${get("pack-mule").name}`, slugs: ["cart", "pack-mule"] }] : [];
  const carriers = [{ label: "Bare", slugs: [] }, ...picks.map((t) => ({ label: t.name, slugs: [t.slug] })), ...combo].map((c) => {
    const milli = carry.carryMultiplier(c.slugs.map(row));
    const caps = carry.carryCaps(baseConfig, milli);
    const hard = carry.carryHardCaps(caps);
    return { ...c, multiplier: milli / carry.MULT_SCALE, cap: caps.weight, hard: hard.weight, equippable: c.slugs.some((s) => get(s)?.equippable) };
  });

  // How one load fares for each carrier: units under each cap, trips for the whole output, and whether a trip
  // leaves the carrier Overburdened.
  const fare = (unitLbs, units, crated) => {
    const each = crated ? null : unitLbs;
    const total = crated ? crateWeight([{ quantity: units, tagId: "x" }], new Map([["x", unitLbs]])) : unitLbs * units;
    return carriers.map((c) => {
      const underCap = each ? Math.floor(c.cap / each) : null;
      const underHard = each ? Math.floor(c.hard / each) : null;
      const trips = total > 0 ? Math.ceil(total / c.hard) : 0;
      const load = trips ? total / trips : 0;
      return { carrier: c.label, cap: c.cap, hard: c.hard, underCap, underHard, trips, overburdened: load > c.cap };
    });
  };

  const depot = combos.sites.depot;
  const flow = ({ id, what, from, to, unitLbs, units, per, note = "", crateable = true }) => {
    const lbs = unitLbs * units;
    const canCrate = crateable && packagingZones.has(from) && lbs <= PACKAGE_MAX_LBS && units <= PACKAGE_MAX_UNITS;
    const cratedLbs = canCrate ? crateWeight([{ quantity: units, tagId: "x" }], new Map([["x", unitLbs]])) : null;
    return { id, what, from, to, hops: hops(from, to), unitLbs, units, lbs, per, note, canCrate, cratedLbs, carriers: fare(unitLbs, units, false), crated: canCrate ? fare(unitLbs, units, true) : null };
  };

  const refineZone = zoneWith("refinery");
  const godfleshZone = zoneWith("godflesh");
  const farmZone = zoneWith("soilery");
  const squeeze = get(refinery.REFINERY_OUTPUT_SLUG);
  const smithing = resourceBalance.find((r) => r.family === "smithing");
  const tob = activities.find((a) => a.id === "farm:tobacco");
  const pro = activities.find((a) => a.id === "mine:Caves:skilled");
  const dropLbs = (producerDrops.prospecting.caves.skilled ?? []).reduce((n, d) => n + d.p * w(d.slug), 0);
  const alcohol = get("alcohol");
  const alcoholPerMove = alcohol?.requirement?.turnsCost ? (alcohol.requirement.yield ?? 1) / alcohol.requirement.turnsCost : null;

  const flows = [
    flow({ id: "squeeze", what: `${squeeze.name}, a refining shift's ${refinery.REFINERY_YIELD} cubes`, from: refineZone, to: depot, unitLbs: w(squeeze.slug), units: refinery.REFINERY_YIELD, per: "a shift" }),
    flow({ id: "godflesh", what: `A ${get("godflesh")?.name ?? "Godflesh"} lump, cut and carried to the vats`, from: godfleshZone, to: refineZone, unitLbs: w("godflesh"), units: 1, per: "a shift", note: godfleshZone === refineZone ? "the same zone: no crossing" : "" }),
    flow({ id: "resources-turn", what: `⬢ for a smith, a median smithing recipe's burn a turn`, from: depot, to: forgeZones[0] ?? null, unitLbs: RESOURCE_UNIT_LBS, units: Math.ceil(smithing?.medianBurn ?? 0), per: "a turn", note: `forge in ${forgeZones.join(", ") || "no zone"}; ⬢ cannot be hand-crated, but a Depot order arrives crated`, crateable: true }),
    flow({ id: "resources-order", what: `⬢, a full Depot order of ${params.depotMaxQuantity}`, from: depot, to: forgeZones[0] ?? null, unitLbs: RESOURCE_UNIT_LBS, units: params.depotMaxQuantity, per: "an order", note: "the Depot ships it crated" }),
    flow({ id: "harvest", what: `A food harvest (${get(params.stapleCrop)?.name ?? params.stapleCrop})`, from: farmZone, to: farmZone, unitLbs: w(params.stapleCrop), units: Math.round(params.harvestPerFarm), per: "a Farm action", note: "light: carried within the farming zone to a kitchen" }),
    ...(tob ? [flow({ id: "tobacco", what: "A tobacco harvest, to the Depot", from: farmZone, to: depot, unitLbs: w("tobacco"), units: Math.round(tob.harvest), per: "a Farm action" })] : []),
    ...(pro ? [flow({ id: "prospector", what: "A Prospector's ⬢ and drops, Caves to the Depot", from: pro.zone, to: depot, unitLbs: 1, units: Math.round(pro.resourcesPerPress * RESOURCE_UNIT_LBS + dropLbs), per: "a press", note: "⬢ at 1 lb and the drops at their weights, as one load", crateable: false })] : []),
    ...(alcoholPerMove ? [flow({ id: "alcohol", what: `${alcohol.name}, a turn's brewing`, from: null, to: depot, unitLbs: w("alcohol"), units: alcoholPerMove, per: "a Move", note: "brewed wherever the brewer is; sold to players, so carried to wherever they are" })] : []),
  ];
  // Anything else the catalog makes over half the base cap a turn: none of the day-verbs above miss one today.

  // Factory solo, carry-limited: each cycle is a shift and a rest turn, and the cubes go to the Depot on ONE trip a
  // cycle. What the carrier can hold (the hard cap) is what gets there; the rest is set down and waits, so in the
  // steady state that is the share delivered. A load over the cap is Overburdened, so the crossing costs the Move,
  // which a solo refiner has spare on the rest turn.
  const solo = activities.find((a) => a.id === "factory:solo");
  const sq = flows.find((f) => f.id === "squeeze");
  const cycle = (label, crated) => {
    const c = carriers.find((x) => x.label === label);
    if (!c) return null;
    const load = crated ? sq.cratedLbs : Math.min(sq.lbs, Math.floor(c.hard / sq.unitLbs) * sq.unitLbs);
    const share = crated ? Math.min(1, c.hard / sq.cratedLbs) : load / sq.lbs;
    return { share, load, overburdened: load > c.cap };
  };
  const cart = get("cart");
  const carryLimited = solo && sq
    ? [
        { key: "bare", label: "bare, uncrated", ...cycle("Bare", false) },
        ...(sq.canCrate ? [{ key: "crated", label: "bare, crated", ...cycle("Bare", true) }] : []),
        ...(cart ? [{ key: "cart", label: cart.name, ...cycle(cart.name, false) }] : []),
      ].map((r) => ({ ...r, perTurn: solo.netPerTurn * r.share }))
    : [];
  const logistics = packaging.filter((p) => p.zone === refineZone);

  return {
    base: params.carryWeightLbs,
    hardRatio: carry.HARD_CAP_RATIO,
    carriers,
    carryTags: list.filter((t) => t.carryBonus).map((t) => ({ name: t.name, bonus: t.carryBonus, pick: Boolean(t.purchasable), equippable: Boolean(t.equippable) })),
    flows,
    packaging: packaging.map((p) => ({ zone: p.zone, where: p.name, access: (p.access ?? []).map((slug) => get(slug)?.name ?? slug) })),
    logistics,
    packageMaxLbs: PACKAGE_MAX_LBS,
    packageMaxUnits: PACKAGE_MAX_UNITS,
    freeCrossings: schemaDefault("freeZoneMovesPerTurn"),
    carryLimited,
    squeezeFlow: sq,
  };
}

module.exports = { buildTransport };
