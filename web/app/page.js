import { redirect } from "next/navigation";
import { getGmSession } from "@/lib/discordGuild";
import { loadFeedViewer } from "@/lib/feedAccess";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import HomeScreen from "./components/HomeScreen";

export default async function Home() {
  const [{ session, inGuild }, turn] = await Promise.all([getGmSession(), getOpenTurn()]);

  if (session?.discordUserId && inGuild) {
    // A spectator came to watch, and there is nothing on /character for
    // somebody with no character to watch (web/lib/feedAccess.js#loadFeedViewer).
    const viewer = await loadFeedViewer();
    redirect(viewer.spectator ? "/chat" : "/character");
  }

  // Signed in but no longer in the guild: (app)/layout.js and (desk)/layout.js
  // both redirect back here rather than into the site, so this must not send
  // them straight back in — that would loop. HomeScreen shows different copy
  // for this case instead of the ordinary sign-in prompt.
  return <HomeScreen turnLabel={describeTurn(turn).label} leftGuild={Boolean(session?.discordUserId)} />;
}
