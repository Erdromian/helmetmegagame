"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { dialogHoldsKeyboard } from "@/app/components/Modal";
import { hasModifier, isFieldFocused } from "@/lib/deskKeyGuard";

// Escape takes you back to the game. Mounted by /character's layout, and only
// when there is a living character to draw a sheet for — the lobby and the
// creation wizard keep their own Escape. The layout leaves it out when the
// Play page is switched off too, since /play would only bounce back here.
//
// The order is the desks' (gm/turns/Workspace.js): a dialog that holds the
// keyboard keeps its Escape; a field with focus is blurred rather than
// abandoned mid-edit; a floating thing that is open — a pinned tag panel, a
// click menu, a dropdown — is closed by its own handler on this same keypress
// and the navigation stands down for it. Only a bare Escape on a bare page
// goes anywhere. The /play snapshot paints in the first frame, which is what
// makes it feel immediate.
//
// Listened for in the CAPTURE phase, deliberately. The menu's and the pinned
// panel's own Escape handlers sit on document, and React flushes the state
// change they make before a bubbling window listener runs — so by the time
// this looked, the menu was already gone from the DOM and the page navigated
// out from under a player who only meant to close a menu. Capture runs first
// and sees the menu still open.
const FLOATING = '.tag-tooltip[data-pinned], .chat-menu-portal, .select-popup';

export default function EscapeToPlay() {
  const router = useRouter();

  useEffect(() => {
    // Warm the route so the navigation is a swap, not a fetch.
    router.prefetch("/play");
    function onKey(e) {
      if (e.key !== "Escape" || hasModifier(e)) return;
      if (dialogHoldsKeyboard()) return;
      if (document.querySelector(FLOATING)) return;
      const active = document.activeElement;
      if (isFieldFocused(active)) {
        active.blur?.();
        return;
      }
      router.push("/play");
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router]);

  return null;
}
