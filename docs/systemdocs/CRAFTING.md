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
| `cures` / `administerable` | Consume, with a target | `consumeTagRequestImpl` (`MEDICAL.md` §1) |

The last row is not a fifth menu flag the way the first four are — every
item already sits in Consume, whatever its `cures` list says. What `cures`/
`administerable` decide is narrower: whether Consume's target picker may
post to someone OTHER than the actor at all (an item curing nothing the
target holds, and not `administerable`, refuses the targeted branch outright,
same server-side re-check posture as the four flags above).

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

  **It is paid in ⬢ and nothing else.** An obol is one ⬢, but it is not a ⬢
  (`DEPOT.md` §0) and no recipe takes one. Smithing was the single exception —
  `resolveObolSpend` let a smith put held coin toward the bill at 1:1 — and it
  was removed on 2026-09-20 for contradicting that rule and for making the
  Depot's 3 ¢ import price meaningless to the trade that buys the most ⬢. If a
  crafter has coin and no material, the counter is the way across, at the
  station's rate. Do not add a second one.
- `turnsCost` — the WORK one unit takes, in Moves, as a **decimal on the
  exact grid** `db/lib/tagShapes.js#SUB_MOVE_COSTS` names: `0.05`, `0.1`,
  `0.125`, `0.2`, `0.25`, `0.5`, `0.75`, plus `0` and any whole number. **0**
  is free of the Move entirely, rationed only by a recipe's own `perTurn` if
  it has one (bliss at 2, bone-mask at 1) — Dead Simple used to live here
  too, off a shared 4-a-turn pool, but that rung costs `0.25` now
  (`SMITHING.md` §2, `DEPOT.md` §4), so `0` is rarer than it was. Quarters
  read the way they always did (four `0.25`s fill a Routine, two `0.5`s, one
  `0.75` with a quarter left over); Cooking's finer shares (COOKING.md §2a)
  work the same way at their own denominator — twenty `0.05`s fill a
  Routine, ten `0.1`s, eight `0.125`s, five `0.2`s. **1** is this turn's
  whole Routine — one per turn, by arithmetic. **2+** is a project (§3), one
  unit per project, whole turns only. Quantity is limited by this arithmetic
  alone (Chris 2026-09-06). Anything off the grid is refused by the sync,
  because the Move budget is exact rational arithmetic
  (`web/lib/craftBudget.js`) and a cost it cannot hold exactly would let a
  character do work they never paid for — `0.33` is refused for that reason,
  not because it misses a quarter specifically; every value on the grid is an
  exact rational (a whole multiple of 1/1000), which is the actual rule.
  It was a `1/N` fraction until 9/2026, stored as `requirementTurns: 1` +
  `requirementPerTurn: N`; the decimal sits in `requirementTurns` itself now,
  and the thirds went with the old encoding (§2a).
- `perTurn` — a RATION, and **only legal at `turnsCost: 0`**: a hard daily
  cap, and now the only free allowance a 0-turn recipe gets — there is no
  shared pool behind it any more (bliss at 2, bone-mask at 1). It is never a
  work cost — the sync refuses it on anything that costs a Move, because
  for a while it did double duty as the denominator of a `1/N` cost and the
  two meanings drifted (one Routine held 99 Broadswords). Work is
  `turnsCost`, and `0.25` is how you say "four a Routine"; the cap is
  `perTurn`.
