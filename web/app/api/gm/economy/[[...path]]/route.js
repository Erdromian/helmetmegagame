import { getGmSession } from "@/lib/discordGuild";
import { getEconomyReportFile, getEconomyReportFiles } from "@/lib/economyReport";

// GET /api/gm/economy/[...path] — the economy report's files, for the frame on /gm/economy.
//
// A CATCH-ALL, not one path: report.js now writes one file per section (its own SECTIONS list) plus
// the shared report.css/report-client.js, rather than one ~800 KB page, and each section's own <nav>
// links to its siblings by plain relative filename (wages.html, power.html, …) — the same links that
// work when the checkout's economy-report/ is opened straight off disk. Serving from this one dynamic
// segment, at the same path depth report.js's own relative hrefs already resolve to, means the frame
// never needs to know the file list; it just follows links like any other page.
//
// Named `economy` and not `economy-report` because .gitignore carries an unanchored
// `economy-report/` (for the output `npm run economy:report` writes), which silently swallows any
// directory of that name anywhere in the tree — this one included.
//
// **Route handlers do not run layouts**, so the (desk) layout's GM gate does not cover this the way it
// covers the page. The check is repeated here, and it is the real one — same getGmSession() the layout
// and the other api/gm handlers use. 404 rather than 403: a GM-only surface does not confirm it exists.
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 404 });

  const { path: segments } = await params;
  const name = segments?.length ? segments.join("/") : "index.html";

  const file = await getEconomyReportFile(name);
  if (!file) {
    // Distinguish "the report itself would not build" (503, the same answer whichever file was asked
    // for) from "that is not one of its files" (404) — the built set is checked once, since a name
    // that is not in a report that DID build is never going to appear by asking again.
    const built = await getEconomyReportFiles();
    if (!built) {
      return new Response("The economy report could not be generated.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(null, { status: 404 });
  }

  return new Response(file.content, {
    headers: {
      "content-type": file.contentType,
      // `private` because it is GM-only and must never land in a shared cache. The five minutes is
      // about a reload or a tab reopen inside one sitting — the report itself only moves on the next
      // deploy, which restarts the process and empties the module cache behind this anyway.
      "cache-control": "private, max-age=300",
    },
  });
}
