# Cooking

The Fine and Lavish Meals, the ingredients that go in them, and what eating
one does. Read this before touching `Tag.cooked`, `Tag.cookedFrom`,
`requirement.ingredientSlots`, `web/lib/cooking.js`,
`db/lib/mood.js#dishMoodTerms`, or `IngredientSlots.js`.

Crafting in general is [`CRAFTING.md`](CRAFTING.md); this is the one recipe
family that does something crafting alone cannot.

## 1. What changed, and why

Cooking used to make two flat items. A Fine Meal was always +15 mood and a
Lavish always +30, the Lavish took exactly one delicacy out of a hardcoded
list of four (`items: [anyOf: [tea, sweets, honey, fish-roe]]`), and putting
your own name on a dish cost +1 ⬢. Nothing a cook chose changed what the food
**was** — the ingredient was a gate on the recipe, not a part of the meal.

Now the ingredient is the point:

- The meal's own mood is small (`mealMood`, **5** and **8**) and the
  ingredient carries the rest, from **+45** (saffron) down to **−55** (feces).
- Fine takes 0–1 ingredients, Lavish takes 1–2.
- An ingredient brings its side effects with it. A dish made from a person
  makes the eater nauseous or worse; one made with Squeeze is a seizure.
- Every dish has a **taste**, and eating one says so.
- Naming your work is free.

## 2. A dish is a minted row

Every meal with words or ingredients on it is a **minted `Tag`** — the fifth
runtime authoring door, the one `CRAFTING.md` §4a already described, now
carrying more than a name. `mintCustomCraft` clones the recipe row
(`custom: true`, `ephemeral: true`, `craftable: false`) and writes two things
on the clone:

| Column | What |
|---|---|
| `cookedFrom` | the ingredient slugs, **sorted** |
| `mealMood` | copied off the recipe |

A meal with **no words and no ingredients** does not mint. It has nothing to
carry, and an ephemeral clone of the base row would only make it
un-Depot-listable and Restart-Game-deletable for no gain. In practice a
Lavish Meal always mints, because it always has an ingredient.

**The ingredients are part of the mint's identity.** Reuse keys on name +
description + `cookedFrom`, so two cooks who both type "Steak Dinner" — one
over saffron, one over feces — get two rows. Nothing on any surface tells
them apart, which is the point. Miss this and one of them is serving the
other's dinner.

Sorted rather than in slot order because Postgres array equality is
order-sensitive: a key that did not match what was written would reuse
nothing and mint a row per craft. The cost is that the taste sentence reads
alphabetically.

Dishes are swept like disguises — `db/index.js`'s expiry pass deletes
`ephemeral` `custom-craft-` rows nobody holds, that no room holds, and that
no Offer or CraftProject pins.

## 3. `cooked:` — what a tag contributes as an ingredient

```yaml
  fish-roe:
    cooked:
      taste: "little crunchies"
      mood: 28
      into: [nauseous]        # OPTIONAL — read §4
```

**The presence of this block is the only thing that makes a tag cookable.**
There is no `ingredient: true`, and no recipe names a legal ingredient
anywhere. Adding a fourteenth thing you can cook with is one YAML entry and a
`db:sync-tags`.

- **`taste`** is a *fragment*, dropped into the middle of one sentence, so it
  is lowercase and under 40 characters. `taste: ""` is legal and means
  **undetectable** — Phrygian Tears and Adder's Bite, the two things a cook
  can hide in a meal with no tell at all. The key is still required, so an
  empty taste is a claim somebody made rather than a field somebody forgot.
- **`mood`** is signed, on the `MOOD.md` scale.
- **`into`** is what it grants the eater, in the same shapes `consumesInto`
  takes (`oneOf` included).

## 4. Raw is not cooked

**An ingredient with no `into` contributes its own `consumesInto`.** That is
not a fallback, it is the mechanism, and it makes the tag's two halves say two
different things:

