import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="full" title="Ledger" panels={[[40, 90, 65], [70, 100, 55]]} />;
}
