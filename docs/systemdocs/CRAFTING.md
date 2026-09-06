# Crafting, Destroy, and the capability flags

The Craft button on `/character` (it replaced Add Tag), the Destroy button
(it replaced Remove Tag), multi-turn projects, and the four flags on `Tag`
that decide which menu a tag sits in.

## 1. The four flags

Every player tag menu is one boolean in `docs/tags.yaml`, re-checked
server-side by the matching request. None is derived from the category.

| Flag | Menu | Re-check |
|---|---|---|
| `craftable` | Craft | `craftRequest` (`character/requestActions.js`) |
| `removable` | Destroy | `destroyTagRequest` |
| `healable` | Heal | `healCharacterRequest` via `web/lib/healRequests.js#isHealable` |
| `teachable` | Learn / Teach | `db/lib/lessons.js#teachableSkills` (LESSONS.md) |

The 9/2026 sweep set `healable: true` on every health tag with a cure,
`removable: false` on every health tag (a wound is healed, not thrown away —
a condition nobody can cure runs its course or waits for a medic), and
`teachable: true` on every skill. `docs/tags.yaml`'s header documents each
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
- `turnsCost` — Moves of work. **0** is Dead Simple: no Move, rationed to
  `DEAD_SIMPLE_PER_TURN` units a turn (SMITHING.md §2). **1** is this turn's
  Routine. **2+** is a project (§3).
- `perTurn` — units of this recipe one character may make in a turn, counted
  per recipe. At `turnsCost: 0` it is the free allowance; omit it and a Dead
  Simple recipe falls back to the shared `DEAD_SIMPLE_PER_TURN` pool of 4. At
  `turnsCost: 1` it is the **batch size**: the recipe costs `quantity/perTurn`
  of the Move instead of all of it, so three Alcohol fill a Routine and one
  leaves room for two more (§2a).
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
| `turnsCost: 1` with `perTurn: N` | `quantity/N` |
| `turnsCost: 1` with no `perTurn` | the whole Move |
| `turnsCost: 2+` — a project start or continue | the whole Move, every turn it runs |

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
`smithing`, `builder`, `crafting`. Other gates are ignored: barbed-net's
`fundamentalist` sits beside `crafting` and the recipe is crafting. A recipe
with **no** craft family — bone-mask, gated on `butcher` alone — can neither
lock a Routine nor spend from one, so its ration stays a hard wall and going
past it is refused the way it always was.

A turn's Routine commits to one family. Half a Routine at the still and half
at the anvil is not a thing, and that includes the Dead Simple pool: spill a
work knife (`smithing`) into the Move and a sling (`crafting`) is refused for
the rest of the turn.

**The ledger.** `Action.craftBudget` on the `auto:craft` Action:

```json
{ "family": "brewing", "usedNum": 2, "usedDen": 3,
  "entries": [{ "tagId": "…", "name": "Alcohol", "qty": 2, "freeQty": 0,
                "num": 2, "den": 3, "requestId": "…" }] }
```

`usedNum/usedDen` is the running total in lowest terms; each entry carries its
own fraction, and `freeQty` records how much of a straddling order the free
allowance covered. All of it is integer arithmetic
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
player may craft again that turn from scratch. **Undo** of one craft request
hands back the tag, the ⬢ and the ingredients but **not** the budget — a
deliberate asymmetry, Reject being the full reset. Nothing in the turn-end
push reads `craftBudget`.

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
               startedTurnId, lastTurnId, requestId }
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
- **Finish**: the last advance grants the tag and writes the `ADD_TAG`
  Request (`effect { tagId, quantity, resourcesSpent, payer, projectId,
  turnsNeeded, actionId, replaced, consumed }`), and the Action reads
  "Crafted …".
- **Cancel** (`cancelCraft`): status CANCELLED, audit `craft_cancelled`, no
  refund — of ⬢ or of ingredients. Death cancels ACTIVE projects
  (`characterDeath.js`), on the same terms.

The only Request is the completion. Mid-project turns leave audit rows
(`craft_started`, `craft_continued`) and the Actions themselves, which the
desk shows like any Routine.

## 4. Undo

`web/lib/requestEffects.js` `ADD_TAG.undo`: the tag comes off, replaced tiers
come back, `effect.consumed` ingredients come back, `resourcesSpent` is
refunded to `effect.payer` (an older row without one refunds the character),
and a project is marked CANCELLED. The auto-filed Actions stay — a GM who
wants the Move back uses Reject.

The GM edit path (`applyEdit`, *Remove the tag*) restores the same two lists,
each behind its own already-done flag — `replacedRestored` and
`consumedRestored` — so a second Confirm cannot hand either out twice. `undo`
reads those flags before restoring, for the same reason.

## 4a. Custom items (`customizable`)

A recipe flagged `customizable:` in docs/tags.yaml (the two meals, the
painting, the badge, the hat) can be crafted as the maker's OWN: for
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
`payload.baseTagId`, and all three counters in web/lib/requests.js bill by
it). Identical words reuse the existing mint, so a second batch of the same
dish stacks; the mint happens OUTSIDE the craft transaction because the
name-collision retry cannot run inside one (paperMint.js's 25P02 trap), and
is deleted again if the transaction fails.

Player words are cleaned by `cleanCustomText` (web/lib/customCraft.js): no
`{}` (a description must not forge a `{tag:…}` chip), no `‡` (these are the
player's words — they ship UNMARKED, the paper/book-title precedent), no `@`
(item names travel into Discord), no control characters, hard length caps.
There is no GM pre-approval — same posture as paper and book titles — and
Reject/Undo and the dev panel remain the recourse.

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

`destroyTagRequest`: drops a `removable` tag you hold, rolls `removesInto`
aftermath, files `REMOVE_TAG`. No ⬢ field any more and nothing refunded — the
`/store` loophole rule (a negative-cost tag must be removable or consumable)
still relies on the Beliefs staying `removable`.

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
| Desk | `web/app/(desk)/gm/turns/RequestSections.js` (Craft ‡ / Destroy ‡), `web/lib/requestLabels.js` |
