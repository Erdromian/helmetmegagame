"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import ClickMenu from "@/app/components/ClickMenu";
import FormError from "@/app/components/FormError";
import HoverCard from "@/app/components/HoverCard";
import ChipLabel from "@/app/components/ChipLabel";
import TagDetails from "@/app/components/TagDetails";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { ChevronDownIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import ActionButton from "@/app/components/ActionButton";
import { actionFor, helpFor, labelFor, reasonFor } from "@/app/components/actionRegistry";
import useSoundItem, { soundLabel } from "@/app/components/useSoundItem";
import { equipOne, unequipOne } from "@/app/(app)/character/equipActions";
import { myThings } from "./actions";
import useVisiblePoll from "./useVisiblePoll";
import { playSfx } from "@/app/components/sfx";
import { actionThrowMessage } from "@/app/components/actionThrow";

// THINGS: what is in your pockets, in the column, so the four things a player
// does to an item all day are not a trip to the sheet and back.
//
// Every chip opens the SAME dialog the sheet opens — Consume is the sheet's
// Consume, Give is its Transfer, Destroy is its Destroy — through
// RequestActionsProvider with the item already picked. Equip is the sheet's
// own instant toggle (character/equipActions.js), which writes no request and
// no audit row on purpose.
//
// The menu is drawn off the catalog's four flags, plus the item's own verbs
// from db/lib/itemVerbs.js (Play Instrument on a lute, Detonate on a remote).
// The four never say WHY they are missing, because the absence is a fact about
// the item and not about the world; an item verb greys with the registry's own
// reason. Every one is re-checked server-side.
//
// Closed by default, and it stays however this browser left it, in
// localStorage.

const KEY = "chat-things-open";
const POLL_MS = 60_000;

function subscribe(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function readServer() {
  return false;
}

function write(open) {
  try {
    window.localStorage.setItem(KEY, open ? "1" : "0");
    // The storage event never fires in the tab that wrote it.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}

// Just the buttons — ClickMenu owns the .chat-menu box itself, so wrapping
// them in a second one here would double it up.
//
// A slot holds one physical item, so a partly-equipped stack (2 of 5 swords
// out) can offer BOTH verbs at once — Equip pulls one more from reserve,
// Unequip puts one back — rather than one toggle that can only mean one of
// them.
// The item's OWN verbs (db/lib/itemVerbs.js, resolved server-side into
// row.itemVerbs) come first, drawn the way HereList.js's PersonMenu draws the
// registry: its `show` hides, its `gate` greys with the registry's reason. The
// Trumpet and the Horn are not registry modes and sound through onSound.
function ItemVerbs({ row, pools, onPick, onSound, soundPending }) {
  return row.itemVerbs.map((mode) => {
    const local = soundLabel(mode);
    if (local) {
      return <ActionButton key={mode} variant="menu" label={local} busy={soundPending} onClick={() => onSound(mode)} />;
    }
    const action = actionFor(mode);
    if (!action) return null;
    if (action.show && !pools?.[action.show]) return null;
    return (
      <ActionButton
        key={mode}
        variant="menu"
        label={labelFor(action, pools)}
        help={helpFor(action, pools)}
        disabled={action.gate ? !pools?.[action.gate] : false}
        reason={reasonFor(action, pools)}
        onClick={() => onPick(mode)}
      />
    );
  });
}

function ThingMenu({ row, onClose, onEquip, onUnequip, onSound, soundPending, pending }) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;
  const pools = actions?.pools ?? null;

  const pick = useCallback(
    (mode) => {
      onClose();
      open?.(mode, row.tagId);
    },
    [open, onClose, row.tagId],
  );

  return (
    <>
      {row.itemVerbs?.length > 0 && (
        <ItemVerbs
          row={row}
          pools={pools}
          onPick={pick}
          onSound={(kind) => {
            onClose();
            onSound(kind);
          }}
          soundPending={soundPending}
        />
      )}
      {row.equippable && row.equippableRemaining > 0 && (
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          disabled={pending}
          onClick={() => {
            onClose();
            onEquip(row);
          }}
        >
          Equip
        </button>
      )}
      {row.equippable && row.equippedQuantity > 0 && (
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          disabled={pending}
          onClick={() => {
            onClose();
            onUnequip(row);
          }}
        >
          Unequip
        </button>
      )}
      {row.consumable && (
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => pick(row.poison ? "poison" : "consume")}
        >
          {row.poison ? "Poison" : "Consume"}
        </button>
      )}
      {row.tradeable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("transfer")}>
          Give
        </button>
      )}
      {row.removable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("destroy")}>
          Destroy
        </button>
      )}
    </>
  );
}

