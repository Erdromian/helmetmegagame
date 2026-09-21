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

export async function GET(request) {
  const viewer = await loadFeedViewer();
  // Signed in is the whole gate, the same as the stream's: somebody waiting on
  // a seat gets the Game channel and nothing else, rather than a 403 their
  // Chat reads as a dead session.
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first." }, { status: 401 });
  // `?probe=1` is Chat asking only whether the session is still good after
  // its stream has dropped twice (Chat.js): the gates above are the whole
  // answer, and a hundred tabs recovering from one redeploy should not each
  // pay for the place list to learn it.
  if (new URL(request.url).searchParams.get("probe")) return new Response(null, { status: 204 });

  const places = await placesFor(prisma, viewer.character, viewer.options);
  return Response.json({ places });
}
