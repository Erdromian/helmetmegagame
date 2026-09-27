// Medicine: what a medic can treat, where, and what is better left alone.
//
// Every figure is read from the game: the cure ladder off the catalog's health tags (cureRung and requirement,
// TAGS.md §5c), the free pool (web/lib/requests.js MEDICAL_SIMPLE_PER_TURN), the site rule and the Gambit rule
// (web/lib/healRequests.js, db/lib/healGambit.js), the untreated chains (expiresInto, as db/lib/tagExpiryPass.js
// runs them), the cure items (Tag.cures), the sites from docs/zones.yaml, the medics from the starting roles, and
// the Godflesh cut's injury table (db/lib/godflesh.js). The ONLY typed inputs are the injury-rate knobs below.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const healGambit = require("../../../lib/healGambit");

const REPO = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

// ---- the injury-rate knobs: SCENARIO ASSUMPTIONS, not game rules ----------------------------------------------
const KNOBS = {
  caversPer100: 3, // players caving on a given turn, per hundred
  troubleBudget: 3, // each stops at this many troubles (the Caving tab's budget)
  turretTargetsPerTurn: 0, // people the Depot turret fires on a turn
  fightWoundPer: 25, // one GM-adjudicated fight wound a turn per this many players
};

// Constants the game keeps in files the report cannot require (web/ is ESM and Next-only), read by pattern.
function readConst(rel, name) {
  const m = read(rel).match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
  if (!m) throw new Error(`medical.js: could not read ${name} out of ${rel}; the file has changed shape.`);
  return Number(m[1]);
}
function readInjuryTable() {
  const src = read("db/lib/godflesh.js");
  const m = src.match(/const INJURY_TABLE = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("medical.js: could not read INJURY_TABLE out of db/lib/godflesh.js.");
  return Function(`"use strict"; return (${m[1]});`)();
}

function buildMedical({ list, get, params, rv, combos, caving, starting, activities, players, moveValue }) {
  const nameOf = (slug) => get(slug)?.name ?? slug;
  const health = list.filter((t) => t.category === "health");
  const tierSlugs = Object.keys(healGambit.MEDICAL_TIER);
  const tierOfSkills = (skills) => Math.max(0, ...(skills ?? []).map((s) => healGambit.MEDICAL_TIER[s] ?? 0));
  const reqOf = (t) => t?.requirement ?? null;
  const freePool = readConst("web/lib/requests.js", "MEDICAL_SIMPLE_PER_TURN");
  const spillShare = 0.25; // what a 0-turn cure past the pool bills, per TAGS.md §5c and craftBudget.js
  const dyingSlug = "dying";

  // ---- 1. the ladder, read from the catalog ----------------------------------------------------------------------
  // A rung's block is the one its tags carry most often; a named exception (a half rung) is listed on its own.
  const rungTags = health.filter((t) => Number.isInteger(t.cureRung) && t.cureRung > 0 && reqOf(t) && t.slug !== dyingSlug);
  const blockKey = (r) => `${r.resourceCost ?? 0}|${r.turnsCost ?? 0}|${(r.skills ?? []).join(",")}|${Boolean(r.gambit)}`;
  const rungs = [...new Set(rungTags.map((t) => t.cureRung))].sort((a, b) => a - b).map((rung) => {
    const on = rungTags.filter((t) => t.cureRung === rung);
    const counts = new Map();
    for (const t of on) counts.set(blockKey(reqOf(t)), (counts.get(blockKey(reqOf(t))) ?? 0) + 1);
    const key = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const r = reqOf(on.find((t) => blockKey(reqOf(t)) === key));
    const tier = tierOfSkills(r.skills);
    return {
      rung,
      resources: r.resourceCost ?? 0,
      turns: r.turnsCost ?? 0,
      skill: (r.skills ?? []).map(nameOf).join(", ") || "none",
      tier,
      gambit: Boolean(r.gambit),
      site: (r.skills ?? []).includes("medical-expert"),
      coinAtBuy: (r.resourceCost ?? 0) * rv.buy,
      coinAtMid: (r.resourceCost ?? 0) * rv.mid,
      tags: on.map((t) => ({ name: t.name, group: t.group })),
      offBlock: on.filter((t) => blockKey(reqOf(t)) !== key).map((t) => t.name),
    };
  });
  const dying = get(dyingSlug);

  // ---- 2. what one medic can treat a turn -------------------------------------------------------------------------
  // The free pool takes 0-turn cures; the one Move takes the rest in shares; a Gambit heal takes the whole Move.
  const tiers = tierSlugs.map((slug, i) => {
    const tier = healGambit.MEDICAL_TIER[slug];
    const chain = tierSlugs.slice(0, i + 1);
    const doable = rungs.filter((r) => r.tier <= tier);
    const perMove = doable.filter((r) => r.turns > 0).map((r) => ({ rung: r.rung, count: Math.floor(1 / r.turns), resources: Math.floor(1 / r.turns) * r.resources }));
    // Reaching above your tier files a Gambit: the threshold the game's own rule sets, and the d6's odds of it.
    const above = rungs.filter((r) => r.tier > tier || r.gambit).map((r) => {
      const threshold = healGambit.healThreshold({ requirementSkills: r.tier ? [{ slug: tierSlugs[r.tier - 1] }] : [], requirementGambit: r.gambit }, tier);
      return { rung: r.rung, threshold, p: Math.max(0, Math.min(1, (7 - threshold) / 6)) };
    });
    return {
      slug,
      name: nameOf(slug),
      tier,
      points: chain.reduce((n, s) => n + (get(s)?.pointCost ?? 0), 0),
      freePool,
      perMove,
      above,
    };
  });

  // ---- untreated chains --------------------------------------------------------------------------------------------
  // Follow expiresInto: each entry lands at once, a oneOf is an even pick, a self-reference renews the tag, Dying is
  // a countdown to death, and `dead` kills at the close. What each path costs to treat, and how long it takes.
  const cureCost = (t) => (reqOf(t) ? reqOf(t).resourceCost ?? 0 : null);
  const outcomes = (slug, depth = 0, seen = []) => {
    const t = get(slug);
    if (slug === "dead") return [{ p: 1, end: "dead", turns: 0, worst: null }];
    if (!t) return [{ p: 1, end: "clears", turns: 0, worst: null }];
    if (slug === dyingSlug) return [{ p: 1, end: "dead", turns: t.durationTurns ?? 1, worst: t }];
    const entries = (t.expiresInto ?? []).map((e) => (typeof e === "string" ? [e] : e.oneOf ?? [e.slug]));
    if (!t.durationTurns) return [{ p: 1, end: "stays", turns: Infinity, worst: t }];
    if (!entries.length || depth > 8) return [{ p: 1, end: "clears", turns: t.durationTurns, worst: t }];
    // Several entries land together: the worst of them decides where the patient ends up.
    let paths = [{ p: 1, end: "clears", turns: t.durationTurns, worst: t }];
    for (const options of entries) {
      const branch = options.filter((s) => s !== slug).flatMap((s) => (seen.includes(s) ? [] : outcomes(s, depth + 1, [...seen, slug]).map((o) => ({ ...o, p: o.p / options.length, turns: t.durationTurns + o.turns }))));
      if (!branch.length) continue;
      const next = [];
      for (const a of paths) for (const b of branch) next.push(worse(a, b));
      paths = next.length ? next : paths;
    }
    return paths;
  };
  const RANK = { clears: 0, stays: 1, worsens: 2, dead: 3 };
  const worse = (a, b) => {
    const pick = RANK[b.end] >= RANK[a.end] ? b : a;
    const dearer = (cureCost(b.worst) ?? 0) > (cureCost(a.worst) ?? 0) ? b.worst : a.worst;
    return { end: pick.end, turns: pick.end === "dead" ? Math.min(a.end === "dead" ? a.turns : Infinity, b.end === "dead" ? b.turns : Infinity) : Math.max(Number.isFinite(a.turns) ? a.turns : 0, b.turns), worst: dearer, p: a.p * b.p };
  };

  // ---- 4. leave it or treat it: an expected-value comparison ------------------------------------------------------
  // cost(T): treating T now, in ¢ — its ⬢ at the run's price and its Move share at a Move's worth, or the cheapest item
  // that cures it, whichever is less. wait(T): the expected cost of letting T's clock run once — the average over its
  // expiresInto outcomes of best(X) = min(cost(X), wait(X)), all the entries of one step landing together. Floors: a
  // tag with no cure and no harmful successor costs nothing (recovery, a scar); a maiming costs the item that answers
  // it, or PERMANENT_COST where nothing does; Dying costs its rescue over the rescue Gambit's odds; death is infinite.
  const PERMANENT_COST = 1000; // a labelled stand-in for a loss nothing in the catalog repairs
  const perMove = moveValue;
  const itemFor = (slug) =>
    list
      .filter((x) => (x.cures ?? []).includes(slug) && (x.depotPrice ?? x.sellablePrice) != null)
      .sort((x, y) => (x.depotPrice ?? x.sellablePrice) - (y.depotPrice ?? y.sellablePrice))[0] ?? null;
  const dyingOdds = dying && reqOf(dying) ? Math.max(1e-6, (7 - healGambit.healThreshold({ requirementSkills: (reqOf(dying).skills ?? []).map((sl) => ({ slug: sl })), requirementGambit: reqOf(dying).gambit }, tierOfSkills(reqOf(dying).skills))) / 6) : 1;
  const costOf = new Map();
  const cost = (slug) => {
    if (costOf.has(slug)) return costOf.get(slug);
    const t = get(slug);
    let out;
    if (slug === "dead") out = { coin: Infinity, how: "death" };
    else if (!t) out = { coin: 0, how: "nothing" };
    else {
      const r = reqOf(t);
      const medic = r && t.healable ? (r.resourceCost ?? 0) * params.rvMain + (r.turnsCost ?? 0) * perMove : null;
      const item = itemFor(slug);
      const itemCoin = item ? item.depotPrice ?? item.sellablePrice : null;
      if (slug === dyingSlug && medic != null) out = { coin: medic / dyingOdds, how: `the rescue at ${Math.round(dyingOdds * 100)}% odds` };
      else if (medic != null && (itemCoin == null || medic <= itemCoin)) out = { coin: medic, how: "a medic" };
      else if (itemCoin != null) out = { coin: itemCoin, how: item.name };
      // A lasting loss nothing answers: a missing part, a lost hand, or a fighting penalty of a tier or more. Anything
      // else with no cure (a scar, a limp, a cough) is a floor of nothing.
      else if (!t.durationTurns && (/^missing-/.test(slug) || t.handsLost || (t.fighting?.tiers ?? 0) <= -1)) out = { coin: PERMANENT_COST, how: "permanent: nothing repairs it" };
      else out = { coin: 0, how: "no cure needed" };
    }
    costOf.set(slug, out);
    return out;
  };
  const waitMemo = new Map();
  const wait = (slug, seen = []) => {
    if (waitMemo.has(slug)) return waitMemo.get(slug);
    const t = get(slug);
    if (!t || slug === "dead") return { coin: slug === "dead" ? Infinity : 0, odds: [] };
    if (slug === dyingSlug) return { coin: Infinity, odds: [{ p: 1, name: "death" }] };
    if (!t.durationTurns) return { coin: cost(slug).coin, odds: [], noClock: true };
    const entries = (t.expiresInto ?? []).map((e) => (typeof e === "string" ? [e] : e.oneOf ?? [e.slug]));
    let coin = 0;
    const odds = [];
    for (const options of entries) {
      let sum = 0;
      for (const o of options) {
        // A self-reference renews the tag: still to pay at its own price.
        const best = o === slug ? cost(slug).coin : seen.includes(o) ? cost(o).coin : Math.min(cost(o).coin, wait(o, [...seen, slug]).coin);
        sum += best / options.length;
        odds.push({ p: 1 / options.length, name: o === "dead" ? "death" : nameOf(o), coin: best });
      }
      coin += sum;
    }
    const out = { coin, odds };
    if (!seen.length) waitMemo.set(slug, out);
    return out;
  };
  const leave = health
    .filter((t) => t.healable || t.expiresInto || t.durationTurns)
    .map((t) => {
      const paths = outcomes(t.slug);
      const pDead = paths.filter((o) => o.end === "dead").reduce((n, o) => n + o.p, 0);
      const deadTurns = Math.min(...paths.filter((o) => o.end === "dead").map((o) => o.turns), Infinity);
      const now = reqOf(t);
      const c = cost(t.slug);
      const w = wait(t.slug);
      // Lethal within the wait: one step of the clock lands Dying or death.
      const lethal = t.slug === dyingSlug || (t.expiresInto ?? []).some((e) => (typeof e === "string" ? [e] : e.oneOf ?? [e.slug]).some((o) => o === "dead" || o === dyingSlug));
      const verdict = !t.healable && !itemFor(t.slug) ? "untreatable" : w.noClock ? "no hurry" : !lethal && w.coin < c.coin ? "wait" : "treat now";
      const oddsText = w.odds.length ? w.odds.map((o) => `${Math.round(o.p * 100)}% ${o.name}${Number.isFinite(o.coin) ? ` at ${fmt1(o.coin)} ¢` : ""}`).join(", ") : t.durationTurns ? "clears" : "stays";
      return {
        slug: t.slug,
        name: t.name,
        group: t.group,
        rung: t.cureRung ?? null,
        healable: Boolean(t.healable),
        resources: now?.resourceCost ?? null,
        turns: now?.turnsCost ?? null,
        skill: (now?.skills ?? []).map(nameOf).join(", ") || (now ? "none" : "—"),
        tier: now ? tierOfSkills(now.skills) : null,
        gambit: Boolean(now?.gambit),
        site: (now?.skills ?? []).includes("medical-expert") && t.slug !== dyingSlug,
        duration: t.durationTurns ?? null,
        costNow: c.coin,
        costHow: c.how,
        waitCost: w.coin,
        odds: oddsText,
        pDead,
        deadTurns: Number.isFinite(deadTurns) ? deadTurns : null,
        saved: verdict === "wait" ? c.coin - w.coin : 0,
        verdict,
        lethal,
        reason: lethal ? (t.slug === dyingSlug ? `death at the close of ${t.durationTurns} turn${t.durationTurns === 1 ? "" : "s"}` : `its next step is Dying or death, in ${t.durationTurns} turn${t.durationTurns === 1 ? "" : "s"}`) : verdict === "wait" ? `waiting is cheaper: ${oddsText}` : verdict === "no hurry" ? "no clock: it never gets worse" : verdict === "untreatable" ? "nothing cures it" : `waiting costs more: ${oddsText}`,
      };
    })
    .sort((a, b) => b.saved - a.saved || (a.verdict === "treat now" ? -1 : 1));
  // What a town saves a turn by following the verdicts, at the injury rate of section 6 (filled in below).
  let townSaved = 0;

  // ---- 5. triage priority, by rule ---------------------------------------------------------------------------------
  const tierName = (n) => nameOf(tierSlugs[n - 1] ?? tierSlugs[0]);
  const gambitOdds = (row, tier) => {
    const threshold = healGambit.healThreshold({ requirementSkills: row.tier ? [{ slug: tierSlugs[row.tier - 1] }] : [], requirementGambit: row.gambit }, tier);
    return { threshold, p: Math.max(0, Math.min(1, (7 - threshold) / 6)) };
  };
  const treatable = leave.filter((r) => r.healable && r.resources != null);
  const band = (r) => (r.lethal ? 0 : r.verdict === "treat now" ? 1 : r.verdict === "wait" ? 3 : 2);
  // What treating now saves over waiting, a Move of the medic's time.
  const savedPerMove = (r) => (Number.isFinite(r.waitCost) ? (r.waitCost - r.costNow) / Math.max(r.turns || spillShare, spillShare) : 0);
  const triage = [...treatable]
    .sort((a, b) => band(a) - band(b) || (band(a) === 0 ? (a.duration ?? 0) - (b.duration ?? 0) : band(a) === 1 ? savedPerMove(b) - savedPerMove(a) : (b.rung ?? 0) - (a.rung ?? 0)))
    .map((r, i) => {
      const who = Math.max(1, r.tier ?? 1);
      const lower = who > 1 ? gambitOdds(r, who - 1) : null;
      return {
        order: i + 1,
        ...r,
        who: `${tierName(who)}${r.site ? " at a site" : ""}`,
        why: band(r) === 0 ? `turns lethal in ${r.duration} turn${r.duration === 1 ? "" : "s"} untreated` : band(r) === 1 ? `${fmt1(savedPerMove(r))} ¢ saved a Move by treating now` : band(r) === 3 ? r.reason : `rung ${r.rung ?? "—"}; ${r.reason}`,
        lowerGambit: lower ? `${tierName(who - 1)} can try: ${Math.round(lower.p * 100)}% on a d6 (needs ${lower.threshold}), and a miss adds a complication` : null,
      };
    });

  // ---- 3. where: the sites and the hops to them --------------------------------------------------------------------
  const doc = yaml.load(read("docs/zones.yaml"));
  const sites = [];
  const scan = (zone, locations) => {
    for (const [slug, loc] of Object.entries(locations ?? {})) {
      if ((loc.structures ?? []).includes("surgical-theater")) sites.push({ zone, where: loc.name, what: nameOf("surgical-theater") });
      for (const room of Object.values(loc.rooms ?? {})) {
        const st = room.stash;
        const has = Array.isArray(st) ? st.includes("surgical-equipment") : Boolean(st?.items?.["surgical-equipment"]);
        if (has) sites.push({ zone, where: `${loc.name}, ${room.name}`, what: nameOf("surgical-equipment") });
      }
    }
  };
  for (const [zk, zv] of Object.entries(doc.zones)) {
    scan(zk, zv.locations);
    for (const [lk, lv] of Object.entries(zv.levels ?? {})) scan(lk, lv.locations);
  }
  const hops = (a, b) => combos.hops[a]?.[b] ?? null;
  const siteZones = [...new Set(sites.map((s) => s.zone))];
  const nearestSite = (zone) => Math.min(...siteZones.map((z) => hops(zone, z) ?? Infinity));
  // The same walk in TRAVEL (½ a town crossing, 1 any other), which is what the free allowance pays for.
  const travelTo = (a, b) => combos.travel?.[a]?.[b] ?? hops(a, b);
  const nearestTravel = (zone) => Math.min(...siteZones.map((z) => travelTo(zone, z) ?? Infinity));
  const injuryZones = [...new Set([...params.caveLevels, combos.sites.refine, combos.sites.cut, combos.sites.depot].filter(Boolean))];
  const reach = leave
    .filter((r) => r.pDead > 0 && r.healable)
    .map((r) => ({
      name: r.name,
      site: r.site,
      deadTurns: r.deadTurns,
      byZone: injuryZones.map((z) => {
        const h = nearestSite(z);
        const t = nearestTravel(z);
        // The free travel a turn is spent first; past it a crossing costs the Move. Turns of walking at the free allowance.
        const turnsToWalk = Number.isFinite(t) ? Math.ceil(t / Math.max(0.5, params.freeZoneMoves) - 1e-9) : Infinity;
        return { zone: z, hops: h, travel: t, inTime: !r.site || turnsToWalk < r.deadTurns };
      }),
    }));
  const buyables = {
    equipment: { name: nameOf("surgical-equipment"), coin: get("surgical-equipment")?.depotPrice ?? null, points: get("surgical-equipment")?.pointCost ?? 0, weight: get("surgical-equipment")?.weight ?? null },
    theater: { name: nameOf("surgical-theater"), resources: get("surgical-theater")?.requirement?.resourceCost ?? null, moves: get("surgical-theater")?.requirement?.turnsCost ?? null, skill: (get("surgical-theater")?.requirement?.skills ?? []).map(nameOf).join(", ") },
    pack: { name: nameOf("portable-surgical-pack"), resources: get("portable-surgical-pack")?.requirement?.resourceCost ?? null, moves: get("portable-surgical-pack")?.requirement?.turnsCost ?? null, skill: (get("portable-surgical-pack")?.requirement?.skills ?? []).map(nameOf).join(", ") },
  };

  // ---- 6. the town's injuries and its medics -----------------------------------------------------------------------
  // Cavers: the Caving tab's trouble mix at the budget, each kind priced as the tags caving.js names for it.
  const WOUND_KIND_SLUGS = { minor: ["deep-wound", "broken-bone"], major: ["gut-wound", "punctured-lung"], limb: ["missing-leg"], death: [] };
  const injuries = new Map();
  const addInjury = (slug, perTurn, source) => {
    if (!slug || !(perTurn > 0)) return;
    const cur = injuries.get(slug) ?? { slug, perTurn: 0, sources: new Set() };
    cur.perTurn += perTurn;
    cur.sources.add(source);
    injuries.set(slug, cur);
  };
  const cavers = (players * KNOBS.caversPer100) / 100;
  for (const zone of ["caves", "depths"]) {
    const mix = caving.perZone[zone]?.mix ?? {};
    for (const [kind, share] of Object.entries(mix)) {
      const slugs = WOUND_KIND_SLUGS[kind] ?? [];
      for (const slug of slugs) addInjury(slug, ((cavers / 2) * KNOBS.troubleBudget * share) / slugs.length, `caving (${zone})`);
    }
  }
  // Godflesh cutters: a cut on every shift, the injury chance of the die, the bare-hands column of the table.
  const solo = activities.find((a) => a.id === "factory:solo");
  const table = readInjuryTable();
  const cutsPerTurn = (params.refinerySeats ?? 0) * (params.refineDuty ?? 0);
  if (solo?.injuryChance) for (const [slug, share] of Object.entries(table.none ?? {})) addInjury(slug, cutsPerTurn * solo.injuryChance * share, "cutting Godflesh, bare hands");
  // GM fights: one wound a turn per KNOBS.fightWoundPer players, drawn from the Caves' mix.
  const fights = players / KNOBS.fightWoundPer;
  for (const [kind, share] of Object.entries(caving.perZone.caves?.mix ?? {})) for (const slug of WOUND_KIND_SLUGS[kind] ?? []) addInjury(slug, (fights * share) / (WOUND_KIND_SLUGS[kind].length || 1), "GM-adjudicated fights");
  const injuryRows = [...injuries.values()].map((i) => {
    const t = get(i.slug);
    const r = reqOf(t);
    const items = list.filter((x) => (x.cures ?? []).includes(i.slug) && (x.depotPrice ?? x.sellablePrice) != null).sort((a, b) => (a.depotPrice ?? a.sellablePrice) - (b.depotPrice ?? b.sellablePrice));
    const item = items[0] ?? null;
    const medicCoin = r ? (r.resourceCost ?? 0) * rv.buy + (r.turnsCost ?? 0) * moveValue : null;
    return {
      slug: i.slug,
      name: t?.name ?? i.slug,
      perTurn: i.perTurn,
      sources: [...i.sources],
      rung: t?.cureRung ?? null,
      tier: r ? tierOfSkills(r.skills) : null,
      turns: r?.turnsCost ?? null,
      resources: r?.resourceCost ?? null,
      item: item ? { name: item.name, coin: item.depotPrice ?? item.sellablePrice, administer: item.administerSkill ? nameOf(item.administerSkill) : null } : null,
      medicCoin,
      itemBeatsMedic: item && medicCoin != null ? (item.depotPrice ?? item.sellablePrice) < medicCoin : null,
    };
  }).sort((a, b) => (b.rung ?? 0) - (a.rung ?? 0));
  // Medic-turns needed, by the tier a cure needs: shares of a Move, and 0-turn cures past the free pool.
  const need = [1, 2, 3].map((tier) => {
    const rows = injuryRows.filter((r) => Math.max(1, r.tier ?? 1) === tier && r.turns != null);
    return { tier, name: tierName(tier), injuries: rows.reduce((n, r) => n + r.perTurn, 0), moves: rows.reduce((n, r) => n + r.perTurn * r.turns, 0), freeCures: rows.filter((r) => r.turns === 0).reduce((n, r) => n + r.perTurn, 0), resources: rows.reduce((n, r) => n + r.perTurn * (r.resources ?? 0), 0) };
  });
  const medics = [1, 2, 3].map((tier) => {
    const roles = starting.roles.filter((r) => r.seats > 0 && tierOfSkills(r.tagSlugs) === tier);
    return { tier, name: tierName(tier), seats: roles.reduce((n, r) => n + r.seats, 0), roles: roles.map((r) => `${r.name}${r.seats > 1 ? ` ×${r.seats}` : ""}`) };
  });
  // Capacity: a medic of a tier can take their own and every lower tier's work, a Move and the free pool each.
  const capacity = [1, 2, 3].map((tier) => {
    const available = medics.filter((m) => m.tier >= tier).reduce((n, m) => n + m.seats, 0);
    const neededMoves = need.filter((n) => n.tier >= tier).reduce((s, n) => s + n.moves, 0);
    return { tier, name: tierName(tier), medicsAtOrAbove: available, movesNeeded: neededMoves, surplus: available - neededMoves };
  });
  for (const i of injuryRows) townSaved += i.perTurn * (leave.find((r) => r.slug === i.slug)?.saved ?? 0);
  const resourcesPerTurn = injuryRows.reduce((n, r) => n + r.perTurn * (r.resources ?? 0), 0);
  const coinPerTurn = resourcesPerTurn * rv.buy;

  return {
    knobs: KNOBS,
    freePool,
    spillShare,
    rungs,
    dying: dying ? { resources: reqOf(dying)?.resourceCost ?? null, turns: reqOf(dying)?.turnsCost ?? null, skill: (reqOf(dying)?.skills ?? []).map(nameOf).join(", "), gambit: Boolean(reqOf(dying)?.gambit) } : null,
    tiers,
    leave,
    triage,
    sites,
    siteZones,
    injuryZones,
    reach,
    buyables,
    injuryRows,
    need,
    medics,
    capacity,
    coinPerTurn,
    resourcesPerTurn,
    townSaved,
    permanentCost: PERMANENT_COST,
    cavers,
    fights,
    cutsPerTurn,
    payer: "any party the medic can reach: the medic, the patient or the room (the Heal action's payer)",
  };
}

const fmt1 = (n) => (n == null || !Number.isFinite(n) ? "—" : String(Math.round(n * 10) / 10));

module.exports = { buildMedical, MEDICAL_KNOBS: KNOBS };
