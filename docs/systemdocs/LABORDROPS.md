# The labor drop die

What a Labor payout can find, on top of its ⬢. Companion to `LABORING.md`
(the payout this rides on), `SYNC.md` (the YAML-master mechanics this reuses),
`TAGS.md` (the catalog a TAG drop grants from) and `CAVING.md` (the other
"roll a die on an action, maybe grant a tag" system in the game — see §5 for
where the two diverge on purpose).

Read this before touching `db/lib/laborDrops.js`, `db/lib/syncLaborDrops.js`,
`docs/labordrops.yaml`, or the `laborDrop` entry in `db/lib/moveEffects.js`.

## 1. The die

Every Labor payout that actually resolves to a real tier — `basic`,
`skilled`, `hunting`, `farming` or `fishing` — rolls a flat, unweighted 1d6
once, on top of its ⬢. **A refining Labor (the Godard Factory floor) never
rolls at all**; it pays in Squeeze, not the die (`FACTORY.md`).

It fires from exactly one place: the `laborDrop` entry in
`db/lib/moveEffects.js`'s `MOVE_EFFECTS`, which every Labor payout already
runs through — the auto-labor pass (`db/lib/autoLaborPass.js`) and a
hand-filed Labor's turn-close payout (`db/lib/stagedPush.js`) both call
`applyMoveEffects` on the same `Action` row, so there is exactly one code path
and neither payout route can forget to roll.

