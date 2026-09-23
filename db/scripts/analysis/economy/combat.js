// Combat: what a fighting tag or a weapon is worth.
//
// The game has no hard number for what the fighting band DOES, so this does two honest things.
//   1. The catalogue, read from the game: every tag a player can come by with a `fighting:` block, and every
//      armour piece. Each is scored by the game's own resolver (db/lib/fightingSkill.js) on a made-up character,
//      alone and on top of the first two melee or ranged rungs, and shown as the BAND WORD the sheet shows, never
//      the number. The YAML's `fighting:` block goes through tagShapes.js#normalizeFighting first, the same
//      normaliser the sync uses, so the resolver sees what the database would hold.
//   2. The caving half, an assumption: the Caving tab's band → trouble mix (caving.js MIX_BY_BAND, Bascinet's pending
//      a real mechanic) turns a band step into ¢ for a caver, at a 3-trouble budget in the Depths.

// SCORE_FLOOR is not exported by fightingSkill.js; the default mirrors its `const SCORE_FLOOR = 0`.
const { fightingSkill, BANDS, bandRank, SCORE_FLOOR = 0 } = require("../../../lib/fightingSkill");
const { normalizeFighting } = require("../../../lib/tagShapes");
const { armorWord, combineArmor, ARMOR_CAP } = require("../../../lib/armorValue");
const threats = require("../../../lib/threats");
const { REINFORCEMENTS } = require("../../../lib/lateJoin");
const { MANIFESTS, manifestOf } = require("../../../lib/depotManifests");