- `items` — the ingredients (`CORPSES.md` §8). **Spent by default**,
  `quantity` units per craft, taken off the crafter's own sheet **when the
  work starts** — so a multi-turn project pays up front and `continueCraft`
  does not re-check them. A `group:` entry is *kept* instead: any corpse to
  hand satisfies Bone Mask, and none is used up. An `anyOf:` entry is a spend the
  player chooses, posted from the dialog and re-checked server-side for
  membership and possession. A recipe may now carry **more than one**
  `anyOf` picker (COOKING.md §2a's tiered recipes need it — Vegetable Stew
  alone needs two) — the single-picker `ingredientChoice` channel still
  answers picker 0 for every recipe that only ever had one, and a multi-picker
  recipe posts `ingredientPicks: string[]` instead, one entry per
  `pickerIndex` (`db/lib/tagShapes.js` stamps it at sync time). Two pickers
  landing on the same slug merge into one cumulative spend
  (`resolveRecipeItems`'s `pushSpend`), not two independent reads of the same
  stack. A `placement:` recipe may not carry `items` at all; the sync refuses
  the pair.
- `count:` on a spent `items` entry — how many units of THAT ingredient one
  craft takes, on top of the craft quantity. A blank book is `paper` with
  `count: 10`, and three of them take thirty sheets. Defaults to 1, which is
  every recipe written before it existed. Refused on a `group:` and alongside
  `keep: true`, for the same reason `keep: false` is refused on a group: both
  are hold-checks with no single stack to draw from, so the number would mean
  nothing. It rides the chip as `uses Paper ×10`.
- `gambit` is ignored: crafting is always a Routine. The sweep cleared it on
  the two brews that carried one (BREWING.md). **Trinket is the one
  deliberate exception** — but it does not work by this flag actually doing
  anything: `{tag:trinket}` carries no `requirement:` block at all and never
  goes near `craftRequestImpl`. It has its own bespoke request action
  instead, because a self-spoiling recipe (the Craft dialog shows you the
  result before you commit) is a contradiction the dialog can't express. See
  [`TRINKETS.md`](TRINKETS.md) §2.

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

A Routine is one Move, and crafting can now spend it a **part at a time**. The
rule is one Move's worth of work per turn — and, as of 2026-09-15, that Move
can be split across any mix of families in the same turn, not just one.

**What a craft costs.**

| Recipe | Cost of the Move |
|---|---|
| `turnsCost: 0`, inside its own `perTurn` allowance | nothing — a free action, as before |
| `turnsCost: 0`, past that allowance | `1/perTurn` per extra unit (a fourth bone-mask is a third of a Move) |
| `turnsCost` on the sub-Move grid (`0.05`–`0.75`) | `quantity × turnsCost` — each unit is that much of a turn's work |
| `turnsCost: 1` | one is a turn's work |
| `turnsCost: 2+` — a project start or continue | the whole Move, every turn it runs — and ONE unit per project, its turns being per piece |

The allowance is the recipe's own `perTurn`, and only that — there is no
shared pool behind it any more (`SMITHING.md` §2, `web/lib/requests.js`).
Going past it used to be refused outright; the ruling (2026-09-05) is that
the allowance stays free and the units after it come out of the Move. So a
recipe with its own `perTurn: 1` still crafts one free, and the second costs
the whole Move. Dead Simple no longer has an allowance to overflow past at
all — it prices at `turnsCost: 0.25` from the first unit, so four of them
fill the Routine outright and a fifth simply has no Move left to spend.

**Decimals on the page, exact rationals underneath.** A cost is authored as a
decimal on the exact grid (§2) and a player reads it as one — "0.25 turns",
"0.125 of your Move". The budget does not hold it that way: `craftMoveCost`
(`web/lib/craftBudget.js`) turns the decimal into a num/den pair once and
exactly (`× 1000` then reduced — every legal cost is a whole multiple of
1/1000), and everything past that is integer arithmetic — added by
`addFractions`, compared by cross-multiplication in `fitsInRemaining`, never by
a float. That is the reason the exact-grid rule exists at all: a turn's Move
has to close exactly, and a cost the ledger could only approximate would leave
a sliver behind or come up short, which is a character doing work they never
paid for. Costs were authored as `1/N` fractions until 9/2026, thirds among them;
the thirds are what this argument finally cost.

**A spill denominator is still whatever the ration is.** The exact-grid rule
binds what a recipe may be *authored* as; it does not bind what the ledger can
hold. A `turnsCost: 0` recipe past its own `perTurn` bills `1/perTurn` per
extra unit, and an allowance is any whole number — so Flesh of Tzchernobog,
rationed 3 a turn, bills a third of a Move for the fourth. The arithmetic
stays exact, because the ledger is rational either way; only the display
rounds, and that one prints as `0.33`.

That fourth Flesh of Tzchernobog has a second price worth knowing: spilling
files an Action, and the one-Move-a-turn row is the day. Three free ones leave
the day open; the fourth spends it, so there is no Mine, Farm or Refine left
that turn. Dead Simple gets no free half of that trade either: at
`turnsCost: 0.25` from the first unit (`SMITHING.md` §2), even one Work Knife
files the `auto:craft` Action, the same as any other Move-costing craft.

**The family.** `craftFamily()` (`web/lib/tagRequests.js`) takes the first of
`brewing`, `cooking`, `smithing`, `builder`, `crafting` that any of the
recipe's `requirementSkills` prefixes match — that fixed precedence, not the
order the skills come back in, since Prisma returns the relation unordered
and a two-trade recipe's family would otherwise depend on row order.
Barbed-net's `fundamentalist` sits beside `crafting` and the recipe is
crafting. A recipe gated outside the
five trades takes its first skill prefix AS its family (bone-mask is
`butcher` work, holy water `blessing` work), and one with no skill at all is
generic `craft` — so EVERY recipe Move-prices by the same arithmetic (Chris
2026-09-06). Bone-mask's ration spilling into a butcher's Move, instead of
walling, is the one behavior this changed.

A turn's Routine can hold any mix of families now. Half a Routine at the
still and half at the anvil is a thing — the only wall is the Move itself:
spill a work knife (`smithing`) into the Move and a sling (`crafting`) still
spends from the same fraction that's left, it just isn't refused for being a
different family. (This changed 2026-09-15; before that, the first family
billed to a turn's Routine locked out every other family for the rest of the
turn.)

**`medical` is a family too, but it is never derived — it is always passed
explicitly.** A routine Heal or an `administerSkill`-gated Consume
(`MEDICAL.md` §2–3) bills through this same arithmetic, but the tag being
priced is an AFFLICTION or a fitted ITEM, not a recipe with
`requirementSkills` for `craftFamily()` to read a trade prefix off — a
skill-less cure like Choking would otherwise fall through to the generic
`craft` family and get labelled as ordinary crafting on the desk. Every
medical caller says `family: "medical"` up front instead of asking
`craftFamily` to guess. `family` is still tagged onto every ledger entry —
it just no longer gates which entries a Routine may hold.

**The seven medicines (`antidote`, `fever-draught`, `burn-dressing`,
`autoinjector`, `portable-surgical-pack`, `cybernetic-arm`,
`cybernetic-leg`) are ordinary recipes now, not afflictions or fitted
items** — they carry `requirementSkills: [brewing-skilled]` or
`[brewing-expert]`, so `craftFamily()` derives them as `brewing` by the
ordinary rule above, the same as any other brew. `medical` still bills only
healing and `administerSkill` fittings — brewing a batch of Antidote is a
`brewing`-family craft — but a Routine spent Healing someone can now go on
to brew Antidote too, the same turn, as long as the Move has room left. One
Action per character per turn still holds only one Move, so a medic can heal
a patient **and** brew their own medicine in the same turn now, as long as
the two fractions together still fit in it.

**The ledger.** `Action.craftBudget` on the `auto:craft` Action:

```json
{ "usedNum": 3, "usedDen": 4,
  "entries": [{ "tagId": "…", "name": "Choking", "family": "medical",
                "qty": 1, "num": 1, "den": 4 },
              { "tagId": "…", "name": "Alcohol", "family": "brewing",
                "qty": 2, "num": 1, "den": 2 }] }
```

`usedNum/usedDen` is the running total in lowest terms; each entry carries its
own family and fraction, in lowest terms (a straddling order's free half is
`qty` minus the billed `num`). All of it is integer arithmetic
(`web/lib/craftBudget.js`) — four quarters have to be exactly one Move.

**The ledger is not craft-only any more.** Bury and Engrave take their Move
from here (`CORPSES.md` §7), with `family: "burial"` and a null `tagId`. Each
is a whole Move by default, which bills through this budget perfectly well and
simply consumes all of it — but a Shovel halves the burial, and that half is
why they stayed on a shareable ledger rather than moving to the whole-Move
path: with one equipped, a burial and a piece of work share one turn. They pass their
own marker in `gmNotes` — `"auto:craft auto:bury"` — because `checkLedgerMove`
recognises a shareable ledger by the `auto:craft` substring. Anything else
joining this budget does the same; every other verb still takes a whole clean
Move through `requireFreeMove`.

Searching a room is the third thing on it (`SEARCH.md` §9): an exact third, with
`family: "search"` and `"auto:craft auto:search"` in the notes, and the desk
line gets its own verb, "Searching this turn: …". It is also the first
share-of-a-Move verb on a **Discord** button, which is why the arithmetic,
`checkLedgerMove`, `fileAutoRoutine` and `spendLedgerMove` live in
`db/lib/moveLedger.js` now; `web/lib/craftBudget.js`, `web/lib/moveSpend.js`
and `actions/shared.js` re-export them under the names every caller here
already uses.

Nothing is derived and nothing is cached: **the row is the record.** Every
budget-consuming craft takes the Character `FOR UPDATE` row lock, re-reads the
Action inside the transaction, re-runs the remainder check there, and
`fileAutoRoutine`'s `P2002` catch stays the backstop under even that. The
Action's `description` is rebuilt from the entries each time one lands,
grouped by family so each verb stays in its own voice — "Treating this turn:
Choking. Crafting this turn: 2× Alcohol." — so the desk reads the whole
turn's work in one line. A project turn keeps its own "(2/3)" line, because a
project never shares a turn.

**GM semantics.** **Reject** deletes the Action and the ledger with it
(`deleteActionRestoringTurn`, which needs to know none of this), and the
player may craft again that turn from scratch. There is no Undo of a
finished craft — a GM reversing one works by hand from the audit row (§4).
Nothing in the turn-end push reads `craftBudget`.

**The dialog** quotes all of this before the player commits: the fraction
left as a header line, unaffordable recipes greyed with the reason on the
row, a quantity field clamped to whichever runs out first (ingredients,
budget, the server's 99), and a confirm that says which units are free and
what the rest spend. Every number of it is computed server-side in
`character/page.js` and re-checked by `craftRequest` under the lock — the
dialog is a hint, never the gate.

## 2b. Recipe visibility: known vs secret

`requirement.skills` decides who is *allowed* to make a recipe (§2); a
recipe's own ingredients decide who is even shown it exists.
`knownRecipeIds` (`web/app/(app)/character/page.js`) is the second filter on
top of the skill check: a recipe naming an ingredient whose own
`catalogVisibility` isn't `all` (or, for a `group:` entry, whose group has
any non-`all` member) stays off the Craft menu and the Recipes tab —
`isNonPublicRecipe` — until the character actually holds one of those
ingredients (`satisfiesIngredientsAtQuantityOne`, checked at quantity one: a
hidden recipe only has to prove itself known, not affordable). Holding the
ingredient is what proves you know the recipe calls for it, so once you hold
it, showing you the recipe tells you nothing a document search wouldn't have.
A public recipe that merely names a `catalog: gm` ingredient (honey → Lavish
Meal, and eight more like it) works exactly this way: the ingredient hides
it from everyone who doesn't hold one, and reveals it in full — cost,
turns, every other ingredient — to anyone who does.

**A "secret" recipe is a narrower thing than "a recipe with a hidden
ingredient": it is a craftable whose own *product* — the tag it makes — is
`catalog: gm`, never `catalog: secret`.** Holding an ingredient never
reveals one of these on the Craft menu or the Recipes tab; the gate above
only ever hides or shows a recipe by its *ingredients*, and a secret
recipe's product visibility is a separate field nothing here reads. **Nothing
a player can do reveals one.** The Cathedral's Research skill used to, as a
blurb on a minted paper, and it went with the Scholastic — so a secret recipe
now reaches a character only when a GM hands them the product or the page from
`/gm/dev`. `catalog: secret` products sit a level further out again: hidden
even from GMs on every surface but the unfiltered `/gm/dev/tags` view.

**`recipePublic` (`Tag.recipePublic`, authored as `requirement.recipePublic:
true`) is the escape hatch from the ingredient gate above** —
`isNonPublicRecipe` checks it first, before the ingredient walk, and lists
the recipe regardless of what its ingredient's group currently contains.
Maggot Milk is the reason it exists: it names a `purring-maggot` that is
`catalog: gm`, so the gate above would never open for a player who had never
found one — for a recipe that is supposed to be common knowledge once you
know Brewing I. Bone Mask and Death Mask name a `group: items-corpse` whose
members (`nekker-corpse`, `graga-corpse`, `skinless-corpse`) are all
`catalog: secret`, and do **not** set the flag: for those two, "you have to
have held a corpse" is the intended discovery mechanic, not a side effect
worth working around.

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
  Arrow (1/3).". A recipe of one Move or less (`turnsCost ≤ 1`, part-turns
  included) finishes on the spot and puts the snapshot straight on the
  request. From 2026-09-17 to 2026-09-24 a part-turn recipe did not: the
  check read `turns === 1`, so it was filed as a project and nothing was
  handed over.
