// Armour, piece against piece.
//
// The "Buyable gear" page prices every pick by the ¢ it replaces for, which is the right lens for a
// rope or a pickaxe and the wrong one for armour: a Pavise and a Knight's Helmet cost the same to
// make per point, so that page called both "on the scale" while the Pavise turned aside as much as
// the helmet for a third of the points. What a piece of armour is FOR is the two fractions it stops
// (Tag.melee / Tag.ballistic), against what it costs in points, pounds, ⬢ and access. This module
// puts every wearable piece on that footing and flags the ones with no reason to exist.
//
// A piece is compared inside its CLASS (the equip slot — two things that can
// be worn together are alternatives to nothing, so a Breastplate is never "dominated" by a helmet)
// and, for the price question only, across the whole catalog. Four flags:
//
//   twin of X          same class, same points, pounds and both fractions, same perks. A cosmetic
//                      variant. Fine if that is the intent; noise in a crafting list if it is not.
//   dominated by X     same class; X stops at least as much on both axes, costs no more points, weighs
//                      no more, is no harder to come by, and has every perk this one has. Nothing this
//                      piece does that X does not do as well or better.
//   outpriced by X     any class; X costs half the points or less and stops as much or more on the
//                      average of the two axes. The Pavise-against-the-helmet shape: the dearer piece
//                      is what gets the flag, since the cheap one is doing nothing wrong.
//   heavy for the step same class; a rival weighs half or less and at least HEAVY_GAP pounds less,
//                      costs no more points, and this piece stops less than STEP more on the average.
//                      Plate at 55 lb over a 20 lb Breastplate — and not a 4 lb helm over a 1 lb cap.
//
// Only pieces a player can actually come by (a creation pick, a Depot ware, or a recipe) take part in
// the comparisons. Role kit and loot — a Cataphract, the Soulbreaker Helm — are listed for reference
// and neither flag anything nor get flagged: a Breastplate is not worse for the Cataphract existing.
//
// PERKS are what a piece does besides stopping blows, and a piece keeping one is never dominated by
// a piece without it: concealing (optional, or forced — kept distinct, since a closed helm you cannot
// open is a cost to some players), hiding under clothes (`visible: worn`), a mining or carry bonus, a
// fighting modifier, and the one pair of gloves db/lib/godflesh.js reads by slug. Every perk is listed
// on the row, so a reader can see what a piece is buying. "Outpriced" honours the ones that DO
// something (the bonus, the modifier, the gloves) — a cheap piece only outprices a dear one it
// matches on those — but not concealment or hiding under a coat: a 2-pt helm already conceals, so
// nobody is paying 7 points for a hood, and a 9-pt closed helm outpriced by a 3-pt shield is the
// exact case this flag exists for.
//
// The TURRET column is the share of wearers left neither dying nor dead by one burst from the Depot
// gun wearing this piece alone (db/lib/depotTurret.js, DEPOT.md §0i) — the one place ballistic armour
// is rolled by code, so it is the honest unit for the ballistic axis.

const { armorWord } = require("../../../lib/armorValue");
const { turretTable, ARMOR_GAIN, armorOdds } = require("../../../lib/depotTurret");
const { rankLabel } = require("./sources");
const { ARMORED_GLOVES_SLUG } = require("../../../lib/godflesh");

// A piece is "heavy for the step" when it weighs twice a cheaper rival and at least this much more,
// and stops less than STEP more on the average of the two axes. A band is 0.2 wide (armorValue.js),
// so STEP is half a word; the gap keeps a 4 lb helm from being "heavy" over a 1 lb cap.
const STEP = 0.1;
const HEAVY_GAP = 10;

const round3 = (n) => Math.round(n * 1000) / 1000;

function perksOf(t) {
  const out = [];
  if (t.forcesConceal) out.push("conceals (forced)");
  else if (t.concealsIdentity) out.push("conceals");
  if (t.visible === "worn") out.push("hidden unless worn");
  if (t.miningBonus?.amount) out.push(`+${t.miningBonus.amount} ⬢ prospecting`);
  if (t.carryBonus) out.push(`carry ${t.carryBonus > 0 ? "+" : ""}${t.carryBonus} lb`);
  if (t.fighting && typeof t.fighting === "object") out.push(t.fighting.situational ? "fighting (situational)" : "fighting modifier");
  if (t.slug === ARMORED_GLOVES_SLUG) out.push("handles Godflesh");
  return out;
}

// Neither dying nor dead after one burst, wearing only this. The graze is a flat dodge outside the
// bend; the wound bands are renormalised over what is left and the draw raised to a power.
function turretSurvival(ballistic) {
  const table = turretTable(null);
  const graze = table.graze ?? 0;
  const wounds = ["minor-wound", "deep-wound", "grievous-wound"].reduce((s, k) => s + (table[k] ?? 0), 0);
  const mass = 1 - graze;
  const k = 1 + ARMOR_GAIN * armorOdds(Math.min(0.95, ballistic));
  return graze + mass * Math.pow(wounds / mass, 1 / k);
}

