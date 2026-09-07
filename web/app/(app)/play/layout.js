import { Suspense } from "react";
import { getOpenTurn } from "@/lib/turn";
import DeskHeader from "@/app/components/DeskHeader";
import { SkeletonBar } from "@/app/components/PageShell";
import ChatTurn from "./ChatTurn";

// Chat owns its whole screen, the way the (desk) workspaces do: no
// PageShell, no centred max-width, a 100dvh column whose regions scroll
// inside it. A chat that scrolled the document would drag the header off the
// top every time somebody spoke.
//
// It wears the same DeskHeader those workspaces wear. It used to carry a
// bespoke `.chat-crumb` holding one line of uppercase --fs-2xs muted text and
// no <h1> at all, which next to three desks in a serif .section-title read as
// a different application.
//
// The turn promise is NOT awaited here — passed down so Suspense streams the
// "TOWN · DAY 6 · DUSK · CLEAR" chip in behind the shell instead of blocking
// every navigation, exactly as web/app/(app)/layout.js does for TurnChip.
export default function PlayLayout({ children }) {
  const turnPromise = getOpenTurn();
  return (
    <div className="chat-shell">
      <DeskHeader
        title="Chat"
        meta={
          <Suspense fallback={<SkeletonBar width="11rem" height={22} />}>
            <ChatTurn turnPromise={turnPromise} />
          </Suspense>
        }
      />
      {children}
    </div>
  );
}
