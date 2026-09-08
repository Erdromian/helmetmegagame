import { SkeletonBar } from "@/app/components/PageShell";

// Only the middle column. The shell — .desk-shell, the header, the rail and the
// inspector — lives in this route's layout.js, which stays mounted across a
// navigation, so drawing one here would paint a second desk inside the first.
//
// What it does have to match is RosterTable.js's own root: the segmented
// Players/Factions pair, then FilterBar's search-and-buttons row, then the
// table. Four generic bars foreshadowed none of that, so the column reflowed
// twice — once for the toolbar appearing, once for the table under it.
export default function Loading() {
  return (
    <main className="desk-main">
      <div className="flex flex-col gap-4 p-3" aria-hidden="true">
        <div className="animate-pulse flex flex-col gap-4">
          {/* The Players / Factions segmented control. */}
          <SkeletonBar width="14rem" height={30} />
          {/* FilterBar: the search field, its filters, and the bulk buttons. */}
          <div className="flex flex-wrap items-end gap-3">
            <SkeletonBar width="16rem" height={34} />
            <SkeletonBar width="7rem" height={34} />
            <SkeletonBar width="7rem" height={34} />
            <SkeletonBar width="10rem" height={34} />
          </div>
          {/* The roster itself: a header row and a first screenful. */}
          <SkeletonBar width="100%" height={28} />
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBar key={i} width="100%" height={22} />
          ))}
        </div>
      </div>
    </main>
  );
}
