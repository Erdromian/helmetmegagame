// A field's productivity: a pool of "what the soil has left", drawn down by every harvest there and refilled
// each turn, so a reasonable amount of farming feeds the town and too much wears the field out.
// See docs/systemdocs/SOILERY.md §9.
//
// EVERY LOCATION with the `soilery` attribute is its own field, with its own pool (LocationField). Each refills at
// the town's rate times the Location's `soileryRegen` (default 1: a field that feeds the whole town), so a second,
// poorer field is one more Location with a smaller share and needs no code.
//
//   REFILL   Each turn close a field's pool gains `sustainableRate` crops times its share: what the town eats (2
//            crops make the one basic dish that feeds a person a turn, so 2 a seat) plus a margin. It is capped
//            at `poolTurns` turns of that, so a quiet spell banks a buffer and no more.
//   DRAW     Every harvest takes what it produced out of the pool, counted in FOOD-CROP EQUIVALENTS: a
//            plant takes the same from the field whatever it gives you, so a tobacco leaf (a third of a
//            plant's usual yield) counts as three crops. Cash crops wear the field like any other.
//   CURVE    The pool sets a yield multiplier for the harvests of the coming turn. At or above `comfort`
//            of a full pool it is 1. Below that it falls to `minYield` at an empty pool and stays there
//            however far into debt the pool goes.
//   DEBT     The pool may go below zero (down to minus one full pool), because overdrawing is the thing
//            being punished. Output falls until it matches the refill, then holds; if farmers stop, the
//            debt is paid back at the refill rate.
//
// The curve is knobs on GameConfig (db/lib/gameConfigFields.js, group "economy"), so a GM can tune it mid-round;
// a field's own share is an attribute on its Location. The pool and the multiplier live on LocationField, which
// the wipe clears, so Restart Game resets them.
//
// The pure half (settings, rate, cap, curve) takes plain numbers and touches nothing. The two helpers that
// write take `tx` first, like db/lib/lifeweb.js#bumpBlood, and clamp inside one locked UPDATE so two
// harvests resolving together cannot stomp each other.

const { readGameConfig, readGameState, effectivePlayerCount } = require("./gameState");
const { SOILERY_ATTRIBUTE, SOILERY_REGEN_ATTRIBUTE, hasAttribute } = require("./locationAttributes");

// Two crops make one basic dish (COOKING.md §2a), and one dish is one person's 35 hunger, which is what a
// person burns in a turn (TURN-ENGINE.md §5). So a seat eats 2 crops a turn whatever the decay is.
const CROPS_PER_SEAT = 2;

// The fallbacks, and the same numbers as the schema defaults (a knob that is missing reads these).
const DEFAULTS = {
  enabled: true,
  margin: 0.15,
  poolTurns: 4,
  comfort: 0.75,
  minYield: 0.25,
  curveExp: 1,
};

const num = (v, fallback, lo, hi) => {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// The knobs off a GameConfig row (or nothing at all), clamped to what the curve can use.
function fieldSettings(config) {
  return {
    enabled: config?.farmFieldEnabled ?? DEFAULTS.enabled,
    margin: num(config?.farmSustainMargin, DEFAULTS.margin, 0, 2),
    poolTurns: num(config?.farmPoolTurns, DEFAULTS.poolTurns, 0.5, 50),
    comfort: num(config?.farmComfortFrac, DEFAULTS.comfort, 0.05, 1),
    minYield: num(config?.farmMinYield, DEFAULTS.minYield, 0, 1),
    curveExp: num(config?.farmCurveExp, DEFAULTS.curveExp, 0.25, 6),
  };
}

// A Location's share of the town's refill: its `soileryRegen` attribute, 1 when unset. Kept off zero, because a field that
// refills nothing has no pool to measure against and would read as sound forever.
const MIN_SHARE = 0.01;
function regenShare(attributes) {
  const v = attributes?.[SOILERY_REGEN_ATTRIBUTE];
  if (v == null || v === false) return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(MIN_SHARE, n));
}

// Crops a turn a field refills, for this many seats. `share` is the field's own (regenShare); 1 feeds the whole town.
function sustainableRate(seats, s = DEFAULTS, share = 1) {
  return Math.max(0, seats) * CROPS_PER_SEAT * (1 + s.margin) * share;
}