- **Continue** (`continueCraft`): the Craft dialog lists active projects;
  pick one, choose *Keep working on it*. Same Move check; one advance per
  turn (`lastTurnId`); a claim on `turnsDone` so two clicks can't double an
  advance. Turns needn't be consecutive. The recipe's skills and the workshop
  are re-checked — losing either stops the work where it stands — and so is
  incapacitation, which this path was quietly missing. The **ingredients are
  not** re-checked, and must not be: they were spent at the start, so the
  check would fail on turn 2 for a project that is doing nothing wrong.
  **A `due` project** (ACTIVE with `turnsDone ≥ turnsNeeded`, which only
  that week's part-turn crafts can be) reads *Take it*: Continue finishes it
  at once, with no Move and no wait. Its slotted cooking ingredients were
  never saved, so a dish comes out as the plain recipe.
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

## 3a. When the product arrives: same turn or at the push

`GameConfig.craftYieldTiming`, the **Crafted items arrive** control under
Economy on `/gm/dev`, decides when a finished craft hands over what it makes:

- **Same turn** (`IMMEDIATE`, the default, and how crafting has always
  worked): the product lands on the sheet when the player presses Craft.
- **At the turn push** (`STAGED`): the product lands at the turn-end push.

Only the hand-over moves. Everything else still happens on the press, in the
same transaction that stages the product: the Move share, the ingredients, the
⬢, the Death Mask's face, the minted custom row, any lower tier the product
replaces, and the `request_craft_tag` audit row. So nothing a recipe costs can
be sold, handed on or spent again while the product is on its way. The audit
row has to stay on the press anyway, because the per-turn rations count it
(`REQUESTS.md` §1a).

It covers every path that ends in `grantCrafted`: free and part-turn crafts, a
one-turn craft, the last turn of a project, and Take it on a `due` project. Build
sites (`placement:`) are left out, because they make a structure rather than an
item. Trinkets have their own pass, and are left out too.

**A staged product is a StagedEffect**, the same row a GM queues from the
tray, so `db/lib/stagedPush.js` applies it with everything else at the push.
`grantCrafted` writes it with the craft's Move as `moveId` (null for a free
craft) and the player as `createdByDiscordUserId`:

