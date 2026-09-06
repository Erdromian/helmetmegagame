import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { loadFeedViewer, findPlace } from "@/lib/feedAccess";

// GET /api/feed/history?place=<key> — the last hundred things said in one
// place.
//
// The stream carries what happens NEXT; this is what happened before. They are
// separate on purpose: a Hall has half a dozen places and a GM has hundreds,
// and pushing every one of their backlogs down one stream would spend a
// player's first second of the page on rooms they never opened. So the page
// server-renders the place it opens on, and this fills in the rest as they are
// selected.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return Response.json({ error: "Sign in first. ‡" }, { status: 401 });
  if (!viewer.character && !viewer.gm) {
    return Response.json({ error: "You have no living character. ‡" }, { status: 403 });
  }

  const place = new URL(request.url).searchParams.get("place");
  // The same gate the stream uses, derived from the same place list.
  const found = await findPlace(prisma, viewer.character, place, viewer.options);
  if (!found) return Response.json({ error: "You aren't there. ‡" }, { status: 403 });

  const rows = await prisma.archiveEntry.findMany({
    where: { placeKey: place, deletedAt: null },
    orderBy: { seq: "desc" },
    take: HISTORY_ROWS,
    select: FEED_ROW_SELECT,
  });

  return Response.json({ place, rows: rows.reverse().map((row) => feedRowShape(row)) });
}
