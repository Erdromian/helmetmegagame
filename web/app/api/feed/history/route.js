import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloor, seqFilterAbove } from "@lifeweb/db/lib/feedWipe";
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

  // Nothing from before the last Dawn wipe (db/lib/feedWipe.js). Discord's
  // half of that pass deleted its messages outright; the Hall keeps the rows
  // for /archive and reads past them.
  const floor = await feedWipeFloor(prisma);

  const rows = await prisma.archiveEntry.findMany({
    where: { placeKey: place, deletedAt: null, seq: seqFilterAbove(floor) },
    orderBy: { seq: "desc" },
    take: HISTORY_ROWS,
    select: FEED_ROW_SELECT,
  });

  // One `?v=` per character across the page, rather than the per-row sentAt
  // fallback that made the same face refetch on every line.
  return Response.json({ place, rows: await withAvatarVersions(prisma, rows.reverse()) });
}