```json
{ "tagOps": [{ "tagId": "…", "op": "add", "quantity": 4, "source": "CRAFT" }],
  "craftYield": true, "craftRecipeTagId": "<the recipe>",
  "craftProductTagId": "<what lands: the recipe, or its minted custom row>",
  "craftLabel": "4× Bread" }
```

- `quantity` already includes Distilling and `requirementYield`. A
  non-stackable is pinned at 1, because `validateTagOps` refuses more.
  `craftLabel` leaves Distilling's doubling out, as the "made:" line does.
- The expiry is stamped at the push against the turn the product lands in, so
  a one-turn item lasts the turn it arrives.
- The audit row gets `staged: true` and `stagedEffectId`. When the product
  lands, the push writes a `craft_yield_arrived` row with the player as actor,
  not the `gm_staged_tag_applied` a GM's row gets.

**Nothing is lost at the push.** Four rules make sure of it:

- **The turn is locked while the row is written.** `grantCrafted` reads the
  turn `FOR SHARE` and stages only if it is still `OPEN`. `advanceTurn` closes
  a turn by updating that row, so the close waits for the craft to commit and
  the push is certain to see it. A turn that closed first means the product
  lands at once.
- **A spare is set down, not dropped.** If the player already holds the
  non-stackable product by the push (handed one, bought one, picked one up),
  the push puts the new one in a random public Room where they stand, the rule
  an opened crate follows, and DMs them where. With no public Room there, the
  row fails and the tray shows it. `addToStack` would otherwise have kept the
  held one and quietly dropped the one they paid for.
