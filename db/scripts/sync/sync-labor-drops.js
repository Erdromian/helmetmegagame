// Manual, terminal-invoked sync from docs/labordrops.yaml -> DB.
// Run with `npm run db:sync-labor-drops`. The same function
// (db/lib/syncLaborDrops.js#syncLaborDropsFromYaml) is also called from
// wipeGameData's "Restart Game" flow (web/app/(app)/gm/dev/actions.js).
//
// Run this AFTER db:sync-zones and db:sync-tags — every slug named in the
// YAML is validated against the Tag/Zone/Location rows those two create.
require("dotenv").config();
const { prisma, syncLaborDropsFromYaml } = require("../../index");

async function main() {
  const summary = await syncLaborDropsFromYaml(prisma);
  console.log(`labor drop options: ${summary.total}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