function buildArmor({ list, get, sources = null, pointsOf = () => 0 }) {
  const nameOf = (slug) => get?.(slug)?.name ?? slug;
  const rows = list
    .filter((t) => t.category === "items" && t.equipSlot && ((t.melee ?? 0) > 0 || (t.ballistic ?? 0) > 0))
    .map((t) => {
      const melee = t.melee ?? 0;
      const ballistic = t.ballistic ?? 0;
      const r = t.requirement ?? null;
      const craft = t.craftable && r ? { resources: r.resourceCost ?? 0, moves: r.turnsCost ?? 0, skills: (r.skills ?? []).map(nameOf), items: (r.items ?? []).map((i) => nameOf(typeof i === "string" ? i : i.tag ?? i.customOf ?? "")).filter(Boolean) } : null;
      const routes = sources ? sources.routesFor(t.slug).filter((x) => x.kind !== "points") : [];
      const rank = routes[0]?.rank ?? 5;
      const reach = t.purchasable && (t.pointCost ?? 0) > 0 ? "pick" : t.depotPrice != null ? "depot" : craft ? "craft" : "kit";
      return {
        slug: t.slug,
        name: t.name,
        catalog: t.catalog ?? "all",
        slot: t.equipSlot,
        layer: t.equipLayer ?? null,
        cls: { HEAD: "Head", BODY: "Body", WEAPON: "Held", ACCESSORY: "Accessory", MOUNT: "Ride" }[t.equipSlot] ?? t.equipSlot,
        points: t.pointCost ?? 0,
        weight: t.weight ?? 0,
        melee,
        ballistic,
        average: round3((melee + ballistic) / 2),
        meleeWord: armorWord(melee),
        ballisticWord: armorWord(ballistic),
        turret: round3(turretSurvival(ballistic)),
        perks: perksOf(t),
        reach,
        rank,
        rankLabel: rankLabel(rank),
        route: routes[0]?.label ?? "no route in the data",
        depot: t.depotPrice ?? null,
        sell: t.sellablePrice ?? null,
        craft,
        skillPoints: craft?.skills?.length ? Math.max(...(r.skills ?? []).map((s) => pointsOf(s))) : 0,
        twins: [],
        dominatedBy: [],
        outpricedBy: [],
        heavyFor: [],
        badges: [],
        verdict: null,
      };
    });

  const inPlay = rows.filter((r) => r.reach !== "kit");
  const sameClass = (a, b) => a.cls === b.cls;
  const perksCover = (x, r) => r.perks.every((p) => x.perks.includes(p));
  const LOOK_PERKS = new Set(["conceals", "conceals (forced)", "hidden unless worn"]);
  const pricePerksCover = (x, r) => r.perks.every((p) => LOOK_PERKS.has(p) || x.perks.includes(p));
  const samePerks = (x, r) => x.perks.length === r.perks.length && perksCover(x, r);

  for (const r of inPlay) {
    for (const x of inPlay) {
      if (x === r) continue;
      if (sameClass(x, r)) {
        const equal = x.points === r.points && x.weight === r.weight && x.melee === r.melee && x.ballistic === r.ballistic;
        if (equal && samePerks(x, r)) {
          r.twins.push(x.name);
          continue;
        }
        const noWorse = x.melee >= r.melee && x.ballistic >= r.ballistic && x.points <= r.points && x.weight <= r.weight && x.rank <= r.rank && perksCover(x, r);
        const better = x.melee > r.melee || x.ballistic > r.ballistic || x.points < r.points || x.weight < r.weight;
        if (noWorse && better) r.dominatedBy.push(x.name);
        if (x.weight * 2 <= r.weight && r.weight - x.weight >= HEAVY_GAP && x.points <= r.points && r.average - x.average < STEP && x.rank <= r.rank) r.heavyFor.push(`${x.name} (${x.weight} lb)`);
      }
      if (r.points > 0 && x.points > 0 && x.points * 2 <= r.points && x.average >= r.average && x.rank <= r.rank && pricePerksCover(x, r)) r.outpricedBy.push(`${x.name} (${x.points} pt)`);
    }
  }

  // Best-in-class badges, among the pieces in play, so a row can say what it is FOR.
  const classes = [...new Set(inPlay.map((r) => r.cls))];
  for (const cls of classes) {
    const rs = inPlay.filter((r) => r.cls === cls);
    if (rs.length < 2) continue;
    const award = (label, key, pick) => {
      const best = pick(rs.map(key));
      for (const r of rs) if (key(r) === best) r.badges.push(label);
    };
    award("lightest", (r) => r.weight, (v) => Math.min(...v));
    award("cheapest", (r) => r.points, (v) => Math.min(...v));
    award("best melee", (r) => r.melee, (v) => Math.max(...v));
    award("best ballistic", (r) => r.ballistic, (v) => Math.max(...v));
    award("best average", (r) => r.average, (v) => Math.max(...v));
    award("easiest to get", (r) => r.rank, (v) => Math.min(...v));
  }

  for (const r of rows) {
    if (r.reach === "kit") r.verdict = "kit or loot";
    else if (r.dominatedBy.length || r.twins.length) r.verdict = "no use case";
    else if (r.outpricedBy.length || r.heavyFor.length) r.verdict = "worth a look";
    else r.verdict = "earns its place";
  }

  const order = { Head: 0, Body: 1, Held: 2, Accessory: 3 };
  rows.sort((a, b) => (order[a.cls] ?? 9) - (order[b.cls] ?? 9) || a.points - b.points || a.weight - b.weight || a.name.localeCompare(b.name));

  return {
    rows,
    step: STEP,
    heavyGap: HEAVY_GAP,
    counts: {
      pieces: rows.length,
      inPlay: inPlay.length,
      noUseCase: rows.filter((r) => r.verdict === "no use case").length,
      worthALook: rows.filter((r) => r.verdict === "worth a look").length,
      twins: rows.filter((r) => r.twins.length).length,
      dominated: rows.filter((r) => r.dominatedBy.length).length,
      outpriced: rows.filter((r) => r.outpricedBy.length).length,
      heavy: rows.filter((r) => r.heavyFor.length).length,
    },
  };
}

module.exports = { buildArmor, STEP, HEAVY_GAP, turretSurvival };
