"use client";

import { useMemo, useState } from "react";
import TagChip from "./TagChip";
import TagPointsValue from "./TagPointsValue";
import { useRequestActions } from "./RequestActionsProvider";
import EquipmentPanel from "./EquipmentPanel";
import Modal from "./Modal";
import StorePanel from "./StorePanel";
import { useTags } from "./TagsProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";

// The Tags section of a character sheet. It's a client component for one
// reason: clicking a consumable chip opens the Consume dialog already pointed
// at that tag, via RequestActionsProvider's context.
//
// Equipment lives here too, as an embedded EquipmentPanel sub-section —
// equipped items are just a view over the same held-tags data this panel
// already renders, so a standalone Equipment card was one more scroll stop
// for no new information. "Spend Tag Points" (StorePanel inside a Modal)
// sits in this header next to the Tag Points readout it spends, rather than
// as its own nav destination.

// Fixed display order rather than alphabetical or catalog order — Status
// (needs, buffs/debuffs) and Health (whatever is currently wrong with you)
// belong near the top, ahead of General/Skills.
const CATEGORY_ORDER = [
  "Meta",
  "Status",
  "Health",
  "General",
  "Skills",
  "Items",
  "Assets",
  "Demoness",
];

function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Groups the CharacterTag rows, not the bare Tags — the wrapper carries
// expiresTurn and quantity, which the chip and its countdown need.
function groupTagsByCategory(characterTags) {
  const groups = new Map();
  for (const ct of characterTags) {
    const raw = ct.tag.category?.trim() || "Other";
    // Case-folded, because the catalog holds both "Items" and "items" and two
    // cards headed the same word is a bug on sight. The spelling shown is
    // CATEGORY_ORDER's where there is one, so the fix does not depend on which
    // tag happened to be read first.
    const category = CATEGORY_ORDER.find((c) => c.toLowerCase() === raw.toLowerCase()) ?? raw;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(ct);
  }
  return [...groups.entries()].sort(
    (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]),
  );
}