**The face is never shown to the player.** Nothing else on a Move's
"Applied:" line names its own die either — a Gambit's roll is the one
exception, and it's shown at a deliberate reveal moment nothing here needs
(`stagedPush.js`'s `formatGambitRollDm`). A find or a bonus speaks for itself
in the DM; a `NOTHING` draw or an unconfigured roll says nothing at all,
which is what lets a table be padded with silence rather than announcing
every miss.

### 1a. Which tier the roll answers to

`Action.laborTier` — stamped once, either at filing (`db/lib/moves.js`, a
hand-filed Labor) or at auto-labor creation (`db/lib/autoLaborPass.js`) — is
the source, **never recomputed** at turn close. A free zone move can carry a
character somewhere else before a hand-filed Labor's payout runs
(`Action.locationId`'s own comment in `schema.prisma` is the same hazard,
predating this system); re-deriving the tier from wherever the character
happens to be standing when the die finally rolls would answer a different
question than the one that was actually priced. A row filed before this
column existed reads `null` and simply rolls no drop — same as any Labor
whose face lands on an unconfigured pool.

## 2. Combining scopes

A drop table is never one row. `LaborDropOption` rows are pool *entries*, and
a "table" for one roll is every entry that answers to it across up to **six**
scopes at once, drawn from as one combined pool:

| Scope | Matches when |
|---|---|
| Global | always |
| Labor type | the winning tier |
| Zone | the zone the Labor was filed in |
| Labor type + Zone | both at once |
| Location | the Location the Labor was filed in |
| Labor type + Location | both at once |

**Zone and Location never combine with each other** — there is no seventh
"Labor type + Zone + Location" bucket, and no plain "Zone + Location" one.
Farming in a zone with no location-specific table still draws from Global,
`laborType: farming`, and the zone's own pool, all at the same die face —
`db/lib/laborDrops.js#scopeFilters` is the one place this is expressed, and
`db/test/laborDrops.test.js` pins its exact output.

The combined pool is drawn from **uniformly** — every entry has the same
chance, whatever scope it came from. There is no separate weight field;
**repeat an entry to weight it**, the way the seeded fishing and farming
tables repeat `nothing` to make a miss more likely than a find. This is a
deliberate simplicity choice: a weight column is easy to add later
(`LaborDropOption.weight` alongside a change to `pickLaborDropOption`'s draw)
if repetition ever stops being expressive enough.

### 2a. The seventh gate: `requiredTag`

The six scopes above answer "where, and doing what" — a **seventh**, fully
orthogonal dimension answers "held by whom". A `LaborDropOption` row may
carry `requiredTagId`: null (the overwhelming common case) means every
character; set, the row only joins the combined pool for a character who
holds that tag too. Forester-in-the-Forest is the first user: a `forester`
skill whose own catalog line — "gaining an advantage in finding food, water,
or shelter" — did nothing at all before this, now backs a bonus pool nested
under `zone.forest`.

It is deliberately **not** part of the SQL `WHERE` `scopeFilters` builds.
"Does the drawing character hold tag X" cannot be expressed against a query
keyed on their zone/location/laborType alone, so `db/lib/laborDrops.js`
fetches every row the six scopes already matched and **post-filters** in
application code — `passesRequiredTag(row, heldTagIds)`, pure and
unit-tested (`db/test/laborDrops.test.js`) precisely because it has no
database dependency to fake. `heldTagIds` defaults to an empty set, so a
caller that doesn't pass it — or genuinely holds nothing — sees every gated
row excluded rather than leaking in; there is no "unknown, so allow it"
branch anywhere in this path.

`db/lib/moveEffects.js`'s `laborDrop.apply` loads the character's held tags
**fresh, at apply time** — the same live-state reasoning §1a gives for
`Action.laborTier`: a skill learned between filing and turn close should
count, the same way the tier itself is never re-derived from a stale
snapshot. It is one extra `characterTag.findMany`, run once per Labor
payout, alongside the query the drop itself already needs.

Authored as a `requiresTag:` key nested under any roll-keyed node — a whole
bucket, or one place/labor-type inside it — mapping skill slug to another
roll-keyed node of the same shape:

```yaml
zone:
  forest:
    requiresTag:
      forester:
        6:
          - rope
          - trail-ration
          - "+1"
```

The nesting is a plain recursive parse (`db/lib/syncLaborDrops.js#rowsFromScopeNode`),
so it isn't special-cased to `zone` — `laborType.hunting.requiresTag.forester`
or even a double-gated `requiresTag.forester.requiresTag.butcher` parse the
same way with no extra code, though nothing seeds those yet. `npm run
db:audit-labor-drops -- --holds <skill-slug>` (optionally with `--zone`/
`--location`) previews the enriched combined pool a holder actually draws
from; omit it and the Combined section shows the baseline every other
character gets, which is also exactly what the tool defaults to so a gated
entry can never be mistaken for already-active.

## 3. Pool entries

Authored in `docs/labordrops.yaml`, one list per (bucket, roll face). Three
kinds, and the sync tells them apart by the string's own shape:

```yaml
laborType:
  hunting:
    6:
      - nightshade-herb   # a Tag slug -> grants the tag
      - "+2"              # a signed integer -> a ⬢ delta (usually positive;
                           #   nothing stops a bad-table entry going negative)
      - nothing            # the explicit no-result pad, case-insensitive
```

A **TAG** draw grants through `db/lib/tagWrites.js#addToStack` — the same
primitive every other tag grant in the game uses. A repeat find of a
stackable tag adds to the stack; a repeat find of a non-stackable one is a
no-op grant rather than an error, so authoring the same rare tag into two
different scopes' pools can never throw at draw time. A **RESOURCES** draw
credits (or, for a negative entry, debits, floor-clamped) through the same
`addResources` primitive `resources` and the Gambit ⬢ delta use. A
**NOTHING** draw, or a roll that matches no configured entry at all, applies
nothing and is recorded nowhere — see §1's note on why the face itself is
silent.

## 4. Undo comes for free

A labor drop is just another `MOVE_EFFECTS` entry (`db/lib/moveEffects.js`),
snapshotted onto `Action.appliedEffects` exactly like `resources` and
`exhausted`. That means a GM reverting a Labor Move from `/gm/turns` — the
ordinary Move-undo path, nothing built for this system specifically — already
takes the found tag back or debits the bonus ⬢, with no extra code. There is
no separate "undo this find" button the way `CAVING.md` §4 needed one: Caving
loot is granted outside the Move machinery entirely (a `CavingRoll`, not an
`Action`), so it had to build its own revert; a labor drop rides the revert
this codebase already had.

The flip side: there is **no GM lens** for this system yet, unlike Caving's
(`CAVING.md` §5). A find shows up in the player's DM and in the Move's own
`appliedEffects`, but nothing surfaces "everyone who found something this
turn" as its own view.

Printing it on the desk costs **two** edits, not one: `describeMoveEffects`
(`db/lib/moveEffects.js`) is mirrored by hand in `web/lib/moveRows.js#paidLabel`
so the web never imports `db/lib` just to print "+5 ⬢". The first version of
this system taught only the db half, and `/gm/turns` rendered
`laborDrop: [object Object]` for a week. Teach both. Worth
building once the table is real and Bascinet wants to watch it; not built
now because there is nothing yet worth watching.

## 5. Why this isn't the Caving Die twice

Two "roll a die on an action, maybe grant something" systems now exist in
this codebase, and they deliberately don't share code, because they answer
different design questions:

- **The Caving Die's table is code** (`db/lib/cavingLoot.js`) — a fixed
  weighted-tier draw nobody expects a GM to retune without a deploy, gated by
  `validateCavingLoot()` at startup. **The labor drop table is data**
  (`docs/labordrops.yaml`) — Bascinet's own session notes call it out
  explicitly as unfinished and iterative ("we don't have the full loot table
  figured out yet"), and the whole point of this system is a GM-editable
  pool with no code change required to reshape it.
- The Caving Die rolls **on arrival** at a Location, with a **1** meaning
  GM-adjudicated trouble that lands unresolved on its own desk lens. The
  labor drop die rolls **on a Labor payout resolving**, and every face is
  either silent, a tag, or a ⬢ delta — nothing here is ever left for a GM to
  narrate. A "bad" result is still just a pool entry like any other — a
  `bruised` on a 1, never a queued adjudication.
- Caving loot is a **separate row** (`CavingRoll`) outside the Move
  machinery, because a cave arrival isn't a Move at all. A labor drop rides
  on the `Action` a Labor already is, which is what buys it free Undo (§4)
  at the cost of no dedicated log.

## 6. Seeding a table for the first time

`docs/labordrops.yaml` seeds `laborType.hunting.6`, `laborType.farming.6`,
`laborType.fishing.6`, `global.1`/`global.6`, and one skill-gated bucket,
`zone.forest.requiresTag.forester.6` (§2a). `location`, `laborTypeZone`,
`laborTypeLocation` and both `basic`/`skilled` on their own are still `{}`,
which is a legal, deliberate "not configured yet". An unconfigured
`(bucket, roll)` pair — or a `requiresTag` gate nobody in the combined draw
happens to hold — contributes nothing to any pool; neither is an error, and
both are indistinguishable at draw time from every entry in a configured
pool happening to be `nothing`.

`global.1` is the first real use of the Global bucket, and it's a
demonstration of what Global is *for*: three self-clearing minor mishaps
(`bruised`, `vomiting`, `aching` — 2-3 turns, no mechanical cost beyond the
tag) with no hunting/farming/fishing-specific equivalent in the catalog, so
one shared pool covers a bad roll for every labor type at once — Basic and
Skilled included, which is why `db:audit-labor-drops`'s combined view reports
100% hit rate on their roll-1 even though neither has an authored bucket of
its own. `global.6` is one entry, `obol` — the physical form of ⬢ itself
(`DEPOT.md`), so it is priced at exactly 1 ⬢ rather than by a `sellablePrice`
it doesn't carry (§6a).

To add to a table: edit `docs/labordrops.yaml`, run
`npm run db:audit-labor-drops` to see what it's actually worth before
committing to it (§6a), then `npm run db:sync-labor-drops` (or
`npm run db:sync`, which includes it last) to apply it. The sync is
**destructive on every run** — the whole `LaborDropOption` table is deleted
and rebuilt from the YAML, the same posture as `db:sync-documents`
(`SYNC.md` §1) — which is safe here specifically because nothing in the game
ever points *at* one of these rows (no `CharacterTag`, no `Action` foreign
key), so there is no player state a partial upsert would need to protect.

### 6a. Pricing a table before you commit to it

`npm run db:audit-labor-drops` reads `docs/labordrops.yaml` straight off
disk — no sync needed first — and prints, for every authored bucket and
every combined labor-type pool:

- each entry's Depot sell value (a `RESOURCES` entry's own ⬢ delta; a `TAG`
  entry's `sellablePrice` where it has one, `obol` hardcoded to 1 ⬢ since it
  IS the currency rather than something priced in it);
- the pool's ⬢ **expected value** — the plain average of every entry's ⬢
  value, `nothing` and an unpriced tag both counting as 0;
- the pool's **hit rate** — the share of the pool that isn't `nothing`,
  independent of whether the hit carries a ⬢ price (a granted debuff is a
  hit with 0 ⬢ EV, and the report says so rather than hiding it inside the
  average).

A tag's `pointCost` is printed next to an unpriced entry for reference, but
never summed into the ⬢ EV — it's a different scale (character-build points),
and mixing the two would make the number mean nothing. Pass `--zone <slug>`
and/or `--location <slug>` to preview what a combined pool would look like
at a place with its own scoped bucket, and `--holds <skill-slug>` (comma-
separated for more than one) to also fold in whatever a `requiresTag`-gated
bucket adds for a character who holds it (§2a). Every `requiresTag` entry
still prints in the Authored-pools section regardless of `--holds` — it's
only the Combined section, the "what a real payout draws from" view, that
the flag changes.

### 6b. `--write`: the file annotates itself

`npm run db:audit-labor-drops -- --write` is the one flag that touches the
file. It rewrites `docs/labordrops.yaml`'s own comments in place — every
pool entry's ⬢ value, every roll's **own** EV (this bucket alone, CONDITIONAL
on landing on that face) *and* **combined** EV (what a real payout in that
exact scope actually pools together on that face, per §2's six buckets and
§2a's seventh gate) — and, on every category header (a labor type, a place,
a skill under `requiresTag`), a rollup that is **not** those per-face numbers
sitting next to each other.

**The rollup is `⬢ EV/labor`: the true, unconditional expected value of one
Labor action in that scope.** The die is 1d6, uniform, so it is `(1/6) *`
the sum of every face's combined EV — and a face nobody configured (almost
always 2-5) is a real, counted **zero** in that sum, not a face left out of
it. A pool authored only at rolls 1 and 6 does NOT average those two
numbers together; four of the six faces produce nothing, and they belong in
the denominator. `hills-waterway`'s fishing table is the worked example:
roll 6 alone pools to `EV 3.88 ⬢`, but the actual value of fishing there is
`3.88 / 6 ≈ 0.65 ⬢` per Labor, because five of every six attempts land on a
face (1-5) that gives nothing or (on this table) only the Global roll-1
mishaps. Hit rate in the rollup is the same kind of number: the share of
**all six faces**, not just the configured ones, that produce something.

That rollup is what "cascading" means concretely: `forester:`'s own line is
the real ⬢-per-Labor a Forester nets from Global + Zone + their own gated
pool, combined and properly weighted, without anyone hand-computing it —
edit the pool, run `--write`, read the new number. The terminal report
(no `--write`) prints the same per-tier total after each tier's per-face
lines, labeled `-> <tier>: ⬢ EV/labor ...`.

It is **text surgery, not a YAML round-trip** (`db/lib/labordropsAnnotate.js`)
— an indentation-stack walker over the raw lines that only ever replaces a
trailing `# ...` on a line it recognizes (a roll key, a category key, a pool
entry). Every other line — every hand-written paragraph, every blank line,
the six-bucket structure itself — passes through untouched, because nothing
here re-serializes the YAML; it can't reorder a key or reformat a list. This
is a deliberate trade against a generic comment-preserving YAML library: the
file's shape is fully hand-authored and disciplined (2-space indents,
`key:` lines, numeric roll keys, `- entry` lines), so a bespoke walker
tailored to exactly that shape is simpler and safer than a general one.

