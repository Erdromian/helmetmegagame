import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="default" title="Play" panels={[[30], [90, 100, 70, 100, 60]]} />;
}
