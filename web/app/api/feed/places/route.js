import { prisma } from "@lifeweb/db";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";

// GET /api/feed/places — the viewer's place list.
//
// The page renders the same list on the server for its first paint; this is
// what a client refreshes with when it has reason to think the list moved and
// no stream open to tell it (a failed EventSource, a tab woken from sleep).
// The stream itself pushes the list as `event: places`, which is the normal
// path.
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first. ‡" }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character. ‡" }, { status: 403 });
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  return Response.json({ places });
}
