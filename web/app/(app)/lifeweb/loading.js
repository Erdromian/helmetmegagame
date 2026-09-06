import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="narrow" title="Lifeweb" panels={[[45, 100], [60, 85]]} />;
}
