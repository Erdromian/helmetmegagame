import DeskHeader from "@/app/components/DeskHeader";
import { SkeletonBar } from "@/app/components/PageShell";

// A desk skeleton — deliberately not SkeletonPage, which assumes the PageShell
// chrome this route group doesn't have. It draws the same FRAME the real desk
// draws so only the content swaps: the real DeskHeader with skeleton meta and
// actions sized like Workspace.js's, the three columns, and the push tray strip
// that is always on screen (StagingTray.js's `.desk-tray` / `.desk-tray-bar`,
// mirrored here rather than reinvented).
//
// The meta bars are not decoration. `.desk-header` is flex-wrap, so a header
// skeleton carrying nothing but a title is one line where the real one is two,
// and the whole desk jumps up when the queue lands.
export default function Loading() {
  return (
    <div className="desk-shell">
      <DeskHeader
        title="Adjudication"
        meta={
          <>
            <SkeletonBar width="7rem" height={22} />
            {/* The lock chip's slot — see LockChip.js and the note above. */}
            <SkeletonBar width="9rem" height={22} />
            <SkeletonBar width="5rem" height={22} />
            <SkeletonBar width="4rem" height={16} />
          </>
        }
        actions={<SkeletonBar width="6.5rem" height={28} />}
      />
      <div className="desk-body">
        <aside className="desk-rail" aria-hidden="true" />
        <main className="desk-main">
          <p className="p-6 text-sm text-muted">Loading the queue…</p>
        </main>
        <aside className="desk-inspector" aria-hidden="true" />
      </div>
      <section className="desk-tray" aria-hidden="true">
        <div className="desk-tray-bar">
          <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <strong>Push tray</strong>
            <span className="mono">…</span>
          </span>
        </div>
      </section>
    </div>
  );
}
