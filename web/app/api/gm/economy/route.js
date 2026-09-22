import { getGmSession } from "@/lib/discordGuild";
import { getEconomyReportHtml } from "@/lib/economyReport";

// GET /api/gm/economy — the economy report's HTML, for the frame on /gm/economy.
//
// Named `economy` and not `economy-report` because .gitignore carries an unanchored
// `economy-report/` (for the output `npm run economy:report` writes), which silently swallows any
// directory of that name anywhere in the tree — this file included.
//
// A route handler rather than an `srcDoc` on the page itself. The report is a ~790 KB document, and
// inlining it meant shipping all of it — HTML-attribute-escaped, so rather more than that — inside
// the page's RSC payload on every single navigation, uncacheable because the route is dynamic. Served
// on its own it is one ordinary response the browser can keep.
//
// **Route handlers do not run layouts**, so the (desk) layout's GM gate does not cover this the way it
// covers the page. The check is repeated here, and it is the real one — same getGmSession() the layout
// and the other api/gm handlers use. 404 rather than 403: a GM-only surface does not confirm it exists.
export const dynamic = "force-dynamic";

export async function GET() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 404 });

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
      // `private` because it is GM-only and must never land in a shared cache. The five minutes is
      // about a reload or a tab reopen inside one sitting — the report itself only moves on the next
      // deploy, which restarts the process and empties the module cache behind this anyway.
      "cache-control": "private, max-age=300",
    },
  });
}
