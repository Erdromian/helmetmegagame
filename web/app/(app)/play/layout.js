import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import HallTurn from "./HallTurn";

// The Hall owns its whole screen, the way the (desk) workspaces do: no
// PageShell, no centred max-width, a 100dvh column whose regions scroll
// inside it. A chat that scrolled the document would drag the header off the
// top every time somebody spoke.
//
// The turn promise is NOT awaited here — passed down so Suspense streams the
// "TOWN · DAY 6 · DUSK · CLEAR" line in behind the shell instead of blocking
// every navigation, exactly as web/app/(app)/layout.js does for TurnChip.
export default function PlayLayout({ children }) {
  const turnPromise = getOpenTurn();
  return (
    <div className="hall-shell">
      <header className="hall-crumb">
        <Suspense fallback={<span className="hall-turn">…</span>}>
          <HallTurn turnPromise={turnPromise} />
        </Suspense>
      </header>
      {children}
    </div>
  );
}
