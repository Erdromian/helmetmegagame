import { Suspense } from "react";
import { prisma } from "@lifeweb/db";
import { getEconomyReportFiles } from "@/lib/economyReport";
import { reportPageTitle } from "@/lib/economyShareHtml";
import EconomyReportView from "./EconomyReportView";

// The economy report page, shared by /gm/economy and /econ/economy. Each of those sits behind its own
// layout gate ((desk) for GMs, (econ) for the Economist — they cannot share a layout chain, see
// (econ)/layout.js), so each page is a one-line mount of this. The frame's source is a route handler,
// and layouts do NOT run for those, so web/app/api/economy/report/[[...path]]/route.js carries the real
// check itself. See web/lib/economyReport.js for how the report is built.

// Building the model takes the better part of twenty seconds the first time (it is a full pricing pass
// over the whole catalog, not a file read) — its own Suspense boundary so the shell paints at once and
// only the frame waits, the same split AppBar.js uses for the nav promise it will not block on.
//
// The await is for the WAIT and the failure, not for the HTML: the frame fetches the document itself
// from /api/economy/report, so none of the report's own bytes ever ride in this page's payload. By the
// time the browser asks, the run below has finished and the handler answers from the same
// process-wide cache.
async function EconomyFrame() {
  const [built, rows] = await Promise.all([
    getEconomyReportFiles(),
    prisma.economyReportShare.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, token: true, page: true, createdAt: true },
    }),
  ]);
  if (!built) {
    return (
      <div className="desk-empty">
        <p>The economy report could not be generated. Check the server logs.</p>
      </div>
    );
  }
  // Page titles for the share bar, off each page's own <title>, so the bar never keeps a second copy of
  // report.js's section list.
  const titles = {};
  for (const [name, file] of built) {
    if (name.endsWith(".html")) titles[name] = reportPageTitle(file.content) ?? name;
  }
  const shares = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  return <EconomyReportView shares={shares} titles={titles} />;
}

export default function EconomyReport() {
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
