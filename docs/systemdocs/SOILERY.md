# Soilery: the Farm button

A design-doc-driven farming verb: a character holding **Soilery**, the skill,
standing on `soilery`-attributed ground, spends a seed bag's licence and sows
up to a GM-tunable cap of **plants** (`GameConfig.farmMaxCrops`, 50 out of the
box, editable on `/gm/dev` mid-round with no deploy) in one Move. The crops
and a fatigue lockout land when the turn is pushed, not when the button is
pressed.

**The cap counts plants, not crops.** A surviving plant brings in
`CROPS_PER_PLANT` of its crop — 3 for the food crops — so 50 sown is about
125 crops once the wither die has taken its sixth. A wheat plant giving one
single grain of wheat was never what this meant.

Read this before touching `db/lib/soilery.js`, `db/lib/locationAttributes.js`'s
`soilery` attribute, the `farmed` entry in `db/lib/moveEffects.js`,
`db/lib/fatigue.js`, or the seed-bag/sowing/crop tags in `docs/tags.yaml`.

Related: [`MINING.md`](MINING.md) (Soilery's sibling skill, the other button
that spends a day, and the fatigue ladder both share),
[`FACTORY.md`](FACTORY.md)
(the closest existing analog — a Location-attribute-gated verb with its own
pure module and turn-push resolution), [`CARRY.md`](CARRY.md) (what a full
harvest weighs), [`COOKING.md`](COOKING.md) §3 (`cooked.hunger`/`tasteForm`,
which the new crop and foodstuff tags carry), [`TAGS.md`](TAGS.md) (the
`items-seeds` group, and the tag catalog rules these tags follow), and
[`TURN-ENGINE.md`](TURN-ENGINE.md) §5/§5a (the 0-100 hunger meter — the other
half of this same body of work; its full mechanics live there, not here, see
§7 below).

## 1. Why it exists

