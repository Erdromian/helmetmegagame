import { redirect } from "next/navigation";
import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import EmptyState from "@/app/components/EmptyState";
import { loadFeedViewer, placesFor } from "@/lib/feedAccess";
import Hall from "./Hall";

// /play — the Hall. Three columns on a desktop, one on a phone: everywhere
// this character can hear on the left, the open scene in the middle, and (in
// phase 3) the people standing there on the right.
//
// The first place's rows are rendered on the server so the page has something
// to show before any JavaScript runs; every other place is fetched when the
// reader opens it, and everything after that arrives on the one SSE stream
// Hall.js holds.
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 100;

export default async function PlayPage() {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) redirect("/");

  if (!viewer.character && !viewer.gm) {
    return (
      <div className="hall-body hall-body--empty">
        <div className="panel">
          <EmptyState>You have no living character. ‡</EmptyState>
        </div>
      </div>
    );
  }

  const places = await placesFor(prisma, viewer.character, viewer.options);
  const first = places[0] ?? null;

  if (!first) {
    return (
      <div className="hall-body hall-body--empty">
        <div className="panel">
          <EmptyState>You are nowhere yet. ‡</EmptyState>
        </div>
      </div>
    );
  }

  // The cursor the stream opens with is the newest seq in the GAME at render
  // time, not the newest in this place. The catch-up then carries exactly what
  // happened while the page was loading, across every place at once — asking
  // from this place's own newest would have replayed every other place's whole
  // backlog down the stream.
  const [rows, watermark, forcedName, concealment] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: { placeKey: first.placeKey, deletedAt: null },
      orderBy: { seq: "desc" },
      take: HISTORY_ROWS,
      select: FEED_ROW_SELECT,
    }),
    prisma.archiveEntry.aggregate({ _max: { seq: true } }),
    viewer.character ? loadForcedName(prisma, viewer.character.id) : null,
    viewer.character ? loadConcealment(prisma, viewer.character.id) : null,
  ]);

  // The name this character's own optimistic rows wear before the server
  // answers — forced beats concealed beats their own, the same resolution the
  // send route does, so an optimistic row never shows a name the confirmed
  // one will not.
  const identity = viewer.character
    ? presentedIdentity(viewer.character, { forcedName, concealment })
    : { name: null };

  return (
    <Hall
      initialPlaces={places}
      initialPlace={first.placeKey}
      initialRows={rows.reverse().map((row) => feedRowShape(row))}
      initialSeq={watermark._max.seq === null ? "0" : String(watermark._max.seq)}
      self={{
        characterId: viewer.character?.id ?? null,
        name: identity.name,
        avatarVersion: viewer.character?.updatedAt?.getTime?.() ?? null,
      }}
    />
  );
}