// `starting` is the starting-roles model (who begins with which tags), for the armour split.
function buildCombat({ list, get, caving, params, starting = null, sources = null }) {
  const row = (t) => ({ tag: { slug: t.slug, name: t.name, fighting: normalizeFighting(t.fighting, t.slug), equipSlot: t.equipSlot ?? null, category: t.category ?? null }, equipped: true });
  const rungs = (tree) => [1, 2].map((n) => list.find((t) => t.fighting?.tree === tree && t.fighting?.rung === n)).filter(Boolean);
  // Which half of the tree a tag serves, asked of the resolver: the half whose score it moves (a weapon's class
  // decides that inside fightingSkill.js), else what the block names, else melee.
  const baseScore = fightingSkill([]);
  const treeOf = (t) => {
    const moved = fightingSkill([row(t)]);
    const hit = ["melee", "ranged"].filter((tr) => moved[tr].score !== baseScore[tr].score);
    return hit.length === 1 ? hit[0] : t.fighting.tree === "ranged" ? "ranged" : "melee";
  };
  const bandWith = (rows, tree) => fightingSkill(rows)[tree].band;
  const base = { melee: bandWith([], "melee"), ranged: bandWith([], "ranged") };
  // The score a character is valued at: the resolver's score, held inside the band it resolved to, since a floor: or
  // cap: tag (Apex Form, Bound) moves the band after the points are summed and the score alone would miss it.
  const bandRange = BANDS.map((b, i) => ({ key: b.key, min: i === 0 ? SCORE_FLOOR : BANDS[i - 1].max + 1, max: b.max }));
  const effective = (half) => {
    const r = bandRange.find((b) => b.key === half.band.key);
    return Math.min(Math.max(half.score, r.min), r.max);
  };
  // The band a caver fights at: ranged counts as much as melee, the two trees never stack, so it is the BETTER of
  // the resolver's two trees for what they hold (Bascinet, 2026-09-23), judged by the valued score. A tie reads as melee.
  const caveBand = (rows) => {
    const s = fightingSkill(rows);
    const pick = ["melee", "ranged"].map((tree) => ({ tree, band: s[tree].band, value: effective(s[tree]) })).sort((a, b) => b.value - a.value)[0];
    return { ...pick.band, tree: pick.tree, value: pick.value };
  };
  const caveBase = caveBand([]);

  // What a player can come by: bought at creation, stocked, sold at the counter, or made.
  const obtainable = (t) => t.purchasable || t.depotPrice != null || t.sellablePrice != null || t.craftable;
  // A tag's prerequisites, nearest first, walked through parentTag and requiredTag the way model.js#skillChain
  // walks them: you cannot hold Melee IV without Melee III, II and I.
  const get0 = (slug) => list.find((x) => x.slug === slug);
  const chainOf = (t) => {
    const out = [];
    const seen = new Set([t.slug]);
    const walk = (slug) => {
      if (!slug || seen.has(slug)) return;
      const p = get0(slug);
      if (!p) return;
      seen.add(slug);
      out.push(p);
      walk(p.parentTag);
      walk(p.requiredTag);
    };
    walk(t.parentTag);
    walk(t.requiredTag);
    return out;
  };
  const tags = list
    .filter((t) => t.fighting && obtainable(t))
    .map((t) => {
      const tree = treeOf(t);
      const [r1, r2] = rungs(tree);
      const chain = chainOf(t);
      const held = [...chain.map(row), row(t)];
      // Measured with the prerequisites held, since that is the only way to hold the tag.
      const alone = bandWith(held, tree);
      const without = chain.length ? bandWith(chain.map(row), tree) : base[tree];
      const withRungs = (rs) => [...new Map([...rs, ...chain, t].map((x) => [x.slug, x])).values()].map(row);
      const onI = r1 ? bandWith(withRungs([r1]), tree) : null;
      const onII = r1 && r2 ? bandWith(withRungs([r1, r2]), tree) : null;
      const baseI = r1 ? bandWith([row(r1)], tree) : null;
      const baseII = r1 && r2 ? bandWith([row(r1), row(r2)], tree) : null;
      const own = t.pointCost ?? 0;
      const cave = caveBand(held);
      const caveWithout = chain.length ? caveBand(chain.map(row)) : caveBase;
      return {
        caverBand: cave.label,
        caverBandKey: cave.key,
        caverTree: cave.tree,
        caverWithoutKey: caveWithout.key,
        caverScore: cave.value,
        caverWithoutScore: caveWithout.value,
        slug: t.slug,
        name: t.name,
        tree,
        kind: t.fighting.weaponClass ? `weapon (${t.fighting.weaponClass})` : t.fighting.rung ? "rung" : t.fighting.situational ? "situational" : t.fighting.when ? "conditional" : "trait",
        tiers: t.fighting.tiers ?? (t.fighting.rung ? t.fighting.rung : null),
        needsFirst: chain.map((c) => c.name),
        ownPoints: own,
        // The whole chain's cost: the tag plus everything it requires.
        points: own + chain.reduce((n, c) => n + (c.pointCost ?? 0), 0),
        withoutKey: without.key,
        marginalSteps: chain.length ? bandRank(alone.key) - bandRank(without.key) : null,
        coin: t.depotPrice ?? t.sellablePrice ?? null,
        coinHow: t.depotPrice != null ? "shelf" : t.sellablePrice != null ? "counter" : null,
        alone: alone.label,
        aloneKey: alone.key,
        onI: onI?.label ?? null,
        onII: onII?.label ?? null,
        rungNames: [r1?.name, r2?.name].filter(Boolean),
        // Band steps it buys over a baseline character, on its own and on top of the first rung.
        steps: bandRank(alone.key) - bandRank(base[tree].key),
        stepsOnI: onI && baseI ? bandRank(onI.key) - bandRank(baseI.key) : null,
        stepsOnII: onII && baseII ? bandRank(onII.key) - bandRank(baseII.key) : null,
      };
    })
    .sort((a, b) => b.steps - a.steps || a.points - b.points);

  const armour = list
    .filter((t) => (t.melee != null || t.ballistic != null) && obtainable(t))
    .map((t) => ({ slug: t.slug, name: t.name, points: t.pointCost ?? 0, coin: t.depotPrice ?? t.sellablePrice ?? null, ballistic: armorWord(t.ballistic ?? 0), melee: armorWord(t.melee ?? 0) }));

  // ---- armour combinations ------------------------------------------------------------------------------------
  // Pieces stack across slots, multiplicatively on what gets through, capped (armorValue.js#combineArmor, read for
  // both fields). One or none a slot: HEAD holds one piece, BODY one a layer (equipLayer 1 and 2), a shield is a
  // WEAPON and takes a hand, and an ACCESSORY has no limit (only one armour accessory exists, so one or none). A status
  // that counts unworn (Resilient) is not a piece and stays out. A piece nobody can buy, stock or make is a role-kit
  // piece: included, and marked.
  // Which pieces an ordinary player can assemble. A piece is on the main table if a player can come by it in play:
  // bought at creation, on a shelf a player can reach (the black market included, flagged), sold at the counter, or
  // made. The catalogue flag does not decide it — the Energy Shield is `catalog: gm` and sits on the shelf at 162 ¢,
  // and a thing you can buy is a thing you can wear (Bascinet, 2026-09-23); a GM-catalogue piece on the main table
  // is marked as such. Of the pieces with no route, one an antagonist seat is handed (the threat roles in
  // db/lib/threats.js, their reinforcements in db/lib/lateJoin.js, the Tribunal's arrivals) is antagonist kit; one a
  // player role starts with is kit-only; the rest are set aside for their catalogue or for having no route at all.
  const antagonistRoles = new Set([...threats.THREATS.map((t) => t.spawn?.roleSlug).filter(Boolean), ...threats.SHUTTLE_ARRIVAL_SLUGS, ...REINFORCEMENTS.map((r) => r.roleSlug)]);
  const heldBy = (slug, antagonist) => (starting?.roles ?? []).filter((r) => r.tagSlugs.includes(slug) && antagonistRoles.has(r.slug) === antagonist).map((r) => r.name);
  const reachableShelf = (t) => t.depotPrice != null && MANIFESTS.some((m) => m.id === manifestOf(t));
  // A route IN: the counter buying a piece (sellablePrice) is not one, and neither is a recipe a player cannot
  // see — the Censor's Helmet is craftable, but its recipe sits in the GM catalogue (sources.js marks such a
  // recipe secret) so no ordinary smith ever finds it; a recipe hidden until the thing is held is the same. The
  // sourcing model already decides both, so it is read from there rather than judged again here.
  const recipeOf = (t) => (sources?.recipes ?? []).find((r) => r.slug === t.slug) ?? null;
  const openRecipe = (t) => {
    const r = recipeOf(t);
    return !!t.craftable && !!r && !r.secretRecipe && !r.hiddenUntilHeld;
  };
  const routeOf = (t) => (t.purchasable ? "creation" : reachableShelf(t) ? (manifestOf(t) === "black-market" ? "black market" : "shelf") : openRecipe(t) ? "craft" : null);
  const route = (t) => routeOf(t) != null;
  const allPieces = list
    .filter((t) => (t.melee != null || t.ballistic != null) && t.equipSlot)
    .map((t) => {
      const antagonist = heldBy(t.slug, true);
      const kit = heldBy(t.slug, false);
      const main = route(t);
      const reason = main ? null : antagonist.length ? "antagonist kit" : kit.length ? "role kit only" : t.catalog !== "all" ? (t.catalog === "secret" ? "secret catalogue" : "GM catalogue") : "no route";
      return {
        slug: t.slug,
        name: t.name,
        slot: t.equipSlot === "BODY" ? `BODY-${t.equipLayer ?? 1}` : t.equipSlot,
        melee: t.melee ?? 0,
        ballistic: t.ballistic ?? 0,
        meleeWord: armorWord(t.melee ?? 0),
        ballisticWord: armorWord(t.ballistic ?? 0),
        weight: t.weight ?? 0,
        points: t.pointCost ?? 0,
        coin: t.depotPrice ?? t.sellablePrice ?? null,
        hand: t.equipSlot === "WEAPON",
        blackMarket: manifestOf(t) === "black-market" && t.depotPrice != null,
        catalog: t.catalog ?? null,
        // On the main table despite a GM or secret catalogue flag: it has a real route in.
        gmCatalog: main && (t.catalog ?? "all") !== "all",
        route: routeOf(t),
        reason,
        roles: reason === "antagonist kit" ? antagonist : kit,
        alsoParts: alsoPartsOf(t, get0),
      };
    });
  const pieces = allPieces.filter((p) => !p.reason);
  const mainPieces = pieces;
  // A special piece (kit-only or set aside) against the best an ordinary player can wear in the same slot: is it
  // best in class for whoever has it, or is there a main-table piece worth trading to?
  for (const p of allPieces.filter((x) => x.reason)) {
    const rivals = pieces.filter((x) => x.slot === p.slot);
    const bestOn = (field) => [...rivals].sort((a, b) => b[field] - a[field] || a.weight - b.weight)[0] ?? null;
    const bb = bestOn("ballistic");
    const bm = bestOn("melee");
    const cmp = (field, best) => (!best ? "best" : p[field] > best[field] + 1e-9 ? "best" : Math.abs(p[field] - best[field]) <= 1e-9 ? "ties" : "beaten");
    const cb = cmp("ballistic", bb);
    const cm = cmp("melee", bm);
    p.bestInClass = { ballistic: cb === "best", melee: cm === "best" };
    const pc = (x, f) => `${x.name} ${Math.round(x[f] * 100)}%`;
    p.verdict = !rivals.length
      ? "nothing an ordinary player can wear in this slot"
      : cb === "best" && cm === "best"
        ? `best in its slot on both fields for whoever has it (next best: ${pc(bb, "ballistic")} ballistic, ${pc(bm, "melee")} melee)`
        : cb !== "beaten" && cm !== "beaten"
          ? `as good as anything an ordinary player can wear in its slot (${cb === "ties" ? `ties the ${pc(bb, "ballistic")} on ballistic` : "best on ballistic"}; ${cm === "ties" ? `ties the ${pc(bm, "melee")} on melee` : "best on melee"})`
          : cb !== "beaten"
            ? `${cb === "best" ? "best" : "as good as the best"} ballistic in its slot; on melee the ${pc(bm, "melee")} beats it`
            : cm !== "beaten"
              ? `${cm === "best" ? "best" : "as good as the best"} melee in its slot; on ballistic the ${pc(bb, "ballistic")} beats it`
              : `worth trading to the ${bb === bm ? bb.name : `${bb.name} (ballistic) or ${bm.name} (melee)`}, which beat${bb === bm ? "s" : ""} it on both fields${bb.weight < p.weight && bm.weight < p.weight ? " and weigh less" : ""}`;
  }
  // The kit analysis, over any set of main pieces: every combination, the two fronts, the best at each limit, and
  // what each slot's pieces contribute. Run twice below, once over every main piece and once with the dominant one
  // held out.
  const analyseKits = (pieces) => {
    const slots = [...new Set(pieces.map((p) => p.slot))].sort();
    const asTag = (p) => ({ tag: { ballisticArmor: p.ballistic, meleeArmor: p.melee }, equipped: true });
    const kits = [];
    const walk = (i, chosen) => {
      if (i === slots.length) {
        if (!chosen.length) return;
        const coins = chosen.map((p) => p.coin);
        kits.push({
          pieces: chosen.map((p) => p.name),
          ballistic: combineArmor(chosen.map(asTag), "ballisticArmor"),
          melee: combineArmor(chosen.map(asTag), "meleeArmor"),
          weight: chosen.reduce((n, p) => n + p.weight, 0),
          points: chosen.reduce((n, p) => n + p.points, 0),
          coin: coins.every((c) => c != null) ? coins.reduce((n, c) => n + c, 0) : null,
          blackMarket: chosen.some((p) => p.blackMarket),
          hand: chosen.some((p) => p.hand),
          count: chosen.length,
        });
        return;
      }
      walk(i + 1, chosen);
      for (const p of pieces.filter((x) => x.slot === slots[i])) walk(i + 1, [...chosen, p]);
    };
    walk(0, []);
    for (const k of kits) {
      k.ballisticWord = armorWord(k.ballistic);
      k.meleeWord = armorWord(k.melee);
    }
    // The front on one field: no kit as light or lighter stops more. Ties on weight keep the better, then the cheaper.
    const frontOn = (field) => {
      const sorted = [...kits].sort((a, b) => a.weight - b.weight || b[field] - a[field] || a.points - b.points);
      const out = [];
      let best = -1;
      for (const k of sorted) {
        if (k[field] > best + 1e-9) {
          out.push(k);
          best = k[field];
        }
      }
      return out;
    };
    const fronts = { ballistic: frontOn("ballistic"), melee: frontOn("melee") };
    const efficient = [...new Set([...fronts.ballistic, ...fronts.melee])].map((k) => ({ ...k, winsOn: fronts.ballistic.includes(k) && fronts.melee.includes(k) ? "both" : fronts.ballistic.includes(k) ? "ballistic" : "melee" }));
    for (const k of kits) k.efficient = fronts.ballistic.includes(k) || fronts.melee.includes(k);
    const bestUnder = (limit, key, field) => kits.filter((k) => k[key] <= limit).sort((a, b) => b[field] - a[field] || a.weight - b.weight || a.points - b.points)[0] ?? null;
    const weightLimits = [10, 20, 30, 45, params.carryWeightLbs].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const pointBudgets = [2, 5, 8, 12];
    // The lightest kit that reaches each word or better, words in the order the armour scale climbs.
    const lightestTo = (field) => {
      const words = [...new Map(kits.map((k) => [armorWord(k[field]), k[field]])).entries()];
      const floorOf = (w) => Math.min(...kits.filter((k) => armorWord(k[field]) === w).map((k) => k[field]));
      return words
        .map(([w]) => ({ w, floor: floorOf(w) }))
        .sort((a, b) => a.floor - b.floor)
        .map(({ w, floor }) => ({ word: w, kit: kits.filter((k) => k[field] >= floor).sort((a, b) => a.weight - b.weight || a.points - b.points)[0] }));
    };
    // Diminishing returns: the best kit with exactly one, two and three pieces, on each field.
    const bestWith = (n, field) => kits.filter((k) => k.count === n).sort((a, b) => b[field] - a[field])[0] ?? null;
    // Best options by slot: a piece is as good as the kits it ends up in. For each main piece, how many efficient kits
    // (either front) hold it, how many of each front, and how many of the best-at-a-limit picks below name it.
    const limitPicks = [];
    const bySlot = slots.map((slot) => ({
      slot,
      pieces: pieces
        .filter((p) => p.slot === slot)
        .map((p) => ({
          ...p,
          efficientKits: efficient.filter((k) => k.pieces.includes(p.name)).length,
          frontBallistic: fronts.ballistic.filter((k) => k.pieces.includes(p.name)).length,
          frontMelee: fronts.melee.filter((k) => k.pieces.includes(p.name)).length,
          picks: 0, // filled once the limit tables exist, below
        }))
        .sort((a, b) => b.efficientKits - a.efficientKits || b.ballistic + b.melee - (a.ballistic + a.melee)),
    }));
    const byWeight = weightLimits.map((w) => ({ limit: w, ballistic: bestUnder(w, "weight", "ballistic"), melee: bestUnder(w, "weight", "melee") }));
    const byPoints = pointBudgets.map((b) => ({ limit: b, ballistic: bestUnder(b, "points", "ballistic"), melee: bestUnder(b, "points", "melee") }));
    for (const row of [...byWeight, ...byPoints]) for (const k of [row.ballistic, row.melee]) if (k) limitPicks.push(k);
    for (const g of bySlot) for (const p of g.pieces) p.picks = limitPicks.filter((k) => k.pieces.includes(p.name)).length;
    for (const g of bySlot) g.pieces.sort((a, b) => b.efficientKits - a.efficientKits || b.picks - a.picks || b.ballistic + b.melee - (a.ballistic + a.melee));
    return {
      pieces,
      kitOnly: allPieces.filter((p) => p.reason === "role kit only"),
      setAside: allPieces.filter((p) => p.reason && p.reason !== "role kit only"),
      slots,
      count: kits.length,
      kits,
      fronts,
      efficient: efficient.sort((a, b) => b.ballistic - a.ballistic || b.melee - a.melee),
      byWeight,
      byPoints,
      lightest: { ballistic: lightestTo("ballistic"), melee: lightestTo("melee") },
      bySlot,
      ceiling: { ballistic: Math.max(...kits.map((k) => k.ballistic)), melee: Math.max(...kits.map((k) => k.melee)), cap: ARMOR_CAP },
      steps: { ballistic: [1, 2, 3].map((n) => bestWith(n, "ballistic")), melee: [1, 2, 3].map((n) => bestWith(n, "melee")) },
    };
  };
  const armourKits = analyseKits(mainPieces);
  // The dominant piece: the main piece in the most efficient kits (either front). With it held out, the same
  // analysis says what an ordinary player assembles if that one piece is not to be had.
  const dominant = armourKits.bySlot.flatMap((g) => g.pieces).sort((a, b) => b.efficientKits - a.efficientKits || b.picks - a.picks)[0] ?? null;
  const armourKitsWithout = dominant
    ? (() => {
        const k = analyseKits(mainPieces.filter((p) => p.slug !== dominant.slug));
        const shieldOf = (ps) => ps.filter((p) => p.hand).sort((a, b) => b.melee + b.ballistic - (a.melee + a.ballistic))[0] ?? null;
        const sh = shieldOf(k.pieces);
        const out = {
          ...k,
          heldOut: { slug: dominant.slug, name: dominant.name, slot: dominant.slot, efficientKits: dominant.efficientKits, of: armourKits.efficient.length, hand: dominant.hand },
          bestShield: sh ? { name: sh.name, melee: armorWord(sh.melee), ballistic: armorWord(sh.ballistic), weight: sh.weight } : null,
          drop: { ballistic: armourKits.ceiling.ballistic - k.ceiling.ballistic, melee: armourKits.ceiling.melee - k.ceiling.melee },
        };
        // Every kit is still there for the report, but kept out of model.json: the with-it list is already there.
        Object.defineProperty(out, "kits", { value: k.kits, enumerable: false });
        return out;
      })()
    : null;

  // ---- weapons: hands, the best shield, and the specialty the resolver pairs with each -----------------------------
  const shields = pieces.filter((p) => p.hand).sort((a, b) => b.melee + b.ballistic - (a.melee + a.ballistic));
  const bestShield = shields[0] ?? null;
  // A specialism is scored with the weapon it names (fightingSkill.js bestArmed): a `when:` tag on the same tree.
  const specialties = list.filter((t) => t.fighting?.when && !t.fighting.situational && obtainable(t));
  const weaponRows = tags
    .filter((r) => r.kind.startsWith("weapon"))
    .map((r) => {
      const t = get0(r.slug);
      const [r1, r2] = rungs(r.tree);
      const rungRows = [r1, r2].filter(Boolean);
      const withTags = (extra) => [...new Map([...rungRows, t, ...extra].map((x) => [x.slug, x])).values()].map(row);
      const onRungs = bandWith(withTags([]), r.tree);
      const onRungsCave = caveBand(withTags([]));
      let best = null;
      for (const sp of specialties) {
        const chain = chainOf(sp);
        const band = bandWith(withTags([...chain, sp]), r.tree);
        const steps = bandRank(band.key) - bandRank(onRungs.key);
        if (steps > 0 && (!best || steps > best.steps)) best = { name: sp.name, slug: sp.slug, points: (sp.pointCost ?? 0) + chain.reduce((n, c) => n + (c.pointCost ?? 0), 0), band: band.label, steps, unarmoured: Boolean(sp.fighting.when?.unarmoured), caveScore: caveBand(withTags([...chain, sp])).value };
      }
      const twoHanded = Boolean(t.twoHanded);
      return {
        ...r,
        weight: t.weight ?? 0,
        hands: twoHanded ? 2 : 1,
        withShield: !twoHanded,
        shield: !twoHanded && bestShield ? { name: bestShield.name, melee: armorWord(bestShield.melee), ballistic: armorWord(bestShield.ballistic), weight: bestShield.weight, total: (t.weight ?? 0) + bestShield.weight } : null,
        onRungs: onRungs.label,
        onRungsKey: onRungs.key,
        onRungsCaveScore: onRungsCave.value,
        specialty: best,
      };
    })
    .sort((a, b) => bandRank(b.onRungsKey) - bandRank(a.onRungsKey) || a.weight - b.weight);
  const twoHandTrade = (() => {
    const two = weaponRows.filter((w) => w.hands === 2)[0];
    const one = weaponRows.filter((w) => w.hands === 1)[0];
    return two && one && bestShield ? { two: { name: two.name, band: two.onRungs }, one: { name: one.name, band: one.onRungs }, shield: { name: bestShield.name, melee: armorWord(bestShield.melee), ballistic: armorWord(bestShield.ballistic) } } : null;
  })();

  // ---- situational tags a GM might count underground --------------------------------------------------------------
  // The resolver never adds a `situational: true` tag to the number; a GM does, from the fiction (COMBAT.md §2). These
  // are scored AS IF counted: the same tiers on the same tree, with the condition taken away.
  const NAMED = new Set(["monster-hunter", "tunnel-rat", "guerrilla", "night-vision", "night-blind", "teratophobia", "tactician", "tactician-defending", "melee-shield-wall", "melee-duelist"]);
  const underground = /\b(cave|caves|dark|darkness|monster|monsters|underground|tunnel|tunnels)\b/i;
  const situational = list
    // A situational tag on the ranged tree counts too, since ranged counts as much as melee (the Sniper beside the
    // Duelist and the Shield Wall).
    .filter((t) => t.fighting && (t.fighting.situational || t.fighting.when) && (NAMED.has(t.slug) || /^true-form-/.test(t.slug) || underground.test(t.description ?? "") || (t.fighting.situational && t.fighting.tree === "ranged" && t.fighting.tiers)))
    .map((t) => {
      const chain = chainOf(t);
      const counted = t.fighting.tiers ? { ...t, fighting: { tree: t.fighting.tree ?? "melee", tiers: t.fighting.tiers } } : null;
      const band = counted ? caveBand([row(counted)]) : caveBase;
      return {
        tree: counted ? counted.fighting.tree : null,
        slug: t.slug,
        name: t.name,
        points: (t.pointCost ?? 0) + chain.reduce((n, c) => n + (c.pointCost ?? 0), 0),
        tiers: t.fighting.tiers ?? null,
        condition: t.fighting.situational ? "a GM's call" : `when ${Object.keys(t.fighting.when).join(", ")}`,
        band: band.label,
        bandKey: band.key,
      };
    });

  // The caving half: a Depths caver at a 3-trouble budget, by band, plain and with Lucky.
  const T = 3;
  const byBand = BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    plain: caving.expedition("depths", T, "base", b.key).net,
    lucky: caving.expedition("depths", T, "lucky", b.key).net,
  }));
  // A character is valued by their SCORE, not the band word: each band's net sits at the midpoint of its score range
  // (the end bands at their edge less or plus half a typical width), and a score between two midpoints is read on
  // the straight line between them, clamped at the ends. So +5 points is worth half a step from anywhere, and the
  // band edges stop deciding what a half tier is worth.
  const widths = bandRange.slice(1, -1).map((b) => b.max - b.min + 1).sort((a, b) => a - b);
  const typical = widths[Math.floor(widths.length / 2)];
  const anchors = bandRange.map((b, i) => ({
    at: i === 0 ? b.max - typical / 2 : i === bandRange.length - 1 ? b.min + typical / 2 : (b.min + b.max) / 2,
    net: byBand.find((x) => x.key === b.key)?.plain ?? 0,
  }));
  const netAtScore = (score) => {
    if (score <= anchors[0].at) return anchors[0].net;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (score <= b.at) return a.net + ((score - a.at) / (b.at - a.at)) * (b.net - a.net);
    }
    return anchors[anchors.length - 1].net;
  };
  // What a tag's band step is worth to that caver, taken as one expedition a turn (the Lucky row's assumption).
  // Every figure reads the better-of band, on either tree, against the better of an untrained character's two.
  // Scored at three starting positions, since one position is a band-edge accident: an untrained character sits
  // just under a boundary, so half a tier can look like a whole step. At each position the gain is the better-of band
  // with the tag (and what it requires) against the same holdings without either: alone, on the first rung of its
  // tree, on the first two. A "both" tag is read on whichever tree it lifts more at each position. The caver's gain is the
  // average of the three; a rung's own row is its step from the rung below (position one), since it IS the ladder.
  const threePositions = (t, tree) => {
    const chain = chainOf(t);
    const trees = t.fighting?.tree === "both" ? ["melee", "ranged"] : [tree];
    const uniq = (xs) => [...new Map(xs.map((x) => [x.slug, x])).values()].map(row);
    const gainAt = (tr, n) => {
      const rs = rungs(tr).slice(0, n);
      if (rs.length < n) return null;
      // Without it means without its chain too, since the chain is part of the price (a tag's points are the whole
      // chain); a rung is the exception, measured over the rungs below it, which is its step.
      const without = uniq((t.fighting?.rung ? [...rs, ...chain] : rs).filter((x) => x.slug !== t.slug));
      const withIt = uniq([...rs, ...chain, t]);
      return netAtScore(caveBand(withIt).value) - netAtScore(caveBand(without).value);
    };
    return [0, 1, 2].map((n) => {
      const gs = trees.map((tr) => gainAt(tr, n)).filter((g) => g != null);
      return gs.length ? Math.max(...gs) : null;
    });
  };
  const average = (xs) => {
    const v = xs.filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  for (const r of tags) {
    const t = get0(r.slug);
    const [g0, g1, g2] = threePositions(t, r.tree);
    r.gainFromUntrained = g0;
    r.isRung = Boolean(t.fighting.rung);
    r.gainFromI = r.isRung ? null : g1;
    r.gainFromII = r.isRung ? null : g2;
    r.caverGain = r.isRung ? g0 ?? 0 : average([g0, g1, g2]) ?? 0;
    // What the tag itself adds over holding only what it requires (Melee IV over Melee III).
    r.marginalGain = r.marginalSteps != null ? netAtScore(r.caverScore) - netAtScore(r.caverWithoutScore) : null;
    // The same gain per unit of what it costs: creation points, or ¢ where the shelf or the counter prices it.
    // A rung's gain is its own step, so it is set against its own points; anything else against its whole chain.
    const pts = r.isRung ? r.ownPoints : r.points;
    r.caverGainPerPoint = pts > 0 ? r.caverGain / pts : null;
    r.caverGainPerCoin = r.coin > 0 ? r.caverGain / r.coin : null;
  }
  for (const r of situational) {
    // The same three positions, on the tag as a GM would count it.
    const t = get0(r.slug);
    const counted = r.tiers != null ? { ...t, fighting: { tree: r.tree, tiers: r.tiers } } : null;
    const gs = counted ? threePositions(counted, r.tree === "ranged" ? "ranged" : "melee") : [0, 0, 0];
    [r.gainFromUntrained, r.gainFromI, r.gainFromII] = gs;
    r.caverGain = average(gs) ?? 0;
    r.caverGainPerPoint = r.points > 0 ? r.caverGain / r.points : null;
  }
  for (const w of weaponRows) w.specialtyGain = w.specialty ? netAtScore(w.specialty.caveScore) - netAtScore(w.onRungsCaveScore) : null;
  const perPoint = tags.filter((r) => r.points > 0 && r.steps > 0).map((r) => ({ ...r, stepsPerPoint: r.steps / r.points })).sort((a, b) => b.stepsPerPoint - a.stepsPerPoint);
  const perCoin = tags.filter((r) => r.coin > 0 && r.steps > 0).map((r) => ({ ...r, stepsPerCoin: r.steps / r.coin })).sort((a, b) => b.stepsPerCoin - a.stepsPerCoin);

  return {
    base: { melee: base.melee.label, ranged: base.ranged.label },
    caveBase: caveBase.label,
    scoreAnchors: anchors,
    bands: BANDS.map((b) => b.label),
    tags,
    armour,
    armourKits,
    armourKitsWithout,
    weapons: weaponRows,
    bestShield: bestShield ? { name: bestShield.name, melee: armorWord(bestShield.melee), ballistic: armorWord(bestShield.ballistic), weight: bestShield.weight } : null,
    twoHandTrade,
    situational: situational.sort((a, b) => (b.caverGainPerPoint ?? -1e9) - (a.caverGainPerPoint ?? -1e9)),
    byBand,
    budget: T,
    mixByBand: caving.mixByBand,
    bandStep: caving.bandStep,
    bestPerPoint: perPoint[0] ?? null,
    bestPerCoin: perCoin[0] ?? null,
    moveValue: params.moveValue ?? null,
  };
}

