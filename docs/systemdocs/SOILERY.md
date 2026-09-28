# Soilery: the Farm button and Foodstuffs

A character holding **Soilery**, the skill, standing on `soilery` ground,
presses **Farm**. That plants **100 crops** and spends their Move. When the turn
is pushed, each crop has a 1-in-6 chance of withering; every crop that survives
brings in **1 Foodstuff**. The farmer is left **Recently Farmed** for 2 turns,
which refuses the next farm — so a farmer farms one turn in three — and takes a
step up the ordinary **Tired → Exhausted** ladder.

This is the whole of Bascinet's design doc
`E:\Bascinet\V3\Soilery\Soilery Rework.docx` as far as farming goes. The same doc
also reworks hunger ([`TURN-ENGINE.md`](TURN-ENGINE.md) §5), cooking
([`COOKING.md`](COOKING.md)) and eating ([`REQUESTS.md`](REQUESTS.md) §4); each
lives in its own doc and is not repeated here.

Read this before touching `db/lib/soilery.js`, the `farmed` entry in
`db/lib/moveEffects.js`, `db/lib/fatigue.js#grantRecentlyFarmed`, the
`soilery` attribute in `db/lib/locationAttributes.js`, or the `foodstuffs` tag.

## 1. What the rework replaced

Until the rework, farming meant eight crops (wheat, potato, tomato, carrot,
onion, plump helmet, pigtails and tobacco), a seed bag for each that was
consumed into a one-turn sowing licence, a Farm dialog that took a plan of up
to 50 plants, three crops a plant, a shared "field productivity" pool that wore
the soil out, and the ordinary Tired → Exhausted ladder. **All of that is gone**:

- the eight crops, eight seed bags and eight `sowing-*` licences are out of
  `docs/tags.yaml`, and the `items-seeds` tag group with them;
- the Farm dialog (`FarmDialog.js`) is gone — Farm is an instant verb with a
  confirm, like Mine and Refine;
- the field pool (`db/lib/fieldProductivity.js`, the `LocationField` table, the
  `fieldRegen` turn pass, six `farm*` GameConfig knobs and the `soileryRegen`
  Location attribute) is gone, removed at Bascinet's call;
