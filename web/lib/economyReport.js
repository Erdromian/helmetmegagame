import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoPath } from "@lifeweb/db/lib/repoPaths";

const execFileAsync = promisify(execFile);

// The economy report (db/scripts/analysis/economy/report.js, "Docs against the model" et al.), hosted
// at /gm/economy and, for the Economist role, /econ/economy. Built and cached once per server process rather than per request — the
// catalog it reads (docs/tags.yaml, docs/zones.yaml, schema.prisma, the db/lib constants) only moves on
// the next deploy, which restarts this process anyway.
//
// Spawned as a REAL, separate `node` process — exactly the one `npm run economy:report` runs — rather
// than `require()`d into the Next server bundle. `db/lib/repoPaths.js`'s own header explains why that
// matters: Turbopack bundles @lifeweb/db regardless of serverExternalPackages and inlines a bundled
// file's __dirname as a build-time literal, which would break every `readYaml("docs/...")` and
// `schemaDefault()` call the model makes — reads against the real filesystem, not requires the
// bundler can trace. A subprocess's own __dirname is never touched by the bundler, so report.js and
// the dozen files under db/scripts/analysis/economy/ it pulls in need no change at all.

// A full pricing pass measures about 18s on a warm local disk, and a Railway container is slower and
// busier than that. This ceiling is here to stop a wedged process holding a worker forever, not to
// bound ordinary work — set anywhere near the real runtime it just converts a slow container into a
// SIGTERM and an error page.
const TIMEOUT_MS = 120_000;

// report.js now writes one file per section (SECTIONS in report.js) rather than one ~800 KB page, plus
// the shared report.css/report-client.js the old inline <style>/<script> moved into. Only these three
// extensions are ever served — the CSVs, report.md and model.json are for a human or a script reading
// the checkout directly, not for the site.
const SERVABLE = new Set([".html", ".css", ".js"]);
const CONTENT_TYPE = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

let cached = null; // Map<filename, { content, contentType }>, kept for the life of the process
let pending = null; // the run in flight, shared by everyone who asks while it is going

async function build() {
  // Non-null only means docs/ was found (repoPaths.js searches for docs/zones.yaml); it does not say
  // the script is there. A missing one surfaces as an ENOENT in the catch below, like any other
  // failure to run it.
  const script = repoPath("db/scripts/analysis/economy/report.js");
  if (!script) return null;
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "economy-report-"));
  try {
    // No --players/--turns/etc: the same defaults `npm run economy:report` runs with, plain.
    await execFileAsync(process.execPath, [script, "--out", outDir], { timeout: TIMEOUT_MS });
    const names = await fs.readdir(outDir);
    const files = new Map();
    for (const name of names) {
      const ext = path.extname(name);
      if (!SERVABLE.has(ext)) continue;
      const content = await fs.readFile(path.join(outDir, name), "utf8");
      files.set(name, { content, contentType: CONTENT_TYPE[ext] });
    }
    return files.has("index.html") ? files : null;
  } catch (err) {
    console.error("Economy report generation failed:", err);
    return null;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Map<filename, {content, contentType}> | null, or null while nothing has built successfully yet.
export async function getEconomyReportFiles() {
  if (cached) return cached;
  // Share the promise, not just the result. The cache is only written when a run FINISHES, so
  // checking it alone left the door open for the whole ~18s: two GMs opening the page together, or
  // one refresh, meant two full pricing passes racing each other on the same container. A failed run
  // clears `pending` rather than caching the null, so the next load gets a fresh attempt.
  pending ??= build().finally(() => {
    pending = null;
  });
  const files = await pending;
  if (files) cached = files;
  return files;
}

// One named file from the built set, or null if generation failed or the name does not exist —
// web/app/api/economy/report/[[...path]]/route.js is the one caller, and it turns either kind of null
// into a 404/503 of its own.
export async function getEconomyReportFile(name) {
  const files = await getEconomyReportFiles();
  return files?.get(name) ?? null;
}
