"use client";

import { useEffect } from "react";

// Puts the page back where it belongs after a phone's keyboard goes away.
// Mounted once in the root layout, renders nothing.
//
// iOS 26 Safari (and every iOS browser, all being WebKit) has a bug: when the
// keyboard comes up, the visible area slides up to keep the focused box in
// view, and when the keyboard goes away it does not always slide back.
// `visualViewport.offsetTop` stays at what it was with the keys up, so the
// whole screen sits shifted. Chat's composer, which is at the foot of the
// screen, stays stuck halfway up it with empty space below, until the player
// happens to scroll. A fixed bottom sheet does the same. Apple has the reports
// (FB19889436); it is still there in the iOS 27 beta.
//
// So once the keyboard has gone, check whether the page is still shifted and
// make it scroll, which makes WebKit work the visible area out again:
//   - on Chat, a GM desk or the map, the document never scrolls (globals.css
//     locks it), so it goes back to the top;
//   - on any other page, it goes back to where the reader already was.
//
// "The keyboard has gone" means nothing that types has focus any more. Moving
// from one box to the next keeps the keyboard up, so the check waits a moment
// after focus leaves a box, and on `visualViewport` resize (the keyboard
// closing makes the visible area taller) it is skipped while a box has focus.
// Android is left alone: there `interactiveWidget: "resizes-content"`
// (layout.js) resizes the page itself, and nothing is left shifted.

const NOT_TYPED = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

// After the keyboard's own closing animation, which is about a quarter second.
const SETTLE_MS = 300;

function typing() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !NOT_TYPED.has(el.type);
}

// The three pages that pin the screen (globals.css, "the document behind those
// three never scrolls").
function pinned() {
  return Boolean(document.querySelector(".chat-shell, .desk-shell, .map-shell"));
}

function settle() {
  const vv = window.visualViewport;
  // Pinch-zoomed in, the visible area is SUPPOSED to sit off the top; the bug
  // is only the unzoomed case.
  if (!vv || typing() || vv.scale > 1.01) return;
  const y = pinned() ? 0 : window.scrollY;
  if (vv.offsetTop <= 0 && window.scrollY === y) return;
  // A scroll to where the page already is does nothing, so step a pixel away
  // and come back.
  window.scrollTo(window.scrollX, y > 0 ? y - 1 : y + 1);
  window.scrollTo(window.scrollX, y);
}

export default function KeyboardSettle() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer = null;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    };
    vv.addEventListener("resize", later);
    window.addEventListener("focusout", later);
    return () => {
      clearTimeout(timer);
      vv.removeEventListener("resize", later);
      window.removeEventListener("focusout", later);
    };
  }, []);
  return null;
}