// The most the pool holds, and the deepest it can be in debt (the same number, negative).
function poolCap(seats, s = DEFAULTS, share = 1) {
  return sustainableRate(seats, s, share) * s.poolTurns;
}

// The yield multiplier for a pool level. 1 at or above `comfort` of a full pool, `minYield` at empty or below,
// and `curveExp` shapes the way between (1 is a straight line, more is gentle at first and steep at the end).
function yieldMultiplier(pool, cap, s = DEFAULTS) {
  if (!(cap > 0)) return 1;
  const x = pool / cap;
  if (x >= s.comfort) return 1;
  const t = Math.min(1, Math.max(0, x / s.comfort));
  return s.minYield + (1 - s.minYield) * Math.pow(t, s.curveExp);
}

// One turn of the pool, in numbers: draw what was produced, then refill. Used by the pass and by the tests and
// the economy report, so all three agree on the order (draw first, refill second).
function stepPool(pool, produced, rate, cap) {
  const drawn = Math.max(-cap, pool - Math.max(0, produced));
  return Math.min(cap, drawn + rate);
}

// Where one field's pool stands, for a sheet or a panel. `field` is its LocationField row (or nothing yet: full) and
// `attributes` the Location's, for its share.
function fieldStatus(config, state, field, attributes) {
  const s = fieldSettings(config);
  const seats = effectivePlayerCount(config, state);
  const share = regenShare(attributes);
  const rate = sustainableRate(seats, s, share);
  const cap = poolCap(seats, s, share);
  const pool = field?.pool ?? cap;
  const mult = s.enabled ? (field?.yieldMult ?? 1) : 1;
  return { enabled: s.enabled, seats, share, rate, cap, pool, mult, fraction: cap > 0 ? pool / cap : 1, settings: s };
}

// How bad the field is, in four steps, for the players. Nothing is said until the yield falls to 80%, and then it is said in
// words, never a number: the state is something a farmer would see in the ground, not read off a gauge. The steps are at
// 80%, 60%, 40% and below 30%; anything above 80% is 0, sound.
const FIELD_TIERS = [
  { tier: 1, atOrBelow: 0.8, text: "The soil is starting to tire." },
  { tier: 2, atOrBelow: 0.6, text: "The field is being worked too hard. The plants are coming up thin." },
  { tier: 3, atOrBelow: 0.4, text: "The field is failing. Much of what is sown is not coming up." },
  { tier: 4, below: 0.3, text: "The field is nearly dead. Almost nothing will grow." },
];

// 0 for a sound field, up to 4 for a dying one. The tiers are ordered worst last, so the deepest one that fits wins.
function fieldTier(mult) {
  let found = 0;
  for (const t of FIELD_TIERS) {
    const hit = t.below != null ? mult < t.below : mult <= t.atOrBelow + 1e-9;
    if (hit) found = t.tier;
  }
  return found;
}

// What the players are told about the state of the field: null while it is sound, a short sentence when it is not.
function fieldWarning(mult) {
  const tier = fieldTier(mult);
  return tier ? FIELD_TIERS[tier - 1].text : null;
}

// ---- writes --------------------------------------------------------------------------------------------------

// The row for a place, made on the spot. Null pool is a full field, so a fresh row is exactly what "never harvested" means.
async function ensureField(tx, locationId) {
  await tx.locationField.upsert({ where: { locationId }, update: {}, create: { locationId } });
}

// What one place's field needs to know to size itself: the curve, this game's seats and the place's own share.
async function fieldContext(tx, locationId) {
  const [config, state, location] = await Promise.all([
    readGameConfig(tx),
    readGameState(tx),
    tx.location.findUnique({ where: { id: locationId }, select: { attributes: true } }),
  ]);
  const s = fieldSettings(config);
  const seats = effectivePlayerCount(config, state);
  const share = regenShare(location?.attributes);
  return { s, seats, share, rate: sustainableRate(seats, s, share), cap: poolCap(seats, s, share) };
}

// What a harvest here comes up at: this field's multiplier, or 1 when the field is switched off or has no row yet.
async function yieldMultFor(db, locationId) {
  if (!locationId) return 1;
  const [config, field] = await Promise.all([readGameConfig(db), db.locationField.findUnique({ where: { locationId }, select: { yieldMult: true } })]);
  return fieldSettings(config).enabled ? field?.yieldMult ?? 1 : 1;
}

