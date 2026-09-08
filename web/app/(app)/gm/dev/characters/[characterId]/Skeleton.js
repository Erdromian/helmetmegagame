import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title panels={[[40, 100], [30], [60, 90, 70]]} />;
}