- **Staged crafts count as held.** `craftGrantChecks` weighs them for
  exclusivity, named conflicts and tier chains, so two crafts the sheet would
  refuse side by side can't both be staged. It refuses a second non-stackable
  on its way by `craftProductTagId`, the tag that will land, which is the same
  test the sheet uses: a custom-named hat blocks neither a plain one nor
  another name. Crafting upward over a tier that is still on its way is
  refused until the push.
- **A GM edit keeps the markers.** `updateStagedEffect` carries the craft keys
  and the product's `source: CRAFT` through an edit while the product is still
  being added. A GM who takes the product out leaves an ordinary row.

With no open turn there is nothing to stage against, so the craft lands at
once whatever the setting says.

The player is told on the press ("4× Bread made — it arrives when the turn
pushes."), and the Craft dialog carries a one-line note while the setting is
on and a turn is open. Until the push, the sheet's turn forecast lists each one
as "4× Bread arrives". GMs see the row in the tray, marked "Crafted by" the
player, and in the dev panel's "Staged for push" tile. Deleting it there takes
the product away, and the Move and ingredients stay spent, as with any staged
effect a GM deletes.

## 4. Reversing a craft

There is no Undo. The `request_craft_tag` audit row is a finished craft's
whole record — `details` carries the tag and quantity, the ⬢ and who paid
them, any `replaced` tiers, and the spent ingredients (`details.consumed`,
the `replaced` snapshot shape) — so a GM reversing one works by hand from
/gm/dev, reading that row for what to take off and what to hand back.
Reject of the auto-filed Action remains the full reset for the turn's Move
(§2a).

## 4a. Custom items (`customizable`)

A recipe flagged `customizable:` in docs/tags.yaml (the painting, the badge,
the hat, and — since
2026-09-09 — the plain arms and all the armor on the Smithing ladder,
`SMITHING.md` §3-§4) can be crafted as the maker's OWN: for
**+1 ⬢ a unit** (`CUSTOM_SURCHARGE`, web/lib/customCraft.js) the player sets
a name and/or a description, and either falls back to the base recipe's when
left blank.

**No cooking recipe is on that list.** A cook names nothing: the dialog offers
them no name or description box (`chosen.customizable` gates the whole block),
and `customCraftFor` returns an inactive custom for a recipe that isn't
customizable, so a posted name is dropped rather than refused — the same
posture as a quantity on a non-stackable. The meals were on the list twice
before: free at `custom: { cost: 0 }` on the argument that charging made every
meal in the game anonymous, then briefly at 1 ⬢ a batch. Neither is the rule
now. What a dish is called is its recipe plus its ingredients.

**What the words cost is the recipe's own business** —
`surchargeFor(tag)`, reading `Tag.customCost`, is the one verdict both the
dialog and the server price with, and `custom: { describable: false }` is the
other half: a recipe may take a name and no description, so the dialog hides
the textarea and the server drops a posted one rather than refusing it. No
recipe in the catalog uses either at the moment — all 31 customizable recipes
sit on the default 1 ⬢ and take both — but both stay, since the cost is a
column and not a constant.

A **cooked dish still mints**, name or no name, because its mint keys on the
INGREDIENTS rather than on words — see COOKING.md §2, which is the one place
this mechanism does something the rest of the customizable recipes do not.
That is why the mint is guarded by `custom.active || cookedFrom.length` and
not by `customizable` alone: taking naming away from cooks leaves the
ingredient half untouched.

**A meal is always minted with its cook's own name** (COOKING.md §2: a class,
a name and description the cook writes, the class's symbols round it), in
`literal` mode, so it reads exactly as written — "+Scones+", never "Scones
(Skilled Meal)". Before the Soilery Rework a dish kept its recipe's name, plain
`Bread` however it was made. It used to be `baseTag.name` plus its
ingredients' tastes — `Bread (rich spices)` — which is gone: a name is printed
by every stash panel, Search readout and pickpocket picker there is, so
baking the taste into it published the one thing eating is meant to reveal.
COOKING.md §2 has the reasoning and what it costs a cook. On a customizable
recipe the displayed name still carries the base identity the other way
(`Dockers' Mark (Badge)`, or `Badge (custom)` for a description-only custom),
so every surface says what the thing IS and a custom name cannot impersonate
another item.

Two dishes of the same recipe with different ingredients now share a name, and
that is safe: reuse keys on name + description + **`cookedFrom`**, so they stay
separate rows. `Tag.name` is not unique — only `slug` is — so any number of
`Bread` rows coexist.

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

### Who may sign a piece

`customizableSkill:` on the recipe names a tag the maker has to be HOLDING,
and every arm and every piece of armor names `smithing-skilled`. Signing
your work is a skilled smith's privilege — not something an apprentice does
to a cudgel — and the piece's own tier has nothing to do with it: a basic
smith still forges a plain dagger, they just cannot put their name on it.
Omit the key and the recipe is open to anyone who can make the thing, which
is the meals, the painting, the badge and the hat.

One verdict, `mayCustomize` in web/lib/customCraft.js, read by both faces:
`/character` ships `customizable` already RESOLVED against the viewer's held
tags, so the dialog's predicate stays one field, and `craftRequestImpl`
re-decides it from the session's own character (a server action is a public
endpoint). Fields posted against a recipe somebody may not customize are
IGNORED, not refused — the same posture as a quantity on a non-stackable.