**A `PostToolUse` hook runs it automatically.**
`.claude/hooks/labordrops-value-hint.py`, registered in the project's
`.claude/settings.json`, fires on every Edit/Write to this file and runs
`--write` right away — the mechanical numbers are never stale for more than
one edit. What the hook cannot do is judge *why* an entry belongs in a pool,
so it hands that back as a reminder instead:

**Convention for a pool entry's comment: blurb first, then ` — `, then the
mechanical value.**

```yaml
- minor-bleeding  # a boar's tusk catches you — not sellable
```

Write the blurb yourself when you add an entry — `db/lib/labordropsAnnotate.js`
never invents one. On every later `--write`, `splitBlurb()` preserves
whatever sits before ` — ` and only regenerates what comes after; a bare
comment that already equals today's mechanical value (no blurb ever
written, or the tool's own prior output) is left alone rather than wrapped
into a fake blurb, which is what stops a plain refresh from ever duplicating
itself into `sells 4 ⬢ — sells 4 ⬢`.

## 7. The pads on face 1

Every roll-1 bucket carries its own `nothing` entries, and the fraction
deepens as buckets stack: `global` 30%, `laborType.hunting` 40%, every zone
and cross bucket 50%.

This is not decoration, and it is the thing most easily broken by a
well-meaning edit. The draw is uniform over the **concatenation** of whichever
buckets match (§2), so the pooled no-wound rate is the size-weighted average of
the contributing buckets' own rates. Pad only `global` and a hunter in the
Depths — who pools four buckets — is back to "a 1 always hurts", which is
exactly the character who least deserves it. The deepening pads are why a
Depths hunter is slightly *safer* per 1 (42% clean) than a labourer in Town
(30%): the dangerous places add more entries, so they need more silence in them
to stay level.

