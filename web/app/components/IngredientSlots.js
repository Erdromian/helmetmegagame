"use client";

import ChipPicker from "./ChipPicker";

// The cooking bench (docs/systemdocs/COOKING.md): the ordered ingredient
// slots a meal recipe takes, over the pantry of everything you are carrying
// that can go in one.
//
// The SLOTS are what this file is for. The pantry under them is ChipPicker's
// row, borrowed rather than re-typed — a chip is a chip, and the one thing
// this needed that it did not have (more than one live answer at a time) is
// now a per-option `active`. What ChipPicker cannot be is the slots
// themselves: it is a single-value picker, and these are ordered positions
// that mean different things (a Lavish Meal requires its first and offers its
// second).
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
}) {
  const picked = Array.isArray(value) ? value : [];
  const bySlug = new Map(options.map((o) => [o.slug, o]));
  const full = picked.length >= max;

  return (
    <>
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
                <span className="slot-tag">{required ? "Needed" : "Optional"}</span>
                <span className="slot-empty">—</span>
              </div>
            );
          }
          return (
            <div key={i} className="slot" data-filled="true">
              <button
                type="button"
                className="slot-clear"
                onClick={() => onChange(picked.filter((_, n) => n !== i))}
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

      {/* Bounded, because ChipPicker's own header is right that two hundred
          chips is worse than a dropdown: 58 tags in the catalog carry a
          `cooked` block, and a hoarder can be holding a lot of them. The row
          scrolls inside its own box rather than pushing the slots and the
          Craft button off the bottom of the modal. */}
      <div className="pantry">
      <ChipPicker
        options={options.map((o) => ({
          id: o.slug,
          label: o.name,
          note: `×${o.held}`,
          // Slotted chips read as chosen AND refuse a second click; a stack
          // too short for the batch, or a full set of slots, only refuses.
          active: picked.includes(o.slug),
          disabled: picked.includes(o.slug) || o.held < quantity || full,
        }))}
        value=""
        onChange={(slug) => {
          if (slug && !full && !picked.includes(slug)) onChange([...picked, slug]);
        }}
        emptyLabel="You don't have any ingredients."
      />
      </div>
    </>
  );
}