Deliberately authored per recipe rather than derived from the recipe's own
skills, which is the trick `needsWorkshop` gets away with. Nothing derives
correctly here: a Padded Cap is `crafting` work and still wants the smith's
rung, and the Hat is `crafting` work that must stay open to everyone — and
the two sit in the same tag group. No ancestry walk either: the only rung
above `smithing-skilled` is `smithing-gunpowder`, which carries it as a
`requiredTag`.

### What the clone has to carry

The clone carries `fighting` (a weapon's class, and what it is worth in a
fight), `meleeArmor`, `ballisticArmor`, `concealsIdentity`, `forcesConceal`,
`concealSprite`, `miningBonus` and `carryBonus`. Every one of those was
missing at some point and cost something real: a "Custom Breastplate" with
zero armor, a "Custom Knight's Helmet" that concealed nobody, a signed
Broadsword that counted as no weapon at all. **Any new stat column on `Tag`
needs adding here before a recipe carrying it is made `customizable`**, or
the mint quietly loses it — this has gone wrong twice now.

`customOfSlug` is the other half of that rule, for what a stat column cannot
express. A mint's slug is fresh (`custom-craft-*`), so every rule that reads
a HELD tag's slug back stops seeing it: `db/lib/godflesh.js` names the tools
that cut Godflesh and the body armor that survives the Spillway, and a signed
breastplate would have protected nobody. That module resolves through
`customOfSlug` now, and so must the next rule of its shape.
`db/lib/torture.js`'s Trench Knife bonus is the one that does not — the
Trench Knife is not customizable, and stays that way for exactly this reason.
Granting a tag by slug (`cavingLoot.js`, `thanati.js`, `threats.js`) is
unaffected; only matching a held row is.