| | Raw (`consumesInto`) | Cooked (`cooked.into`) |
|---|---|---|
| Onion | `[]` — nothing | absent → nothing |
| Deep Morel | `[nauseous]` | `[]` — cooking takes the nausea off |
| Moonshine | tipsy, blind-drunk, damaged-vision | absent → all three, still |
| Human Flesh | `[ate-meal]` | `[{oneOf: [nauseous, vomiting]}]` |
| Squeeze | `[seizure]` | absent → a seizure, still |

`into: []` and an absent `into` are **different claims**. The first says
"contributes nothing"; the second says "whatever I do raw". Nine of the
thirteen new ingredients do nothing raw and say so with `consumable: true`
and an empty `consumesInto` — you can put a raw onion in your mouth, and then
nothing happens, which is a real answer rather than a missing one.

**Cookable and edible are different claims.** The six body parts are not
consumable at all and carry `cooked` blocks: nobody gnaws a raw hand, and a
hand in a stew is very much a thing that can happen.

## 5. Deferred: medical consumables

**If you are here from the medical rework: you probably need to do nothing.**

White Honey, Mercy, Poppy, the Cat and the rest carry a `taste` and a `mood`
and **no `into`**, deliberately. They therefore contribute their own live
`consumesInto`, read at the moment somebody eats the dish rather than frozen
in when it was cooked. Whatever the medical PR makes a medicine do, it does
in a stew too — for every dish already sitting in every pocket, on the next
bite, with no re-mint, no backfill and no code here.

That is the whole reason effects are derived late (§6). If the medical rework
adds a *new* medical consumable, give it a `cooked:` block with a taste and a
mood and leave `into` alone.

## 6. Eating one

`consumeTagRequestImpl`, when the row has a `cookedFrom`:

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
3. `applyHiddenCures` for the meal **and each ingredient**, so a pie made with
   leeches still takes the bruise off.
4. Mood (§7).
5. Return `{ line }` — the taste sentence.

## 7. Mood

A dish takes its own path, because `consumeReliefFor` is a max over a table of
positives and can express neither a sum nor a negative.

`dishMoodTerms(mealMood, ingredientMoods)` **sums** — two delicacies in a
Lavish Meal are worth both, which is the only thing that makes a second slot
mean anything — and returns the halves as **two terms, never netted**:

```
MEAL     +53   (8 mealMood + 45 saffron)
DISGUST  −55   (feces)
```

Netting them first would charge a scaled −2 instead of an unscaled +53 and an
unscaled −55, because only harm is ever scaled.

**`DISGUST` carries `noMultiplier`**, the way `DRIFT` does. Three rules in
`MULTIPLIERS` apply to `kinds: "*"`, and while "Brave halves your disgust at
eating a liver" is arguable, "the Rite of Rage makes feces free" and "holding
the right sword makes you immune to disgust" are not. Revulsion at what you
just swallowed is not a fright.

`CONSUME_RELIEF`'s `fine-meal: 15` and `lavish-meal: 30` are **gone**. A
minted dish's slug is `custom-craft-…` and could never have matched a table
keyed by slug. `ate-meal: 5` stays and is now genuinely the floor.

**Eating is not rationed.** `MOVE_MOOD_TURN_CAP` counts only `move: true`
terms. The ingredients are the ration — you have to *find* three lots of
feces, and each costs a fraction of a cooking Routine.

## 8. The taste line

One sentence, in the bottom-right notice (`NoticeProvider`). Composed by
`tasteLine` in `web/lib/cooking.js`; empty tastes are dropped rather than
printed as a gap.

The **‡ sits on the sentence and nowhere else**. A taste is a fragment, and
marking each one would print "honey ‡ and onions ‡" —
`db/lib/tagShapes.js#normalizeCooked` refuses a ‡ in a `taste` to keep it that
way.

**Both eating paths raise it.** The one-click Consume on the tag rail is how
people actually eat; it used to throw the server's result away, which would
have meant the taste line only ever reaching the handful who go through the
Actions grid.

