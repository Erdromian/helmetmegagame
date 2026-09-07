# Crafting, Destroy, and the capability flags

The Craft button on `/character` (it replaced Add Tag), the Destroy button
(it replaced Remove Tag), multi-turn projects, and the four flags on `Tag`
that decide which menu a tag sits in.

## 1. The four flags

Every player tag menu is one boolean on `Tag`, re-checked server-side by the
matching request. Three are hand-written in `docs/tags.yaml`; `removable` is
derived from the category (§5).

| Flag | Menu | Re-check |
|---|---|---|
| `craftable` | Craft | `craftRequest` (`character/requestActions.js`) |
| `removable` | Destroy | `destroyTagRequest` (derived, §5) |
| `healable` | Heal | `healCharacterRequest` via `web/lib/healRequests.js#isHealable` |
| `teachable` | Learn / Teach | `db/lib/lessons.js#teachableSkills` (LESSONS.md) |

The 9/2026 sweep set `healable: true` on every health tag with a cure and
`teachable: true` on every skill. Health is not `removable` — a wound is
healed, not thrown away, and a condition nobody can cure runs its course or
waits for a medic — which the category rule now gives for free. `docs/tags.yaml`'s header documents each
key. Harm's menu is the one that still reads the category
(`INFLICTABLE_GROUPS` / `INFLICTABLE_SLUGS`, a curated list).

## 2. A recipe

A craftable tag's `requirement:` block is the recipe, and Craft enforces all
of it:

- `skills` — every listed skill, or a higher tier of it, must be held
  (`db/lib/medicalVision.js#satisfiedSkillIds`, the same walk Heal uses).
  The page decides this per recipe (`knownRecipeIds`) and the menu shows only
  those; the server re-checks.
