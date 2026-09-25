// The craft Move budget: what one craft costs of a turn's Routine (docs/systemdocs/CRAFTING.md §2a).
//
// Costs are AUTHORED as decimals (docs/tags.yaml `turnsCost: 0.25`) and carried
// here as num/den pairs, compared by cross-multiplication. The rationals are
// not legacy — they are the point. A turn's Move has to hold exactly, and a
// float budget would let four 0.25 crafts leave a sliver behind or come up
// short, which is a character doing work they did not pay for. The decimal
// converts to a fraction once, exactly, at craftMoveCost below, and everything
// past that is integer arithmetic.

import { craftFamily } from "./tagRequests";
// Deep paths avoid the @lifeweb/db barrel (leaks node:fs into "use client" bundles); same shim as formatTagRequirement.js.
import { formatMoveAmount } from "@lifeweb/db/lib/formatTagRequirement";
// The arithmetic and the ledger readers live in db/lib/moveLedger.js now, so
// the Discord face can spend a share of the Move too (a room search, SEARCH.md
// §9). Re-exported so every existing caller keeps its import path.
import {
  WHOLE_MOVE,
  reduceFraction,
  addFractions,
  fitsInRemaining,
  unitsAffordable,
  ledgerUsed,
  ledgerRemaining,
  isLedgerAction,
} from "@lifeweb/db/lib/moveLedger";

export { WHOLE_MOVE, addFractions, fitsInRemaining, unitsAffordable, ledgerUsed, ledgerRemaining };

// Lives in db/lib/formatTagRequirement.js (M2); re-exported so every existing caller keeps its import path.
export { formatMoveAmount };

// The word for a family of work, as it reads in a sentence: "brewing work", "smith's work".
const FAMILY_LABELS = {
  brewing: "brewing",
  cooking: "cooking",
  smithing: "smith's",
  builder: "building",
  crafting: "crafting",
  butcher: "butcher's",
  blessing: "blessing",
  // medical is hardcoded (M2, TAGS.md §5c), kept off craftFamily's guess by craftMoveCost's override.
  medical: "medical",
  // Not a craft at all: Bury and Engrave sit on this ledger rather than on the
  // whole-Move path, so a half-Move burial with a Shovel can share a turn with
  // half a turn's work at the bench (CORPSES.md). Without one, burial is the
  // whole Move and simply eats the ledger. No recipe tag carries this family.
  burial: "burial",
};

export function craftFamilyLabel(family) {
  return FAMILY_LABELS[family] ?? "craft";
}

// What one craft costs of this turn's Move: free/spill/capped (0-turn, vs. an allowance), share (1-turn
// recipe, 1/N of a turn, Chris 2026-09-06) or whole (a project turn). `family` overrides craftFamily's guess (TAGS.md §5c).
export function craftMoveCost(
  tag,
  // No default on `family`: must stay `undefined` when omitted, or moveFamilyOf's `family: null` override would be indistinguishable via `??`.
  { quantity = 1, allowance = null, freeLeft = null, family: familyOverride } = {},
) {
  const turns = tag?.requirementTurns ?? 1;
  const perTurn = tag?.requirementPerTurn ?? null;
  const family = familyOverride !== undefined ? familyOverride : craftFamily(tag);
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
  // A cost of one Move or less shares the Move; a project (turns ≥ 2, always a
  // whole number) takes the whole Move every turn.
  //
  // `turns * 1000` then reduced is exact: the sync (db/lib/tagShapes.js,
  // SUB_MOVE_COSTS) only ever admits a cost that is a multiple of 0.005 —
  // quarters plus Cooking's finer shares, 0.05/0.1/0.125/0.2 included — so
  // every legal `turns` value converts to a whole number of thousandths with
  // no drift `Math.round` cannot absorb (a `turns` not on that grid is
  // refused at authoring time, long before this runs). `reduceFraction`
  // brings it back down to the smallest exact denominator (1/20, 1/8, 1/5,
  // 1/4…). `allowance` is how many fit in a Routine — 20 at 0.05, 4 at 0.25,
  // 2 at 0.5, 1 at a whole Move — which is what the dialogs print as "up to N
  // a turn". It used to be read off requirementPerTurn, which is a ration
  // again now and nothing else.
  if (turns > 0 && turns <= 1 && family) {
    const cost = reduceFraction(Math.round(quantity * turns * 1000), 1000);
    return {
      kind: "share",
      family,
      freeQty: 0,
      billedQty: quantity,
      num: cost.num,
      den: cost.den,
      allowance: Math.floor(1 / turns),
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

// The turn's ledger as the sheet and the dialog read it; null unless the open turn's Action carries one. A turn's Routine can mix families now, so this reports only what's left of the Move — not a single family the whole turn is "locked" to.
export function summarizeCraftBudget(action) {
  // `includes`, matching checkLedgerMove: other machinery may append to gmNotes, and must not hide a live ledger.
  if (!isLedgerAction(action)) return null;
  const left = ledgerRemaining(action.craftBudget);
  return {
    remainingNum: left.num,
    remainingDen: left.den,
  };
}
