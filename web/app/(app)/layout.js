import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import AppRail from "../components/AppRail";
import TurnChip from "../components/TurnChip";
import TurnChipAsync from "../components/TurnChipAsync";
import { GM_NAV, PLAYER_NAV } from "@/lib/navItems";

// The nav item lists and loadNavItems moved to web/lib/navItems.js when (desk)
// grew a rail of its own — see the note at the top of that file.

export default async function AppLayout({ children }) {
  // getGmSession() rather than auth(): it wraps the same (React-cached) auth()
  // call and adds the guild-member lookup, which is itself cached for five
  // minutes with in-flight dedup (web/lib/discordGuild.js). That buys the
  // fallback below its SHAPE — without it every GM navigation into this group
  // painted a player rail first and then dropped the GM section in on top,
  // shoving the whole list down. (desk) never had that tell because it has
  // always passed a fallback matching its user; this is the same rule, and
  // /documents already awaited this exact call for its own GM-only entries.
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  // Not awaited here — passed down so Suspense can stream it in behind the
  // shell instead of blocking every navigation.
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