**Adding a wound to a roll-1 bucket means adding pad with it.** Otherwise you
have quietly raised the wound rate everywhere that bucket applies.

Where it currently lands, per Labor:

| Situation | No wound on a 1 | Wound | Severe | Grievous |
|---|---|---|---|---|
| Basic/Skilled, quiet zone | 30% | 11.7% | — | — |
| Hunting, Forest | 35% | 10.8% | — | — |
| Hunting, Forest Cliffs | 40% | 10.0% | 1.1% | — |
| Hunting, Marshes / Depths | 42% | 9.6% | 2.1% | 0.42% |
| Hunting, Black Hills | 42% | 9.6% | 0.4% | — |
| Basic labor, Marshes / Depths | 40% | 10.0% | 1.7% | — |

Every wound carries the catalog's `durationTurns` (2-4) onto the grant, so
these all clear on their own — see `laborDrop.apply`'s own comment for why
that has to be stamped at grant time rather than read back from the catalog.

## 8. The Depths corpse table

`laborTypeZone.hunting.depths` configures faces **5 and 6** with one pool:
`skinless-corpse` ×3, `nekker-corpse` ×3, `graga-corpse` ×3, `aberrant-heart` ×1.

Zone-scoped rather than repeated across six Locations because
`laborAccess.js#resolveLaborRate` refuses a tier whose location coefficient is
missing or zero, and `depths-crystal-chambers` is the only Depths Location with
no `yield:` block. Hunting is already impossible there, so "zone-wide" and
"every Depths Location with a yield" name the same set.

