import { prisma } from "@lifeweb/db";
import { ARCHIVE_ROW_SELECT, archiveRowsShape } from "@lifeweb/db/lib/archive";
import { loadArchiveAccess } from "@/lib/archiveAccess";
import {
  ARCHIVE_PAGE_SIZE,
  archiveCursorOf,
  archiveOrderBy,
  archivePageWhere,
  parseArchiveParams,
  searchParamsObject,
} from "@/lib/archiveQuery";

// GET /api/archive?…filters&cursor=<sentAt|id> — the next screen of transcript.
//
// The page server-renders the first screen and this fills in the rest as you
// scroll. Same filters, same order, same shaping — all three come from
// web/lib/archiveQuery.js and db/lib/archive.js rather than being spelled a
// second time here, because a scroll that quietly changed what it was showing
// past the first screen would be worse than no scroll at all.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const access = await loadArchiveAccess(params.get("game") ?? "");
  if (!access.ok) {
    // The same three answers the page gives, as status codes.
    const message =
      access.reason === "signin" ? "Sign in first." : access.reason === "no-game" ? "No such game." : "GM only.";
    return Response.json({ error: message }, { status: access.status });
  }
  // Nothing to scroll through: the rows are in a packet in the bucket.
  if (access.archived) return Response.json({ rows: [], cursor: null, done: true });

  // searchParamsObject, not Object.fromEntries: a repeated `zone` or `room` is
  // several filters, and fromEntries would keep only the last of them.
  const filters = parseArchiveParams(searchParamsObject(params));
  // One helper for the filter AND the cursor. Spreading the two into one object
  // let the cursor's OR overwrite Speech's, so a scroll past the first screen
  // quietly turned Speech into Everything.
  const where = archivePageWhere(access.game.id, filters, params.get("cursor"));

  // One more than a screen, so "is there another screen" needs no second
  // count(*) over a filtered transcript on every scroll.
  const rows = await prisma.archiveEntry.findMany({
    where,
    select: ARCHIVE_ROW_SELECT,
    orderBy: archiveOrderBy(filters.order),
    take: ARCHIVE_PAGE_SIZE + 1,
  });
  const done = rows.length <= ARCHIVE_PAGE_SIZE;
  const screen = done ? rows : rows.slice(0, ARCHIVE_PAGE_SIZE);

  return Response.json({
    rows: await archiveRowsShape(prisma, screen),
    cursor: archiveCursorOf(screen[screen.length - 1]),
    done,
  });
}
