"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// The result notice: one line that says what a button just did.
//
// Every player action used to end with the dialog closing and nothing else —
// no "Ada is tied up.", no "Offer sent." A verb that changes something out of
// view read as a dead button. This is the one place a success is spoken, so
// every surface says it the same way: RequestActionsProvider raises one after
// each action, from the sentence the server sent back or the one the client
// composed (actions/noticeLines.js).
//
//   const notice = useNotice();
//   notice("Ada is tied up.");
//   notice({ text: "Your comrades.", rows: [{ name, note, mark }] });
//   notice({ text: res.error, tone: "bad" });
//
// Mounted once in layout.js, like ConfirmProvider. It renders a fixed stack
// (.notice-stack) that is NOT a .modal-overlay — Modal.js#dialogHoldsKeyboard
// counts those, and a notice must never make a desk think a dialog is open.
//
// Timers: a card dismisses itself after `ttl` (twice that when it carries
// rows), and hovering or focusing it holds the clock. State is only ever set
// from a click path or inside a timeout callback — never synchronously in an
// effect, which is an error in this repo.

const NoticeContext = createContext(null);

const DEFAULT_TTL = 6000;
// Past this the stack is a wall; the oldest drops when a new one arrives.
const MAX_CARDS = 3;

export function useNotice() {
  const ctx = useContext(NoticeContext);
  if (!ctx) throw new Error("useNotice must be used within a NoticeProvider");
  return ctx;
}

export default function NoticeProvider({ children }) {
  const [cards, setCards] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const arm = useCallback(
    (card) => {
      const t = timers.current.get(card.id);
      if (t) clearTimeout(t);
      timers.current.set(
        card.id,
        setTimeout(() => dismiss(card.id), card.ttl),
      );
    },
    [dismiss],
  );

  const hold = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notice = useCallback(
    (input) => {
      const opts = typeof input === "string" ? { text: input } : (input ?? {});
      if (!opts.text) return null;
      const id = ++seq.current;
      const card = {
        id,
        text: String(opts.text),
        tone: opts.tone === "bad" ? "bad" : "info",
        rows: Array.isArray(opts.rows) && opts.rows.length ? opts.rows : null,
        ttl: opts.ttl ?? (Array.isArray(opts.rows) && opts.rows.length ? DEFAULT_TTL * 2 : DEFAULT_TTL),
      };
      setCards((prev) => {
        const next = [...prev, card];
        // Drop the oldest past the cap, and its timer with it.
        while (next.length > MAX_CARDS) {
          const gone = next.shift();
          const t = timers.current.get(gone.id);
          if (t) clearTimeout(t);
          timers.current.delete(gone.id);
        }
        return next;
      });
      arm(card);
      return id;
    },
    [arm],
  );

  const value = useMemo(() => notice, [notice]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {/* Always mounted so the live region exists before the first notice —
          a region that appears with its first message is announced by nobody. */}
      <div className="notice-stack" role="status" aria-live="polite" aria-atomic="false">
        {cards.map((card) => (
          <div
            key={card.id}
            className="notice-card"
            data-tone={card.tone}
            onMouseEnter={() => hold(card.id)}
            onMouseLeave={() => arm(card)}
            onFocus={() => hold(card.id)}
            onBlur={() => arm(card)}
            onKeyDown={(e) => {
              if (e.key === "Escape") dismiss(card.id);
            }}
          >
            <div className="notice-body">
              <p className="notice-text">{card.text}</p>
              {card.rows && (
                <ul className="notice-rows">
                  {card.rows.map((row, i) => (
                    <li key={`${row.name}-${i}`}>
                      <span>{row.name}</span>
                      {row.note ? <span className="text-muted"> · {row.note}</span> : null}
                      {row.mark ? <span className="notice-mark"> {row.mark}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="notice-close"
              aria-label="Dismiss"
              onClick={() => dismiss(card.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}
