// Secret recipes: the crafts an ordinary player is never shown, and why each one matters.
//
// Two flags from the sourcing model (sources.js), both about who is SHOWN a recipe (CRAFTING.md §2):
//   - secretRecipe: the product itself is not `catalog: all`. Holding an ingredient never reveals one of these; it
//     reaches a character only when a GM hands over the product or the page, or a seat starts holding the product
//     (TAGS.md §5: a `gm` tag shows to a player once they relate to it). A `secret` product is hidden even from GMs
//     outside the unfiltered /gm/dev/tags view.
//   - hiddenUntilHeld: the recipe names an ingredient that is not `catalog: all`, and is not marked recipePublic,
//     so it stays off the Craft menu until the character holds one of those ingredients.
// What each is worth is read off the other tabs, never worked out again: the armour verdicts and efficient kits
// (combat.js), a weapon's band steps (combat.js), a craft's wage against DEPOT.md §4's rung (model.js), a dish's
// worth and margin (cooking.js), and any effect no main-catalogue tag carries.

function buildSecrets({ list, get, sources, combat, activities, profitRows, profitTiers, workedRows, shortlists, starting, cooking, pointsOf }) {
  const nameOf = (slug) => get(slug)?.name ?? slug;
  const rankLabel = (id) => sources.ranks.find((r) => r.id === id)?.label ?? "?";
  const open = (slug) => (get(slug)?.catalog ?? "all") === "all";
  const main = list.filter((t) => open(t.slug));
  const r1 = (n) => Math.round(n * 10) / 10;

  // ---- effects, as atoms a main-catalogue tag either shares or does not ------------------------------------------
  const intoSlugs = (xs) => (xs ?? []).flatMap((x) => (typeof x === "string" ? [x] : x?.oneOf ? x.oneOf.map((o) => (typeof o === "string" ? o : o.slug)) : x?.slug ? [x.slug] : []));
  const atomsOf = (t) => {
    const out = [];
    for (const s of t.cures ?? []) out.push([`cures:${s}`, `cures ${nameOf(s)}`]);
    for (const [a, b] of Object.entries(t.curesInto ?? {})) out.push([`curesInto:${a}`, `turns ${nameOf(a)} into ${nameOf(b)}`]);
    for (const s of new Set(intoSlugs(t.consumesInto))) if (get(s)?.category !== "resource" && s !== "obol") out.push([`into:${s}`, `turns into ${nameOf(s)}`]);
    for (const s of t.removesOnConsume ?? []) out.push([`clears:${s}`, `clears ${nameOf(s)}`]);
    for (const s of t.resists ?? []) out.push([`resists:${s}`, `resists ${nameOf(s)}`]);
    if (t.consumesIntoTagPoints) out.push(["tagPoints", `turns into ${t.consumesIntoTagPoints} tag points`]);
    if (t.carryBonus > 0) out.push(["carryUp", `raises the carry cap by ${Math.round(t.carryBonus * 100)}%`]);
    if (t.miningBonus?.amount > 0) out.push(["mining", `adds ${t.miningBonus.amount} ⬢ to a Mine press`]);
    for (const p of t.placement?.provides ?? []) out.push([`provides:${p}`, `provides ${nameOf(p)} where it stands`]);
    if (t.gambitBonus > 0) out.push(["gambit", `adds ${t.gambitBonus} to the Gambit die`]);
    if (t.poison) out.push(["poison", "is a poison"]);
    if (t.administerable) out.push(["administerable", "can be given to anyone, whatever they hold (MEDICAL.md §1)"]);
    return out;
  };
  const mainAtoms = new Set(main.flatMap((t) => atomsOf(t).map(([k]) => k)));
  const uniqueOf = (t) => atomsOf(t).filter(([k]) => !mainAtoms.has(k)).map(([, text]) => text);

  // ---- who can reach it today ------------------------------------------------------------------------------------
  const roles = starting.roles;
  const reachOf = (t, rec) => {
    const skills = t.requirement?.skills ?? [];
    const withSkill = roles.filter((r) => skills.every((s) => r.tagSlugs.includes(s)));
    const holdsProduct = roles.filter((r) => r.tagSlugs.includes(t.slug));
    const gated = rec.items.filter((i) => i.slugs.some((s) => !open(s)));
    const holdsGate = (r) => gated.some((i) => i.slugs.some((s) => !open(s) && r.tagSlugs.includes(s)));
    const names = (rs) => listAnd(rs.map((r) => r.name));
    const seats = (n) => `${n} seat${n === 1 ? " starts" : "s start"} with the skill`;
    // Who can make it: a secret recipe only for a seat that holds the product (and the skill); a hidden one for a
    // seat with the skill and one of the gated ingredients.
    const makers = rec.secretRecipe ? holdsProduct.filter((r) => withSkill.includes(r) && (!rec.hiddenUntilHeld || holdsGate(r))) : withSkill.filter(holdsGate);
    const parts = [];
    if (holdsProduct.length) parts.push(`${names(holdsProduct)} start${holdsProduct.length === 1 ? "s" : ""} with one`);
    if (makers.length) parts.push(`${names(makers)} can make it from the start`);
    else if (rec.secretRecipe) parts.push(`nobody can make it at the start: only a GM hands out the product or the page${t.catalog === "secret" ? " (and the product is hidden from GMs outside /gm/dev/tags)" : ""}${withSkill.length ? `; ${seats(withSkill.length)}` : ""}`);
    else parts.push(`anyone with the skill once they hold ${listAnd(gated.map((i) => i.label), "or")}; ${withSkill.length ? seats(withSkill.length) : "no seat starts with the skill"}`);
    return { who: [...new Set([...holdsProduct, ...makers].map((r) => r.name))], text: parts.join("; ") };
  };

  // ---- why it matters, looked up on the other tabs ----------------------------------------------------------------
  const A = combat.armourKits;
  const slotPieces = A.bySlot.flatMap((g) => g.pieces.map((p, i) => ({ p, rank: i + 1, of: g.pieces.length })));
  const special = [...A.kitOnly, ...A.setAside];
  const dishRank = (() => {
    const ds = cooking.dishes.filter((d) => d.value != null);
    const by = (f) => [...ds].sort((a, b) => (b[f] ?? -1e9) - (a[f] ?? -1e9)).map((d) => d.slug);
    return { value: by("value"), margin: by("marginPerMove"), n: ds.length };
  })();
  const flagged = new Set(sources.recipes.filter((r) => r.secretRecipe || r.hiddenUntilHeld).map((r) => r.slug));
  const rows = sources.recipes
    .filter((r) => r.secretRecipe || r.hiddenUntilHeld)
    .map((rec) => {
      const t = get(rec.slug);
      const why = [];
      let tier = 2; // 0 best in class or unique, 1 efficient for its cost, 2 the rest
      // Every reason that lifts a row counts toward its place: two firsts outrank one.
      let score = 0;
      const lift = (n) => {
        tier = Math.min(tier, n);
        score += n === 0 ? 10 : 1;
      };
      // Armour: on the main table, how many efficient kits hold it; off it, the verdict against what anyone can wear.
      const onMain = slotPieces.find((x) => x.p.slug === rec.slug);
      const off = special.find((p) => p.slug === rec.slug);
      if (onMain) {
        why.push(`armour: in ${onMain.p.efficientKits} of ${A.efficient.length} efficient kits, #${onMain.rank} of ${onMain.of} in ${onMain.p.slot} (it has a route in, ${onMain.p.route}, so it is on the main table)`);
        if (onMain.rank === 1 && onMain.p.efficientKits > 0) lift(0);
        else if (onMain.p.efficientKits > 0) lift(1);
      } else if (off) {
        why.push(`armour, ${off.reason}: ${off.verdict}`);
        if (off.bestInClass?.ballistic || off.bestInClass?.melee) lift(0);
        else if (/as good as/.test(off.verdict)) lift(1);
      }
      // Weapons: the band it reaches and where it ranks among weapons of its class.
      const f = combat.tags.find((r) => r.slug === rec.slug);
      if (f && f.kind.startsWith("weapon")) {
        const cls = combat.tags.filter((r) => r.kind === f.kind).sort((a, b) => b.steps - a.steps || a.points - b.points);
        const rank = cls.findIndex((r) => r.slug === f.slug) + 1;
        const tied = cls.filter((r) => r.steps === f.steps).length;
        why.push(`weapon: ${f.alone} on its own, +${f.steps} band step${f.steps === 1 ? "" : "s"}, ${Math.round(f.caverGain * 10) / 10} ¢ an expedition to a caver (the combat tab's three-position average); ${f.steps === cls[0].steps ? (tied > 1 ? `ties the best of ${cls.length}` : `the best of ${cls.length}`) : `#${rank} of ${cls.length}`} ${f.kind.replace(/^weapon \((.*)\)$/, "$1")} weapons`);
        if (f.steps > 0 && f.steps === cls[0].steps) lift(tied > 1 ? 1 : 0);
      } else if (f && f.steps > 0) {
        why.push(`fighting: +${f.steps} band step${f.steps === 1 ? "" : "s"} (${f.alone})`);
        lift(1);
      }
      // A craft that sells: its wage against its rung's median and the best easy craft of its kind.
      const act = activities.find((a) => a.id === `craft:${rec.slug}`);
      const dish = cooking.dishes.find((d) => d.slug === rec.slug);
      if (act && act.netPerTurnBuy != null && !dish) {
        const rung = profitTiers.filter((x) => x.points <= act.skillPoints).sort((a, b) => b.points - a.points)[0] ?? null;
        const kind = act.skill.split(", ").includes("crafting") ? "crafting" : act.family;
        // The best easy craft a player is actually shown: the shortlist less the recipes this tab is about.
        const bestEasy = (shortlists[kind] ?? []).find((x) => !flagged.has(x.slug)) ?? null;
        const pr = profitRows.find((r) => r.slug === rec.slug);
        const wr = workedRows.find((r) => r.slug === rec.slug);
        const onRung = pr ? (pr.onRung ? "on the DEPOT.md §4 rung" : `off the rung (it pays ${pr.rate} ¢ a Move)`) : wr ? (wr.onFormula ? "on the worked-input formula" : `off the worked-input formula (${wr.expected} ¢ expected)`) : "outside the wage table";
        why.push(`craft: ${r1(act.netPerTurnBuy)} ¢ a turn${rung ? `, against ${r1(rung.netMedian)} at the ${rung.points}-point median` : ""}${bestEasy ? ` and ${r1(bestEasy.netPerTurnBuy)} for the best easy ${kind} craft (${bestEasy.name})` : ""}; ${onRung}`);
        if (bestEasy && act.netPerTurnBuy > bestEasy.netPerTurnBuy && (!rung || act.netPerTurnBuy > rung.netMedian)) lift(1);
      }
      // A dish: what it is worth to eat, against every other dish.
      if (dish) {
        const v = dishRank.value.indexOf(dish.slug) + 1;
        const m = dishRank.margin.indexOf(dish.slug) + 1;
        why.push(`dish: ${dish.hunger} hunger, ${dish.mood} mood, worth ${r1(dish.value ?? 0)} ¢ (#${v} of ${dishRank.n}), ${dish.marginPerMove == null ? "no Move" : `${r1(dish.marginPerMove)} ¢ over its ingredients a Move (#${m})`}`);
        if (v === 1 || m === 1) lift(0);
        else if (v <= 5 || m <= 5) lift(1);
      }
      // Anything no main-catalogue tag does.
      const unique = uniqueOf(t);
      if (unique.length) {
        why.push(`nothing in the main catalogue ${listAnd(unique)}`);
        lift(0);
      }
      const reach = reachOf(t, rec);
      return {
        slug: rec.slug,
        name: t.name,
        catalog: t.catalog ?? "all",
        secret: rec.secretRecipe,
        hidden: rec.hiddenUntilHeld,
        skill: (t.requirement?.skills ?? []).map(nameOf).join(" + ") || "none",
        points: (t.requirement?.skills ?? []).length ? Math.max(...t.requirement.skills.map(pointsOf)) : 0,
        moves: rec.moves,
        resources: rec.resourceCost,
        inputs: rec.items.map((i) => ({ label: i.label, rank: rankLabel(i.rank), rankId: i.rank, route: i.route })),
        workshop: rec.workshop,
        sells: t.sellablePrice ?? null,
        shelf: t.depotPrice ?? null,
        why,
        unique,
        tier,
        score,
        reach: reach.text,
        reachable: reach.who,
      };
    })
    .sort((a, b) => a.tier - b.tier || b.score - a.score || b.unique.length - a.unique.length || a.name.localeCompare(b.name));

  return {
    rows,
    counts: {
      total: rows.length,
      secret: rows.filter((r) => r.secret).length,
      hidden: rows.filter((r) => r.hidden).length,
      both: rows.filter((r) => r.secret && r.hidden).length,
      significant: rows.filter((r) => r.tier === 0).length,
      efficient: rows.filter((r) => r.tier === 1).length,
      reachable: rows.filter((r) => r.reachable.length).length,
    },
  };
}

// "a, b and c" (or "or").
function listAnd(xs, word = "and") {
  const a = [...xs];
  return a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} ${word} ${a[a.length - 1]}`;
}

module.exports = { buildSecrets };
