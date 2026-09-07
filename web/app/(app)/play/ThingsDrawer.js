"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { ChevronDownIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
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
// Closed by default, and it stays however this browser left it — the same
// localStorage state Yesterday keeps.

const KEY = "hall-things-open";
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
    <div className="hall-menu" role="menu" aria-label={row.name}>
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
          {row.equipped ? "Unequip ‡" : "Equip ‡"}
        </button>
      )}
      {row.consumable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("consume")}>
          Use ‡
        </button>
      )}
      {row.tradeable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("transfer")}>
          Give ‡
        </button>
      )}
      {row.removable && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => pick("destroy")}>
          Destroy ‡
        </button>
      )}
    </div>
  );
}

export default function Things({ groups: initialGroups = [] }) {
  const open = useSyncExternalStore(subscribe, read, readServer);
  const [groups, setGroups] = useState(initialGroups);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef(null);

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
    <div className="hall-details hall-things" ref={wrapRef} onBlur={(event) => {
      if (!wrapRef.current?.contains(event.relatedTarget)) close();
    }}>
      <button type="button" className="hall-details-summary" aria-expanded={open} onClick={toggle}>
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        Things ‡
      </button>
      {open && (
        <div className="hall-details-body">
          {groups.length === 0 ? (
            <p className="hall-quiet-line">Your pockets are empty. ‡</p>
          ) : (
            groups.map((group) => (
              <div key={group.category}>
                <p className="hall-quiet-line">{group.category} ‡</p>
                <div className="hall-chips">
                  {group.rows.map((row) => (
                    <span key={row.characterTagId ?? row.tagId} className="hall-thing-wrap">
                      <button
                        type="button"
                        className="chip"
                        aria-haspopup="menu"
                        aria-expanded={openId === row.tagId}
                        data-active={row.equipped ? "true" : undefined}
                        onClick={() => setOpenId(openId === row.tagId ? null : row.tagId)}
                      >
                        {row.name}
                        {row.quantity > 1 ? ` ×${row.quantity}` : ""}
                        {/* What is out and in hand, rather than in a pocket. */}
                        {row.equipped ? " ·" : ""}
                        {/* The doctor's-eye read (M4 fix round), same gate and
                            same wording as the sheet's own TagChip. */}
                        {row.poisonMarker ? <span className="text-muted"> · smells wrong ‡</span> : null}
                      </button>
                      {openId === row.tagId && (
                        <ThingMenu row={row} onClose={close} onEquip={equip} pending={pending} />
                      )}
                    </span>
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
