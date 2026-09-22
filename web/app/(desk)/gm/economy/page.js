// The economy report, GM-only. The (desk) layout has already checked isGm
// (web/app/(desk)/layout.js), so there's no gate here — a layout gate is
// presentation, and there is no server action on this page to re-check one.
// The frame's source is a route handler, and layouts do NOT run for those, so
// that one carries the real check itself — web/app/api/economy/report/route.js,
// shared with the Economist role's twin page at /econ/economy.
// See web/lib/economyReport.js for how the report itself is built.

import { Suspense } from "react";
import { getEconomyReportHtml } from "@/lib/economyReport";

export const metadata = {
  title: "Economy",
  description: "The Bascinet economy report",
  robots: { index: false, follow: false },
};

// Building the model takes the better part of twenty seconds the first time (it is a full pricing pass
// over the whole catalog, not a file read) — its own Suspense boundary so the shell paints at once and
// only the frame waits, the same split AppBar.js uses for the nav promise it will not block on.
//
// The await is for the WAIT and the failure, not for the HTML: the frame fetches the document itself
// from /api/economy/report, so ~790 KB never rides in this page's payload. By the time the browser
// asks, the run below has finished and the handler answers from the same process-wide cache.
async function EconomyFrame() {
  const built = await getEconomyReportHtml();
  if (!built) {
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
      <iframe title="Economy report" src="/api/economy/report" />
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