// Takes `amount` crop-equivalents out of a place's pool and answers what was ACTUALLY taken. It clamps at the debt floor, so
// a refund of the nominal amount on an Undo would mint crops the field never gave up; callers snapshot `delta`.
async function drawFromPool(tx, locationId, amount) {
  if (!(amount > 0) || !locationId) return { before: null, after: null, delta: 0 };
  await ensureField(tx, locationId);
  const { cap } = await fieldContext(tx, locationId);
  const rows = await tx.$queryRaw`
    WITH prev AS (
      SELECT COALESCE("pool", ${cap}) AS before FROM "LocationField" WHERE "locationId" = ${locationId} FOR UPDATE
    )
    UPDATE "LocationField" f
    SET "pool" = LEAST(${cap}, GREATEST(${-cap}, prev.before - ${amount}))
    FROM prev
    WHERE f."locationId" = ${locationId}
    RETURNING prev.before AS before, f."pool" AS after
  `;
  const before = rows[0]?.before ?? cap;
  const after = rows[0]?.after ?? before;
  return { before, after, delta: before - after };
}

// The undo of drawFromPool: puts back what was actually taken, never past a full pool.
async function refundToPool(tx, locationId, delta) {
  if (!(delta > 0) || !locationId) return;
  await ensureField(tx, locationId);
  const { cap } = await fieldContext(tx, locationId);
  await tx.$queryRaw`
    WITH prev AS (
      SELECT COALESCE("pool", ${cap}) AS before FROM "LocationField" WHERE "locationId" = ${locationId} FOR UPDATE
    )
    UPDATE "LocationField" f
    SET "pool" = LEAST(${cap}, prev.before + ${delta})
    FROM prev
    WHERE f."locationId" = ${locationId}
  `;
}

// The turn-close pass: for every farming place, refill its pool, then set next turn's yield multiplier off where it
// ended up. Runs after the staged push (which is where harvests draw), so this turn's harvests are already out of the pools.
//
// NOT idempotent (it adds a turn of refill), which is why it is a named pass in db/index.js's TURN_PASSES and why
// markDone stops a resumed advance from refilling twice.
async function runFieldPass(prisma, turn) {
  const [config, state, locations] = await Promise.all([
    readGameConfig(prisma),
    readGameState(prisma),
    prisma.location.findMany({ select: { id: true, name: true, attributes: true, field: { select: { pool: true } } } }),
  ]);
  const s = fieldSettings(config);
  const seats = effectivePlayerCount(config, state);
  const farms = locations.filter((l) => hasAttribute(l, SOILERY_ATTRIBUTE));
  const out = { enabled: s.enabled, turn: turn?.number ?? null, seats, fields: [] };

  for (const loc of farms) {
    if (!s.enabled) {
      // Switched off: the field is sound, whatever it was left as.
      await ensureField(prisma, loc.id);
      await prisma.locationField.update({ where: { locationId: loc.id }, data: { yieldMult: 1 } });
      continue;
    }
    const share = regenShare(loc.attributes);
    const rate = sustainableRate(seats, s, share);
    const cap = poolCap(seats, s, share);
    const before = loc.field?.pool ?? cap;
    const after = Math.min(cap, Math.max(-cap, before) + rate);
    const mult = yieldMultiplier(after, cap, s);
    await prisma.locationField.upsert({
      where: { locationId: loc.id },
      update: { pool: after, yieldMult: mult },
      create: { locationId: loc.id, pool: after, yieldMult: mult },
    });
    out.fields.push({
      location: loc.name,
      share,
      rate: Math.round(rate * 10) / 10,
      cap: Math.round(cap),
      poolBefore: Math.round(before * 10) / 10,
      poolAfter: Math.round(after * 10) / 10,
      yieldMult: Math.round(mult * 1000) / 1000,
    });
  }
  // The lowest multiplier of any field, for the one-line audit narrative.
  out.yieldMult = out.fields.length ? Math.min(...out.fields.map((f) => f.yieldMult)) : 1;
  return out;
}

module.exports = {
  CROPS_PER_SEAT,
  MIN_SHARE,
  DEFAULTS,
  fieldSettings,
  regenShare,
  sustainableRate,
  poolCap,
  yieldMultiplier,
  stepPool,
  fieldStatus,
  fieldTier,
  fieldWarning,
  yieldMultFor,
  drawFromPool,
  refundToPool,
  runFieldPass,
};
