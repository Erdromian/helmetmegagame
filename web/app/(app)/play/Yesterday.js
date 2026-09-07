"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import { describeTurn } from "@/lib/turnFormat";
import { ChevronDownIcon } from "@/app/components/icons";
import { yesterday as loadYesterday } from "./actions";

// What the last close said to you: the GMs' staged messages and the bot's own
// Routine result and Gambit reveal, read back out of DirectMessage. It sends
// nothing and it is not a second inbox — a player who reads their DMs has
// seen all of it already, and a web-only player never would have.
//
// Closed by default, and it stays however this browser left it. The body is
// fetched the first time it is opened, so the block costs nothing on a page
// load nobody opens it on.

const KEY = "hall-yesterday-open";

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

export default function Yesterday() {
  const open = useSyncExternalStore(subscribe, read, readServer);
  const [state, setState] = useState({ loaded: false, turn: null, entries: [] });
  const toggle = useCallback(() => write(!read()), []);

  useEffect(() => {
    if (!open || state.loaded) return;
    let live = true;
    loadYesterday()
      .then((res) => {
        if (!live) return;
        if (res?.ok) setState({ loaded: true, turn: res.turn, entries: res.entries });
        else setState({ loaded: true, turn: null, entries: [] });
      })
      .catch(() => {
        // Nothing to lose: closing and opening it again asks once more.
      });
    return () => {
      live = false;
    };
  }, [open, state.loaded]);

  return (
    <div className="hall-details">
      <button
        type="button"
        className="hall-details-summary"
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        Yesterday
      </button>
      {open && (
        <div className="hall-details-body">
          {state.turn && (
            <p className="hall-quiet-line">{describeTurn(state.turn).label}</p>
          )}
          {!state.loaded ? (
            <p className="hall-quiet-line">Reading…</p>
          ) : state.entries.length === 0 ? (
            <p className="hall-quiet-line">Nothing came back yet.</p>
          ) : (
            state.entries.map((entry) => (
              <div key={entry.id} className="hall-yesterday-row">
                <ChatMarkdown content={entry.content} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
