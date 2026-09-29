import { prisma } from "@lifeweb/db";
import { getEconomyReportFile, getEconomyReportFiles } from "@/lib/economyReport";
import { isShareablePage, sharedPageHtml } from "@/lib/economyShareHtml";

// GET /share/economy/<token> — one page of the economy report, for anyone holding the link, signed in
// or not (ECONOMY.md §7a). A GM or Economist mints the token from the Share button above the report
// (web/app/components/EconomyReportView.js).
//
// **This serves the share's one page and nothing else.** The report is gated because some of it is
// not for players — the Secret recipes page most of all — so the lock is here: the token names one
// filename, and no path from the URL ever reaches getEconomyReportFile. The Secret recipes page itself
// is never served, even to a token that names it (isShareablePage). The nav coming out of the page
// (economyShareHtml.js) is courtesy, not the lock.
//
// The token is looked up BEFORE the report is touched. The first read in a fresh process builds the
// whole report, about twenty seconds of pricing, and a guessed token must never be what starts one.
//
// In (public) because that is where a page for a signed-out reader lives. A route handler runs no
// layout, so no session is read and nothing can redirect a stranger to the Discord sign-in.
export const dynamic = "force-dynamic";

const HEADERS = {
  // no-store, not the report route's five private minutes: a revoked link has to stop working at once,
  // including in any cache between here and the reader.
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  // The token is the whole credential, so it never leaves in a Referer.
  "referrer-policy": "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function text(status, body) {
  return new Response(body, { status, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

export async function GET(_request, { params }) {
  const { token } = await params;
  if (typeof token !== "string" || !TOKEN.test(token)) return text(404, "This link does not exist, or it was revoked.");

  const share = await prisma.economyReportShare.findUnique({ where: { token }, select: { page: true } });
  if (!share || !isShareablePage(share.page)) return text(404, "This link does not exist, or it was revoked.");

  const [page, css, js] = await Promise.all([
    getEconomyReportFile(share.page),
    getEconomyReportFile("report.css"),
    getEconomyReportFile("report-client.js"),
  ]);
  if (!page) {
    // Same split as /api/economy/report: the report would not build (503, try later) against a page a
    // later deploy took out of it (404, for good).
    if (!(await getEconomyReportFiles())) return text(503, "The economy report could not be generated. Try again later.");
    return text(404, "This page is no longer in the economy report.");
  }

  return new Response(sharedPageHtml(page.content, { css: css?.content, js: js?.content }), {
    headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" },
  });
}
