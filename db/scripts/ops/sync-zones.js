// docs/zones.yaml -> the places.
//
//   npm run db:sync-zones            # what the next Restart Game would change
//   npm run db:sync-zones -- --apply # change it now
//
// Restart Game and Start Game run this themselves: every place is made to
// match the YAML, and whatever a GM changed during the game goes back
// (db/lib/zonesSync.js). The script is for looking first, and
// for bringing a game in progress up to the YAML by hand. Run that way it
// writes only the authored columns: nothing lying in a room moves, no gate
// opens or shuts, and a stash seed that changed reaches the room at the next
// game's pour.
require("dotenv").config();
const { prisma } = require("../../index");
const { syncZonesFromYaml } = require("../../lib/zonesSync");

function list(label, lines) {
  if (!lines.length) return;
  console.log(`${label} (${lines.length}):`);
  for (const line of lines) console.log(`  ${line}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const report = await syncZonesFromYaml(prisma, { apply });
  const verb = apply ? "" : "would be ";

  const created = Object.entries(report.created)
    .filter(([, rows]) => rows.length)
    .map(([kind, rows]) => `${kind}: ${rows.join(", ")}`);
  list(`${apply ? "Created" : "Would create"}`, created);
  list(`${apply ? "Sides added" : "Sides to add"}`, report.sidesToAdd);
  list(`Fields ${verb}changed`, report.changes);
  list(`${apply ? "Retired" : "Would retire"}`, report.retired);
  list(`${apply ? "Removed" : "Would remove"}`, report.deleted);
  list("Not retired, for a person to look at", report.reportOnly.map((r) => `${r.kind}/${r.key}: ${r.reason}`));
  list("Warnings", report.warnings);

  const nothing =
    !created.length && !report.sidesToAdd.length && !report.changes.length && !report.retired.length && !report.deleted.length;
  if (nothing) console.log("Nothing to change: the places match docs/zones.yaml.");
  if (!apply && !nothing) console.log("\nDry run. Re-run with `-- --apply` to write it.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
