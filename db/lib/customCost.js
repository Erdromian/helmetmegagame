// What a craft costs in ⬢ once the maker's own words are on it: the recipe's own cost for every unit, plus the naming
// surcharge. The surcharge is normally charged PER UNIT (a named dagger is +1 ⬢), but a recipe may charge it PER BATCH
// instead (`custom: { perBatch: true }` in docs/tags.yaml, Tag.customPerBatch): once for the whole craft action however
// many units come out of it, which is what a cook naming a batch of twenty dishes wants. One function, read by the dialog
// and by the server action, so the ⬢ shown is always the ⬢ billed.
//
// ZERO DEPENDENCIES, and it must stay that way — CraftDialog.js imports this through web/lib/customCraft.js; anything
// required here gets dragged into the browser bundle.

function craftResourceCost({ resources = 0, surcharge = 0, perBatch = false, quantity = 1 } = {}) {
  const units = Math.max(0, Math.floor(Number(quantity) || 0));
  const own = (Number(resources) || 0) * units;
  if (!(surcharge > 0) || units === 0) return own;
  return own + (perBatch ? surcharge : surcharge * units);
}

module.exports = { craftResourceCost };
