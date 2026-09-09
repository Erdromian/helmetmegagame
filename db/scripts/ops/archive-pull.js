// Sync every archive packet in the bucket down to a folder on this machine.
//
//   npm run archive:pull                     # -> ./archives, everything
//   npm run archive:pull -- --dest ~/packets # somewhere else
//   npm run archive:pull -- --final          # only the permanent packets
//   npm run archive:pull -- --recheck        # re-verify what is already here
//
// WHY THIS EXISTS. Under the packet design (docs/systemdocs/ARCHIVE.md §6) a
// finished game leaves the database, so the packet in the bucket is the ONLY
// copy of that transcript. One bucket is one place. This is the command that
// makes a second one, and it is meant to be boring enough to run on a cron.
//
// It talks to no database at all — the bucket is the whole input — so it is
// safe to point at anything, and it can run on a laptop that has the S3_*
// credentials and no reach to Postgres.
//
// TWO THINGS IT DOES NOT DO.
//
// It does not trust the transfer. Every download lands on a `.part` file, is
// verified by verifyPacket() — the same re-read-and-rehash the exporter runs
// before it lets anything believe a packet exists — and is only then renamed
// into place. A half-written file therefore never occupies the name, so the
// next run re-fetches it rather than skipping it as already there. That is the
// whole reason the temp name exists: a truncated packet is the same shape and
// roughly the same size as a good one.
//
// And it does not let a packet reach git. The transcript names the character
// behind every /conceal (ARCHIVE.md's note on the gate) and this repo is
// public. The destination is gitignored in the root .gitignore, and this
// writes a self-ignoring .gitignore into the folder as well, so a `git add -A`
// run from a different destination still cannot pick one up.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { verifyPacket } = require("../../lib/archiveExport");
const { bucketConfigured, listObjects, getObject, ARCHIVE_PREFIX } = require("../../lib/archiveBucket");

// `*` ignores this file too, hence the negation — otherwise the guard would
// disappear the first time somebody committed the folder deliberately.
const SELF_IGNORE = "# Archive packets: a public repo must never carry one.\n*\n!.gitignore\n";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  if (!bucketConfigured()) {
    console.error("No bucket credentials in this environment (S3_ENDPOINT / S3_BUCKET / AWS_*).");
    process.exitCode = 1;
    return;
  }

  const dest = path.resolve(arg("dest") || process.env.ARCHIVE_PULL_DIR || path.join(process.cwd(), "archives"));
  const prefix = has("final") ? `${ARCHIVE_PREFIX()}/final/` : `${ARCHIVE_PREFIX()}/`;

  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitignore"), SELF_IGNORE);

  const objects = (await listObjects(prefix))
    .filter((o) => o.key.endsWith(".jsonl.gz"))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  console.log(`${objects.length} packet(s) under ${prefix} -> ${dest}\n`);

  const pulled = [];
  const skipped = [];
  const failed = [];

  for (const o of objects) {
    // The key's own shape under the prefix is the folder layout: final/ and
    // live/<gameId>/ come across as they are, so a local copy reads the same
    // as the bucket does and a second run can tell them apart.
    const rel = o.key.slice(ARCHIVE_PREFIX().length + 1);
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const here = fs.existsSync(out) ? fs.statSync(out).size : null;
    if (here === o.size && !has("recheck")) {
      skipped.push(rel);
      console.log(`  = ${rel}`);
      continue;
    }
    if (here === o.size) {
      // --recheck: the file is the right size, so the question is whether its
      // bytes are still good. Nothing is downloaded to answer it.
      try {
        await verifyPacket(out);
        skipped.push(rel);
        console.log(`  = ${rel}  (re-verified)`);
      } catch (err) {
        // The bad copy is moved out of the way rather than left sitting on the
        // name. Bit rot does not change the size, so leaving it there would
        // mean every later run skipped it as already here — the one outcome
        // this command exists to prevent. The bytes are kept, not deleted:
        // whatever went wrong is worth being able to look at.
        fs.renameSync(out, `${out}.corrupt`);
        failed.push({ rel, why: `${err.message} — moved aside to ${rel}.corrupt` });
        console.log(`  ! ${rel}  ${err.message}`);
      }
      continue;
    }

    const part = `${out}.part`;
    try {
      fs.writeFileSync(part, await getObject(o.key));
      const manifest = await verifyPacket(part);
      fs.renameSync(part, out);
      pulled.push(rel);
      console.log(`  + ${rel}  ${mb(o.size)}, ${manifest.entryCount} entries, game ${manifest.gameId}`);
    } catch (err) {
      fs.rmSync(part, { force: true });
      failed.push({ rel, why: err.message });
      console.log(`  ! ${rel}  ${err.message}`);
    }
  }

  console.log(`\n${pulled.length} pulled, ${skipped.length} already here, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\nNone of these hold the name any more, so a re-run will fetch them again:");
    for (const f of failed) console.log(`  ${f.rel}: ${f.why}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