## 9. `ingredientSlots`

```yaml
    requirement:
      ingredientSlots: { min: 1, max: 2 }
```

A **sibling** of `requirement.items`, not a second `anyOf`. The legal set is
"any tag carrying a `cooked` block", which no authored list could keep up
with — so `validateRequirementItems`' one-picker cap stays exactly where it
is, still guarding the Death Mask and the Dreamer's Draught.

Refused on anything not craftable, on a `placement`, and on a **multi-turn
project**: the mint happens on the finishing turn, days after the cook picked,
and nothing carries the slugs that far. Put slots on a 2-turn recipe and they
would have to ride on `CraftProject.custom`.

The server re-checks membership, possession and the count in
`resolveIngredientSlots`. **The same slug twice is refused** — it keeps "it
tastes like onion and onion" off the notice, and it keeps the spend honest.

### The Honey discovery moved, and got better

`isNonPublicRecipe` asks "does this recipe *name* something the catalog
hides", which is what used to keep the honeyed Lavish Meal secret: the
Recipes tab narrowed the `anyOf` to "Tea, Sweets or Fish Roe" until a cook
held a jar.

A slots recipe names nothing, so **`isNonPublicRecipe` must ignore
`requirementIngredientSlots`** — reading them the way `items` is read would
mark both meals non-public and hide dinner from the whole game. The secret
now lives in the chip list instead: Honey appears as something you can slot
only if you are holding one. Same discovery, one less place to maintain it.

## 10. The dialog

Cooking is a **branch inside the Craft dialog**, not a screen of its own: a
cook spends the same Move, pays the same way and stacks the same batch, and
forking `CraftDialog.js` to change one control would double the maintenance.

`IngredientSlots.js` draws a `.slot-row` of `max` slots over a `.chip-row` of
everything on the sheet that can go in a pot. Click a chip, it fills the first
empty slot; click a slot's ✕, it comes back out. Not an extension of
`ChipPicker.js` — that is a single-value picker and this is an ordered
multi-slot where the positions mean different things.

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

| Source | What |
|---|---|
| Hunting | Boar Loin, Deer Liver, Goose Fat |
| Fishing | Crayfish everywhere; River Eel in the Forest, Lamprey in the Marshes, Blind Fish in the Caves |
| Farming | Onion (the commonest and cheapest of the thirteen, on purpose) |
| Caving | Rock Salt, `ultracommon` in `db/lib/cavingLoot.js` |
| Room stashes | 3 Deep Morels scattered across the Caves and Depths, 4 more in the Godshroom; 5 Hard Cheeses across the cellars |
| The Depot | Saffron (15 ⬢, three cigarettes), Tinned Butter (10 ⬢) |

Room stashes are a **seed, never a top-up** (`syncZones.js#seedRoomStash`):
once the five cheeses are eaten there are no more.

**The fragmentation grenade's fishing rate is not 0.1%.** The labor-drop draw
is uniform over a concatenated pool and the file has no weight field on
purpose, so the only lever is repeat count — 0.1% would need ~150 lines of
`blind-fish` living in `docs/labordrops.yaml` forever. What ships is about
**0.8%** per cave fishing labor. Closing the gap means either padding the pool
out or teaching `db/lib/laborDrops.js` a weight column.

## 12. Two catalog bugs fixed here

Both were found wiring this up, and both were load-bearing for it — a poison
ingredient has to actually poison somebody.

- **Nightshade** promised `{tag:choking}` in its description and had **no
  `consumesInto` at all**. Drinking one did nothing. Its description also
  carried an unclosed `{tag:choking` token, which printed literally.
- **Phrygian Tears** promised `{tag:phrygian-toxin}` and had the same gap, so
  the most expensive poison a Brewer can make did nothing when drunk. Only
  Adder's Bite and the installed poison tooth ever granted the toxin.

The Cat and the Mindbreaker Toxin also moved to `catalog: gm`, on Bascinet's
call — they are hidden recipes the way Honey and White Honey are.