// The catalog, resources, co-located rosters and heal targets all moved to
// RequestActionsProvider with the dialogs that used them — this panel only
// ever renders what the character already holds.
export default function TagsPanel({
  characterTags,
  isSelf,
  currentTurn = null,
  tagPoints = null,
  equipSlots = 6,
  // The mid-game store's catalog and this character's standing within it —
  // undefined for a viewer looking at someone else's sheet (mode !== "self"),
  // which is also why the button below only ever renders for isSelf.
  storeTags = null,
  storeHeldTags = null,
  storeRoleSlug = null,
  // GameState.nukeArmedTurn, for the one chip that shows it (TagChip.js).
  nukeArmedTurn = null,
  // "sheet" is /character: one card, every category inside it, the equipped
  // rack at the top. "rail" is /ledger's right column: one card per category
  // and no rack, because that sheet mounts the equipment in its middle
  // column instead. Same chips, same store, same click behaviour either way.
  variant = "sheet",
  showEquipment = true,
}) {
  // Null on someone else's sheet, where no provider is mounted — which is
  // also exactly when the chips must stay read-only.
  const openDialog = useRequestActions()?.open ?? null;
  const [storeOpen, setStoreOpen] = useState(false);

  const { tagsBySlug } = useTags();
  const tagGroups = useMemo(() => groupTagsByCategory(characterTags), [characterTags]);
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // Tag.consumesInto carries slugs; the app-wide catalog turns them into
  // names. It arrives via fetch, so fall back to the raw slug meanwhile.
  // Resolved against what this character holds, since a grant can be
  // conditional (Fine Meal cheers everyone but a noble) — promising a tag the
  // grant won't deliver would be worse than saying nothing. A
  // consumesIntoOneOf position (Skinned Cave Rat) is rendered as "A or B"
  // rather than rolled — resolveConsumeGrants commits to a real pick, and
  // this hint must not re-roll on every hover.
  function consumeHintFor(tag) {
    const names = (tag?.consumesInto ?? [])
      .map((slug, i) => {
        const blockers = tag?.consumesIntoUnless?.[slug] ?? null;
        if (blockers?.some((b) => heldSlugs.has(b))) return null;
        const alternatives = tag?.consumesIntoOneOf?.[i];
        return Array.isArray(alternatives)
          ? alternatives.map((s) => tagsBySlug.get(s)?.name ?? s).join(" or ")
          : (tagsBySlug.get(slug)?.name ?? slug);
      })
      .filter(Boolean);
    return names.length ? `Click to consume → ${names.join(", ")}` : "Click to consume";
  }

  // One category's chips. Shared by both layouts below so a chip behaves the
  // same wherever it is drawn — the only difference between the two is the
  // frame around the list.
  function chipList(tags) {
    return (
      <ul className="flex flex-wrap gap-2">
        {tags.map((ct) => {
          // Only your own consumables are clickable — someone else's
          // sheet stays a read-only hover tooltip.
          const clickable = isSelf && ct.tag.consumable && openDialog;
          return (
            <li key={ct.tag.id}>
              <TagChip
                tag={ct.tag}
                quantity={ct.quantity}
                onConsume={clickable ? () => openDialog("consume", ct.tag.id) : null}
                consumeHint={clickable ? consumeHintFor(ct.tag) : null}
                expiresTurn={ct.expiresTurn}
                currentTurn={currentTurn}
                armedTurn={ct.tag.slug === "nuclear-device" ? nukeArmedTurn : null}
              />
            </li>
          );
        })}
      </ul>
    );
  }

  // The store, mounted once whichever layout is drawing. It is a modal, so it
  // does not care which frame it hangs off.
  const store = isSelf && storeTags && (
    <Modal
      open={storeOpen}
      onClose={() => setStoreOpen(false)}
      title="Spend Tag Points"
      width="widest"
    >
      <StorePanel
        tags={storeTags}
        budget={tagPoints ?? 0}
        heldTags={storeHeldTags ?? []}
        roleSlug={storeRoleSlug}
        onDone={() => setStoreOpen(false)}
      />
    </Modal>
  );

  const pointsControl =
    tagPoints != null &&
    (isSelf && storeTags ? (
      <button type="button" className="btn-quiet" onClick={() => setStoreOpen(true)}>
        Spend Tag Points (<TagPointsValue points={tagPoints} />)
      </button>
    ) : (
      <span className="text-sm">
        <span className="text-muted">Tag points </span>
        <TagPointsValue points={tagPoints} />
      </span>
    ));

  // The rail layout (/ledger): one card per category down a narrow column,
  // instead of one card holding every category. The chips and the store are
  // the same; only the frame differs.
  if (variant === "rail") {
    return (
      <>
        {pointsControl && (
          <section className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">Tags</h2>
              {pointsControl}
            </div>
          </section>
        )}
        {store}
        {tagGroups.length === 0 ? (
          <section className="panel p-4">
            <p className="text-sm text-muted">No tags yet.</p>
          </section>
        ) : (
          tagGroups.map(([category, tags]) => (
            <section key={category} className="panel p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="section-title">{category}</h2>
                <span className="mono text-sm text-muted">{tags.length}</span>
              </div>
              {chipList(tags)}
            </section>
          ))
        )}
      </>
    );
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-title">Tags</h2>
          {pointsControl}
        </div>
      </div>

      {showEquipment && (
        <div className="mb-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <EquipmentPanel
            characterTags={characterTags}
            slots={equipSlots}
            isSelf={isSelf}
            embedded
          />
        </div>
      )}

      {store}

      {tagGroups.length === 0 ? (
        <p className="text-sm text-muted">No tags yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tagGroups.map(([category, tags]) => (
            <div key={category}>
              <p className="field-label mb-1">{category}</p>
              {chipList(tags)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
