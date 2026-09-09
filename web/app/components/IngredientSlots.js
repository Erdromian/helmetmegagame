"use client";

// The cooking bench (docs/systemdocs/COOKING.md): the ordered ingredient
// slots a meal recipe takes, over the pantry of everything you are carrying
// that can go in one.
//
// NOT an extension of ChipPicker.js, though it wears the same .chip-row.
// That one is a SINGLE value picker — `onChange(active ? "" : id)`, one
// answer, toggled — and this is an ordered multi-slot where the same list can
// fill two positions and the positions mean different things (a Lavish Meal
// requires its first and offers its second). Reusing it would have meant
// bending "one value" into "an array" at every call site.
//
// What the cook is told is the TASTE and nothing else. No mood figure, no
// effect list, no hint that the thing they are about to serve will make
// somebody vomit. That is Bascinet's call (2026-09-09) and it is enforced a
// layer down too: web/lib/referenceData.js#cookedTasteOnly cuts the block to
// its taste before it ever reaches a browser, so there is nothing here to
// leak even by accident.
//
// A greyed chip is a hint — every slot is re-checked server-side by
// resolveIngredientSlots, which owns membership, possession and the count.

export default function IngredientSlots({
  min = 0,
  max = 1,
  // [{ slug, name, taste, held }] — everything the cook is carrying that
  // carries a `cooked` block, already narrowed by the caller.
  options = [],
  // The slugs slotted so far, in order.
  value = [],
  onChange,
  // How many of each the batch will spend, so a stack of one cannot fill two
  // meals' worth of a slot.
  quantity = 1,
  disabled = false,
  emptyLabel = "You have nothing to cook with. ‡",
}) {
  const picked = Array.isArray(value) ? value : [];
  const bySlug = new Map(options.map((o) => [o.slug, o]));
  const full = picked.length >= max;

  const add = (slug) => {
    if (disabled || full || picked.includes(slug)) return;
    onChange([...picked, slug]);
  };
  const clear = (index) => {
    if (disabled) return;
    onChange(picked.filter((_, i) => i !== index));
  };

  return (
    <div className="field">
      <div className="slot-row">
        {Array.from({ length: max }, (_, i) => {
          const slug = picked[i];
          const ing = slug ? bySlug.get(slug) : null;
          const required = i < min;
          if (!ing) {
            return (
              <div
                key={i}
                className="slot"
                data-required={required ? "true" : undefined}
                // The first empty slot is where the next chip lands, so it
                // says so rather than leaving the cook to guess which of two
                // identical boxes is next.
                data-next={i === picked.length ? "true" : undefined}
              >
                <span className="slot-tag">{required ? "Needed ‡" : "Optional ‡"}</span>
                <span className="slot-empty">—</span>
              </div>
            );
          }
          return (
            <div key={i} className="slot" data-filled="true">
              <button
                type="button"
                className="slot-clear"
                onClick={() => clear(i)}
                disabled={disabled}
                aria-label={`Take out ${ing.name}`}
              >
                ✕
              </button>
              <span className="slot-tag">{ing.name}</span>
              {ing.taste ? <span className="slot-taste">{ing.taste}</span> : null}
            </div>
          );
        })}
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="chip-row" role="group" aria-label="What you can cook with">
          {options.map((o) => {
            const slotted = picked.includes(o.slug);
            // A stack of two cannot fill a slot on a batch of three. The
            // server prices this again; here it just stops the click.
            const short = o.held < quantity;
            return (
              <button
                key={o.slug}
                type="button"
                className="chip"
                data-active={slotted ? "true" : undefined}
                aria-pressed={slotted}
                disabled={disabled || slotted || short || full}
                onClick={() => add(o.slug)}
              >
                {o.name}
                <span className="chip-note mono">×{o.held}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