Face 5 is otherwise unconfigured everywhere, so a 5 draws from this pool alone
— 90% a corpse, 10% the heart. A 6 pools with the global obol and the hunting
table (18 entries), halving it. That asymmetry is deliberate: a 5 in the Depths
is always a body, a 6 is a body or an ordinary find. Per Depths-hunting Labor:
**23.3% a corpse, 2.59% an Aberrant Heart.**

Two things to know about the corpses. They are `sellable: false`, so
`db:audit-labor-drops` scores them at 0 ⬢ and the bucket's EV is really the
heart alone — their worth is butchering (`skinless-brain`, `graga-sac`,
`nekker-pheromones`). And a Graga Corpse is 75 lb against a 71 lb base cap, so
a hunter who draws one walks out Overburdened; the carry pass settles it at
turn close (`TURN-ENGINE.md` §8b), shedding to a Depths room only past the
106 lb hard cap.

## 9. Where the code lives

| Concern | File |
|---|---|
| The config table, and its two enums | `db/prisma/schema.prisma` (`LaborDropOption`, `LaborDropLaborType`, `LaborDropKind`) |
| Reading a combined pool and drawing from it | `db/lib/laborDrops.js` |
| The die roll, the grant/credit, and Undo | `db/lib/moveEffects.js`'s `laborDrop` entry |
| Which tier a roll answers to | `Action.laborTier`, stamped by `db/lib/moves.js` and `db/lib/autoLaborPass.js` |
| The YAML master | `docs/labordrops.yaml` |
| The sync | `db/lib/syncLaborDrops.js`, `db/scripts/sync/sync-labor-drops.js` |
| Pricing a table, and `--write`ing its own comments | `db/scripts/ops/audit-labor-drops.js`, `db/lib/labordropsAnnotate.js` |
| The auto-refresh hook | `.claude/hooks/labordrops-value-hint.py` |
| Combine-scope tests | `db/test/laborDrops.test.js` |
| Cascading-EV / annotator tests | `db/test/labordropsAnnotate.test.js` |
