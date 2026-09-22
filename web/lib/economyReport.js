import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoPath } from "@lifeweb/db/lib/repoPaths";

const execFileAsync = promisify(execFile);

// The economy report (db/scripts/analysis/economy/report.js, "Docs against the model" et al.), hosted
// GM-only at /gm/economy. Built and cached once per server process rather than per request — the
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
let cached = null;

export async function getEconomyReportHtml() {
  if (cached) return cached;
  const script = repoPath("db/scripts/analysis/economy/report.js");
  if (!script) return null;
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "economy-report-"));
  try {
    // No --players/--turns/etc: the same defaults `npm run economy:report` runs with, plain.
    await execFileAsync(process.execPath, [script, "--out", outDir], { timeout: 30_000 });
    cached = await fs.readFile(path.join(outDir, "index.html"), "utf8");
  } catch (err) {
    console.error("Economy report generation failed:", err);
    return null;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
  return cached;
}
