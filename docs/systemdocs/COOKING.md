# Cooking

A cook makes a **meal** in one of three classes — Basic, Skilled or Lavish —
out of **Foodstuffs**, names it, describes it, may slot extra ingredients into
it and may give it one base taste. This is Bascinet's design doc
`E:\Bascinet\V3\Soilery\Soilery Rework.docx`. Read this before touching
`Tag.cooked`, `Tag.cookedFrom`, `Tag.mealClass`, `Tag.mealTaste`/`mealTasteForm`,
`requirement.ingredientSlots`, `db/lib/meals.js`, `web/lib/cooking.js`,
`db/lib/mood.js#dishMoodTerms`, the meal branch of
`web/app/(app)/character/actions/crafting.js`, or `IngredientSlots.js`.

Crafting in general is [`CRAFTING.md`](CRAFTING.md); this is the one recipe
family that does something crafting alone cannot. What a meal does to your
hunger is [`TURN-ENGINE.md`](TURN-ENGINE.md) §5; eating several at once is
[`REQUESTS.md`](REQUESTS.md) §4.

## 1. What changed, and why

Until the rework there were 36 **named** recipes — Bread, Omelette, Steak and
the rest — each with fixed base ingredients (crops, meat, fish) and its own
hunger, mood and taste, and a cook could not name what they made. The doc
removes every one of them and every food crop, and puts one general
**Foodstuffs** item in their place ([`SOILERY.md`](SOILERY.md) §2). A cook now
picks a **class** and writes the dish themselves.

What carries over unchanged, in mechanism:

- Extra ingredients still slot on top, 0–4 of them, out of any tag with a
  `cooked:` block (§3, §9).
- An ingredient brings its side effects, its cures, its poison and its taste
  with it (§4–§5a).
- Eating a meal says how it tastes, and nothing else (§8).
- A dish is a minted row (§2).

## 2. The three meal classes

Three catalog templates in `docs/tags.yaml`, each with `mealClass`:

| Class | Template | Skill | Foodstuffs | Hunger | Mood | Move | Extra ingredients | Where |
|---|---|---|---|---|---|---|---|---|
| Basic | `basic-meal` | Cooking I (`cooking-basic`) | 2 | +15 | +2 | 0.05 | 0–4 | anywhere |
| Skilled | `skilled-meal` | Cooking II (`cooking-skilled`) | 2 | +18 | +6 | 0.05 | 0–4 | anywhere |
| Lavish | `lavish-meal` | Cooking II | 3 | +20 | +12 | 0.2 | **1**–4 | a kitchen |

