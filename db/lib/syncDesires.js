// docs/desires.yaml -> DB, called by db/scripts/sync/sync-desires.js (manual
// `npm run db:sync-desires`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/DESIRES.md.
// This is the sole write path for DesireTemplate rows.
//
// Unlike syncTagsFromYaml (upsert-only, never deletes/hides anything), this
// sync SOFT-RETIRES: a slug present in the DB but absent from the file gets
// `retired: true` (hidden from every picker, existing instances keep
// running), and a slug that comes back gets it cleared.
//
// Four passes: 0. parse + validate everything up front, no writes; 1. upsert
// scalars by slug; 2. resolve the tag/role requirement links; 3. soft retire.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { Prisma } = require("@prisma/client");
const { docsPath } = require("./repoPaths");
const { entriesOf } = require("./yamlEntries");
const { validateAutoVerify } = require("./desireAutoVerify");

// Key-order-blind JSON, for diffing a Json column: Postgres jsonb hands keys
// back in its own order, so a plain JSON.stringify would call every
// autoVerify changed on every run.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// 1 is most Desires, 2 the hard ones, 3 the really good ones, 4 the top tier and 5 the very biggest (every 4 and 5
// is once-per-game). 6 and 7 are retired: tier 7 used to mark a Desire once-per-game, and that is now
// always the explicit `oncePerLife: true`.
const TIER_WHITELIST = new Set([1, 2, 3, 4, 5]);