Armor and headgear needed one more change first: `validateCustomizable`
refuses `customizable` on anything non-stackable, and every armor/headgear
tag was non-stackable — one Breastplate, ever, was the whole enforcement of
"you already have that tag." Bascinet's call (2026-09-09): it's fine for a
character to carry more than one, so every armor and headgear recipe on the
Smithing ladder is now both `stackable: true` and `customizable: true`. The
equip system already handled a stackable, layered, equippable tag correctly
before this — the Hat proved it — so a second Breastplate just fights the
first one for the BODY slot exactly like a second Hat would
(`db/lib/equipSlots.js`).

Player words are cleaned by `cleanCustomText` (web/lib/customCraft.js): no
`{}` (a description must not forge a `{tag:…}` chip), no `@` (item names
travel into Discord), no control characters, hard length caps.
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
The same validator refuses a `customizableSkill` that names no real tag, or
one left behind on a recipe whose flag has come off: a typo there would close
the door to everybody rather than fail loudly.

## 4b. Where a structure may stand

A recipe with a `placement:` block raises a `Structure` at the builder's
Location instead of landing in a pocket. `db/lib/structures.js#canBuildHere` is
the one rule for the ground, asked by the Craft menu and again by the server:

| The ground | What goes up |
|---|---|
| Outdoors, on the surface | anything |
| Indoors, on the surface | only a type that names this Location in `placement.locations` (the Brewery in the inn) |
| A cave level (the Caves, the Depths) | only a type flagged `placement.underground: true` |
| A `noBuild` Location | nothing |