- Tobacco, the one cash crop, is gone with the rest (also Bascinet's call).

A game that was running when this landed is moved across by
`npm run db:convert-soilery` (§6).

## 2. Foodstuffs

`foodstuffs` in `docs/tags.yaml` — one generic food item that replaces every
crop.

| | |
|---|---|
| Weight | 1 lb |
| Eaten raw | +4 hunger, −5 mood (`mealHunger`/`mealMood`) |
| Sellable | no |
| Cooked | the base of every meal (2 or 3 a meal, [`COOKING.md`](COOKING.md)) |

It carries **no `cooked:` block on purpose**. A `cooked:` block is what makes a
tag an *additional* ingredient a cook can slot into a meal; Foodstuffs are what
a meal is cooked *from*, so they never appear in the slots.

Where Foodstuffs come from: the Farm button; gathering in the Black Hills
(`db/lib/cavingLoot.js`, where onions and carrots used to be); the starting
kits of the cooks and servants (`docs/roles.yaml` — 40 for a cook, which is 20
Basic meals, one whole Move); the Soilery's Silo and a few other room stashes
(`docs/zones.yaml`). The `alcohol` brew is made from 2 of them.

The turn close also **eats** Foodstuffs for anybody about to become Starving,
and anything better they carry only to keep them from starving to death
([`TURN-ENGINE.md`](TURN-ENGINE.md) §5a), and the Stable's arelitz eat them
([`ARELITZ.md`](ARELITZ.md)).

## 3. The Farm action

`web/app/(app)/character/actions/soilery.js#farmRequestImpl`, filed as a Move
that commits now and resolves at the push, like Refine (`FACTORY.md`). It takes
nothing from the client. Gates, in order:

1. Standing on a Location with the `soilery` attribute, or refused.
2. `db/lib/soilery.js#farmRefusalFor(tags, hasOpenAction)` — the **one**
   function the server action and the sheet's Farm button both read:
   - no `soilery` skill → *"You don't know how to farm."*
   - holds `recently-farmed` → *"The fields need some time to recover before you can plant there again."*
   - holds `exhausted` → *"You're too worn out to farm right now."* Tired alone
     does not refuse.
   - already filed a Move → *"You already have an action this turn."*
3. `blockerFor(tags, ACT)` — Bound, Dying, Paralyzed, Catatonic.
4. `requireFreeMove` — an open turn, outside the Move lock, and no Action yet.

It files `farmPlan: { v: 3, locationId, planted, fertilized }`, where `planted`
is `GameConfig.farmMaxCrops` ("Plants per farm" on `/gm/dev`, 100 by default,
`FARM_PLANTS` is the code fallback) and `fertilized` is whether the farmer holds
`fertilized-fields` (§5).

## 4. At the push

`db/lib/moveEffects.js`'s `farmed` entry, run by `db/lib/stagedPush.js`:

- `db/lib/soilery.js#reapFoodstuffs(planted, rng, { fertilized })` rolls every
  crop **independently** — never a rounded average, so a harvest has real
  variance. About 83 of 100 survive.
- The survivors land on the farmer as Foodstuffs (`addToStack`).
- `db/lib/fatigue.js#grantRecentlyFarmed` gives **Recently Farmed**
  (`durationTurns: 2` in `docs/tags.yaml`). Filed on turn N, the farmer is
  Recently Farmed through N+2 and may farm again on N+3.
- `db/lib/fatigue.js#applyFatigueStep` steps the ordinary ladder, the same as
  a day's mining (`MINING.md` §5): nothing becomes Tired, and Tired becomes
  Exhausted. Exhausted still refuses a farm; Tired does not.
- Undo (`revert`) takes the Foodstuffs back, hands the fatigue snapshot to
  `revertFatigueStep`, and removes Recently Farmed if this push granted it. A
  harvest pushed before Recently Farmed existed granted Exhausted outright, and
  its snapshot reverts the same way.
- A plan filed before the rework (`v` 1 or 2: rows of crops) resolves as an
  ordinary farm, capped at the plants it sowed, so nothing in flight is lost.

The farmer is DM'd the harvest (`farmDm`): *"planted 100 crops and reaped 83
Foodstuffs."* `stagedPush.js` carves this out of its usual silence about
`auto:` Moves.

A harvest weighs about 83 lb, over the ordinary 71 lb carry cap, so a farmer
usually comes in Overburdened and has to set some of it down or store it. That
is the doc's weight (1 lb a Foodstuff), not an accident.

## 5. Fertilizer

Kept from the old Soilery doc's Addendum, which the rework does not mention:
consuming `fertilizer` grants `fertilized-fields` (2 turns), and a farm filed
while holding it has **no wither die** — instead each crop has a 1-in-6 chance
of bringing in **2** Foodstuffs. About 117 from 100 crops. One bag covers one
farm, because the farmer cannot farm again inside its two turns.

## 6. Moving a running game across

`npm run db:convert-soilery` (`db/scripts/ops/convert-soilery.js`), dry run
unless given `-- --apply`, idempotent. Run it after the deploy's `db:sync-tags`
and before `npm run db:prune-tags`:

- each food crop becomes 1 Foodstuff and each seed bag 2, wherever they are
  held — characters, room floors (hidden units too), vending slots and crate
  manifests — poison and all;
- sowing licences, Tobacco, Pigtails and Ate Meal are deleted (Dined was too,
  until it came back as what a Lavish meal leaves — [`COOKING.md`](COOKING.md)
  §6a — so the script no longer touches a held one);
- a plain recipe dish (`bread` held as-is) becomes a meal of its class, keeping
  the recipe's own hunger, mood and taste; a dish already minted off a recipe
  is re-pointed at its class; both get the class's symbols;
- every living character is given the hunger descriptor their meter says;
- the Stable gets its three unruly arelitz, once;
- room stash seeds that still name a retired slug are rewritten.

The prune then deletes the 62 retired tags and the empty `items-seeds` group.
Both steps change live data and need Bascinet's yes first (CLAUDE.md).

## 7. Where the code lives

| Concern | File |
|---|---|
| The rules: plants per farm, the wither and bounty dice, the refusal, the DM | `db/lib/soilery.js` |
| The Farm server action | `web/app/(app)/character/actions/soilery.js` |
| The push: harvest, Recently Farmed, Tired, Undo | `db/lib/moveEffects.js` (`farmed`), `db/lib/fatigue.js` |
| The harvest DM | `db/lib/stagedPush.js` |
| The Farm verb and its confirm | `web/app/components/actionRegistry.js`, `web/app/components/actions/index.js` (`INSTANT.farm`) |
| The sheet's Farm gate | `web/app/(app)/character/page.js` (`canSeeFarm`/`farmBlocked`/`canFarm`) |
| The `soilery` attribute | `db/lib/locationAttributes.js` |
| Foodstuffs, Fertilizer, Recently Farmed, Exhausted/Tired | `docs/tags.yaml` |
| Plants per farm | `GameConfig.farmMaxCrops`, `db/lib/gameConfigFields.js` |
| Moving a running game across | `db/scripts/ops/convert-soilery.js` |
