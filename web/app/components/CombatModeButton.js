"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AttackIcon } from "./icons";
import { useConfirm } from "./ConfirmProvider";
import FormError from "./FormError";
import { setCombatMode } from "@/app/(app)/chat/actions";
import { LOCKED_ON } from "@lifeweb/db/lib/combatMode";

// Combat mode (docs/systemdocs/COMBAT-MODE.md): the square toggle beside the Move… button, on /chat's
// Turn block and in the sheet's This turn box. It glows red while on (Combat Mode.docx). A bevelled
// button with aria-pressed rather than the Switch every other boolean uses, on purpose: a Switch says
// "flip it back whenever you like", and this one can't come off on the turn it went on, so turning it
// on asks first. `state` is myMove()'s { on, locked, onBlock }, null with no turn open.
//
// It WRAPS the turn card (`children`) rather than sitting under it, because it is sized to the card:
// as large a square as fits to the right of the card's last button, with its foot on the card's
// foot, without touching any line of text — so it never makes the box any taller. It is positioned
// absolutely for that reason, and fitSquare() below does the measuring.

const GAP = 6;
// Below this there is no square worth pressing. It sits under the card instead and makes room.
const MIN = 32;

// Every line of text and every other button in the frame, relative to it — the things the square must
// not cover. Text nodes give one rect per wrapped line, which is what lets it rise beside a short
// last line.
function obstacles(frame, own) {
  const box = frame.getBoundingClientRect();
  const out = [];
  const rel = (r) => ({ left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top });
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (own.contains(node) || !node.textContent.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.width && r.height) out.push(rel(r));
  }
  for (const el of frame.querySelectorAll("button, .btn")) {
    if (own.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push(rel(r));
  }
  return out;
}

// The largest square with its foot on the frame's foot: to the right of the anchor button when there
// is one, else against the right edge. { size, left, top, reserve } — reserve is room the frame must
// add under the card when even MIN does not fit beside it.
function fitSquare(frame, own, reserved) {
  const W = frame.clientWidth;
  const H = frame.clientHeight - reserved;
  const blocks = obstacles(frame, own);
  const buttons = [...frame.querySelectorAll(".chat-buttons .btn")].filter((b) => !own.contains(b));
  const anchor = buttons[buttons.length - 1];
  const fromLeft = anchor ? anchor.getBoundingClientRect().right - frame.getBoundingClientRect().left + GAP : null;

  let size = Math.max(0, Math.min(H, fromLeft == null ? W : W - fromLeft));
  for (let pass = 0; pass < 50; pass += 1) {
    const left = fromLeft ?? W - size;
    const hit = blocks.find(
      (b) => b.right > left + 0.5 && b.left < left + size - 0.5 && b.bottom > H - size + 0.5 && b.top < H - 0.5,
    );
    if (!hit) break;
    // Rise no higher than the thing it hit; against the right edge it may instead get narrower.
    const under = H - hit.bottom - GAP;
    const beside = fromLeft == null ? W - hit.right - GAP : -1;
    const next = Math.floor(Math.max(under, beside));
    if (next >= size) break;
    size = next;
  }
  size = Math.floor(size);
  if (size >= MIN) return { size, left: fromLeft ?? W - size, top: H - size, reserve: 0 };
  return { size: MIN, left: fromLeft != null && fromLeft + MIN <= W ? fromLeft : W - MIN, top: H + GAP, reserve: MIN + GAP };
}

export default function CombatModeButton({ state, onChanged, children }) {
  const confirm = useConfirm();
  const frameRef = useRef(null);
  const buttonRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const shown = Boolean(state);

  // Re-measured whenever the frame changes size or its words change (the countdown, a filed Move).
  // Written straight onto the element, not into state: the size is layout, and a render per resize
  // would be a render per pixel.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const own = buttonRef.current;
    if (!frame || !own) return undefined;
    let reserved = 0;
    let queued = false;
    const place = () => {
      queued = false;
      const fit = fitSquare(frame, own, reserved);
      if (fit.reserve !== reserved) {
        reserved = fit.reserve;
        frame.style.paddingBottom = reserved ? `${reserved}px` : "";
      }
      own.style.width = `${fit.size}px`;
      own.style.height = `${fit.size}px`;
      own.style.left = `${fit.left}px`;
      own.style.top = `${fit.top}px`;
      own.style.visibility = "visible";
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(place);
    };
    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(frame);
    const words = new MutationObserver(schedule);
    words.observe(frame, { childList: true, subtree: true, characterData: true });
    document.fonts?.ready?.then(schedule).catch(() => {});
    return () => {
      resize.disconnect();
      words.disconnect();
      frame.style.paddingBottom = "";
    };
  }, [shown]);

  if (!state) return children;
  const { on, locked, onBlock } = state;
  const stuck = locked ? LOCKED_ON : onBlock;

  async function press() {
    setError(null);
    // Nothing to do, but the reason is printed rather than hidden in a tooltip (SHEET.md §3) — and
    // only now, so the box keeps its height the rest of the time.
    if (stuck) {
      setNote(stuck);
      return;
    }
    setNote(null);
    const want = !on;
    if (want) {
      const ok = await confirm({
        title: "Enter combat mode?",
        message:
          "You can't turn it off until next turn. Each turn you end in combat mode makes you Tired, then Exhausted. You need it to Attack or Intercept.",
        confirmLabel: "Enter combat mode",
        cancelLabel: "Not yet",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await setCombatMode({ on: want });
      if (!res?.ok) setError(res?.error ?? "That didn't work.");
      onChanged?.();
    } catch {
      setError("That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="combat-frame" ref={frameRef}>
        {children}
        <button
          ref={buttonRef}
          type="button"
          className="btn-combat"
          aria-pressed={on}
          aria-disabled={stuck ? "true" : undefined}
          aria-label={`Combat mode: ${on ? "on" : "off"}`}
          disabled={busy}
          onClick={press}
        >
          <AttackIcon aria-hidden="true" />
          <span className="btn-combat-label">Combat mode</span>
          <span className="btn-combat-state">{on ? "On" : "Off"}</span>
        </button>
      </div>
      {/* Only while it is still true: the next turn unlocks it without anyone pressing. */}
      {note && note === stuck && <p className="combat-mode-note text-xs text-muted">{note}</p>}
      <FormError>{error}</FormError>
    </>
  );
}
