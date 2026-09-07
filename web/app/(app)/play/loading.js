import DeskHeader from "@/app/components/DeskHeader";
import { SkeletonBar } from "@/app/components/PageShell";

// The Hall is not a PageShell page, so it cannot be a SkeletonPage either —
// that component draws a centred column with a title, which is the shape this
// route deliberately left behind. What it can do is draw the same frame: the
// real DeskHeader the layout renders, then the three columns held still so
// nothing jumps when the scene lands.
//
// The aside is deliberately absent. Hall.js renders it only `{aside && …}`,
// and a GM with no living character has none — drawing it unconditionally
// gave them a phantom third column that vanished on load.
export default function Loading() {
  return (
    <div className="hall-shell">
      <DeskHeader title="The Hall" meta={<SkeletonBar width="11rem" height={22} />} />
      <div className="hall-body" aria-hidden="true">
        <div className="hall-places" />
        <div className="hall-centre" />
      </div>
    </div>
  );
}