function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("desires.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

async function syncDesiresFromYaml(prisma) {
  const doc = loadDoc();
  const familyEntries = entriesOf(doc?.families, "key");
  const desireEntries = entriesOf(doc?.desires, "slug");

  // --- Pass 0: parse + validate, no writes. ---------------------------
  const familyKeySet = new Set();
  for (const f of familyEntries) {
    if (!f?.key) throw new Error(`docs/desires.yaml: a families entry is missing "key"`);
    if (familyKeySet.has(f.key)) {
      throw new Error(`docs/desires.yaml: family key "${f.key}" is declared more than once`);
    }
    familyKeySet.add(f.key);
  }

  // Every slug the catalog could possibly name, in two reads. The validation
  // below used to ask the database one question per referenced slug, five
  // lists deep per desire — several hundred round trips to answer something
  // two `findMany`s answer once. The loops, their order and their error
  // messages are untouched, so the FIRST failure is still the same failure.
  // Ids come back with the slugs, because pass 2 below needs exactly this
  // lookup and used to buy it three `findMany`s at a time, per desire.
  const tagIdBySlug = new Map(
    (await prisma.tag.findMany({ select: { id: true, slug: true } })).map((t) => [t.slug, t.id]),
  );
  const knownTagSlugs = new Set(tagIdBySlug.keys());
  const knownRoleSlugs = new Set((await prisma.role.findMany({ select: { slug: true } })).map((r) => r.slug));

  const slugSet = new Set();
  for (const d of desireEntries) {
    if (!d?.slug) throw new Error(`docs/desires.yaml: a desire entry is missing "slug"`);
    if (slugSet.has(d.slug)) {
      throw new Error(`docs/desires.yaml: desire slug "${d.slug}" is declared more than once`);
    }
    slugSet.add(d.slug);
    if (!d.name || typeof d.name !== "string") {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has no name`);
    }
    if (!TIER_WHITELIST.has(d.tier)) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has tier ${JSON.stringify(d.tier)} — must be one of ${[...TIER_WHITELIST].join(", ")}`,
      );
    }
    const families = d.families ?? [];
    for (const key of families) {
      if (!familyKeySet.has(key)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" references unknown family "${key}"`);
      }
    }
    if (families.length === 0) {
      console.warn(`docs/desires.yaml: desire "${d.slug}" is in no family`);
    }
    const anyTags = d.requires?.anyTags ?? [];
    const allTags = d.requires?.allTags ?? [];
    const notTags = d.requires?.notTags ?? [];
    const anyRoles = d.requires?.anyRoles ?? [];
    const notRoles = d.requires?.notRoles ?? [];
    const overlap = anyTags.filter((slug) => notTags.includes(slug));
    if (overlap.length > 0) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has "${overlap[0]}" in both requires.anyTags and requires.notTags`,
      );
    }
    for (const slug of anyTags) {
      if (!knownTagSlugs.has(slug)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.anyTags references unknown tag "${slug}" — run npm run db:sync-tags first`);
      }
    }
    for (const slug of allTags) {
      if (!knownTagSlugs.has(slug)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.allTags references unknown tag "${slug}" — run npm run db:sync-tags first`);
      }
    }
    const allNotOverlap = allTags.filter((slug) => notTags.includes(slug));
    if (allNotOverlap.length > 0) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has "${allNotOverlap[0]}" in both requires.allTags and requires.notTags`,
      );
    }
    for (const slug of notTags) {
      if (!knownTagSlugs.has(slug)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.notTags references unknown tag "${slug}" — run npm run db:sync-tags first`);
      }
    }
    for (const slug of anyRoles) {
      if (!knownRoleSlugs.has(slug)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.anyRoles references unknown role "${slug}" — run npm run db:sync-roles first`);
      }
    }
    for (const slug of notRoles) {
      if (!knownRoleSlugs.has(slug)) {
        throw new Error(`docs/desires.yaml: desire "${d.slug}" requires.notRoles references unknown role "${slug}" — run npm run db:sync-roles first`);
      }
    }
    if (d.cooldownTurns != null && !(Number.isInteger(d.cooldownTurns) && d.cooldownTurns > 0)) {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has a cooldownTurns that is not a positive whole number`);
    }
    if (d.verify != null && (typeof d.verify !== "string" || d.verify.trim() === "")) {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has a "verify" that is not a non-empty string`);
    }
    // Throws on a bad shape; the canonical form is what pass 1 stores.
    d.autoVerify = validateAutoVerify(d.slug, d.autoVerify, { knownTagSlugs });
    if (d.oncePerLife != null && typeof d.oncePerLife !== "boolean") {
      throw new Error(`docs/desires.yaml: desire "${d.slug}" has a non-boolean oncePerLife`);
    }
    const combine = d.requires?.combine;
    if (combine != null && combine !== "and" && combine !== "or") {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has requires.combine "${combine}" — only "and" (the default) or "or"`,
      );
    }
    // `combine: or` with only one populated list is a silent no-op, and worse,
    // it reads like a working gate. Refuse it rather than ship a Desire whose
    // YAML says one thing and whose evaluation says another.
    // allTags is unconditional AND by definition; ORing it with anyRoles would
    // mean "hold every one of these, or just have the role", which nobody
    // writes on purpose.
    if (combine === "or" && allTags.length > 0) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" cannot use requires.combine: or together with requires.allTags`,
      );
    }
    if (combine === "or" && (anyTags.length === 0 || anyRoles.length === 0)) {
      throw new Error(
        `docs/desires.yaml: desire "${d.slug}" has requires.combine: or but needs BOTH requires.anyTags and requires.anyRoles to be non-empty`,
      );
    }
  }

  let created = 0;
  let updated = 0;
  let linksUpdated = 0;
  let retired = 0;
  let unretired = 0;

  // --- Pass 1: upsert scalars. -----------------------------------------
  // The whole template table once, relations included, so neither pass below
  // goes back per row.
  const rowBySlug = new Map(
    (
      await prisma.desireTemplate.findMany({
        include: {
          requiresAnyTags: { select: { id: true } },
          requiresAllTags: { select: { id: true } },
          requiresNotTags: { select: { id: true } },
        },
      })
    ).map((r) => [r.slug, r]),
  );

  const idBySlug = new Map();
  for (const [index, entry] of desireEntries.entries()) {
    // Once-per-game is only ever `oncePerLife: true`. Tier 7 used to imply it, and that is gone with the tier.
    const onceEver = entry.oncePerLife === true;
    const scalars = {
      name: entry.name,
      description: entry.description ?? null,
      tier: entry.tier,
      families: entry.families ?? [],
      onceEver,
      cooldownTurns: entry.cooldownTurns ?? null,
      // Empty string is not "unset" here any more than for the other
      // scalars — an absent or blank `verify:` both mean null.
      verifyQuery: entry.verify?.trim() || null,
      // Already validated and canonicalized in pass 0 (DESIRES.md §6b).
      // DbNull, not null: a bare null on a Json column is JSON null, and "no
      // rule" is meant to be SQL NULL.
      autoVerify: entry.autoVerify ?? Prisma.DbNull,
      // Default AND. Only an explicit `combine: or` joins anyTags/anyRoles
      // with OR — see db/lib/desireGates.js#evalRequires.
      requiresAnyOf: entry.requires?.combine === "or",
      sortOrder: index,
    };

    let row = rowBySlug.get(entry.slug) ?? null;
    if (!row) {
      row = await prisma.desireTemplate.create({ data: { slug: entry.slug, ...scalars, retired: false } });
      // Pass 2 reads the three relation lists off this map, and a new row
      // holds none of them yet.
      row = { ...row, requiresAnyTags: [], requiresAllTags: [], requiresNotTags: [] };
      rowBySlug.set(entry.slug, row);
      created += 1;
    } else {
      const needsUpdate = Object.entries(scalars).some(([key, value]) => {
        if (Array.isArray(value)) return JSON.stringify(value) !== JSON.stringify(row[key]);
        if (key === "autoVerify") return stableJson(value === Prisma.DbNull ? null : value) !== stableJson(row[key]);
        return row[key] !== value;
      });
      if (needsUpdate) {
        const fresh = await prisma.desireTemplate.update({ where: { id: row.id }, data: scalars });
        // The update answers with scalars only; the relation lists carry over.
        row = { ...row, ...fresh };
        rowBySlug.set(entry.slug, row);
        updated += 1;
      }
    }
    idBySlug.set(entry.slug, row.id);
  }

  // --- Pass 2: requiresAnyTags/requiresNotTags m2m, requiresAny/NotRoleSlugs. ---
  for (const entry of desireEntries) {
    const id = idBySlug.get(entry.slug);
    const allTagSlugs = entry.requires?.allTags ?? [];
    const anyTagSlugs = entry.requires?.anyTags ?? [];
    const notTagSlugs = entry.requires?.notTags ?? [];
    const anyRoleSlugs = entry.requires?.anyRoles ?? [];
    const notRoleSlugs = entry.requires?.notRoles ?? [];

    // Every slug here was proved to exist in pass 0, so the Map cannot miss.
    const anyTagIds = anyTagSlugs.map((slug) => tagIdBySlug.get(slug));
    const notTagIds = notTagSlugs.map((slug) => tagIdBySlug.get(slug));
    const allTagIds = allTagSlugs.map((slug) => tagIdBySlug.get(slug));

    const current = rowBySlug.get(entry.slug);
    const currentAnyIds = current.requiresAnyTags.map((t) => t.id).sort();
    const desiredAnyIds = [...anyTagIds].sort();
    const currentAllIds = current.requiresAllTags.map((t) => t.id).sort();
    const desiredAllIds = [...allTagIds].sort();
    const currentNotIds = current.requiresNotTags.map((t) => t.id).sort();
    const desiredNotIds = [...notTagIds].sort();
    const currentAnyRoles = [...current.requiresAnyRoleSlugs].sort();
    const desiredAnyRoles = [...anyRoleSlugs].sort();
    const currentNotRoles = [...current.requiresNotRoleSlugs].sort();
    const desiredNotRoles = [...notRoleSlugs].sort();

    const idsChanged =
      JSON.stringify(currentAnyIds) !== JSON.stringify(desiredAnyIds) ||
      JSON.stringify(currentAllIds) !== JSON.stringify(desiredAllIds) ||
      JSON.stringify(currentNotIds) !== JSON.stringify(desiredNotIds);
    const roleSlugsChanged =
      JSON.stringify(currentAnyRoles) !== JSON.stringify(desiredAnyRoles) ||
      JSON.stringify(currentNotRoles) !== JSON.stringify(desiredNotRoles);

    if (idsChanged || roleSlugsChanged) {
      await prisma.desireTemplate.update({
        where: { id },
        data: {
          requiresAnyTags: { set: anyTagIds.map((tid) => ({ id: tid })) },
          requiresAllTags: { set: allTagIds.map((tid) => ({ id: tid })) },
          requiresNotTags: { set: notTagIds.map((tid) => ({ id: tid })) },
          requiresAnyRoleSlugs: anyRoleSlugs,
          requiresNotRoleSlugs: notRoleSlugs,
        },
      });
      rowBySlug.set(entry.slug, {
        ...current,
        requiresAnyTags: anyTagIds.map((tid) => ({ id: tid })),
        requiresAllTags: allTagIds.map((tid) => ({ id: tid })),
        requiresNotTags: notTagIds.map((tid) => ({ id: tid })),
        requiresAnyRoleSlugs: anyRoleSlugs,
        requiresNotRoleSlugs: notRoleSlugs,
      });
      linksUpdated += 1;
    }
  }

  // --- Pass 3: soft retire. --------------------------------------------
  const allRows = await prisma.desireTemplate.findMany({ select: { id: true, slug: true, retired: true } });
  for (const row of allRows) {
    const stillPresent = slugSet.has(row.slug);
    if (!stillPresent && !row.retired) {
      await prisma.desireTemplate.update({ where: { id: row.id }, data: { retired: true } });
      retired += 1;
    } else if (stillPresent && row.retired) {
      await prisma.desireTemplate.update({ where: { id: row.id }, data: { retired: false } });
      unretired += 1;
    }
  }

  return { created, updated, linksUpdated, retired, unretired };
}

module.exports = { syncDesiresFromYaml };
