import { getEconSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getEconomyReportHtml } from "@/lib/economyReport";

// GET /api/economy/report — the economy report's HTML, for the frame on both
// /gm/economy and /econ/economy.
//
// Lives at api/economy/report/, not api/economy-report/: .gitignore carries an
// unanchored `economy-report/` (for the output `npm run economy:report`
// writes), which silently swallows any directory of that name anywhere in the
// tree — this file included, had it been named that.
//
// A route handler rather than an `srcDoc` on the page itself. The report is a ~790 KB document, and
// inlining it meant shipping all of it — HTML-attribute-escaped, so rather more than that — inside
// the page's RSC payload on every single navigation, uncacheable because the route is dynamic. Served
// on its own it is one ordinary response the browser can keep.
//
// **Route handlers do not run layouts**, so neither the (desk) layout's GM gate nor the (econ)
// layout's Economist gate covers this the way each covers its own page. The check is repeated here,
// and it is the real one. 404 rather than 403: a gated surface does not confirm it exists. Safe to
// widen past GM: this report is db/scripts/analysis/economy/report.js's static catalog/pricing
// analysis (docs/tags.yaml, docs/zones.yaml, schema.prisma, db/lib constants) — it reads no
// per-character or ledger data, so there is nothing here for the Economist role to leak.
export const dynamic = "force-dynamic";

export async function GET() {
  const { session, isGm, isEconomist } = await getEconSession();
  if (!session?.discordUserId || !(isGm || isEconomist || isSuperadmin(session.discordUserId))) {
    return new Response(null, { status: 404 });
  }

  const html = await getEconomyReportHtml();
  if (!html) {
    return new Response("The economy report could not be generated.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // `private` because it is gated (GM or Economist) and must never land in a shared cache. The five minutes is
      // about a reload or a tab reopen inside one sitting — the report itself only moves on the next
      // deploy, which restarts the process and empties the module cache behind this anyway.
      "cache-control": "private, max-age=300",
    },
  });
}
