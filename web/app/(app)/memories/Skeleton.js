import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="narrow" title="Memories" panels={[[30], [80, 100, 60], [30], [30], [30]]} />;
}
