import { Suspense } from "react";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import AppRail from "../components/AppRail";
import TurnChip from "../components/TurnChip";
import TurnChipAsync from "../components/TurnChipAsync";
import { GM_NAV, PLAYER_NAV } from "@/lib/navItems";
import SnapshotGuard from "@/lib/snapshot/SnapshotGuard";

// The one route group that renders for a signed-out visitor. (app) redirects
// to "/" without a session (AppLayout), and (desk) is GM-only — neither can
// hold a page meant to be handed out as a bare link (a recruiting post, a
// Discord pin) before the reader has ever signed in. /handbook lives here for
// exactly that reason.
//
// Same .app-shell/.app-main frame as (app), but the rail and the turn chip
// only mount for a signed-in reader — an anonymous visitor gets the page
// alone, full width, with nothing in the chrome implying a session that
// doesn't exist. .app-main is a plain `flex: 1` (globals.css), so it needs no
// extra class to fill the row on its own when AppRail isn't there beside it.
export default async function PublicLayout({ children }) {
  // Same call and the same reason as (app)'s layout: the rail's fallback has
  // to know whether this reader is a GM, or /handbook paints a player rail
  // and then shoves a GM section in above it. A signed-out visitor returns
  // below before any of that, so the anonymous path pays nothing for it.
  const { session, isGm } = await getGmSession();

  if (!session?.discordUserId) {
    // A signed-out browser lands here. No account on the page means every
    // stored page snapshot is somebody's old sheet (CHAT.md §5c), so the
    // guard clears them.
    return (
      <div className="app-shell">
        <SnapshotGuard userId={null} />
        <main className="app-main">{children}</main>
      </div>
    );
  }

  // Not awaited — streamed in behind the shell exactly as AppLayout does, so
  // a signed-in visitor gets the same non-blocking paint here as everywhere
  // else in the app.
  const turnPromise = getOpenTurn();

  return (
    <div className="app-shell">
      <AppRail discordUserId={session.discordUserId} fallback={isGm ? GM_NAV : PLAYER_NAV} />
      <main className="app-main">{children}</main>
      <Suspense fallback={<TurnChip turn={null} />}>
        <TurnChipAsync turnPromise={turnPromise} />
      </Suspense>
    </div>
  );
}
