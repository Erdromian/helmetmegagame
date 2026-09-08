"use client";

import Tooltip from "./Tooltip";
import FormError from "@/app/components/FormError";
import { useState, useTransition } from "react";
import ChipLabel from "./ChipLabel";
import { equipOne, unequipOne } from "@/app/(app)/character/equipActions";

// Click-to-toggle rather than drag-and-drop. Drag needs a touch fallback on
// phones anyway, and that fallback is exactly this — so building it alone
// costs a fraction of the code, works on every input, and is keyboard
// accessible for free.
//
// This is its own surface rather than an affordance on TagChip because
// TagChip's click already opens the Consume dialog (see TagsPanel.js);
// overloading it would make a consumable-and-equippable tag ambiguous.
//
// `embedded` renders this as a sub-section of TagsPanel.js instead of its own
// `.panel` card — the equipped rack is just a view over the same held-tags
// data the Tags panel already has, so it earns a heading, not a whole card.
// The equip/unequip interaction underneath is unchanged either way.
//
// A slot holds ONE physical item. A stackable tag's own `quantity` is not
// what fills the rack — `equippedQuantity` is, and it can be less than
// `quantity` (some of the stack still in reserve) or up to all of it (five
// swords equipped is five slots, one per sword). So the rack is built by
// expanding each equippable row into `equippedQuantity` separate boxes —
// every box acting on the SAME underlying row, since units of a stack are
// fungible and unequipping "this one" vs "that one" means nothing.
export default function EquipmentPanel({ characterTags, slots = 6, isSelf, embedded = false }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const equippable = characterTags.filter((ct) => ct.tag.equippable);
  const equippedSlots = equippable.flatMap((ct) =>
    Array.from({ length: ct.equippedQuantity ?? 0 }, () => ct),
  );
  // What's left of a stack once its equipped units are spoken for — an
  // ordinary equipped tag (quantity 1) drops out entirely, same as before.
  const available = equippable
    .map((ct) => ({ ct, remaining: (ct.quantity ?? 1) - (ct.equippedQuantity ?? 0) }))
    .filter(({ remaining }) => remaining > 0);
  const full = equippedSlots.length >= slots;

  function equip(characterTagId) {
    setError(null);
    startTransition(async () => {
      const result = await equipOne(characterTagId);
      if (result?.error) setError(result.error);
    });
  }

  function unequip(characterTagId) {
    setError(null);
    startTransition(async () => {
      const result = await unequipOne(characterTagId);
      if (result?.error) setError(result.error);
    });
  }

  const Wrapper = embedded ? "div" : "section";
  const wrapperClassName = embedded ? "" : "panel p-4";

  // Nothing equippable and nothing equipped — say so once rather than
  // rendering an empty rack of slots at someone with no gear.
  if (equippable.length === 0) {
    return (
      <Wrapper className={wrapperClassName}>
        <div className="section-title">
          <h2>Equipped</h2>
          <span className="text-sm text-muted mono">0 / {slots}</span>
        </div>
        <p className="text-sm text-muted">You&apos;re not carrying any equippable items.</p>
      </Wrapper>
    );
  }

  return (
    <Wrapper className={wrapperClassName}>
      {/* .section-title, not .panel-header: the heading is a flex child beside
          the counter, and panel-header's rule would underline just the word. */}
      <div className="section-title">
        <h2>Equipped</h2>
        <span className="text-sm text-muted mono">
          {equippedSlots.length} / {slots}
        </span>
      </div>

      <div className="equip-slots">
        {Array.from({ length: slots }, (_, i) => {
          const ct = equippedSlots[i];
          if (!ct) {
            return <div key={`empty-${i}`} className="equip-slot is-empty" aria-hidden="true" />;
          }
          return (
            <Tooltip key={`${ct.id}-${i}`} text={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}>
              <button
                type="button"
                className="equip-slot"
                onClick={() => isSelf && unequip(ct.id)}
                disabled={!isSelf || pending}
                aria-label={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}
              >
                {/* No quantity here even for a stackable tag — a slot holds ONE
                    equipped item. The reserve count shows in Carrying below,
                    and the full count in the Tags list itself. */}
                <ChipLabel tag={ct.tag} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      {isSelf && available.length > 0 && (
        <>
          <p className="field-label mt-3">Carrying</p>
          <div className="flex flex-wrap gap-2">
            {available.map(({ ct, remaining }) => (
              /* "No free slots" is the ONLY explanation of why this button is
                 dead, and a native title= never fires on a disabled element in
                 several browsers — so the one case that most needed a tooltip
                 was the one case that never showed one. HoverCard wraps the
                 button rather than living on it, so it works regardless. */
              <Tooltip key={ct.id} text={full ? "No free slots" : `Equip ${ct.tag.name}`}>
                <button
                  type="button"
                  className="equip-add"
                  onClick={() => equip(ct.id)}
                  disabled={pending || full}
                  aria-label={`Equip ${ct.tag.name}`}
                >
                  {/* The RESERVE count, not the total — an item with some
                      units already equipped shows only what's left to equip. */}
                  <ChipLabel tag={ct.tag} quantity={remaining} />
                </button>
              </Tooltip>
            ))}
          </div>
          {full && (
            <p className="mt-2 text-sm text-muted">
              All {slots} slots are full — unequip something first.
            </p>
          )}
        </>
      )}

      <FormError>{error}</FormError>
    </Wrapper>
  );
}
