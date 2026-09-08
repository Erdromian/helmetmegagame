"use client";

import { useMemo, useState, useTransition } from "react";
import TagChip from "./TagChip";
import TagPointsValue from "./TagPointsValue";
import EquipmentPanel from "./EquipmentPanel";
import Modal from "./Modal";
import StorePanel from "./StorePanel";
import IdentityDialog from "./IdentityDialog";
import { consumeTagRequest } from "../(app)/character/requestActions";

// The Tags section of a character sheet. It's a client component for one
// reason: the Consume button inside a consumable tag's tooltip spends it on
// the spot — one click, no dialog, and nothing said about what it leaves
// behind. The Mulligan Potion is the single exception: it needs a name typed
// into it, so it opens IdentityDialog instead (CHARACTERS.md §1b).
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
  // The mid-game store's catalog and this character's standing within it —
  // undefined for a viewer looking at someone else's sheet (mode !== "self"),
  // which is also why the button below only ever renders for isSelf.
  storeTags = null,
  storeHeldTags = null,
  storeRoleSlug = null,
  // GameState.nukeArmedTurn, for the one chip that shows it (TagChip.js).
  nukeArmedTurn = null,
  // The Mulligan Potion this character holds, if any, and the name parts that
  // seed its dialog — resolved in character/page.js so no slug matching
  // reaches the browser. Null with no bottle held.
  identity = null,
}) {
  const [storeOpen, setStoreOpen] = useState(false);

  const tagGroups = useMemo(() => groupTagsByCategory(characterTags), [characterTags]);
  const [identityOpen, setIdentityOpen] = useState(false);
  // Which tag is mid-consume, and what went wrong with the last one. Keyed by
  // tag id rather than a single flag so two quick clicks on two different
  // chips can't blame each other's error on the wrong tooltip.
  const [busyTagId, setBusyTagId] = useState(null);
  const [consumeError, setConsumeError] = useState(null);
  const [, startConsume] = useTransition();

  // Straight to the server, no confirm and no dialog: a consumable is one
  // click. The action revalidates the page, so the chip disappears on its own.
  function consume(tagId) {
    setConsumeError(null);
    setBusyTagId(tagId);
    startConsume(async () => {
      const res = await consumeTagRequest({ tagId });
      setBusyTagId(null);
      if (!res?.ok) setConsumeError({ tagId, message: res?.error ?? "Something went wrong." });
    });
  }

  // One category's chips. /ledger draws rows instead (TagRail.js); this is
  // /character's only shape now.
  function chipList(tags) {
    return (
      <ul className="flex flex-wrap gap-2">
        {tags.map((ct) => {
          // Only your own consumables are clickable — someone else's
          // sheet stays a read-only hover tooltip.
          const clickable = isSelf && ct.tag.consumable;
          // The bottle asks for a name instead of going down.
          const isPotion = clickable && ct.tag.id === identity?.tagId;
          return (
            <li key={ct.tag.id}>
              <TagChip
                tag={ct.tag}
                quantity={ct.quantity}
                onConsume={
                  clickable
                    ? () => (isPotion ? setIdentityOpen(true) : consume(ct.tag.id))
                    : null
                }
                consumeBusy={busyTagId === ct.tag.id}
                consumeError={
                  consumeError?.tagId === ct.tag.id ? consumeError.message : null
                }
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

  // The store, a modal hanging off the header beside the points it spends.
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

  // Mounted only while open, so the fields seed from the name the character
  // wears right now rather than from whatever it was when the page loaded.
  const identityDialog = isSelf && identity && identityOpen && (
    <IdentityDialog identity={identity} open onClose={() => setIdentityOpen(false)} />
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

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-title">Tags</h2>
          {pointsControl}
        </div>
      </div>

      <div className="mb-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <EquipmentPanel characterTags={characterTags} isSelf={isSelf} />
      </div>

      {store}
      {identityDialog}

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
