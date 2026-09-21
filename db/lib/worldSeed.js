// Pouring the AUTHORED world into the database: what docs/zones.yaml says is
// simply standing there, and what it says is simply lying around.
//
// Two things belong here. Room stashes are the older half and live in
// db/lib/roomStashSeed.js; this module adds the Location `structures:` half and
// puts one entry point over both, so "furnish the world" is one call rather
// than a list a caller can get half-right.
//
// WHY THIS EXISTS AT ALL. The Restart Game wipe deletes every Structure row
// (web/app/(app)/gm/dev/actions.js) because Structure cascades from Location
// and the wipe never deletes a Location. Nothing used to put them back: the
// zones sync stopped provisioning structure, and db/lib/importZones.js is a
// one-shot that skips a Location it already has. So the Square's crucifix, the
// forge, the dungeons and the surgical theater vanished on the first wipe and
// never returned.
//
// TWO CALLERS, AND NEITHER CAN HURT A GAME IN PROGRESS. The wipe calls this
// after its tag sync, and Start Game calls it as a top-up for a lobby that was
// never wiped. Both are safe to run twice, and that is not luck — each half
// carries its own guard:
//
//   - a stash slug already in Room.seededStashSlugs is never poured again, so a
//     room players looted stays looted (roomStashSeed.js says why at length);
//   - a structure type with anything PRESENT at that Location is skipped, so a
//     forge somebody is standing in is never raised a second time.
//
// So a second run writes nothing that is already there. It is NOT a full
// mid-game guard, and the gap is worth knowing: the structure test is "nothing
// present", not "never seeded", so an authored structure players tore down
// WOULD be raised again. That is exactly right after a wipe and wrong during a
// game, which is why only the wipe and Start Game call this — neither can fire
// mid-game — and why nothing a player or a turn reaches should start.
//
// Takes `prisma` as a parameter for the db/lib/dm.js reason, and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath } = require("./repoPaths");
const { parseZonesYaml } = require("./syncZones/parse");
const { PRESENT_STATUSES } = require("./structures");
const { seedAuthoredStashes } = require("./roomStashSeed");

function readZonesYaml() {
  const p = docsPath("zones.yaml");
  if (!p) throw new Error("Cannot find docs/zones.yaml — see db/lib/repoPaths.js");
  return parseZonesYaml(yaml.load(fs.readFileSync(p, "utf8")));
}

// One Location's authored `structures:` list. `standing` is how many rows of
// that type are already PRESENT here — the caller counts it, so a batch can
// count once for the whole location instead of once per slug.
//
// Returns { created, skipped, unknown }. An unknown slug is a REPORT, not a
// throw: tags sync before this in the working order (SYNC.md) but a fresh
// catalog can still be missing one, and a single typo should not cost the other
// fifty locations their furniture.
async function seedLocationStructures(prisma, location, slugs) {
  const report = { created: [], skipped: [], unknown: [] };
  for (const slug of slugs) {
    const tag = await prisma.tag.findUnique({ where: { slug }, select: { name: true } });
    if (!tag) {
      report.unknown.push(slug);
      continue;
    }
    const standing = await prisma.structure.count({
      where: { locationId: location.id, typeSlug: slug, status: { in: PRESENT_STATUSES } },
    });
    if (standing > 0) {
      report.skipped.push(slug);
      continue;
    }
    // Already finished, cost nothing, took nobody a turn: it was always here.
    await prisma.structure.create({
      data: {
        locationId: location.id,
        typeSlug: slug,
        typeName: tag.name,
        status: "COMPLETE",
        turnsNeeded: 1,
        turnsDone: 1,
        resourcesCost: 0,
      },
    });
    report.created.push(slug);
  }
  return report;
}

// Every Location in the game whose authored `structures:` list is missing
// something. `doc` lets a test hand in an already-parsed YAML fixture instead
// of reading docs/zones.yaml off disk, the same hook importZonesFromYaml takes.
async function seedAuthoredStructures(prisma, { doc = null } = {}) {
  const { locationEntries } = doc ? parseZonesYaml(doc) : readZonesYaml();
  const wanted = locationEntries.filter((e) => (e.structures ?? []).length > 0);
  const report = { locations: 0, structures: 0, unknown: [] };
  if (wanted.length === 0) return report;

  const bySlug = new Map(
    (
      await prisma.location.findMany({
        where: { slug: { in: wanted.map((e) => e.slug) } },
        select: { id: true, slug: true },
      })
    ).map((l) => [l.slug, l]),
  );

  for (const entry of wanted) {
    const location = bySlug.get(entry.slug);
    if (!location) {
      // The YAML names a place the database has not been given yet. That is
      // db:import-zones' job, not this seeder's — say so rather than create it.
      report.unknown.push(`${entry.slug}: no such location — run db:import-zones`);
      continue;
    }
    const out = await seedLocationStructures(prisma, location, entry.structures);
    if (out.created.length > 0) {
      report.locations += 1;
      report.structures += out.created.length;
    }
    for (const slug of out.unknown) report.unknown.push(`${entry.slug}: ${slug}`);
  }
  return report;
}

// Furnish the world: what stands in a Location, and what lies in a Room. The
// one call the Restart Game wipe and Start Game both make.
//
// Neither half is allowed to cost the other its run — a missing tag catalog
// should not leave the rooms bare as well as the squares — so each is caught
// on its own and the failure is reported rather than thrown.
async function seedAuthoredWorld(prisma, { doc = null } = {}) {
  const report = { structures: null, stashes: null, unknown: [] };
  try {
    report.structures = await seedAuthoredStructures(prisma, { doc });
    report.unknown.push(...report.structures.unknown);
  } catch (err) {
    report.structures = { locations: 0, structures: 0, unknown: [], error: String(err?.message ?? err) };
  }
  try {
    report.stashes = await seedAuthoredStashes(prisma);
    report.unknown.push(...report.stashes.unknown);
  } catch (err) {
    report.stashes = { rooms: 0, items: 0, unknown: [], error: String(err?.message ?? err) };
  }
  return report;
}

module.exports = { seedLocationStructures, seedAuthoredStructures, seedAuthoredWorld };
