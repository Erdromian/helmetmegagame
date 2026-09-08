import DeskHeader from "@/app/components/DeskHeader";
import { SkeletonBar } from "@/app/components/PageShell";

// Not SkeletonPage: this route has no PageShell chrome to imitate. It draws
// the real DeskHeader instead of a bar where the title goes, so the heading is
// already in its final place and only the meta chip swaps in — the same shape
// (desk)/gm/audit/loading.js has.
export default function Loading() {
  return (
    <div className="desk-shell">
      <DeskHeader
        title="Dev Panel"
        meta={<SkeletonBar width="9rem" height={22} />}
        actions={<SkeletonBar width="18rem" height={16} />}
      />
      <div className="desk-body desk-body--ops">
        <div className="ops-nav">
          <div className="animate-pulse flex flex-col gap-3">
            <SkeletonBar width="60%" />
            <SkeletonBar width="80%" />
            <SkeletonBar width="70%" />
          </div>
        </div>
        <main className="ops-main">
          <div className="animate-pulse flex flex-col gap-3">
            <SkeletonBar width="30%" />
            <SkeletonBar width="100%" />
            <SkeletonBar width="100%" />
            <SkeletonBar width="100%" />
          </div>
        </main>
      </div>
    </div>
  );
}