`E:\bascinet\v3\Soilery.docx` specs a farming system: characters with the
farming skill, standing on farmland, consume seed bags and sow up to a
GM-tunable cap of plants (50 by default) in one action; the crops (with a
1-in-6 per-unit wither chance) and a fatigue lockout land when the turn is
pushed. Cooking (the doc's page 2) needed no new code at all — see §6.

**The economy it is tuned to.** A basic cooked meal feeds one person for one
turn (35 hunger against a 35-a-turn burn, `TURN-ENGINE.md` §5), so feeding a
town of 100 costs exactly 100 basic meals a turn — the burn rate cancels out
of the arithmetic entirely, and only the crop count matters. At 2 crops a
meal that is 200 crops a turn. Three farmers working every other turn make
1.5 harvests a turn, and at 125 crops a harvest that comes to ~3280 hunger a
turn: **three farmers feed about 94 people.** A harvest weighs ~21 lb, well
inside the 71 lb carry cap.

Farming pays **no ¢ for food**. Food crops are not sellable at all — the only
thing to do with a potato is eat it, cook it, or give it away. That is the
whole point of the verb: the one button that puts food on the map rather than
money in a purse. Mining is the button that pays ⬢ (`MINING.md`), and the two
skills are siblings in the `skills-work` tag group with neither gating the
other.

**Tobacco is the one exception, and it is deliberate** (§6a). It is the only
sowable crop worth money, it is not food, and a field of it feeds nobody —
which is exactly the decision it exists to force.

This used to need explaining at length, because `laboring-farming` had a
second life as a paying Laboring tier priced against a Location's
`yield.farming` coefficient, and the Farm button gated on the same tag without
being that. Laboring is gone and so is that tier. **Soilery** is one flat
7-point skill that turns on one button, and there is nothing else it does.

## 2. The `soilery` Location attribute

`db/lib/locationAttributes.js`'s `ATTRIBUTES.soilery` entry, right beside
`refinery` — the exact template Farming borrows:

```js
soilery: {
  type: "boolean",
  describe: () => "**Soilery**: you can sow and reap crops here.",
},
```

`hasAttribute(location, SOILERY_ATTRIBUTE)` is the one gate the server action
and the sheet's Farm-button visibility both read, so a tile either offers the
whole system or none of it.

**Currently one Location carries it**: `town-3`, the Soilery, under the `town`
zone (`docs/zones.yaml`). It moved there with the Farms rework and this doc said
`farms:` under `forest` until 2026-09-20. Its three Rooms are `town-3-1` Farms,
`town-3-2` Silo and `town-3-3` Stable. This is a **deliberate placeholder**, not an
oversight — the whole Farms Location is expected to be reworked later, and
`soilery: true` on it is a stand-in until that redesign lands. Both
`locationAttributes.js` and `zones.yaml` say so in a comment at the point of
use.

On a live game this attribute must also be ticked by hand at `/gm/dev/zones`
for any newly-authored Location, since `docs/zones.yaml` is one-shot/additive
sync (`db:import-zones` never updates an existing row — `CLAUDE.md`). The
checkbox appears automatically because `attributesFromInput` walks
`Object.keys(ATTRIBUTES)`.

## 3. The seed-bag → sowing-licence chain

A seed bag (`wheat-seed-bag`, `potato-seed-bag`, `tomato-seed-bag`,
`carrot-seed-bag`, `onion-seed-bag`, `plump-helmet-seed-bag`,
`pigtails-seed-bag`, `tobacco-seed-bag` — real slugs, verified against
`docs/tags.yaml`; naming
follows the ordinary "slug is the name, slugified" rule rather than the
plan's original literal `seed-bag-<crop>` draft, since the bag slugs
themselves are never referenced anywhere in code) is `consumable` with
`consumesInto: [sowing-<crop>]`. Consuming one grants the matching sowing
tag — `sowing-wheat`, `sowing-potato`, and so on — a **1-turn licence**
(`durationTurns: 1`, an ordinary hidden Status tag, cleared by the standard
turn-expiry sweep like any other 1-turn grant).

The Farm dialog and the server action both read which crops a character may
sow the same way: `db/lib/soilery.js#sowableCrops(characterTags)` filters its
`CROPS` table (the canonical sowing-slug/crop-slug pairing) down to whichever
sowing tags the character currently holds. **One bag licenses any amount of
that crop up to the cap** (`GameConfig.farmMaxCrops`, 50 by default, editable
on `/gm/dev` mid-round) — the doc caps the sowing, not the seed. Seed bags
are Merchant-stocked (`depotPrice: 4`), and the Silo (`town-3-2`) now stashes
six of them — two wheat, two potato, one carrot, one plump-helmet, plus 4 wheat
and 4 potato — behind `[barons-key, soilers-key, hands-key]`. The
Farms Room (`town-3-1`) still stashes only `work-knife: 1`. This paragraph said
no seed was stashed anywhere until 2026-09-20.

Eight crops, eight bags, eight sowing tags — `pigtails` and `tobacco`
included, even though neither is a foodstuff (§5b, §6a). `db/test/soilery.test.js`
asserts the whole triple exists for every entry in `CROPS[]`, so a crop added
to the table without its bag and licence fails the build rather than the game.

## 4. The Farm action

`web/app/(app)/character/actions/soilery.js#farmRequestImpl`, modeled on
`extractGodfleshRequestImpl` (`FACTORY.md` §3) — the closest existing analog:
a Location-attribute-gated action with its own refusal chain, filed as a Move
that commits now and resolves its dice at push.

**Gating, checked in order:**

1. Standing on a `soilery`-attributed Location, or refused outright.
2. `db/lib/soilery.js#farmRefusalFor(characterTags, hasOpenAction)` — the
   **one function** the server action and the sheet's Farm-button tooltip
   both call, so the refusal text can never drift from what actually blocks
   the request:
   - Doesn't hold `soilery` → *"You don't know how to farm."*
   - Holds `exhausted` **or** `tired` → *"You're too worn out to farm right
     now."* (§5 — either rung of the fatigue ladder locks the farm out, not
     just the deeper one.)
   - Already has an action filed this turn → *"You already have an action
     this turn."*
3. `blockerFor(character.tags, ACT)` — Bound, Dying, Paralyzed or Catatonic,
   mirroring `misc.js`'s equivalent gate.
4. `requireFreeMove(character, openTurn)` (`web/lib/moveSpend.js`) — refuses
   on no open turn, the Move-lock window, or an existing `Action` row this
   turn via `@@unique([characterId, turnId])`. This is the "not already
   submitted an action" rule.
