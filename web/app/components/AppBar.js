import { Suspense } from "react";
import { getClock, getOpenTurn } from "@/lib/turn";
import { PLAYER_NAV, loadNavItems } from "@/lib/navItems";
import { SkeletonBar } from "./PageShell";
import NavLinks from "./NavLinks";
import NavLinksAsync from "./NavLinksAsync";
import ClockBlock from "./ClockBlock";
import SoundControls from "./SoundControls";
import SignOutButton from "./SignOutButton";
import CommandPalette from "./CommandPalette";

// The universal top bar every page wears now, replacing the left nav rail
// (NavRail.js/AppRail.js) and every page's own AppHeader/DeskHeader: one row
// — old-fashioned text links (NavLinks.js), then a divider, then the game's
// clock (ClockBlock.js), then, hard against the right edge, the sound cluster
// and Sign out — over the double line (.top-bar, shell.css). Rendered once per
// route group, above {children}
// ((app)/layout.js, (desk)/layout.js, (public)/layout.js), and NOT rendered
// at all for a signed-out visitor — that's each layout's own call, matching
// what AppRail used to do.
//
// Two independent Suspense boundaries, mirroring the old AppRail/AppHeader
// split: the nav items promise waits on a GM/Mortus/treasury check and the
// turn promise is its own query, and neither should hold the other off the
// screen.
export default function AppBar({ discordUserId, fallback = PLAYER_NAV }) {
  const turnPromise = getOpenTurn();
  // The phase, not just the turn: a turn row exists all through the lobby, so the clock has to be told which question it
  // is answering (web/lib/turn.js). Both awaits sit inside the same Suspense boundary below, so this adds no new block.
  const clockPromise = getClock();
  return (
    <>
      <div className="top-bar scroll-fade-x">
        <Suspense fallback={<NavLinks items={fallback} />}>
          <NavLinksAsync itemsPromise={loadNavItems(discordUserId)} />
        </Suspense>
        <span className="action-strip-sep" aria-hidden="true" />
        <Suspense fallback={<SkeletonBar width="10rem" height={14} />}>
          <ClockBlock turnPromise={turnPromise} clockPromise={clockPromise} />
        </Suspense>
        {/* Everything past the spacer is pinned to the bar's right edge: the
            sound cluster, then Sign out, which is the last thing on the row.
            The spacer is a plain flex filler, so when the bar overflows it
            collapses to nothing first and the row goes back to scrolling
            sideways — no breakpoint needed. Outside both Suspense boundaries,
            so neither waits on a Discord role check. */}
        <span className="top-bar-spacer" aria-hidden="true" />
        <SoundControls />
        <span className="action-strip-sep" aria-hidden="true" />
        <SignOutButton />
      </div>
      {/* Mounted here rather than in the root layout so it only exists for a
          signed-in user — and so all three route groups get it from one place. */}
      <CommandPalette />
    </>
  );
}
