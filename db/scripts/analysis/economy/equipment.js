// What a point buys in gear.
//
// Every Item and Asset a player can pick at character creation (purchasable, pointCost > 0 — all of
// them are purchasableAfterStart: false, so the point price is only ever paid out of the starting
// budget, TAGS.md §4a), set against what the same thing costs or earns once the game is running.
// Four lenses, each in its own unit and labelled, never folded into one number:
//
//   REPLACE   the cheapest way to come by one in play, in ¢: the Depot's shelf price where it is
//             stocked; what the counter pays a maker for one (sellablePrice, the least a smith would
//             take for it); or making it yourself (⬢ at the Depot's import price, spent inputs at
//             their price, and the Moves at what a Move would have earned mining). A container is
//             what it opens into. This is what a point is actually exchanged for, so "¢ a point" is
//             built on it.
//   SELL      the counter's guaranteed floor (sellablePrice). What the pick liquidates for.
//   EARNS     for the few pieces that raise output (a pickaxe, a mining helmet, fertilizer), what
//             the investments model already says they clear over the game.
//   FIGHT     for a weapon, the tiers it adds and the ceiling COMBAT.md puts on pricing them
//             (about 7 pt a tier); for armour, the two fractions it turns aside, in the game's own
//             six words.
//
// HOW HARD is the sourcing model's rank of the item's easiest in-game route, with the creation pick
// itself left out (that is the thing being priced), plus which starting kits hand it out for free.
//
// `pointValue` is the ¢ one point is meant to buy: POINT_VALUE below, Bascinet's call on 2026-09-22 — the
// paragraph under TAGS.md §4a's point table (its "priced off what it costs in play" rule; the table itself is in
// points): an Item or Asset is priced at 6–8 ¢ of kit a point, and 7 is the target. It is a rule for SETTING a
// pointCost, not a rate anything in the game trades at: no code turns points into coin.
// The catalog's own median is reported beside it. `--point-value N` tries another scale, and the last
// columns say what each tag would cost on it and how far off it is.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { rankLabel, RULES } = require("./sources");
const { armorWord } = require("../../../lib/armorValue");
const { median } = require("./stats");
const { MANIFESTS, manifestOf } = require("../../../lib/depotManifests");

const REPO = path.resolve(__dirname, "../../../..");

// TAGS.md §4a, the canonical scale. Anything else is off-band, which the doc lists case by case.
const BANDS = { 2: "Minor", 5: "Moderate", 7: "Significant", 9: "Good", 11: "Very good", 14: "Character defining" };
// COMBAT.md "Pricing a tag": a fighting rung costs 7 tag points, so a tier is worth about 7 points —
// a ceiling, not a formula. A weapon's tiers × this is the most combat alone could justify charging.
const POINTS_PER_TIER = 7;
// What one creation point buys in gear, in ¢ — the rule TAGS.md §4a sets for Items and Assets (6–8 ¢ a
// point, 2026-09-22). Every pick's Fair and Drift are measured against it unless --point-value says otherwise.
const POINT_VALUE = 7;
const POINT_VALUE_RANGE = [6, 8];

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

function groupNames() {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(REPO, "docs/taggroups.yaml"), "utf8"));
    const out = new Map();
    for (const [slug, g] of Object.entries(doc?.groups ?? doc ?? {})) if (g && typeof g === "object" && g.name) out.set(slug, g.name);
    return out;
  } catch {
    return new Map();
  }
}

