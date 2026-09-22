import { redirect } from "next/navigation";
import { getEconSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import AppBar from "../components/AppBar";
import { ECONOMIST_NAV } from "@/lib/navItems";

// The Economist's own full-viewport workspace — deliberately a SEPARATE route
// group from (desk), not an extra branch inside its layout gate. (desk)'s
// layout gates every /gm/* page (Turns, Audit, Oracle, Dev, the messaging
// desk) with one isGm check; loosening that single gate to admit the
// Economist would open all of those too, since Next.js layouts have no
// per-path awareness — every page under (desk) shares this one ancestor.
// Keeping the Economist's pages in their own group means they physically
// cannot reach GM-only code, because they never share a layout with it. See
// docs/systemdocs/ECONOMY.md §7 for what this role can and can't reach.
//
// A GM or superadmin isn't blocked here either — no reason to lock out
// higher trust — they just don't get routed here by their own nav (GM_NAV
// points at /gm/economy instead).
export default async function EconLayout({ children }) {
  const { session, isGm, isEconomist, inGuild } = await getEconSession();
  if (!session?.discordUserId) redirect("/");
  // Departed the guild: no web access at all (see (app)/layout.js).
  if (!inGuild) redirect("/");
  if (!isGm && !isEconomist && !isSuperadmin(session.discordUserId)) redirect("/character");

  return (
    <div className="app-shell">
      <AppBar discordUserId={session.discordUserId} fallback={ECONOMIST_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