// One chip and its (portaled) menu. A component of its own so each row gets
// its own triggerRef — hooks can't be called per-iteration inside the .map()
// above it.
function ThingChip({ row, isOpen, onToggle, onClose, onEquip, onUnequip, onSound, soundPending, pending }) {
  const triggerRef = useRef(null);
  const touch = useIsCoarsePointer();
  return (
    <span className="chat-thing-wrap">
      {/* The app's REAL tag chip on hover, the same as the floor's chips
          (RoomPanel.js) — "Wolfsbane" says nothing about what drinking it
          does, and a letter in a pocket should show what it says. The panel is
          dropped while the action menu is open: the two are portaled to the
          same corner of the same chip, and both at once is a pile.
          pinnable={false} because the chip's click already owns that menu,
          which is also why the face is ChipLabel as="button" rather than a
          TagChip — a span inside the button would nest two .chip boxes. */}
      <HoverCard
        pinnable={false}
        panel={
          isOpen ? null : (
            <TagDetails tag={row.tag} quantity={row.quantity} poisonMarker={row.poisonMarker} />
          )
        }
      >
        <ChipLabel
          as="button"
          ref={triggerRef}
          type="button"
          tag={row.tag}
          quantity={row.quantity}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-active={row.equipped ? "true" : undefined}
          onClick={onToggle}
        >
          {/* What is out and in hand, rather than in a pocket. */}
          {row.equipped ? " ·" : ""}
          {/* The doctor's-eye read (M4 fix round), same gate and same wording
              as the sheet's own TagChip. */}
          {row.poisonMarker ? <span className="text-muted"> · smells wrong</span> : null}
        </ChipLabel>
      </HoverCard>
      {isOpen && (
        <ClickMenu triggerRef={triggerRef} onClose={onClose} ariaLabel={row.tag.name}>
          {/* A touch screen has no hover, so the details above could never
              open there. The tap that opens this menu is the one moment the
              player is looking at the item, so they ride at its top. */}
          {touch && (
            <div className="chat-menu-details">
              <TagDetails tag={row.tag} quantity={row.quantity} poisonMarker={row.poisonMarker} />
            </div>
          )}
          <ThingMenu
            row={row}
            onClose={onClose}
            onEquip={onEquip}
            onUnequip={onUnequip}
            onSound={onSound}
            soundPending={soundPending}
            pending={pending}
          />
        </ClickMenu>
      )}
    </span>
  );
}

export default function Things({ groups: initialGroups = [] }) {
  const open = useSyncExternalStore(subscribe, read, readServer);
  const [groups, setGroups] = useState(initialGroups);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { sound, pending: soundPending, error: soundError } = useSoundItem();

  const toggle = useCallback(() => write(!read()), []);
  const close = useCallback(() => setOpenId(null), []);

  const refresh = useCallback(() => {
    myThings()
      .then((res) => {
        if (res?.ok) setGroups(res.groups);
      })
      .catch(() => {
        // A missed read costs one stale minute. The next one fixes it.
      });
  }, []);

  // The same minute the rest of the column runs on, and only while the drawer
  // is open — a closed one is not worth a query a minute.
  useVisiblePoll(refresh, POLL_MS, { enabled: open });

  // Equipping is instant and answers { equipped } or { error } rather than the
  // { ok } shape useActionRunner reads, so it is run here. Each call moves
  // exactly one unit — a slot holds one physical item, so pulling all of a
  // stack out is one tap per unit, same as the sheet's own rack.
  const equip = useCallback(
    (row) => {
      if (!row.characterTagId) return;
      setError(null);
      startTransition(async () => {
        try {
          const res = await equipOne(row.characterTagId);
          playSfx(res?.error ? "refuse" : res?.sfx);
          if (res?.error) setError(res.error);
          else refresh();
        } catch (err) {
          setError(actionThrowMessage(err));
        }
      });
    },
    [refresh],
  );

  const unequip = useCallback(
    (row) => {
      if (!row.characterTagId) return;
      setError(null);
      startTransition(async () => {
        try {
          const res = await unequipOne(row.characterTagId);
          if (res?.error) playSfx("refuse");
          if (res?.error) setError(res.error);
          else refresh();
        } catch (err) {
          setError(actionThrowMessage(err));
        }
      });
    },
    [refresh],
  );

  return (
    <div className="chat-details chat-things">
      <button type="button" className="chat-details-fold" aria-expanded={open} onClick={toggle}>
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        Things
      </button>
      {open && (
        <div className="chat-details-body">
          {groups.length === 0 ? (
            <p className="chat-quiet-line">Your pockets are empty.</p>
          ) : (
            groups.map((group) => (
              <div key={group.category}>
                <p className="chat-quiet-line">{group.category}</p>
                <div className="chat-chips">
                  {group.rows.map((row) => (
                    <ThingChip
                      key={row.characterTagId ?? row.tagId}
                      row={row}
                      isOpen={openId === row.tagId}
                      onToggle={() => setOpenId(openId === row.tagId ? null : row.tagId)}
                      onClose={close}
                      onEquip={equip}
                      onUnequip={unequip}
                      onSound={sound}
                      soundPending={soundPending}
                      pending={pending}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          <FormError>{error ?? soundError}</FormError>
        </div>
      )}
    </div>
  );
}