Hunger, mood, Foodstuffs, skills and the kitchen are the doc's. **The Move cost
is not in the doc** — Basic and Lavish keep the old tiers' 0.05 and 0.2, and
Skilled costs the same 0.05 as Basic (both Bascinet's call), so a turn cooks 20
Basic, 20 Skilled or 5 Lavish meals.
`cooking-skilled` has `parentTag: cooking-basic`, so a Cooking II cook can make
all three.

The templates are ordinary craftable recipes: the Craft dialog lists them to
anyone holding the skill, and the Craft path supplies the Move budget, the
quantity cap (Move, Foodstuffs, extra ingredients — whichever runs out first),
staging, and the slots. **Nobody ever holds a template**: every meal is minted
(§2b).

### 2a. What the cook chooses

The meal branch of `craftRequestImpl` (`resolveMealRequest`), re-checked
server-side whatever the dialog allowed:

- **A name** — required. Letters and single spaces only, 30 at most
  (`db/lib/meals.js#cleanMealName`). The doc says "letters of the alphabet";
  spaces are this implementation's reading, so "Meat Pie" is a name. No digits,
  no punctuation — which is also what stops a Basic cook typing their own
  `+` or `*`.
- **A description** — required (the doc says the cook "must choose a custom
  name and description"). Any characters, 300 at most, through
  `db/lib/customText.js#cleanCustomText`.
- **A base taste** — optional, one of a fixed list (`MEAL_TASTES`: acidic,
  acrid, bitter, cheesy, creamy, crunchy, earthy, fishy, holy, meaty, numbing,
  rich, salty, sweet, toxic). The doc names no list; these are the adjectives
  the catalog's own ingredients already use.
- **Extra ingredients** — optional for Basic and Skilled; a Lavish meal needs
  at least one (`ingredientSlots.min: 1`).
- **How many** — the stepper, capped by what the Move, the Foodstuffs and the
  extra ingredients can pay for. Each meal uses one of each extra ingredient.

A Lavish meal is refused unless the Location has the **`kitchen`** attribute
(`db/lib/locationAttributes.js`, ticked on `/gm/dev/zones`): today the Old
Cock Inn, the Keep and the Poorhouse, the three places with a kitchen room.
It is a Location attribute, so standing at the Inn is enough — nobody needs the
Inn's key.

### 2b. A meal is a minted row

`db/lib/customCraftMint.js#mintCustomCraft`, in `literal` mode, clones the
class template into a `custom-craft-…` row carrying:

| Column | What |
|---|---|
| `name` | the cook's name, dressed in the class's symbols (§2c) |
| `description` | the cook's description |
| `mealClass` | the class |
| `mealHunger`, `mealMood` | the class's figures |
| `mealTaste`, `mealTasteForm` | the chosen base taste (adjective form), or `""` |
| `cookedFrom` | the extra ingredients' slugs, sorted |

A second cook who writes the same name, description, taste and ingredients in
the same class gets the same row (the mint's reuse key). A cook cannot tell
two batches apart except by what they wrote on them.

### 2c. The symbols, and italics

| Class | Written | Example |
|---|---|---|
| Basic | as typed | `Stew` |
| Skilled | `+` either side | `+Scones+` |
| Lavish | `*` either side, drawn in italics | `*Caviar*` |

The symbols are part of `Tag.name` (`db/lib/meals.js#decorateMealName`), so
every surface prints them. The italics are drawn by
`web/app/components/TagName.js` wherever a chip or a tag's details show a name
(`ChipLabel.js`, `TagDetails.js`), off `Tag.mealClass`. On Discord the
asterisks themselves turn `*Caviar*` italic.

### 2d. Nothing about a meal shows but its name and description

The doc: none of the ingredients or flavours are apparent when inspecting a
meal, unless the chef wrote them in the description. So `cookedFrom`,
`mealTaste`, `mealHunger` and `mealMood` never reach a browser —
`web/lib/tagChipRows.js#cookedTasteOnly` strips all four from every held tag
before a page ships it. Taste reaches a player only when their character eats
(§8).

## 3. `cooked:` — what a tag contributes as an ingredient

```yaml
  fish-roe:
    cooked:
      taste: "little crunchies"
      mood: 28
      into: [nauseous]        # OPTIONAL — read §4

  meat:
    cooked:
      taste: meaty
      tasteForm: adjective    # OPTIONAL — see below
      mood: 5
      hunger: 12              # OPTIONAL — see below
```

**The presence of this block is the only thing that makes a tag cookable.**
There is no `ingredient: true`, and no recipe names a legal ingredient
anywhere. Every foodstuff you buy, forage or butcher carries one, and so do
the brews, drugs, body parts and relics worth putting in a pot; adding one more
is one YAML entry and a `db:sync-tags`. Foodstuffs do **not** — they are what a
meal is cooked from, never an extra (§2).

- **`taste`** is a *fragment*, dropped into the middle of one sentence, so it
  is lowercase and under 40 characters. `taste: ""` is legal and means
  **undetectable** — Phrygian Tears and Adder's Bite, the two things a cook
  can hide in a meal with no tell at all. The key is still required, so an
  empty taste is a claim somebody made rather than a field somebody forgot.
- **`mood`** is signed, on the `MOOD.md` scale.
- **`into`** is what it grants the eater, in the same shapes `consumesInto`
  takes (`oneOf` included).
- **`hunger`** is optional — a whole number from 0 to 100, how much this
  ingredient restores on the 0-100 hunger meter (`foodHungerFor`,
  `db/lib/hunger.js`), eaten raw or slotted into a meal. Absent means "not
  really food": it restores nothing.
- **`tasteForm`** is optional and only ever `"adjective"`. By default
  `web/lib/cooking.js` renders `taste` as a noun ("It tastes like onions.");
  `tasteForm: "adjective"` renders it bare instead ("It tastes acidic.").
  Existing tags leave this unset and are unaffected — nobody rewrote the 58
  noun-style tastes to add it.


## 4. Raw is not cooked

**An ingredient with no `into` contributes its own `consumesInto`.** That is
not a fallback, it is the mechanism, and it makes the tag's two halves say two
different things:

| | Raw (`consumesInto`) | Cooked (`cooked.into`) |
|---|---|---|
| Meat | `[]` — nothing | absent → nothing |
| Deep Morel | `[nauseous]` | `[]` — cooking takes the nausea off |
| Moonshine | tipsy, damaged-vision | absent → both, still |
| Human Flesh | `[]` — nothing | `[{oneOf: [nauseous, vomiting]}]` |
| Squeeze | `[seizure]` | absent → a seizure, still |

`into: []` and an absent `into` are **different claims**. The first says
"contributes nothing"; the second says "whatever I do raw". Nine of the
thirteen new ingredients do nothing raw and say so with `consumable: true`
and an empty `consumesInto` — you can put a raw onion in your mouth, and then
nothing happens, which is a real answer rather than a missing one.

**Cookable and edible are different claims.** The six body parts are not
consumable at all and carry `cooked` blocks: nobody gnaws a raw hand, and a
hand in a stew is very much a thing that can happen.

## 5. Medicine in a stew

Half of this needed no hook and half of it did. The half that did is the more
interesting one, so it goes first.

### `cooked.cures` — the opt-in

The medical pass put cures on their own `Tag.cures` column rather than on
`consumesInto`, and a separate column travels nowhere by itself. So an
ingredient's cures ride through the pot only when the ingredient says so:

```yaml
white-honey:
  cooked:
    taste: "medicine"
    mood: 15
    cures: true
```

Default is **off**, because not every cure is swallowed. A tonic somebody
drinks works in a stew; something injected, applied or strapped on does not,
and cooking one into dinner ruins the dinner and cures nothing.

| Rides through the pot | Does not |
|---|---|
| White Honey, Antidote, Fever Draught, Purifier, Antibiotics, Forgiveness | Burn Dressing, Leeches, Cleaning Powder, the two autoinjectors, all six prosthetics |

`db/lib/tagShapes.js#validateCooked` refuses the two shapes that are always
authoring slips: `cures: true` on a tag carrying `administerSkill` (that whole
column is cures a doctor *fits*), and `cures: true` on a tag that cures
nothing. `mergeDishCures` in `web/lib/cooking.js` does the union, and
`curesInto` — the aftermath a cure leaves — merges beside it, last ingredient
winning a collision.

A **dish never carries cures of its own.** A minted dish is a custom craft
off a recipe with no cure on it; the ingredients are the only place one can
come from.

### `into` — the half that was free

White Honey, Mercy, the Cat and the rest carry a `taste` and a `mood`
and **no `into`**, deliberately. They therefore contribute their own live
`consumesInto`, read at the moment somebody eats the dish rather than frozen
in when it was cooked. Whatever the medical pass makes a medicine *grant*, it
grants in a stew too — for every dish already sitting in every pocket, on the
next bite, with no re-mint, no backfill and no code here.

That is the whole reason effects are derived late (§6). A *new* medical
consumable wants a `cooked:` block with a taste and a mood, `into` left alone,
and `cures: true` only if it is a thing you drink.

## 5a. Poison in a dish

Poison reaches a meal by two routes and they behave differently, which is
worth holding in your head before changing either.

**Laced.** Somebody ran `poisonItemRequest` over the finished dish, or over an
ingredient the cook then used. Either way the taint rides the real stack as
`poisonedCount` / `poisonPayload`, drawn hypergeometrically when units leave,
and the medical pass's existing marker catches it.

**Cooked in.** The cook simply used something poisonous — phrygian tears.
This is *not* lacing: the poison rides through
`mergeDishGrants` as the ingredient's own `consumesInto`, and there is no
`poisonedCount` anywhere to notice. This route used to be invisible to Poison
Sense, so a palate that caught a laced bowl missed a bowl that came out of the
pot poisonous.

`dishCarriesPoison` closes that: a dish also reads as tainted when any slug in
its `cookedFrom` is flagged `poison: true`. Derived off `cookedFrom` at read
time like everything else here, so re-flagging an ingredient fixes every dish
already in every pocket.

**Phrygian Tears becomes visible in a dish**, which its authored-empty taste
deliberately hides. That is the intended trade: the tell costs a 5-point trait
or a held gadget (`db/lib/poison.js`), so a Phrygian dish still reads as an
ordinary meal to everyone at the table who has not paid for a palate.

**Iron Constitution shrugs off `nauseous`** alongside the `vomiting` it
already resisted. The seven flesh ingredients roll `oneOf: [nauseous,
vomiting]`, so before this the trait worked on exactly half of a mouthful of
hand, at random — and a raw Deep Morel or Blind Fish got through it entirely.
It stops there on purpose: `phrygian-toxin`, `seizure`, `hallucinating` and
`damaged-vision` are what their items are *for*, not upset stomachs.

## 6. Eating one

`consumeTagRequestImpl`. A meal restores its class's `mealHunger` plus every
extra ingredient's `cooked.hunger` (`db/lib/hunger.js#unitHungerFor`), and
several can be eaten at once up to what fills the eater
([`REQUESTS.md`](REQUESTS.md) §4). When the row has a `cookedFrom`:

1. Load the ingredient rows, put back in `cookedFrom` order. A slug that no
   longer resolves is dropped rather than throwing — the dish is already in
   somebody's hands.
2. `mergeDishGrants` (`web/lib/cooking.js`) concatenates the meal's own
   `consumesInto` with each ingredient's cooked contribution, and
   `resolveConsumeGrants` runs **once** over the merged list. One call is
   load-bearing: it tracks what the eater *will* hold across the list, which
   is how the drinking ladder resolves against a rung the same swallow just
   granted. Two calls would each resolve against a stale sheet and
   double-grant.
3. `mergeDishCures` unions the `cures` of every ingredient that opted in with
   `cooked.cures: true` (§5), and the medical pass's cure loop reads that
   merged list rather than the dish row's own.
4. `applyHiddenCures` for the meal **and each ingredient**, so a pie made with
   leeches still takes the bruise off. (Hidden cures are a separate, older
   mechanism from `Tag.cures` — `db/lib/hiddenCures.js` — and they need no
   opt-in.)
5. Mood (§7).
6. Return `{ line }` — the taste sentence.

### 6a. Dined

Eating a **Lavish** meal leaves the eater **Dined** ("You've eaten properly
today."), and nothing else grants it: no `consumesInto` names it, and
`db/test/dined.test.js` fails the build if one does. The Soilery Rework took it
out along with Ate Meal; it is back, and so is what it is for: a noble who ends a
turn without it takes −10 (NOBLE_MEAL, [`MOOD.md`](MOOD.md) §8).

It lasts **one in-game day**, and a day is however many turns the game counts
to one right now (`db/lib/turnClock.js#turnsInGameDay`): `GameConfig.turnsPerDay`
when a GM has set it, else the turn length's share of 24 hours — 1 turn at 24
hours, 2 at 12, 3 at 8, 4 at 6. That many **whole turns after the one you ate
in**, never "what is left of today": eaten during turn T with N turns to a day,
it expires on T + N (`dined.js#dinedExpiry`). The close's expiry sweep runs
before the mood pass, so it is still held at the close of T and of every turn
after it up to T + N − 1 — N closes, a day's worth, each spared NOBLE_MEAL — and
is swept at the close of T + N. That length can't be a `durationTurns` in
`docs/tags.yaml`, so `db/lib/dined.js#grantDined` works out the expiry at the
grant, and a GM grant from `/gm/dev` is untimed.

- **Another lavish meal restarts the day.** The row's `expiresTurn` moves
  forward, so Dined always means "within a day of your last lavish meal". An
  untimed GM grant is left alone.
- **Several at once is one Dined**, and a lavish meal **fed to somebody else**
  leaves *them* Dined, like every other grant of an administered consume.
- **The Hungerless never dine.** Food does nothing for them (the Soilery Rework
  doc), and Dined is no exception.
- **The close's own eating dines too.** When the turn close eats a lavish meal
  to keep somebody out of Dying (`TURN-ENGINE.md` §5a), `hungerPass.js` grants
  Dined from the closing turn, so the mood pass right after sees it.
- It is `visible: false`, like the hunger descriptors: it shows on the eater's
  own sheet and to nobody inspecting them.

## 7. Mood

**[`MOOD.md` §6a](MOOD.md) is canonical** — it sits with the rest of the mood
tables, which is where somebody asking "what moves the dial" will look. In
short: `dishMoodTerms` sums the meal's own small figure and its ingredients'
(rather than taking a max, the way every other consume does), returns harm and
relief as two terms so only the harm half is scaled, and flags the harm
`noMultiplier` so nothing in the fright table makes disgust free.

A class's own figure (+2, +6, +12) is small beside what an ingredient can
add, from +45 (saffron) to −55 (feces), which is the point: the cook's choice of
ingredient is what makes a meal good or vile.

## 8. The taste line

One sentence, in the bottom-right notice (`NoticeProvider`). `tasteLine(mealName,
entries, count)` (`web/lib/cooking.js`) takes the meal's own name and an array of
`{ taste, adjective }` — the base taste its cook picked (`mealTaste`, §2a)
FIRST, then one entry per extra ingredient's `cooked.taste`/`cooked.tasteForm`
(§3). The design doc's exact wording: "You eat the [meal], it tastes
[flavour], [flavour], …, and [flavour]." — replacing the old, ingredient-only,
mealess "You ate a meal. It tastes like X." Empty tastes are dropped rather
than printed as a gap; no fragments at all reads as "bland" (the two
undetectable poisons, or a meal with no base taste and nothing in it, both
land here). Several eaten at once read "You eat 3 +Scones+, they taste sweet."

A taste fragment renders bare (`tasteForm: "adjective"` — "acidic") or as a
noun (`"like onions"`, the default, unmarked on the 58 legacy tastes) — same
rule `cooked.tasteForm` always had. A picked base taste is always an
adjective.

**Both eating paths raise it.** The one-click Consume on the tag rail is how
people actually eat; it used to throw the server's result away, which would
have meant the taste line only ever reaching the handful who go through the
Actions grid.

`web/lib/tagChipRows.js#cookedTasteOnly` (the server-side cut before a tag's
`cooked` block reaches the browser) keeps `tasteForm` beside `taste`, so the
Craft dialog's ingredient chips render an adjective bare too.

## 9. `ingredientSlots`

```yaml
    requirement:
      ingredientSlots: { min: 1, max: 2 }
```

A **sibling** of `requirement.items`, not another `anyOf`. The legal set is
"any tag carrying a `cooked` block", which no authored list could keep up
with. `ingredientSlots` is the separate door for "any cookable tag, not a
named list" — the Death Mask and the Dreamer's Draught still use `anyOf`/
`group` because they need a *specific* item or a corpse, not "anything that
tastes of something."

Refused on anything not craftable, on a `placement`, and on a **multi-turn
project**: the mint happens on the finishing turn, days after the cook picked,
and nothing carries the slugs that far. Put slots on a 2-turn recipe and they
would have to ride on `CraftProject.custom`.

The server re-checks membership, possession and the count in
`resolveIngredientSlots`. **The same slug twice is refused** — it keeps "it
tastes like onion and onion" off the notice, and it keeps the spend honest.

### The Honey discovery moved, and got better

**`isNonPublicRecipe` must ignore `requirementIngredientSlots`**
(`character/page.js`, which says why at the function). A slots recipe names no
ingredient, so reading its slots the way `items` is read would mark the meal
classes non-public and hide dinner from the whole game. The secret lives in the chip
list now: Honey appears as something you can slot only if you hold a jar.

## 10. The dialog

Cooking is a **branch inside the Craft dialog**, not a screen of its own: a
cook spends the same Move, pays the same way and stacks the same batch, and
forking `CraftDialog.js` to change one control would double the maintenance.

Pick a meal class and the dialog adds the meal's own fields
(`CraftDialog.js`, off `chosen.mealClass`): **Name your meal** (with the name as
it will read — "+Scones+" — once it is legal, and "Letters and spaces only"
until then), **Describe it**, and **Base taste (optional)**. A Lavish meal
away from a kitchen says so, and the Craft button stays off (`CraftAction.js`,
`pools.atKitchen` from `character/page.js`). The server refuses the same
cases whatever the dialog allowed.

`IngredientSlots.js` draws a `.slot-row` of `max` slots over `ChipPicker`'s
own row — boxed in a bounded `.pantry` that scrolls, since 58 cookable tags is
well past the "short, local list" ChipPicker's header asks for — borrowed
rather than re-typed — the one thing it needed that
ChipPicker lacked (more than one live answer at a time) is now a per-option
`active`. Click a chip, it fills the first empty slot; click a slot's ✕, it
comes back out.

**The cook is told the taste and nothing else.** No mood figure, no effect
list, no hint that the thing they are about to serve will make somebody vomit
(Bascinet, 2026-09-09). You learn an ingredient by using it, and poisoning
somebody is meant to be a gamble the poisoner takes too.

That is enforced a layer down, not just left to the component:
`web/lib/referenceData.js#cookedTasteOnly` cuts the `cooked` block to its
taste on the server before it crosses, so there is nothing in the browser to
leak. **`cookedFrom` is not in `TAG_CHIP_FIELDS` at all** — a dish says what
it tastes of and never what it was made with. Do not add it.

`/gm/turns` keeps the full block (`moveRows.js`), which is right: a GM
adjudicating should see everything.

## 11. Where the ingredients come from

The base of every meal is Foodstuffs ([`SOILERY.md`](SOILERY.md) §2). The
extra ingredients come from:

| Source | What |
|---|---|
| Gathering in the Black Hills (`MINING.md` §3c) | The Gather button's table: Cave Fungus and Foodstuffs most days; Crayfish, Meat and a Skinned Cave Rat on a good one; Deep Morel and Honey; Boar Loin and Deer Liver at the rare rungs — the only source those two have; and, once in a long while, a wild Arelitz Egg |
| Farming (Soilery) | Foodstuffs only — the base, never an extra (`SOILERY.md`) |
| The Stable | Arelitz Egg, laid by a fed adult; Meat and Rendered Fat off a butchered arelitz or brood animal — `ARELITZ.md` §4/§5 |
| Butchering | Human Flesh and organs off any corpse; Nekker Pheromones, Graga Sac and Skinless Brain off their own monster corpses — `CORPSES.md` §6 |
| A cook's starting kit | Servant, Geschef, Innkeeper and Inn Staff each start with 40 Foodstuffs (`docs/roles.yaml`): 20 Basic meals, one whole Move |
| Caving | Cave Fungus, Purring Maggot and Rock Salt, `ultracommon` in `db/lib/cavingLoot.js` |
| Room stashes | A handful of Deep Morels across the Caves and Depths; Cheese, Crayfish, Dustfish and Fish Roe stashed a few units at a time in the cellars and the caves |
| The Depot | Saffron, Tinned Butter, Deep Morel, Rock Salt, Honey, Sugar Candy — and, having no other source at all, Sugar and Cheese (`DEPOT.md`'s "Cooking ingredients with no other source" table) |

Room stashes are a **seed, never a top-up** — the "Seed these items now"
action at `/gm/dev/zones` (`seedRoomStash`, `web/app/(app)/gm/dev/zones/actions.js`):
once a stash is eaten there is no more, which is why the Depot rather than a
stash is what makes Cheese actually reliable.

Eel, Dustfish, Haggar, Tunnel Trout and Fish Roe carry the same gap — no
farming, no butchering, no caving loot, nothing past a one-time room-stash
seed or starting-kit grant — and are left unfixed here rather than priced onto
the Depot shelf. Boar Loin, Deer Liver and Crayfish had the same gap until the
gathering table gave them a repeatable source.

Three more ingredients have the same gap and are documented in `BREWING.md`
§4 rather than fixed here: `aberrant-heart`, `ravens-eye` and `trout-heart`
carry a `cooked:` block (so a cook *can* slot one) but nothing currently
drops any of them — that doc names the prospecting loot table as the
intended fix, not an import, so they are deliberately not on the Depot
shelf.

**The fragmentation grenade lands at 0.067% — about 1 in 1,500 draws.**
Getting there is what made the old mining drop die adopt caving's rarity
tiers: under the old uniform draw the floor was 1/poolsize and it would have
shipped eight times too common. (That die is gone now — `MINING.md` §3b — but
the tier vocabulary it borrowed is still `CAVING.md` §3's.)

## 12. A catalog bug fixed here

Found wiring this up, and load-bearing for it — a poison ingredient has to
actually poison somebody.

- **Phrygian Tears** promised `{tag:phrygian-toxin}` and had **no
  `consumesInto` at all**, so the most expensive poison a Brewer can make did
  nothing when drunk. Only Adder's Bite and the installed poison tooth ever
  granted the toxin.

The Cat and the Mindbreaker Toxin also moved to `catalog: gm`, on Bascinet's
call — they are hidden recipes the way Honey and White Honey are.
