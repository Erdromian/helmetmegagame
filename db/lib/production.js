// Canonical Labor ranges (see docs/systemdocs/LABORING.md). Single source of
// truth for the labor resolver (db/lib/laborAccess.js) and for
// web/lib/referenceData.js's getProductionRates, which backs the
// {resource:labor:tier} bubbles docs/tags.yaml's Laboring descriptions render
// through — change a range here, not in either of those places.
//
// One flavor, one field: `labor` is still the only key. The two-level
// {field: {tier}} shape is what the {resource:labor:tier} renderers need, and
// the five tiers below all live under it.
//
// Two general tiers and three specialisations. The general tiers are what you
// make anywhere; a specialisation is scaled by the Location's own coefficient
// (LocationYield.current) before anything else happens to it, so its range
// here is what it pays at a coefficient of exactly 1.0.
//
// There is deliberately no `base` tier any more. Holding no Laboring tag at
// all means you cannot labor, rather than laboring badly.
// Raised ~8% on 2026-09-06, Bascinet's call, applied to these base values
// rather than to GameConfig.productionCoefficient — the dial exempts Basic
// (UNSCALED_TIERS) and would have missed it. The two general tiers did not
// actually move: 2 x 1.08 = 2.16 and 4 x 1.08 = 4.32 both round back to where
// they started, and one whole point on those is 25-50%, which is not an 8%
// boost by any reading. So the rise lands on the three specialisations, which
// is where the volume is anyway.
const PRODUCTION_RATES = {
  labor: {
    basic: { min: 0, max: 2 },
    skilled: { min: 1, max: 4 },
    hunting: { min: 0, max: 19 },
    farming: { min: 13, max: 17 },
    fishing: { min: 8, max: 15 },
  },
};

// Which tiers are the location-scaled specialisations, and the LaborKind each
// maps to. Ordinary object rather than a Set so both directions are cheap —
// db/lib/laborAccess.js needs tier -> kind, the Labor? button needs kind ->
// tier.
const SPECIALISATION_KINDS = { hunting: "HUNTING", farming: "FARMING", fishing: "FISHING" };

// The one tier the global dial cannot touch. Basic is the floor of the whole
// economy — "you can sometimes provide for yourself" — and a GM dropping
// productionCoefficient to rebalance the specialists must not quietly delete
// subsistence along with it.
const UNSCALED_TIERS = new Set(["basic"]);

// Both ends scale independently. No min>max guard on purpose: Math.round is
// monotonic and no multiplier here is ever negative, so min <= max survives the
// scaling by construction — a clamp here would only hide a coefficient that
// had gone genuinely wrong. A small coefficient collapsing 1-4 to 0-0 is
// correct, not a bug.
//
// `coefficient` is the global GameConfig dial; `locationCoefficient` is the
// Location's own LocationYield.current for this kind. They multiply.
function computeRate(field, tier, coefficient, locationCoefficient = 1) {
  const rate = PRODUCTION_RATES[field]?.[tier];
  if (rate == null) return null;
  const c = UNSCALED_TIERS.has(tier) ? 1 : (coefficient ?? 1) * (locationCoefficient ?? 1);
  return { min: Math.round(rate.min * c), max: Math.round(rate.max * c) };
}

// Display form for a rate — "3" when it can't vary, "0–4" (en dash) when it
// can. The one place that dash is written; the API serves the result so no
// client component has to reimplement it.
function formatRate(rate) {
  if (!rate) return null;
  return rate.min === rate.max ? String(rate.min) : `${rate.min}–${rate.max}`;
}

function rollRate(rate) {
  if (!rate) return null;
  return rate.min + Math.floor(Math.random() * (rate.max - rate.min + 1));
}

module.exports = { PRODUCTION_RATES, SPECIALISATION_KINDS, UNSCALED_TIERS, computeRate, formatRate, rollRate };