// ---- what an armour piece does besides armour --------------------------------------------------------------------
// Read off the tag: every field that is not an armour field, a price, a sprite or plumbing says something, and a
// field this list has no words for is printed as it stands rather than dropped. A mining bonus is kept as a number
// so a kit can sum it and priceKits can put the investments tab's ¢ a turn beside it.
const QUIET_FIELDS = new Set(["slug", "catalog", "name", "category", "pointCost", "purchasable", "purchasableAfterStart", "group", "description", "visible", "weight", "sprite", "stackable", "requirement", "sellable", "sellablePrice", "craftable", "equippable", "equipSlot", "equipLayer", "depotPrice", "melee", "ballistic", "manifest", "tradeable", "customizable", "customizableSkill", "keepSlug", "inlayValue", "concealSprite", "removable", "teachable", "healable", "twoHanded", "conflictsWith", "exclusive"]);
function alsoPartsOf(t, get) {
  const nameOf = (slug) => get(slug)?.name ?? slug;
  const parts = [];
  for (const [k, v] of Object.entries(t)) {
    if (QUIET_FIELDS.has(k) || v == null || v === false) continue;
    if (k === "miningBonus") parts.push({ kind: "mining", amount: v.amount ?? 0 });
    else if (k === "carryBonus") parts.push({ kind: "carry", amount: v });
    else if (k === "fastTravel") parts.push({ kind: "text", text: "an extra free crossing a turn" });
    else if (k === "cures") parts.push({ kind: "text", text: `cures ${v.map(nameOf).join(", ")}` });
    else if (k === "curesInto") parts.push({ kind: "text", text: `turns ${Object.entries(v).map(([a, b]) => `${nameOf(a)} into ${nameOf(b)}`).join(", ")}` });
    else if (k === "consumesInto") v.length && parts.push({ kind: "text", text: `opens into ${v.map((x) => nameOf(typeof x === "string" ? x : x.slug ?? "?")).join(", ")}` });
    else if (k === "fighting") {
      const f = v;
      const cond = f.situational ? "a GM's call from the fiction (situational), never on the sheet's number" : f.when ? `when ${Object.entries(f.when).map(([c, xs]) => `${c} ${[].concat(xs).map(nameOf).join(", ")}`).join(" and ")}` : "always";
      parts.push({ kind: "text", text: `a fighting flag${f.tiers ? `: +${f.tiers} tier${f.tiers === 1 ? "" : "s"} on ${f.tree ?? "melee"}` : ""}, ${cond}` });
    } else if (k === "forcesConceal") parts.push({ kind: "text", text: "always hides who you are" });
    else if (k === "concealsIdentity") !t.forcesConceal && parts.push({ kind: "text", text: "can hide who you are" });
    else if (k === "sealedShipping") parts.push({ kind: "text", text: "ships sealed from the Depot" });
    else if (k === "durationTurns") parts.push({ kind: "text", text: `lasts ${v} turn${v === 1 ? "" : "s"}` });
    else parts.push({ kind: "text", text: `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}` });
  }
  return parts;
}
// One line for a piece or a whole kit: mining and carry summed, the rest listed once each.
function alsoLine(partsList, gainOfPiece = []) {
  const flat = partsList.flat();
  const mining = flat.filter((p) => p.kind === "mining").reduce((n, p) => n + p.amount, 0);
  const carry = flat.filter((p) => p.kind === "carry").reduce((n, p) => n + p.amount, 0);
  const gain = gainOfPiece.filter((g) => g != null).reduce((n, g) => n + g, 0);
  const out = [];
  if (mining) out.push(`+${mining} ⬢ a press while worn${gain ? `, ${Math.round(gain * 10) / 10} ¢ a turn for a miner per the investments tab` : ""}`);
  if (carry) out.push(`carry cap ×${Math.round((1 + carry) * 100) / 100}`);
  out.push(...new Set(flat.filter((p) => p.kind === "text").map((p) => p.text)));
  return out.join("; ");
}

