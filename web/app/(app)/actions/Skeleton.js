import { SkeletonPage } from "../../components/PageShell";

// The turn picker, then Moves, Fights and Caving.
export default function Loading() {
  return <SkeletonPage width="wide" title="Actions" panels={[[30], [60, 100, 85, 70], [55, 95, 80], [50, 90]]} />;
}
