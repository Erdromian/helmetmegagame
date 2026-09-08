"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import FormError from "@/app/components/FormError";
import { ChevronDownIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { placePanel } from "@/app/components/portalPlacement";
import { toggleEquip } from "@/app/(app)/character/equipActions";
import { myThings } from "./actions";

// THINGS: what is in your pockets, in the column, so the four things a player
// does to an item all day are not a trip to the sheet and back.
//
// Every chip opens the SAME dialog the sheet opens — Use is the sheet's
// Consume, Give is its Transfer, Destroy is its Destroy — through
// RequestActionsProvider with the item already picked. Equip is the sheet's
// own instant toggle (character/equipActions.js), which writes no request and
// no audit row on purpose.
//
// The menu is drawn off the catalog's four flags and nothing else. It never
// says WHY a verb is missing, because the absence is a fact about the item and
// not about the world, and every one of them is re-checked server-side.
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

// Escapes the menu to document.body, same reasoning and math as
// HoverCard.js (portalPlacement.js): an in-tree .chat-menu is positioned
// relative to its chip, and on a narrow viewport the drawer opens inside
// Chat.js's "⋯" sheet — a scrolling Modal — which clipped or buried it
// instead of showing it. Fixed positioning computed from the trigger's own
// rect, escaped to the body, sidesteps that regardless of which scrolling or
// stacking ancestor the chip happens to sit under.
//
// Not HoverCard itself: the trigger here is already a plain button with its
// own click handler (toggling which row is open, one at a time), which
// doesn't fit HoverCard's hover-preview-then-pin model — this only ever
// opens on click and only ever one at a time, exactly as before.
function ThingMenuPortal({ triggerRef, onClose, ariaLabel, children }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    setPos(placePanel(trigger, panel));
  }, [triggerRef]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    const onScrollOrResize = () => place();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    // Checked against the portal's own panel, not just the trigger, so a
    // click on a menu item still fires — a plain onBlur on an ancestor
    // wrapper (the old approach) closes the menu before that click lands,
    // since the portaled panel is no longer a DOM descendant of it.
    const onPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [place, onClose, triggerRef]);

  return createPortal(
    <div
      ref={panelRef}
      className="chat-menu chat-menu-portal"
      role="menu"
      aria-label={ariaLabel}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

// Just the buttons now — ThingMenuPortal above owns the .chat-menu box
// itself, so wrapping them in a second one here would double it up.
function ThingMenu({ row, onClose, onEquip, pending }) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;

  const pick = useCallback(
    (mode) => {
      onClose();
      open?.(mode, row.tagId);
    },
    [open, onClose, row.tagId],
  );

  return (
    <>
      {row.equippable && (
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
          {row.equipped ? "Unequip" : "Equip"}
        </button>
      )}
      {row.consumable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("consume")}>
          Use
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
function ThingChip({ row, isOpen, onToggle, onClose, onEquip, pending }) {
  const triggerRef = useRef(null);
  return (
    <span className="chat-thing-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="chip"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-active={row.equipped ? "true" : undefined}
        onClick={onToggle}
      >
        {row.name}
        {row.quantity > 1 ? ` ×${row.quantity}` : ""}
        {/* What is out and in hand, rather than in a pocket. */}
        {row.equipped ? " ·" : ""}
        {/* The doctor's-eye read (M4 fix round), same gate and same wording
            as the sheet's own TagChip. */}
        {row.poisonMarker ? <span className="text-muted"> · smells wrong ‡</span> : null}
      </button>
      {isOpen && (
        <ThingMenuPortal triggerRef={triggerRef} onClose={onClose} ariaLabel={row.name}>
          <ThingMenu row={row} onClose={onClose} onEquip={onEquip} pending={pending} />
        </ThingMenuPortal>
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
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  // Equipping is instant and answers { equipped } or { error } rather than the
  // { ok } shape useActionRunner reads, so it is run here.
  const equip = useCallback(
    (row) => {
      if (!row.characterTagId) return;
      setError(null);
      startTransition(async () => {
        try {
          const res = await toggleEquip(row.characterTagId);
          if (res?.error) setError(res.error);
          else refresh();
        } catch {
          setError("Could not reach the server. Nothing was changed. ‡");
        }
      });
    },
    [refresh],
  );

  return (
    <div className="chat-details chat-things">
      <button type="button" className="chat-details-summary" aria-expanded={open} onClick={toggle}>
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
                      pending={pending}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          <FormError>{error}</FormError>
        </div>
      )}
    </div>
  );
}
