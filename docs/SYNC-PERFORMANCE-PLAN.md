# Making the YAML syncs fast

A work plan. Written for whoever picks this up next — the reasoning is here so
you can disagree with it, not just follow it.

## Done, 2026-09-20 — steps 1 to 4, and the carry rebase

Measured on a local Postgres, `db:sync-deploy` end to end, nothing changed in
either YAML — the redeploy case the deploy actually pays:

| | round trips | wall clock |
|---|---|---|
| before | 8,033 | 14s |
| after | **95** | 2s |

That is with **no characters in the database**, so it does not include the
carry rebase at all. In production that loop opened a transaction per living
character on every deploy; it is now skipped outright unless a Tag row was
actually created or updated, which on most deploys is none.

**Step 1's gate is wrong and should not be followed literally.** It says to
measure locally and stop if the result is fast. Locally the old code ran in
14s, which would have said stop — but the production pre-deploy was
timed at **22 minutes** the same day. Latency is ~0 on a laptop, so what a
local clock measures is not the cost. Measure round trips, not seconds:
`SELECT xact_commit FROM pg_stat_database WHERE datname='…'` before and after
is enough.

The plan's reading of the code was otherwise accurate — every line number it
cites is right, and its ~7,000-queries estimate for `syncTags` matched the
7,000 `tag.findUnique` calls the new regression test counts against the old
implementation.

Equivalence was checked by building one database with the old code and one
with the new, then diffing every column: 875 `Tag` rows, 46 `TagGroup`, 285
`DesireTemplate`, and the conflict/skill/requirement join tables — all
identical. `db/test/syncTagsIdempotent.test.js` pins the second-run invariant
and fails against the old implementation, which is the point of it.

Still open: `syncRoles.js` and `syncDocuments.js`, both deliberately left
alone per step 6, and the `createMany` half of step 4 — the cold build still
creates row by row, because it needs the ids back and only runs on an empty
database.

## Why bother

`db:sync-deploy` runs on every deploy as `web`'s Pre-Deploy Command, and the
deploy cannot take traffic until it finishes. Measured on the v3 bring-up
(2026-09-20, deployment `a15e005a`):

```
build       ~1.5 min
pre-deploy  ~22 min      <- all of it here
```

Nothing in that 22 minutes is waiting on disk or on a big write. It is waiting
on round trips: the syncs walk their catalogs one row at a time, and several of
them walk the same catalog four or five times over.

Two honest caveats before you start:

- That 22 minutes is **one** measurement, and a local `sync-tags` was running
  against the same database partway through it, so some of it may be lock
  contention rather than latency. **Time a clean run first** — see "Measure
  before you change anything" below. If the clean number is three minutes, most
  of this plan is not worth doing.
- Nobody has profiled which pass dominates. The per-tag counts below are read
  off the source, not off a trace.

## The shape of the problem

Every one of these is the same bug wearing different clothes: a `findUnique`
inside a `for` loop, where one `findMany` before the loop would do.

### `db/lib/syncTags.js` — the big one (883 tags)

Five sequential passes over the whole catalog, each with its own round trip
per tag:

| Line | Pass | Queries per tag |
|---|---|---|
| 1062 | find, then create or update | 2 |
| 1108 | `parentTagId` / `requiredTagId` | 1–2 |
| 1146 | (fourth pass) | 1–2 |
| 1178 | `conflictsWith` — a `findUnique` with a **relation join** | 1–2 |

Call it ~8 round trips × 883 tags ≈ **7,000 sequential queries**, plus a
separate group loop at 913.

Two further things in that file, both worth knowing:

- **The `conflictsWith` pass reads every tag to check 42 authored conflicts.**
  `conflictSlugsBySlug` is already built in memory at 1165; the loop then asks
  the database about all 883 tags to find the handful that changed.
- **The carry rebase at 1202 is per living character**, and `settleCarry` is
  several queries each. On the empty v3 database that loop is free. **On a
  running game with 100+ characters it is not**, and it is the one part of this
  file whose cost grows with the playerbase rather than the catalog. Measure it
  separately.

### `db/lib/syncDesires.js` (322 desires)

Worse per row than tags, because the **validation** loop hits the database:

```js
for (const slug of anyTags) {
  if (!(await prisma.tag.findUnique({ where: { slug } }))) { throw ... }
}
```

…repeated for `allTags`, `notTags`, `anyRoles`, `notRoles` — five loops per
desire, one query per referenced slug, and 265 reference lines across the file.
Every one of those answers a question two `findMany`s could answer once.

