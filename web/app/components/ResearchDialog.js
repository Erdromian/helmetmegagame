"use client";

import Select from "./Select";

// The body of the Research dialog (docs/systemdocs/CRAFTING.md §2b). State lives in
// RequestActionsProvider like every other mode — this is the form.
//
// One field: which held ingredient to study, off the same picker shape
// CraftDialog's anyOf block uses (`options`, a slug value). Unlike that
// block, this one never renders the empty state — RequestActionsProvider
// only opens this dialog when `canResearch` is already true, which means
// `options.length > 0`.

export default function ResearchDialog({
  options = [],
  ingredientSlug = "",
  onIngredientSlug,
}) {
  return (
    <label className="field">
      <span className="field-label">What will you study?</span>
      <Select
        value={ingredientSlug}
        onChange={(e) => onIngredientSlug(e.target.value)}
        required
      >
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
