// The economy report, GM-only. The (desk) layout has already checked isGm
// (web/app/(desk)/layout.js), so there's no gate here — a layout gate is
// presentation, and there is no server action on this page to re-check one.
// See web/lib/economyReport.js for how the report itself is built.

import { Suspense } from "react";
import { getEconomyReportHtml } from "@/lib/economyReport";

export const metadata = {
  title: "Economy",
  description: "The Bascinet economy report",
  robots: { index: false, follow: false },
};

// Building the model takes several seconds even cached-per-process (it is a full pricing pass over the
// whole catalog, not a file read) — its own Suspense boundary so the shell paints at once and only the
// frame waits, the same split AppBar.js uses for the nav promise it does not want to block the clock on.
async function EconomyFrame() {
  const html = await getEconomyReportHtml();
  if (!html) {
    return (
      <div className="desk-empty">
        <p>The economy report could not be generated. Check the server logs.</p>
      </div>
    );
  }
  return (
    <div className="economy-frame">
      {/* Its own full document — own CSS, own table-sort script — sandboxed from the app's theme by an
          iframe rather than pasted inline, the same reasoning report.js has always meant it to be
          opened as a standalone page for. Not `sandbox`-restricted: this is our own generated content,
          never third-party input, and the sort script needs to run. */}
      <iframe title="Economy report" srcDoc={html} />
    </div>
  );
}

export default function EconomyPage() {
  return (
    <div className="desk-shell">
      <Suspense
        fallback={
          <div className="desk-empty">
            <p>Building the report — this can take several seconds the first time…</p>
          </div>
        }
      >
        <EconomyFrame />
      </Suspense>
    </div>
  );
}
