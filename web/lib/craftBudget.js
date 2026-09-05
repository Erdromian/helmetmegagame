// The craft Move budget: what one craft costs of a turn's Routine, and the
// arithmetic that adds those costs up (docs/systemdocs/CRAFTING.md §2a).
//
// Pure — no prisma, no React — because one model has to hold in three places:
// `craftRequest` enforces it, `character/page.js` summarises it for the sheet,
// and the Craft dialog quotes it before the player commits. A number the
// dialog shows that the server would disagree with is worse than no number.
//
// Costs are FRACTIONS of a Move with small denominators — a recipe's `perTurn`
// ration, or the Dead Simple pool of 4 — kept as integer num/den pairs and
// compared by cross-multiplication. Floats were never an option here: three
// thirds have to be exactly one Move, not 0.9999999999999998 of one.

import { craftFamily } from "./tagRequests";

export const NO_MOVE = { num: 0, den: 1 };
export const WHOLE_MOVE = { num: 1, den: 1 };

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

export function reduceFraction(num, den) {
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / g, den: den / g };
}

export function addFractions(a, b) {
  return reduceFraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

// Does `cost` still fit in what is left? Cross-multiplied, so nothing rounds.
export function fitsInRemaining(cost, remaining) {
  return cost.num * remaining.den <= remaining.num * cost.den;
}

// How many units at 1/den each the remainder still pays for.
export function unitsAffordable(remaining, den) {
  if (!den) return 0;
  return Math.floor((remaining.num * den) / remaining.den);
}

// A ledger's spend and what is left of the Move after it. `1 − a/b` is
// `(b−a)/b`, and stays in lowest terms because a/b already is.
export function ledgerUsed(ledger) {
  if (!ledger) return NO_MOVE;
  return { num: ledger.usedNum ?? 0, den: ledger.usedDen || 1 };
}

export function ledgerRemaining(ledger) {
  const used = ledgerUsed(ledger);
  return reduceFraction(used.den - used.num, used.den);
}

// Just the fraction, for a sentence to sit around — never a word, so a caller
// can say "½ of a Move" or "½ left" without the phrasing being decided here.
const FRACTION_GLYPHS = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  // Mixed denominators (a ⅓ brew after a ½ one) land on sixths; twelfths
  // have no glyphs and fall through to "n/m", which is fine.
  "1/6": "⅙",
  "5/6": "⅚",
};

export function formatMoveFraction(num, den) {
  return FRACTION_GLYPHS[`${num}/${den}`] ?? `${num}/${den}`;
}

// The word for a family of work, as it reads in a sentence: "brewing work",
// "smith's work". The family itself is a skill-slug prefix, which is a key,
// not prose.
const FAMILY_LABELS = {
  brewing: "brewing",
  cooking: "cooking",
  smithing: "smith's",
  builder: "building",
  crafting: "crafting",
};

export function craftFamilyLabel(family) {
  return FAMILY_LABELS[family] ?? "craft";
}

// What one craft costs of this turn's Move. Five answers:
//
//   free   — no Move at all: a 0-turn recipe inside its free allowance.
//   spill  — some units free, the rest billed at 1/allowance each. Chris's
//            ruling: the allowance is free, going past it costs the Move.
//   capped — past the allowance with no craft family to bill it to (bone-mask
//            is gated on `butcher` alone), so the ration is a hard wall.
//   share  — a recipe with a `perTurn` ration and a Move to pay: quantity/N.
//   whole  — the whole Move. A plain 1-turn recipe, or a turn on a project.
//
// `allowance`/`freeLeft` are only read on a 0-turn recipe: the ration and how
// much of it today's turn has left. The caller counts those — the server off
// the turn's requests, the dialog off the map the page hands it.
export function craftMoveCost(
  tag,
  { quantity = 1, allowance = null, freeLeft = null } = {},
) {
  const turns = tag?.requirementTurns ?? 1;
  const perTurn = tag?.requirementPerTurn ?? null;
  const family = craftFamily(tag);
  const free = (qty) => ({
    kind: "free",
    family,
    freeQty: qty,
    billedQty: 0,
    num: 0,
    den: 1,
    allowance,
  });
  if (turns === 0) {
    // No allowance at all — a 0-turn recipe that is neither Dead Simple nor
    // rationed — stays the free action it has always been.
    if (allowance == null) return free(quantity);
    const covered = Math.max(0, Math.min(quantity, freeLeft ?? allowance));
    const billed = quantity - covered;
    if (billed <= 0) return free(quantity);
    return {
      kind: family ? "spill" : "capped",
      family,
      freeQty: covered,
      billedQty: billed,
      num: billed,
      den: allowance,
      allowance,
    };
  }
  // Only a ONE-turn batch shares the Move. A project (turns ≥ 2) takes the
  // whole Move every turn it runs, `perTurn` or not — its continue path
  // prices at 1/1, and a start that priced as a fraction would disagree with
  // every turn after it. No such recipe exists today; this keeps the first
  // one from finding the seam.
  if (turns === 1 && family && perTurn > 0) {
    return {
      kind: "share",
      family,
      freeQty: 0,
      billedQty: quantity,
      num: quantity,
      den: perTurn,
      allowance: perTurn,
    };
  }
  return {
    kind: "whole",
    family,
    freeQty: 0,
    billedQty: quantity,
    num: 1,
    den: 1,
    allowance: null,
  };
}

// The turn's ledger as the sheet and the dialog read it: which family of work
// the Routine is committed to, and how much of the Move is left. Null unless
// the open turn's Action is a craft Action carrying one.
export function summarizeCraftBudget(action) {
  // `includes`, matching checkCraftMove: other machinery may append to
  // gmNotes, and an appended note must not hide a live ledger.
  if (!action || !(action.gmNotes ?? "").includes("auto:craft") || !action.craftBudget)
    return null;
  const left = ledgerRemaining(action.craftBudget);
  return {
    family: action.craftBudget.family ?? null,
    remainingNum: left.num,
    remainingDen: left.den,
  };
}
