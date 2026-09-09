import { SkeletonPage } from "@/app/components/PageShell";

// The first visit paints this; every visit after paints the page's last data
// from the local snapshot and refreshes underneath. The archive had no
// loading.js at all, so a first visit to a long transcript sat blank.
//
// Each panel is a list of bar widths: the controls bar, then a block of
// transcript lines at the ragged lengths speech actually has.
export default function Loading() {
  return <SkeletonPage width="wide" title="Archive" panels={[[60, 30], [95, 80, 90, 70, 88, 60, 92, 75]]} />;
}
