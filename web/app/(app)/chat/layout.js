import { getGmSession } from "@/lib/discordGuild";
import GmToolsProvider from "./GmToolsProvider";

// Chat owns its whole screen, like the (desk) workspaces: no PageShell, no centred max-width, a column whose
// regions scroll inside it — a chat that scrolled the document would drag the universal top bar off the top on
// every message. No AppHeader any more; the bar (rendered by (app)/layout.js, above this shell) already says
// "Chat" via the active link, and hides itself here under 720px (chat.css) so the scene keeps the whole screen.
//
// A GM's page is wrapped in the GM tools, and nobody else's is (./gmTools.js). It is done here and not in
// page.js because a layout is bundled apart from its page: whatever page.js pulls in, every reader downloads.
// getGmSession() is React-cached, and (app)/layout.js above has already asked it.
export default async function PlayLayout({ children }) {
  const { isGm } = await getGmSession();
  const shell = <div className="chat-shell">{children}</div>;
  return isGm ? <GmToolsProvider>{shell}</GmToolsProvider> : shell;
}