- `resourceCost` — ⬢ per unit, **charged when the work starts**, never
  refunded on cancel or on undo-by-GM of a mid-project turn. Paid by
  **yourself, a Room stash here, or a person standing here** (payer select;
  a person is DM'd "*X paid N ⬢ from your purse toward Y*").
- `turnsCost` — the WORK one unit takes, in Moves. **0** is Dead Simple: no
  Move, rationed to `DEAD_SIMPLE_PER_TURN` units a turn (SMITHING.md §2).
  **1** is this turn's whole Routine — one per turn, by arithmetic. **`1/N`**
  is a fraction of it: an Alcohol is `1/3`, so three fill a Routine and a
  spare third takes more same-family work. **2+** is a project (§3), one
  unit per project. Quantity is limited by this arithmetic alone (Chris
  2026-09-06); the sync stores `1/N` as `requirementTurns: 1` +
  `requirementPerTurn: N`, the engine's share encoding.
- `perTurn` — a RATION, and **only legal at `turnsCost: 0`**: a hard daily
  cap below the Dead Simple pool (bliss at 2, bone-mask at 1). It is never a
  work cost — the sync refuses it on anything that costs a Move, because
  for a while it did double duty as the work fraction and the two meanings
  drifted (one Routine held 99 Broadswords). Work is `turnsCost`; the cap is
  `perTurn`.
- `items` — the ingredients (`CORPSES.md` §8). **Spent by default**,
  `quantity` units per craft, taken off the crafter's own sheet **when the
  work starts** — so a multi-turn project pays up front and `continueCraft`
  does not re-check them. A `group:` entry is *kept* instead: any corpse to
  hand satisfies Miasma, and none is used up. An `anyOf:` entry is a spend the
  player chooses, posted from the dialog as `ingredientChoice` and re-checked
  server-side for membership and possession. A `placement:` recipe may not
  carry `items` at all; the sync refuses the pair.
- `gambit` is ignored: crafting is always a Routine. The sweep cleared it on
  the two brews that carried one (BREWING.md).

**Smith's work also needs a forge.** A recipe naming a `smithing-*` or
`builder-*` skill requires Workshop Equipment in reach — held, or set up in a
room you can get into where you stand (`db/lib/equipmentReach.js`). See
[`SMITHING.md`](SMITHING.md) §2a; `needsWorkshop()` in
`web/lib/tagRequests.js` is the shared predicate, so the dialog and the server
cannot disagree.

The purchase-side checks still apply — prerequisite chain, exclusivity,
`conflictsWith`, "already hold a higher tier", non-stackable duplicates
(`craftGrantChecks`). A finished tag lands with `TagSource.CRAFT`, its clock
stamped by `expiryForGrant`, the tiers below it replaced.

## 2a. The Move budget

A Routine is one Move, and crafting can now spend it in **fractions**. The
rule is one family of work per turn, and one Move's worth of it.

**What a craft costs.**

| Recipe | Cost of the Move |
|---|---|
| `turnsCost: 0`, inside its free allowance | nothing — a free action, as before |
| `turnsCost: 0`, past the allowance | `1/allowance` per extra unit (a fifth Dead Simple item is ¼ of a Move) |
| `turnsCost: 1/N` | `quantity/N` — each unit is 1/N of a turn's work |
| `turnsCost: 1` | `quantity/1` — one is a turn's work |
| `turnsCost: 2+` — a project start or continue | the whole Move, every turn it runs — and ONE unit per project, its turns being per piece |

The allowance is the recipe's own `perTurn`, or the shared Dead Simple pool of
4. Going past it used to be refused outright; the ruling (2026-09-05) is that
the allowance stays free and the units after it come out of the Move. So 4
work knives are still free, the fifth costs ¼ of a Routine, and the ninth is
impossible because the Routine is gone.

That fifth knife has a second price worth knowing: spilling files an Action,
and the auto-labor pass pays only characters with **no** Action
(`autoLaborPass.js`, `LABORING.md`). Four free knives leave the day's labor
untouched; the fifth costs it.

**The family.** `craftFamily()` (`web/lib/tagRequests.js`) is the recipe's
first `requirementSkills` slug whose prefix is one of `brewing`, `cooking`,
`smithing`, `builder`, `crafting` — barbed-net's `fundamentalist` sits
beside `crafting` and the recipe is crafting. A recipe gated outside the
five trades takes its first skill prefix AS its family (bone-mask is
`butcher` work, holy water `blessing` work), and one with no skill at all is
generic `craft` — so EVERY recipe Move-prices by the same arithmetic (Chris
2026-09-06). Bone-mask's ration spilling into a butcher's Move, instead of
walling, is the one behavior this changed.

A turn's Routine commits to one family. Half a Routine at the still and half
at the anvil is not a thing, and that includes the Dead Simple pool: spill a
work knife (`smithing`) into the Move and a sling (`crafting`) is refused for
the rest of the turn.

**The ledger.** `Action.craftBudget` on the `auto:craft` Action:

```json
{ "family": "brewing", "usedNum": 2, "usedDen": 3,
  "entries": [{ "tagId": "…", "name": "Alcohol", "qty": 2,
                "num": 2, "den": 3 }] }
```

`usedNum/usedDen` is the running total in lowest terms; each entry carries its
own fraction (a straddling order's free half is `qty` minus the billed
`num`). All of it is integer arithmetic
(`web/lib/craftBudget.js`) — three thirds have to be exactly one Move.

Nothing is derived and nothing is cached: **the row is the record.** Every
budget-consuming craft takes the Character `FOR UPDATE` row lock, re-reads the
Action inside the transaction, re-runs the family and remainder checks there,
and `fileAutoRoutine`'s `P2002` catch stays the backstop under even that. The
Action's `description` is rebuilt from the entries each time one lands —
"Crafting this turn: 2× Alcohol, 1× Cat. ‡" — so the desk reads the whole
turn's work in one line. A project turn keeps its own "(2/3)" line, because a
project never shares a turn.

**GM semantics.** **Reject** deletes the Action and the ledger with it
(`deleteActionRestoringTurn`, which needs to know none of this), and the
player may craft again that turn from scratch. There is no Undo of a
finished craft — a GM reversing one works by hand from the audit row (§4).
Nothing in the turn-end push reads `craftBudget`.

**The dialog** quotes all of this before the player commits: the family and
the fraction left as a header line, cross-family and unaffordable recipes
greyed with the reason on the row, a quantity field clamped to whichever runs
out first (ingredients, budget, the server's 99), and a confirm that says
which units are free and what the rest lock. Every number of it is computed
server-side in `character/page.js` and re-checked by `craftRequest` under the
lock — the dialog is a hint, never the gate.

## 3. Projects

```
CraftProject { characterId, tagId, quantity, turnsNeeded, turnsDone, resourcesCost,
               consumed, payerKey, payerName, status ACTIVE|DONE|CANCELLED,
               startedTurnId, lastTurnId }
```

A table, not an "in progress" pseudo-tag: it has a counter, a payer and a
link to the Move that last advanced it, and a tag would show on 🔍 inspect
and count toward carry.

- **Start** (`craftRequest`, `turnsCost ≥ 1`): needs a **clean** Move
  (`moveWindow` open, no Action this turn — and any fraction already spent on
  a batch craft blocks it, §2a); charges the payer **and spends the
  ingredients**, snapshotting them onto `consumed`; creates the project at
  `turnsDone: 1`; files the Action — `ROUTINE`, `CONFIRMED`, `PASSED`,
  `appliedEffects: {}`, `gmNotes: "auto:craft"`, description "Crafting 4×
  Arrow (1/3). ‡". A one-turn recipe finishes on the spot and puts the
  snapshot straight on the request.
- **Continue** (`continueCraft`): the Craft dialog lists active projects;
  pick one, choose *Keep working on it*. Same Move check; one advance per
  turn (`lastTurnId`); a claim on `turnsDone` so two clicks can't double an
  advance. Turns needn't be consecutive. The recipe's skills and the workshop
  are re-checked — losing either stops the work where it stands — and so is
  incapacitation, which this path was quietly missing. The **ingredients are
  not** re-checked, and must not be: they were spent at the start, so the
  check would fail on turn 2 for a project that is doing nothing wrong.
- **Finish**: the last advance grants the tag and writes the
  `request_craft_tag` audit row (`details { tagId, quantity, resourcesSpent,
  payer, projectId, turnsNeeded, actionId, replaced, consumed }`), and the
  Action reads "Crafted …".
- **Cancel** (`cancelCraft`): status CANCELLED, audit `craft_cancelled`, no
  refund — of ⬢ or of ingredients. Death cancels ACTIVE projects
  (`characterDeath.js`), on the same terms.

The only grant row is the completion's. Mid-project turns leave their own
audit rows (`craft_started`, `craft_continued`) and the Actions themselves,
which the desk shows like any Routine.

## 4. Reversing a craft

There is no Undo. The `request_craft_tag` audit row is a finished craft's
whole record — `details` carries the tag and quantity, the ⬢ and who paid
them, any `replaced` tiers, and the spent ingredients (`details.consumed`,
the `replaced` snapshot shape) — so a GM reversing one works by hand from
/gm/dev, reading that row for what to take off and what to hand back.
Reject of the auto-filed Action remains the full reset for the turn's Move
(§2a).

## 4a. Custom items (`customizable`)

A recipe flagged `customizable:` in docs/tags.yaml (the fine and lavish
meals, the painting, the sketch, the badge, the hat) can be crafted as the
maker's OWN: for
**+1 ⬢ a unit** (`CUSTOM_SURCHARGE`, web/lib/customCraft.js) the player sets
a name and/or a description, and either falls back to the base recipe's when
left blank. The displayed name always carries the base identity —
`Steak Dinner (Lavish Meal)`, or `Lavish Meal (custom)` for a
description-only custom — so every surface says what the thing IS and a
custom name cannot impersonate another item.

Mechanically it is the **fifth runtime authoring door** onto the tag catalog
(db/lib/paperMint.js lists the other four): `mintCustomCraft` in
requestActions.js clones the base row — `custom: true` (sync never sees it,
prune skips it), `ephemeral: true` (Restart Game sweeps it),
`craftable: false` (an item, never a recipe) — and the craft grants the
clone. Everything else runs against the BASE recipe: skills, workshop,
ingredients, the Move budget, and the per-turn rations (the grant records
`details.baseTagId`, and all three counters in web/lib/requests.js bill by
it). Identical words reuse the existing mint — ANYONE'S mint, deliberately:
two cooks who type the same name and description are making the same dish,
and their batches stack on one shared row rather than minting twins. The
mint happens OUTSIDE the craft transaction because the name-collision retry
cannot run inside one (paperMint.js's 25P02 trap), and is deleted again if
the transaction fails (a row someone else already holds is FK-pinned and
survives the attempt).

Player words are cleaned by `cleanCustomText` (web/lib/customCraft.js): no
`{}` (a description must not forge a `{tag:…}` chip), no `‡` (these are the
player's words — they ship UNMARKED, the paper/book-title precedent), no `@`
(item names travel into Discord), no control characters, hard length caps.
There is no GM pre-approval — same posture as paper and book titles — and
the audit row and the dev panel remain the recourse.

The **wayside shrine** is the structure-side variant: `placement.inscribable`
lets the builder write an optional line, stored on `Structure.inscription`
and printed by Examine IN PLACE of `placement.examine`, `»`-prefixed and
unmarked. Blank keeps the stock text.

Two deliberate exclusions. The Depot's price book filters `ephemeral` rows,
so a custom painting never becomes a public line with a player's words on it
(selling one still works — the sell path reads the held row). And
`customizable` is refused at sync on anything not craftable+stackable or
carrying `placement` (db/lib/tagShapes.js#validateCustomizable) — a
non-stackable custom would dodge the base recipe's one-per-character checks.

## 5. Destroy

**Destroy is for things you own.** `Tag.removable` is not authored per tag
any more — `db/lib/syncTags.js` DERIVES it: every tag in the **Items** or
**Assets** category has the Destroy menu and nothing else ever does. The YAML
key survives as an opt-out with `false` as its only legal value, on the seven
rows an item is not allowed to be binned from — the three monster corpses
(Butcher and Bury are the two ways a body leaves, `CORPSES.md`), the Nuclear
Device and its Datacard (`SECRETS.md`), the grafted Quickened Nerve Braid, and
the bolted-down Packaging Equipment (`FACTORY.md`). The sync throws on
`removable: true` anywhere, and on a `false` outside those two categories where
it would do nothing.

This replaced a flag hand-set on 327 entries, which had drifted badly: 113
Items could not be destroyed — every book, every wax seal, every helmet,
`paper` itself — while a Belief could be. **A player holding a letter now has a
way to throw it away**, and Post-Christian no longer offers one.

Runtime-minted rows never pass a sync, so each sets the flag itself:
`paperMint.js` and `photoMint.js` true, `corpseMint.js` false, a packed crate
true, a custom craft inheriting its base recipe's.

**Two knock-ons.** A **Belief can no longer be converted by the player** —
they are `exclusive:` and dropping one was Destroy, so a conversion is a GM's
to make and the store's error just names the pair. And the `/store` loophole
rule (a negative-cost tag must be neither removable nor consumable) is now
half-automatic: a drawback is never an item, so the guard's `removable` arm
only ever fires on a GM-authored custom row.

`destroyTagRequest` itself is unchanged: drops the tag you hold, rolls
`removesInto` aftermath, files `REMOVE_TAG`. No ⬢ field and nothing refunded.

## 6. Where the code lives

| Thing | File |
|---|---|
| Craft / Continue / Cancel / Destroy actions | `web/app/(app)/character/requestActions.js` |
| Recipe list and projects for the page | `web/app/(app)/character/page.js` (`knownRecipeIds`, `craftProjects`) |
| Dialog | `web/app/components/CraftDialog.js`, `RequestActionsProvider.js` (`craft`, `destroy`) |
| Menu filters | `web/lib/tagRequests.js` (`craftableTags`, `destroyableTags`, `craftFamily`), `web/lib/healRequests.js` (`isHealable`) |
| Move budget | `web/lib/craftBudget.js` (the cost model and the fractions), `web/lib/requests.js` (`craftAllowance`, the two per-turn counters, `craftFreeUnits`), `requestActions.js` (`resolveCraftMove`, `spendCraftMove`) |
| Flags in sync | `db/lib/syncTags.js`; catalog `docs/tags.yaml` |
| Kit in reach | `db/lib/equipmentReach.js`, `web/lib/tagRequests.js#needsWorkshop` |
| Tier replacement | `db/lib/tagWrites.js#replaceLowerTiers` |
| What a GM sees | `/gm/audit` (`request_craft_tag`, `request_destroy_tag`) |