**Eight types are flagged for the caves**: the Wayside Shrine, the Barricade,
the Gallows, the Crucifix, Pit Props (`MINING.md` §4), the Camp (`MOOD.md` §7),
the Noticeboard (`PAPERWORK.md` §7) and the Torture Rack (`TORTURE.md` §3).
Everything else is a thing of open ground or of a town — a palisade, a tower, a
trebuchet, a rookery — and a cave refuses it with "That can't be built down
here."

The flag says nothing about the surface: every one of the eight still goes up
anywhere outdoors. Nothing could be built underground at all until 2026-10-04,
on the reasoning that a cave level has no `#summary` — but a site has always
spoken into its own Location's channel, and every cave Location has one.

The menu needs two answers for one piece of ground, because a cave says no to
most types and yes to a few: `structures.js#buildGround` returns `buildable`
and `buildableUnderground`, and `craftRecipes.js#placementOfferedHere` reads
whichever the type is entitled to.

## 4c. A structure that grants its Location an attribute

`placement.grants: <attribute>` — the Noticeboard's `noticeboard`, the Field
Kitchen's `kitchen`. While it stands, the Location carries that attribute, the
same key `docs/zones.yaml` authors and `/gm/dev/zones` ticks.

**It is written onto the Location row, not derived.** The readers of an
attribute are on both faces and most hold nothing but a Location, so a finished
structure sets the real thing and no reader has to know a structure exists.
`db/lib/structureGrants.js` holds the only two writers:

| When | What |
|---|---|
| A build finishes (`grantOnFinish`) | the attribute goes on, and the Location's mirror job is enqueued so the Discord anchor redraws |
| A GM destroys one that was standing (`revokeOnDestroy`) | the attribute comes off; a Noticeboard also takes every notice at the Location |

Everything else follows from that being the whole mechanism:

- **Only an attribute the registry marks `buildable`** may be granted
  (`db/lib/locationAttributes.js`). The tag sync refuses any other key, so a
  typo fails loudly and nobody raises a Refinery.
- **Refused where the attribute already is.** Destroying the structure takes
  the attribute off, so a second one would take an authored one down with it.
- **Damage does not revoke.** A damaged Field Kitchen still cooks. This is
  unlike the kits and bonuses, which serve only while `COMPLETE`. The
  Noticeboard never reaches the question: it is `placement.fragile`, so a
  Damage ruling destroys it outright (`PAPERWORK.md` §7).
- **It lasts one game**, like a `/gm/dev/zones` edit. Restart Game deletes the
  structure and `db:sync-zones` puts attributes back to the YAML. Run by hand
  mid-game, that sync would take a built one's attribute off while the
  structure still stood, and put a destroyed authored one's back.
- **An authored structure authors the attribute too.** `worldSeed.js` raises
  `structures:` already standing, past the build path, so the Location must say
  `noticeboard: true` itself. `db/test/buildings.test.js` holds the two lists
  together.
- **Examine prints the attribute's line**, not a second one for the structure.

## 5. Destroy

**Destroy is for things you own.** `Tag.removable` is not authored per tag
any more — `db/lib/syncTags.js` DERIVES it: every tag in the **Items** or
**Assets** category has the Destroy menu and nothing else ever does. The YAML
key survives as an opt-out with `false` as its only legal value, on the five
rows an item is not allowed to be binned from — the three monster corpses
(Butcher and Bury are the two ways a body leaves, `CORPSES.md`), the grafted Quickened Nerve Braid, and
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
| What a structure grants its ground | `db/lib/structureGrants.js`, `db/lib/locationAttributes.js` (`buildable`) |
| Where a build may stand | `db/lib/structures.js` (`canBuildHere`, `buildGround`), `db/lib/craftRecipes.js#placementOfferedHere` |
| Kit in reach | `db/lib/equipmentReach.js`, `web/lib/tagRequests.js#needsWorkshop` |
| Tier replacement | `db/lib/tagWrites.js#replaceLowerTiers` |
| What a GM sees | `/gm/audit` (`request_craft_tag`, `request_destroy_tag`) |
