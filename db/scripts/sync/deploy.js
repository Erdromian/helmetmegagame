// The syncs Railway's Pre-Deploy runs on every web deploy
// (`npm run db:sync-deploy`), in one process instead of one each.
//
// Most pushes touch no YAML master, so this hashes everything the syncs read —
// the docs/*.yaml masters, every db/lib module the sync functions load, and
// the migration list — and skips the whole run when the hash matches the one
// stored in SyncStamp by the last successful run. A new migration counts as a
// change, so a column added for a YAML field is always filled in.
//
//   npm run db:sync-deploy              # skip if nothing changed
//   npm run db:sync-deploy -- --force   # run anyway
//
// The skip is safe because nothing else writes the YAML-owned rows: tags from
// docs/tags.yaml are not editable in the UI (TAGS.md §5d), and Restart Game
// re-syncs through the library functions directly, not through here.
require("dotenv").config();
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The sync modules load BEFORE the barrel, so the modules they pull in can be
// told apart from everything else in db/lib — the barrel loads all of it.
const { syncTagsFromYaml } = require("../../lib/syncTags");
const { syncDesiresFromYaml } = require("../../lib/syncDesires");
const { syncDocumentsFromYaml } = require("../../lib/syncDocuments");
const SYNC_MODULES = Object.keys(require.cache);
const { prisma } = require("../../index");

const STAMP_KEY = "deploy";
const ROOT = path.resolve(__dirname, "../../..");

// Order matters: desires and documents validate against the Tag rows.
const STEPS = [
  ["tags", async () => {
    const s = await syncTagsFromYaml(prisma);
    return `groups +${s.groupsCreated}/~${s.groupsUpdated}, tags +${s.tagsCreated}/~${s.tagsUpdated}, links ${s.linksUpdated}`;
  }],
  ["desires", async () => {
    const s = await syncDesiresFromYaml(prisma);
    return `+${s.created}/~${s.updated}, retired ${s.retired}, unretired ${s.unretired}`;
  }],
  ["documents", async () => {
    const s = await syncDocumentsFromYaml(prisma);
    return `+${s.created}/~${s.updated}` + (s.pruned.length ? `, pruned ${s.pruned.join(", ")}` : "");
  }],
];

function inputsHash() {
  const files = new Set();
  const docs = path.join(ROOT, "docs");
  for (const name of fs.readdirSync(docs)) {
    if (name.endsWith(".yaml")) files.add(path.join(docs, name));
  }
  // Everything the sync functions pulled in, so a change to their logic
  // (or to anything they call) forces a run.
  const lib = path.join(ROOT, "db", "lib") + path.sep;
  for (const loaded of SYNC_MODULES) {
    if (loaded.startsWith(lib)) files.add(loaded);
  }
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(path.relative(ROOT, file)).update("\0");
    hash.update(fs.readFileSync(file)).update("\0");
  }
  const migrations = fs.readdirSync(path.join(ROOT, "db", "prisma", "migrations")).sort();
  hash.update(migrations.join("\n"));
  return hash.digest("hex");
}

async function main() {
  const force = process.argv.includes("--force");
  const hash = inputsHash();
  const stamp = await prisma.syncStamp.findUnique({ where: { key: STAMP_KEY } });
  if (!force && stamp?.hash === hash) {
    console.log(`sync-deploy: nothing changed since ${stamp.syncedAt.toISOString()}, skipped.`);
    return;
  }
  for (const [name, run] of STEPS) {
    const started = Date.now();
    const line = await run();
    console.log(`${name.padEnd(12)} ${line}  (${Date.now() - started} ms)`);
  }
  // Only after every step succeeded, so a failed run is retried next deploy.
  await prisma.syncStamp.upsert({
    where: { key: STAMP_KEY },
    create: { key: STAMP_KEY, hash },
    update: { hash, syncedAt: new Date() },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