// ---- armour kits by ¢ -------------------------------------------------------------------------------------------
// Priced after the fact, because the price is the equipment tab's REPLACE lens (equipment.js#replaceOf: the cheapest
// of the shelf, a maker at the counter's price, or making it yourself with the Moves counted), and that model is
// built after this one. A kit is priced only when every piece in it is. Run on each kit analysis in turn.
const COIN_BUDGETS = [10, 25, 50, 100, 200, Infinity];
// `gainOf(slug)` is what the investments tab says a piece clears in ¢ a turn, where it has a row (the Mining Helmet).
function priceKits(A, priceOf, gainOf = () => null) {
  const bySlug = new Map();
  for (const p of [...A.pieces, ...A.kitOnly, ...A.setAside]) {
    p.alsoCoin = gainOf(p.slug);
    p.also = alsoLine([p.alsoParts], [p.alsoCoin]);
  }
  for (const p of A.pieces) {
    const rep = priceOf(p.slug);
    p.coinIn = rep ? Math.round(rep.coin * 10) / 10 : null;
    p.coinVia = rep?.via ?? null;
    p.coinHow = rep?.how ?? null;
    bySlug.set(p.name, p);
  }
  for (const g of A.bySlot) for (const p of g.pieces) {
    const src = bySlug.get(p.name);
    Object.assign(p, { coinIn: src.coinIn, coinVia: src.coinVia, coinHow: src.coinHow, also: src.also, alsoCoin: src.alsoCoin });
  }
  for (const k of [...A.kits, ...A.efficient]) {
    const ps = k.pieces.map((n) => bySlug.get(n));
    k.coinIn = ps.every((p) => p.coinIn != null) ? Math.round(ps.reduce((n, p) => n + p.coinIn, 0) * 10) / 10 : null;
    k.coinVia = ps.map((p) => p.coinVia);
    k.also = alsoLine(ps.map((p) => p.alsoParts), ps.map((p) => p.alsoCoin));
    k.alsoCoin = ps.reduce((n, p) => n + (p.alsoCoin ?? 0), 0) || null;
  }
  const priced = A.kits.filter((k) => k.coinIn != null);
  // Compared at a tenth of a percentage point, the finest the tables print, so a kit that stops 0.01% more for twice
  // the ¢ does not win a budget.
  const tenth = (v) => Math.round(v * 1000);
  const bestAt = (limit, field) => priced.filter((k) => k.coinIn <= limit).sort((a, b) => tenth(b[field]) - tenth(a[field]) || a.coinIn - b.coinIn || a.weight - b.weight)[0] ?? null;
  const cheapestTo = (field) => {
    const floors = new Map();
    for (const k of priced) {
      const w = armorWord(k[field]);
      floors.set(w, Math.min(floors.get(w) ?? Infinity, k[field]));
    }
    return [...floors.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([word, floor]) => ({ word, kit: priced.filter((k) => k[field] >= floor).sort((a, b) => a.coinIn - b.coinIn || a.weight - b.weight)[0] }));
  };
  // Where money stops mattering: the least a kit at the top of the priced set costs. Past it no budget buys more.
  const saturate = (field) => {
    const top = Math.max(...priced.map((k) => k[field]));
    const k = priced.filter((x) => tenth(x[field]) >= tenth(top)).sort((a, b) => a.coinIn - b.coinIn || a.weight - b.weight)[0];
    return k ? { coin: k.coinIn, value: top, kit: k } : null;
  };
  A.byCoin = COIN_BUDGETS.map((b) => ({ limit: b, ballistic: bestAt(b, "ballistic"), melee: bestAt(b, "melee") }));
  A.cheapest = { ballistic: cheapestTo("ballistic"), melee: cheapestTo("melee") };
  A.coinSaturates = { ballistic: saturate("ballistic"), melee: saturate("melee") };
  A.coinPriced = { kits: priced.length, of: A.kits.length, unpricedPieces: A.pieces.filter((p) => p.coinIn == null).map((p) => p.name) };
  return A;
}

module.exports = { buildCombat, priceKits, COIN_BUDGETS };