function buildEquipment({ list, get, sources, investments, rv, moveValue, gameTurns, pointsOf, params, pointValue = null }) {
  const names = groupNames();
  const nameOf = (slug) => get(slug)?.name ?? slug;
  const groupOf = (t) => {
    if (!t.group) return "Ungrouped";
    if (names.has(t.group)) return names.get(t.group);
    const tail = t.group.replace(/^(items|assets)-/, "");
    return tail.charAt(0).toUpperCase() + tail.slice(1);
  };
  const isPick = (t) => (t.category === "items" || t.category === "assets") && t.purchasable && (t.pointCost ?? 0) > 0;
  // What a maker pays for one of an input: the shelf price where the Depot stocks it, else what it fetches.
  const priceOf = (slug) => {
    const t = get(slug);
    return t?.depotPrice ?? t?.sellablePrice ?? null;
  };
  const needsWorkshop = (t) => {
    if (t.slug === RULES.workshopSlug) return false;
    const skills = t.requirement?.skills ?? [];
    if (skills.includes("crafting")) return false;
    return skills.some((s) => RULES.workshopPrefixes.some((p) => s === p || s.startsWith(`${p}-`)));
  };

  // ---- making one yourself ---------------------------------------------------------------------
  function craftOf(t) {
    const r = t.requirement;
    if (!t.craftable || !r) return null;
    let items = 0;
    const inputs = [];
    const flags = [];
    let selfRef = false;
    for (const raw of r.items ?? []) {
      if (typeof raw === "string") {
        if (raw === t.slug) selfRef = true;
        const p = priceOf(raw);
        if (p == null) flags.push(`unpriced input ${nameOf(raw)}`);
        items += p ?? 0;
        inputs.push(nameOf(raw));
      } else if (raw.anyOf) {
        const slugs = raw.anyOf.map((o) => (typeof o === "string" ? o : o.tag ?? o.customOf));
        const opts = slugs.map(priceOf).filter((v) => v != null);
        if (!opts.length) flags.push(`unpriced input ${slugs.map(nameOf).join(" / ")}`);
        items += opts.length ? Math.min(...opts) : 0;
        inputs.push(`one of ${slugs.map(nameOf).join(" / ")}`);
      } else if (raw.group) {
        inputs.push(`any ${raw.group} (kept)`); // held, not used up, so it costs nothing here
      } else {
        const slug = raw.tag ?? raw.customOf;
        if (slug === t.slug) selfRef = true;
        const n = raw.count ?? 1;
        if (!raw.keep) {
          const p = priceOf(slug);
          if (p == null) flags.push(`unpriced input ${nameOf(slug)}`);
          items += n * (p ?? 0);
        }
        inputs.push(`${n > 1 ? `${n}× ` : ""}${nameOf(slug)}${raw.keep ? " (kept)" : ""}`);
      }
    }
    const skills = r.skills ?? [];
    const skillPoints = skills.length ? Math.max(...skills.map((s) => pointsOf(s))) : 0;
    const resources = r.resourceCost ?? 0;
    const moves = r.turnsCost ?? 0;
    const materials = resources * rv.buy + items;
    return {
      resources,
      moves,
      items,
      inputs,
      skills,
      skillNames: skills.map(nameOf),
      skillPoints,
      workshop: needsWorkshop(t),
      materials,
      allIn: materials + moves * moveValue,
      selfRef,
      flags,
    };
  }

  // ---- the cheapest way to hold one, in ¢ ---------------------------------------------------------
  const replaceMemo = new Map();
  function replaceOf(t, stack = []) {
    if (!t) return null;
    if (replaceMemo.has(t.slug)) return replaceMemo.get(t.slug);
    if (stack.includes(t.slug)) return null;
    const here = [...stack, t.slug];
    const options = [];
    const flags = [];
    if (t.depotPrice != null) {
      const shelf = t.manifest ?? "merchant";
      const gate = RULES.shelfGate[shelf] ?? null;
      options.push({ via: "depot", how: `Depot, ${shelf} shelf${gate ? ` (needs ${nameOf(gate)})` : ""}`, coin: t.depotPrice });
    }
    const c = craftOf(t);
    if (c && !c.selfRef) {
      options.push({
        via: "make",
        how: `make it: ${c.resources} ⬢${c.items ? ` + ${round1(c.items)} ¢ of inputs` : ""}, ${c.moves} Move${c.moves === 1 ? "" : "s"}, ${c.skillNames.join(" + ") || "no skill"}${c.workshop ? ", at a forge" : ""}`,
        coin: c.allIn,
      });
      flags.push(...c.flags);
      // The counter pays a maker this much for one, so it is the least a maker would take from you.
      if (t.sellablePrice != null) options.push({ via: "maker", how: "buy one from a maker at the counter's price", coin: t.sellablePrice });
    }
    // A container is worth what it opens into — but only when everything inside has a price. One
    // unpriced content (a status, a sheet of paper) would make the whole crate read as free and
    // come in under the shelf price that is actually there.
    const contents = [];
    let unpriced = 0;
    for (const entry of t.consumesInto ?? []) {
      const slugs = typeof entry === "string" ? [entry] : entry.oneOf ? entry.oneOf.map((o) => (typeof o === "string" ? o : o.slug)) : [entry.slug];
      const vals = slugs.filter(Boolean).map((s) => replaceOf(get(s), here)?.coin ?? get(s)?.sellablePrice ?? null);
      const known = vals.filter((v) => v != null);
      if (!known.length) {
        unpriced++;
        flags.push(`no price on ${slugs.map(nameOf).join(" / ")} inside it`);
        continue;
      }
      contents.push({ label: slugs.map(nameOf).join(" / "), coin: Math.min(...known) });
    }
    // Two or more of the same thing read as one line with a count.
    const counted = [...contents.reduce((m, x) => m.set(x.label, { ...x, n: (m.get(x.label)?.n ?? 0) + 1 }), new Map()).values()];
    if (contents.length && !unpriced)
      options.push({ via: "contents", how: `what it opens into: ${counted.map((x) => `${x.n > 1 ? `${x.n}× ` : ""}${x.label} ${round1(x.coin)} ¢`).join(", ")}`, coin: contents.reduce((n, x) => n + x.coin, 0) });
    if (t.consumeChoice?.length) {
      const vals = t.consumeChoice.map((s) => ({ s, v: replaceOf(get(s), here)?.coin ?? get(s)?.sellablePrice ?? null })).filter((x) => x.v != null);
      if (vals.length) options.push({ via: "contents", how: `your pick of ${t.consumeChoice.map(nameOf).join(" / ")}`, coin: Math.min(...vals.map((x) => x.v)) });
      else flags.push(`no price on the choice of ${t.consumeChoice.map(nameOf).join(" / ")}`);
    }
    // Nothing stocks it and nobody makes it, but the counter buys it: its sale is a floor on what it
    // is worth, and the only ¢ figure there is (the Heirloom).
    if (!options.length && t.sellablePrice != null) options.push({ via: "floor", how: "only what the counter pays for it", coin: t.sellablePrice });
    const best = options.length ? options.slice().sort((a, b) => a.coin - b.coin)[0] : null;
    const out = best ? { ...best, options, flags: [...new Set(flags)] } : null;
    if (!stack.length) replaceMemo.set(t.slug, out);
    return out;
  }

  const invBy = new Map((investments?.rows ?? []).map((r) => [r.id, r]));

  // ---- one row a pick -------------------------------------------------------------------------------
  const rows = list.filter(isPick).map((t) => {
    const routes = sources.routesFor(t.slug).filter((r) => r.kind !== "points");
    const best = routes[0] ?? null;
    const kits = routes.find((r) => r.kind === "starting")?.roles ?? [];
    const rep = replaceOf(t);
    const c = craftOf(t);
    const earn = invBy.get(t.slug) ?? null;
    const req = t.requiredTag ? get(t.requiredTag) : null;
    const reqPts = req ? (req.purchasable ? pointsOf(req.slug) : 0) : 0;
    const fight = t.fighting && typeof t.fighting === "object" ? t.fighting : null;
    const armor = t.melee != null || t.ballistic != null ? { melee: t.melee ?? 0, ballistic: t.ballistic ?? 0 } : null;
    const rate = rep && t.pointCost > 0 ? rep.coin / t.pointCost : null;
    return {
      slug: t.slug,
      name: t.name,
      category: t.category,
      group: groupOf(t),
      catalog: t.catalog ?? "all",
      points: t.pointCost,
      band: BANDS[t.pointCost] ?? "off-band",
      requires: req ? `${req.name}${reqPts ? ` (${reqPts} pt)` : req.purchasable ? "" : " (a role)"}` : null,
      requiresPoints: reqPts,
      weight: t.weight ?? 0,
      slot: t.equipSlot ?? null,
      // how hard
      rank: best?.rank ?? 5,
      rankLabel: rankLabel(best?.rank ?? 5),
      route: best?.label ?? "no route in the data",
      routes: routes.map((r) => r.label),
      kits,
      // the money
      depot: t.depotPrice ?? null,
      sell: t.sellablePrice ?? null,
      craft: c
        ? { resources: c.resources, moves: c.moves, inputs: c.inputs, items: round1(c.items), skills: c.skillNames.join(" + ") || "no skill", skillPoints: c.skillPoints, workshop: c.workshop, materials: round1(c.materials), allIn: round1(c.allIn) }
        : null,
      replace: rep ? round1(rep.coin) : null,
      replaceVia: rep?.via ?? null,
      replaceHow: rep?.how ?? null,
      flags: rep?.flags ?? [],
      rate: round1(rate),
      sellRate: t.sellablePrice != null && t.pointCost > 0 ? round1(t.sellablePrice / t.pointCost) : null,
      // what it does
      earnsPerTurn: earn?.gain != null ? round1(earn.gain) : null,
      earnsOverGame: earn?.netOverGame != null ? round1(earn.netOverGame) : null,
      earnsHow: earn?.gainHow ?? null,
      fightTiers: fight?.tiers ?? null,
      fightClass: fight?.weaponClass ?? null,
      fightCeiling: fight?.tiers != null ? round1(fight.tiers * POINTS_PER_TIER) : null,
      armor,
      armorWords: armor ? `Melee: ${armorWord(armor.melee)} | Ballistic: ${armorWord(armor.ballistic)}` : null,
      carryBonus: t.carryBonus ?? null,
      miningBonus: t.miningBonus?.amount ?? null,
      // filled in once the scale is known
      fairPoints: null,
      drift: null,
      verdict: null,
    };
  });

  // ---- the scale ------------------------------------------------------------------------------------
  const priced = rows.filter((r) => r.rate != null);
  const medianRate = median(priced.map((r) => r.rate));
  const pv = pointValue ?? POINT_VALUE;
  for (const r of rows) {
    if (r.replace == null) continue;
    r.fairPoints = Math.max(1, Math.round(r.replace / pv));
    r.drift = r.points - r.fairPoints;
    // The rule is a range, not a point: 6–8 ¢ around 7. On a --point-value override the same width,
    // a seventh either side, is kept.
    r.verdict = r.rate > pv * (POINT_VALUE_RANGE[1] / POINT_VALUE) ? "a bargain" : r.rate < pv * (POINT_VALUE_RANGE[0] / POINT_VALUE) ? "overpriced" : "on the scale";
  }
  rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.points - b.points || a.name.localeCompare(b.name));

  const byGroup = [...new Set(rows.map((r) => r.group))].map((g) => {
    const rs = rows.filter((r) => r.group === g);
    const pr = rs.filter((r) => r.rate != null);
    return {
      group: g,
      rows: rs.length,
      priced: pr.length,
      medianRate: round1(median(pr.map((r) => r.rate))),
      minRate: pr.length ? round1(Math.min(...pr.map((r) => r.rate))) : null,
      maxRate: pr.length ? round1(Math.max(...pr.map((r) => r.rate))) : null,
      bargains: rs.filter((r) => r.verdict === "a bargain").length,
      overpriced: rs.filter((r) => r.verdict === "overpriced").length,
    };
  }).sort((a, b) => (b.medianRate ?? -1) - (a.medianRate ?? -1));

  const byPoints = [...new Set(rows.map((r) => r.points))].sort((a, b) => a - b).map((p) => {
    const rs = rows.filter((r) => r.points === p);
    const pr = rs.filter((r) => r.replace != null);
    return {
      points: p,
      band: BANDS[p] ?? "off-band",
      rows: rs.length,
      priced: pr.length,
      medianReplace: round1(median(pr.map((r) => r.replace))),
      minReplace: pr.length ? round1(Math.min(...pr.map((r) => r.replace))) : null,
      maxReplace: pr.length ? round1(Math.max(...pr.map((r) => r.replace))) : null,
      medianRate: round1(median(pr.map((r) => r.rate))),
      atScale: round1(p * pv),
      examples: rs.slice(0, 4).map((r) => r.name).join(", "),
    };
  });

  // What a point returns when it buys a skill instead, from the investments model: ¢ a turn per
  // point, played out over the game. The same budget, the other thing it can buy.
  const skillPoints = (investments?.rows ?? [])
    .filter((r) => r.perPoint != null && r.points > 0 && r.perPoint > 0 && r.coin === 0)
    .map((r) => ({ name: r.name, group: r.group, valuedBy: r.valuedBy ?? "cash", paysThrough: r.paysThrough, points: r.points, perTurnPerPoint: round1(r.perPoint), overGamePerPoint: round1(r.perPoint * gameTurns) }))
    .sort((a, b) => b.overGamePerPoint - a.overGamePerPoint);

  const unpriced = rows.filter((r) => r.replace == null);
  // The one real route from coin to tag points: a ware that is spent into points (`consumesIntoTagPoints`), bought
  // at the shelf that stocks it, behind whatever tag opens that shelf.
  const pointRoutes = list
    .filter((t) => t.consumesIntoTagPoints > 0 && t.depotPrice != null)
    .map((t) => {
      const shelf = MANIFESTS.find((m) => m.id === manifestOf(t));
      return { name: t.name, price: t.depotPrice, points: t.consumesIntoTagPoints, perPoint: t.depotPrice / t.consumesIntoTagPoints, shelf: shelf?.name ?? manifestOf(t), gate: shelf?.requiredTagSlug ? get(shelf.requiredTagSlug)?.name ?? shelf.requiredTagSlug : null };
    });
  // The schema's own word on the two armour columns.
  const schemaSrc = fs.readFileSync(path.join(REPO, "db/prisma/schema.prisma"), "utf8");
  const meleeUnread = /meleeArmor is authored and displayed but nothing reads it mechanically yet/.test(schemaSrc);
  const ballisticLive = /ballisticArmor is live: it is what the\s*\/\/\s*turrets roll against/.test(schemaSrc);
  // Who reads each field: the turret code rolls against ballistic; a GM reads the melee word off the sheet in an
  // Attack (ATTACK.md). Both are checked in their sources so the sentence cannot outlive them.
  const turretReadsBallistic = /ballisticArmor|combineArmor/.test(fs.readFileSync(path.join(REPO, "db/lib/depotTurret.js"), "utf8"));
  const attackDocReadsArmour = /armou?r/i.test(fs.readFileSync(path.join(REPO, "docs/systemdocs/ATTACK.md"), "utf8"));
  return {
    // The cheapest way to hold one in play, in ¢ (the REPLACE lens above), for any other tab to price by.
    replaceOf: (slug) => replaceOf(get(slug)),
    pointRoutes,
    armorNote: { meleeUnread, ballisticLive, turretReadsBallistic, attackDocReadsArmour },
    rows,
    byGroup,
    byPoints,
    skillPoints,
    unpriced: unpriced.map((r) => ({ slug: r.slug, name: r.name, points: r.points, route: r.route })),
    pointValue: round1(pv),
    pointValueSet: pointValue != null,
    pointValueRange: [round1(pv * (POINT_VALUE_RANGE[0] / POINT_VALUE)), round1(pv * (POINT_VALUE_RANGE[1] / POINT_VALUE))],
    medianRate: round1(medianRate),
    pointsPerTier: POINTS_PER_TIER,
    bands: BANDS,
    budget: {
      points: params.startingTagPoints,
      coin: round1(params.startingTagPoints * pv),
      miningTurns: round1((params.startingTagPoints * pv) / moveValue),
    },
    moveValue: round1(moveValue),
    counts: {
      picks: rows.length,
      priced: priced.length,
      bargains: rows.filter((r) => r.verdict === "a bargain").length,
      overpriced: rows.filter((r) => r.verdict === "overpriced").length,
      onScale: rows.filter((r) => r.verdict === "on the scale").length,
      kits: rows.filter((r) => r.kits.length).length,
    },
  };
}

module.exports = { buildEquipment, BANDS, POINTS_PER_TIER, POINT_VALUE, POINT_VALUE_RANGE };
