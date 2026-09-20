// The merchant's cut. A craft sold to the Merchant is assumed to leave the maker with half of what it
// earns over its cost, and never less than a coin lost to the Merchant on a sale that earns anything
// (Bascinet, 2026-09-20). It is per item: a recipe that makes two sells two things and pays the cut twice.
// It never takes more than the profit, and a craft that loses money pays no cut.
//
// Selling to another player is not sold through the Merchant, so a maker can beat this figure by finding
// a buyer; the report shows both the profit before the cut ("raw") and after it.

const MERCHANT_CUT = { share: 0.5, min: 1 };

function cutOn(profitPerItem) {
  const p = profitPerItem;
  if (!(p > 0)) return 0;
  return Math.min(p, Math.max(MERCHANT_CUT.min, MERCHANT_CUT.share * p));
}

// What is left of a profit per item after the cut.
const afterCut = (p) => p - cutOn(p);

module.exports = { MERCHANT_CUT, cutOn, afterCut };