5. `sowableCrops(character.tags)` → `validatePlan(lines, licensed, maxCrops)`
   — full server-side re-validation (the client's plan is advisory only):
   rejects an unlicensed crop, a non-integer or non-positive count, a total
   of 0, or a total over `maxCrops` (read from `GameConfig.farmMaxCrops`,
   falling back to `FARM_MAX_CROPS` (50) if unset — editable on `/gm/dev`
   with no deploy).

**Inside one `$transaction`**: `lockCharacter`, then the sowing licences are
**re-checked under the lock** (so two tabs can't both spend one bag's one
ticket), one sowing tag dropped per crop actually used (spending the ticket
once per crop, not once per unit planted), `fileAutoRoutine(..., {
deferEffects: true, farmPlan })`, and one `logAudit({ actionType:
"request_farm", ... })`. `web/lib/auditNarrative.js`'s `request_farm`
renderer shows the **plan** filed, not the outcome — the harvest isn't
decided yet at filing time.

**The wither roll**, `db/lib/soilery.js#reap(planted, rng, opts)`: rolls
`planted` **independent** 1-in-`WITHER_IN` (6) chances, not a rounded average
— a small planting can wholly fail or wholly survive, which a rounded average
can never produce. Each survivor then brings in `cropsPerPlant` of its crop
(3 by default), so the return value counts **crops, not plants**.

`cropsPerPlant` and `witherIn` are per-crop overrides carried on the `CROPS`
table, and **`reapFor(cropSlug, planted, rng, opts)` is what callers use** —
it looks the entry up so `moveEffects.js` never has to know a crop's numbers,
the same "one function both sides call" shape `farmRefusalFor` follows. An
unknown slug reaps on the ordinary numbers rather than throwing: this runs at
turn-push, where a throw would lose somebody's whole harvest over a renamed
tag.

`harvestLine(rows)` composes the turn-close prose ("sowed 30 Wheat and reaped
75, ..."), and `farmDm(turn, rows)` wraps it as the DM sent when the turn
closes.

## 5. Why resolution happens at turn-push, not a new pass

Chosen over a new `turnSideEffects` step, for four reasons verified against
the code — the same shape `refined` (`FACTORY.md` §4) already establishes:

1. **The idempotent claim already exists.** `db/lib/stagedPush.js` claims
   each Action row with a conditional write (`appliedEffects: DbNull → {}`,
   `stagedPush.js:411-414`) before applying effects, so a resumed
   turn-advance can't double-roll the wither dice. A new pass would have had
   to invent this idempotency itself.
2. **Push ordering already puts staged-push before the carry pass**
   (`TURN-ENGINE.md` §2), so a 50-crop harvest's 25 lb (`CARRY.md`) gets
   weighed in the same close it lands.
3. **Undo comes free** via `revertMoveEffects` (`db/lib/moveEffects.js`) —
   every `MOVE_EFFECTS` entry's `revert` is called automatically by the
   existing GM Unsolve path.
4. **The exact precedent already exists**: `refined` is a Move that commits
   at press and resolves its outcome at push, discussed in `FACTORY.md` §4.

**The mechanism**, `web/lib/moveSpend.js#fileAutoRoutine`'s `deferEffects`
option: the Move is spent and the seed bag's licence is gone at submission,
but `Action.appliedEffects` stays `null` (rather than `{}`) so the turn-push's
staged-push claim still sees the row as unresolved and rolls the dice at push
time. `farmPlan` (`{ v: 1, rows: [{ slug, tagId, tagName, planted }, ...] }`)
rides along on the `Action` row for that later resolution.

**`db/lib/moveEffects.js`'s `farmed` entry**, after `refined`:

- `read(action)` — `1` if `action.farmPlan?.rows?.length`, else `0`.
- `apply(tx, action)` — per row, `reap(row.planted)`, `addToStack`s the
  survivors onto the character, then calls `applyFatigueStep` (§5a) — one rung
  of the shared ladder, `tired` from fresh and `exhausted` from Tired, exactly
  as a Factory shift does. Returns `{ rows, fatigue }` as the snapshot stamped
  on `appliedEffects`.
- `revert(tx, action, snapshot)` — drops each reaped stack back off, then hands
  the fatigue snapshot to `revertFatigueStep`, the same helper `refined` uses.

`describeMoveEffects` renders a `farmed` value via `harvestLine(value.rows)`.

**The turn-close DM.** `stagedPush.js`'s close-DM suppression skips anything
whose `gmNotes` contains `"auto:"` (the travel stub and the Mine button's own
row already speak for themselves) — which would otherwise swallow the farm harvest DM too, since
Farming files as `"auto:farm"` (`web/lib/moves.js#AUTO_FARM`). A narrow
carve-out reads `action.farmPlan && applied.farmed` and sends `farmDm` instead
of skipping, rather than loosening the generic `"auto:"` skip for every other
auto-filed Routine.

## 5a. The tired/exhausted ladder

`db/lib/fatigue.js#applyFatigueStep(tx, characterId, turnNumber)` — the same
function a day's mining and a Factory shift climb (`MINING.md` §5,
`FACTORY.md` §4). **Farming is on the one ladder now**, and there is no
farming-specific fatigue rule left.

A day at the plough steps one rung: `tired` if you were fresh, `exhausted` if
you were already Tired. `farmRefusalFor` refuses on `exhausted` **only** — the
same gate `refineFatigueRefusal` and `computeMiningAccess` use. So:

- Fresh, you farm. `tired` lands at the close.
- Tired, you may farm **again** — pushing a day is allowed. `exhausted` lands.
- Exhausted, you are refused. At the close it decays into `tired`
  (`expiresInto`, `docs/tags.yaml`), and the close after that `tired` expires
  on its own clock.

**In the steady state that is one day in two.** Exhausted decays back into
`tired`, not into nothing, so after the opening pair you are Tired at the start
of every working day and each day's work takes you straight to Exhausted: two
farms in a row at the very start, then strictly alternating. `npm run
economy:report` plays the ladder out turn by turn against the live gate rather
than asserting it, and prints the pattern (`██·█·█·█·`).

Until 2026-09-21 farming called `grantExhaustedOutright`, which handed out
`exhausted` with no lesser rung, and `farmRefusalFor` refused on `tired` too —
so a single day locked out the next two and farming was the one day-verb you
could never work twice running. Nothing else in the game worked that way.
`grantExhaustedOutright` is now unused by farming; `revertFatigueStep` handles
the Undo for both verbs, since the snapshot shape is the same one.

## 6. The tag catalog additions

All verified directly against the current `docs/tags.yaml`.

**Six growable crops** (`weight: 0.17`, `group: items-food`, `catalog: all`,
`consumable: true`, `cooked.tasteForm: "adjective"`, and **none of them
sellable**):

| slug | taste | mood | hunger | note |
|---|---|---|---|---|
| `wheat` | crunchy | −5 | 2 | raw is Nauseous — `consumesInto: [nauseous]`, `cooked.into: []`, same raw/cooked split as `dustfish` below |
| `potato` | earthy | 2 | 4 | |
| `tomato` | acidic | 3 | 4 | |
| `carrot` | earthy | 3 | 4 | |
| `onion` | acrid (edited in place — was `mood: 8`, no `hunger`) | 2 | 4 | |
| `plump-helmet` | earthy | 1 | 3 | |

**A crop is a third of what it used to be** — a third the weight, a third the
hunger — because a plant now gives three of them. The harvest is the same
21 lb and the same food it always was; it just arrives as more, smaller
things. Eating raw is therefore exactly as good as it ever was (~21 people a
turn off three farmers), while **cooking is now a 4.4× multiplier** rather
than 1.46×, which is the Soilery→Cooking separation the tier ladder is for.

Two knock-ons, both intended. Pure-crop recipes got cheaper relative to meat
and fish ones, since meat and fish are not farmed and did not triple — the
town tilts vegetarian. And a crop dropped into a spare ingredient slot now
adds 4 rather than 12, which quietly reduces how much of a big dish overflows
the 100 ceiling and is thrown away (`TURN-ENGINE.md` §5).

**They are not sellable, and that is the rule, not an oversight.** `sellable`
and `sellablePrice` were both removed — `db/lib/syncTags.js` throws if one is
present without the other, in either direction, so never add just one back.
Tripling the yield while leaving food at 2 ¢ a unit would have made the
Soilery the best-paying job in town by accident, against §1's whole point.

**Two non-foodstuff crops**, sown the same way but never a meal. `pigtails`
(`category: items`, `group: items-gear`, no `cooked:` block, not
`consumable`) — grown in the fields, its Crafting use (crushed into fibre) is
a later page and out of scope here. It yields 3 a plant like the food crops,
weighs 0.17, and is **not sellable either**: leaving a tripled crafting input
priced at 2 ¢ would only have made it a second, accidental tobacco. And
`tobacco` itself, which is §6a.

**Ten non-growable foodstuffs**, same base shape as the crops:

| slug | taste | mood | hunger | note |
|---|---|---|---|---|
| `meat` | meaty | 5 | 12 | |
| `dead-rat` | meaty | −10 | 9 | raw/cooked split, `consumesInto: [nauseous]` |
| `sugar` | sweet | 20 | 12 | |
| `cheese` | cheesy | 15 | 12 | was a deliberate near-duplicate of `hard-cheese`; `hard-cheese` was later retired |
| `rendered-fat` | creamy | 10 | 12 | renamed from the doc's "Fat" — that slug is taken by an unrelated general trait |
| `eel` | fishy | 7 | 15 | was a deliberate near-duplicate of `river-eel`; `river-eel` was later retired |
| `dustfish` | acidic | −15 | 15 | raw/cooked split, `consumesInto: [nauseous]` |
| `haggar` | fishy | 5 | 15 | |
| `tunnel-trout` | fishy | 5 | 15 | |

**Existing foodstuff tags edited in place** to carry `hunger` (and, for
`onion`, a retuned `mood` and `tasteForm`): `onion`, `arelitz-egg`,
`maggot-milk`, `tinned-butter`, `fish-roe`, `honey`, `crayfish`. `hard-cheese`
and `river-eel` were deliberately left untouched at the time — both were later
retired once `cheese`/`eel` fully covered their role, along with the other
pre-Soilery foodstuffs that never made it into the design doc's tables
(`blind-fish`, `canned-crabmeat`, `goose-fat`, `lamprey`) and the standalone
`rations` tin, whose `cooked` values moved onto the Ration Box's own five
draws (`moldy-bread`, `grasshopper-kebab`, `jellied-meats`,
`skinned-cave-rat`, `budget-cold-soup`). Those five have since had their
`cooked` blocks taken off again in favour of a flat `mealHunger`/`mealMood`
pair, so they are **not** slot-eligible ingredients any more — that is the
point of them. Being slot-eligible made the Depot's cheapest shelf the
cheapest hunger in the game BY a wide margin and fed it straight into the
Soilery's own recipes as filler, which collapsed the two food economies into
one. `cooked: { not: null }` is the slot-membership test, so having no
`cooked` block is what keeps them out. `boar-loin`, `flesh-of-tzchernobog`,
`human-flesh` and `saffron` were reconciled against the design doc's
"Ingredients which do not constitute foodstuffs" table (pages 3-4) rather
than removed. `honeyed-cakes` was converted from a standalone craftable into
a proper Skilled Cooking Meal (bread + honey, COOKING.md §2a); `trail-ration`
was removed outright.

**Seven seed bags** (`wheat-seed-bag` … `pigtails-seed-bag`, `group:
items-seeds`, `depotPrice: 4`, `weight: 1`, `consumable`,
`consumesInto: [sowing-<crop>]`) and **seven sowing tags**
(`sowing-wheat` … `sowing-pigtails`, `category: status`, `group:
status-buffs`, `durationTurns: 1`). §3 above.

**Two new `cooked:` block fields**, validated in
`db/lib/tagShapes.js#normalizeCooked`:

- **`hunger`** — a whole number from 0 to 100 (`HUNGER_MAX`), how much this
  ingredient restores on the hunger meter. Stored only when present, same
  opt-in posture as `cures`. Absent means "not really food" — it still grants
  `ate-meal` if tagged for that, but restores nothing.
- **`tasteForm: "adjective"`** — the only other legal value is absent.
  Extends `web/lib/cooking.js`'s taste-line template so a taste renders bare
  ("It tastes acidic.") instead of the default noun form ("It tastes like
  onions."), without touching any of the 58 existing noun-style tastes, which
  are all left unmarked.

**`Tag.mealHunger`**, a new schema column beside `mealMood`, copied onto a
minted `custom-craft-…` dish by `db/lib/customCraftMint.js` (miss that step
and every minted dish restores zero hunger — verified still wired correctly)
and synced from `docs/tags.yaml` by `db/lib/syncTags.js`. `fine-meal` and
`lavish-meal` carry `mealHunger: 12` / `18` (alongside their existing
`mealMood` 5 / 8) so a cooked plate outhungers its raw ingredient — scaled
×3 with every other inferred hunger number when the meter moved to 0-100
(Context §6).

**New tag group**: `items-seeds` (`docs/taggroups.yaml`, category `items`),
with a `Sprout` icon glyph wired in `web/lib/tagIcons.js`.

## 6a. Tobacco, the cash crop

The eighth sowable crop, and **the only one worth money**. Three tags, the
same triple every other crop has (§3): `tobacco`, `tobacco-seed-bag`
(`depotPrice: 4`, like the rest) and `sowing-tobacco`.

| | value | why |
|---|---|---|
| `cropsPerPlant` | **2** | half a food crop's yield |
| `witherIn` | **3** | a 2-in-6 failure, double the food crops' |
| `weight` | 0.25 | leaves, and half a plant's output means half the unit |
| `sellablePrice` | **1 ¢** | the tuning dial — see below |
| `cooked:` block | **none** | not food; cannot be eaten, cannot fill an ingredient slot |

**The arithmetic.** 50 sown → ~33 survive → **~67 leaves**, which at 1 ¢ is
**~67 ¢ a harvest**, about 33 ¢ a turn for a farmer working every other turn.
A tobacco field feeds nobody, so that is a wage paid for entirely by somebody
else's dinner. With three farmers sitting at exactly the town's capacity (§1),
one of them switching to tobacco starves a third of Ravenheart. **That
decision is the whole reason the crop exists.**

`sellablePrice: 1` is the dial, and it sits at the floor on purpose: prices are
whole numbers, so there is no lower setting that still pays anything. It was 2 ¢
until 2026-09-21, which made tobacco the best wage available to a farmer and
made the choice to grow it nearly automatic. At 1 ¢ the leaf still pays, but a
player has to want the coin enough to take the field out of food — which is the
trade the crop is for. The other seven crops are not sellable at all (§6), so
this is the only crop price in the game.

**Fertilizer is worth more here than anywhere else.** It cancels the wither
roll outright (§8), and tobacco's is twice as steep as a food crop's — so the
risky crop is exactly where the Addendum pays best. That falls out of the
existing rule rather than being special-cased.

It carries **no sprite**: no tobacco art exists in `web/public/assets/items`,
and `syncTags.js` throws on a `sprite` naming a file that is not there. An
absent sprite is the ordinary case. Add one and name it when the art lands.

The name is "uncured" on purpose — nothing cures it yet, and a curing step
(or a pipe, or anything a player does with a leaf other than sell it) is an
open page, not a promise this section makes.

## 7. The hunger meter — see TURN-ENGINE.md, not here

The Soilery design doc's other half (pages 1 and the hunger section) is a
full rebuild of Hunger: the old ⬢-upkeep/streak/Gambit-penalty system is torn
out and replaced by a 0-100 meter (`Character.hungerValue`, `db/lib/hunger.js`)
that decays every turn and is raised only by eating — Consume reads the
`cooked.hunger`/`mealHunger` fields §6 introduces. This is thoroughly
documented already and **is not repeated here** to avoid drift between two
copies of the same mechanics:

- [`TURN-ENGINE.md`](TURN-ENGINE.md) §5/§5a/§5b — the full mechanics: decay,
  thresholds, banding, the `dying` chain, the horse-upkeep ordering.
- [`REQUESTS.md`](REQUESTS.md) §4 — Hunger and the Gambit modifier, the
  eating path, the DM copy.
- [`TAGS.md`](TAGS.md) — `ate-meal`'s current lifecycle (see the note below)
  and the automatic-tag-writer conventions it follows.
- [`MOOD.md`](MOOD.md) — the `HUNGRY`/`STARVING` mood events and the one-time
  onset hits.
- [`ECONOMY.md`](ECONOMY.md) §6 — why Hunger is no longer a ⬢ sink.
- [`SHEET.md`](SHEET.md) — the sheet's hunger warning copy (never a number).

**One correction worth flagging here**, since Soilery's own tag work touched
it: `ate-meal` now carries `durationTurns: 1` in `docs/tags.yaml` and expires
through the ordinary turn-expiry sweep, exactly like `hungry`/`starving`/
`tired` — **not** through a bespoke consumption step. It used to be cleared by
the old streak-based hunger pass, which no longer touches it at all under the
new meter; without a duration it would never have expired. `db/lib/hunger.js#foodHungerFor`
only ever *reads* `ate-meal` (as the "this unpriced item still counts as
food" fallback signal), never writes or clears it. The `dined` tag (Nobility's
separate marker, cleared by the mood pass instead — `MOOD.md` §8) carries a
corrected comment in `docs/tags.yaml` reflecting the same fact: it no longer
claims the hunger pass eats `ate-meal`, since nothing does that any more.

## 8. Cooking, and the Fertilizer addendum

Cooking (the design doc's page 2) needed no new code **for this crop/
foodstuff pass**: any tag with a `cooked:` block — including every new crop
and foodstuff tag from §6 — is automatically a valid Cooking ingredient the
moment `docs/tags.yaml` is synced. `cooked.hunger` and `cooked.tasteForm` are
the two additions Cooking's own code needed to learn to read (`COOKING.md`
§3), and both are opt-in fields on the same block Cooking already parsed. A
**later** pass did rebuild the rest of Cooking, replacing the old Fine/Lavish
Meal pair with the design doc's 31 named recipes — see `COOKING.md` §2a,
which is unrelated to the crop/foodstuff catalog this file covers.

The design doc's Addendum — Fertilizer disables the wither roll and replaces
it with an independent 1-in-6 (`BOUNTY_IN`) chance of double yield per
planted unit — lives in `db/lib/soilery.js#reap`'s `fertilized` option, not a
separate function: same per-unit loop shape, opposite outcome table, and the
two are mutually exclusive per unit. "Double" means the plant's **whole**
yield doubles, so 6 crops rather than 3 on a food crop and 4 rather than 2 on
tobacco — never a single extra unit bolted onto the side. `farmRequestImpl` reads whether the
character holds `fertilized-fields` (unconsumed) and stamps it onto `farmPlan`
(`v: 2` now,
`{ fertilized: boolean }` added), read at push by `moveEffects.js`'s `farmed`
entry the same way every other farmPlan field is.

## 9. Where the code lives

| Concern | File |
|---|---|
| The crops, the wither die, per-crop yield (`CROPS_PER_PLANT`, `reapFor`), plan validation, refusal text | `db/lib/soilery.js` |
| Tobacco: the tag, its seed bag and its sowing licence | `docs/tags.yaml` (§6a) |
| The `soilery` Location attribute | `db/lib/locationAttributes.js` |
| The Farm server action | `web/app/(app)/character/actions/soilery.js` (`farmRequestImpl`) |
| The thin request wrapper | `web/app/(app)/character/requestActions.js` (`farmRequest`) |
| Turn-push resolution: the wither roll, the harvest, the fatigue grant | `db/lib/moveEffects.js` (`farmed`) |
| The shared tired/exhausted ladder | `db/lib/fatigue.js` (`applyFatigueStep`, `revertFatigueStep`) |
| Deferred-effects filing (`deferEffects`, `farmPlan`) | `web/lib/moveSpend.js` (`fileAutoRoutine`) |
| The `"auto:farm"` Move marker and desk label | `web/lib/moves.js` |
| The harvest DM carve-out past the `"auto:"` suppression | `db/lib/stagedPush.js` |
| The audit-log renderer for a filed plan | `web/lib/auditNarrative.js` (`request_farm`) |
| The seed bags, sowing tags, crop and foodstuff tags | `docs/tags.yaml` |
| The `items-seeds` tag group and its icon | `docs/taggroups.yaml`, `web/lib/tagIcons.js` |
| `cooked.hunger`/`cooked.tasteForm` validation | `db/lib/tagShapes.js` (`normalizeCooked`) |
| `Tag.mealHunger` schema, sync, and mint-copy | `db/prisma/schema.prisma`, `db/lib/syncTags.js`, `db/lib/customCraftMint.js` |
| The Farms placeholder geography | `docs/zones.yaml` (`farms:`) |
| The sheet-side Farm gate (`canSeeFarm`/`farmBlocked`/`canFarm`) | `web/app/(app)/character/page.js` |
| The Farm verb strip entry | `web/app/components/actionRegistry.js` (`mode: "farm"`) |
| The Farm dialog itself | `web/app/components/actions/FarmDialog.js`, registered in `web/app/components/actions/index.js` |
| The GM-tunable sow cap (`GameConfig.farmMaxCrops`, default 50, `FARM_MAX_CROPS` is the code fallback) | `db/prisma/schema.prisma`, `db/lib/gameConfigFields.js` (`/gm/dev?s=config`, "Economy" group) |