Then the write half (175–240) does find-then-update per desire, plus **three
more `findMany`s per desire** at 201–205 and a relation-loading `findUnique` at
208.

### `db/lib/syncRoles.js` (8 roles)

Already mostly right — it bulk-loads zones, tags and locations up front
(128–158). The per-role find/create/update at 233 is N+1 but N is 8. **Leave it
alone.** Listed here so you don't go looking for a problem that isn't there.

### `db/lib/syncDocuments.js` (30 documents)

Same shape, N is 30. Not worth touching on its own.

## The fix

One pattern, applied to `syncTags.js` and `syncDesires.js`:

1. **Load once into a Map.** `findMany` the whole table, key by slug.
2. **Diff in memory.** Decide created / updated / unchanged with no I/O.
3. **Write in batches.** `createMany` for the new rows; group the updates and
   send them in chunks inside one `$transaction`. Skip the unchanged rows
   entirely — on a redeploy that is nearly all of them, and today they each
   still cost a read.
4. **Keep the passes, drop the re-reads.** The multi-pass structure exists for
   a real reason: `parentTagId`, `requiredTagId` and `conflictsWith` reference
   other tags, so they cannot be written until every tag has an id. That
   constraint survives. What goes is re-querying the catalog to discover ids
   the first pass already knows — carry a `Map<slug, id>` forward instead.
   `tagIdBySlug` already exists; use it.

For desire validation, the whole thing collapses to:

```js
const known = new Set((await prisma.tag.findMany({ select: { slug: true } })).map((t) => t.slug));
// then validate in memory, and keep the exact same error strings
```

## Rules

- **The error messages are the contract.** Every "unknown tag … run
  `npm run db:sync-tags` first" string is what someone reads at 2am when a
  deploy fails. Keep the wording, keep the same first-failure, and keep them
  throwing rather than collecting — a caller upstream relies on the throw.
- **The return shapes are the contract too.** `{ groupsCreated, groupsUpdated,
  tagsCreated, tagsUpdated, linksUpdated, carryRebased }` is printed by
  `db/scripts/sync/sync-tags.js` and read by the wipe's step runner. The counts
  must still mean what they meant.
- **Idempotent, and safe to re-run half-finished.** These are also the wipe's
  steps 6–9 (`LAUNCH.md` §2) and the Pre-Deploy. A batched write that half
  applies must leave a database the next run can finish from.
- **`sync-documents` is destructive and `sync-roles` prunes.** Do not widen
  what either one deletes while making it faster. The `notIn` delete in
  `syncDocuments.js:105` is already one query — leave it.
- **Warnings stay on stdout.** The Depot arbitrage warnings are how anyone
  finds out `trench-knife` sells for more than it costs.

## Measure before you change anything

Against a **local** Postgres (`npm run dev:setup`), never production:

```
time node db/scripts/sync/sync-tags.js
time node db/scripts/sync/sync-desires.js
```

Run each **twice** — the second run is the redeploy case, where almost
everything is unchanged, and that is the number the deploy actually pays. Then
instrument the five passes in `syncTags.js` separately, so you optimise the one
that costs rather than the one that looks worst. Record the before-numbers in
the commit message.

Beware one trap in timing this from a laptop: `DATABASE_URL` pointing at
Railway's TCP proxy adds real per-round-trip latency and will flatter any fix.
Measure locally, where latency is ~0, so what you are measuring is query
*count*.

## Tests

`db/test/` runs on `node --test`. There is no sync test today.

- Add a test that the tag sync is a **no-op on a second run** — same counts,
  zero updates. That is the regression that matters and the one a batching
  rewrite is most likely to break.
- Keep a test per preserved error message for the desire validator.
- `db/test/masteryTags.test.js` already fails on v3 `master` (34 tests, 1
  failure, pre-existing as of 2026-09-20). Do not let it confuse your baseline,
  and do not fix it as part of this.

## Order of work

1. Measure. Publish the clean baseline. **If it is already fast, stop here.**
2. `syncDesires.js` validation — biggest win per line changed, lowest risk,
   pure reads.
3. `syncTags.js` passes 2–5 — carry the id Map forward, stop re-reading.
4. `syncTags.js` pass 1 — `createMany` plus batched updates.
5. The carry rebase, but only with a populated database to measure against.
6. Leave `syncRoles.js` and `syncDocuments.js` alone unless step 1 says otherwise.

## Out of scope

The Discord mirror. It is slow for a different and legitimate reason — Discord
rate limits — and batching cannot help it.
