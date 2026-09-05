# Brewing

Every recipe a brewer can make, with its real cost. Price a new brew off these
tables, not by feel. If you change a number here, also change the tag's
`requirement` block in `docs/tags.yaml` and the row in the **Alcohol & Drugs**
document in `docs/documents.yaml`.

**Brewing has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); brewing prices each recipe on its own, because the real cost
is usually the ingredient rather than the ⬢. So the tables below are the
ladder — there is nothing above them to derive a price from.

**This paragraph used to say no code enforced any of it, and then that only
the ingredient was on the honour system. Neither is true any more.** The Craft
flow charges the ⬢, spends the Move, checks the skills — and **every
ingredient in the tables below is a real tag that the craft SPENDS**
(`Tag.requirementItems`, `CORPSES.md` §8). Three units of a brew take three
units of its ingredient, the same way they take three lots of ⬢. There is no
prose ingredient left in brewing: the ones nothing could ever track were either
turned into real tags (`nightshade-herb`, `aberrant-heart`, `ravens-eye`) or
dropped, with the ⬢ raised to be the gate instead.

**Two exceptions, both kept rather than spent.** `miasma` matches any corpse
and `bone-mask` cuts one, and both only need the body *to hand* — you bottle
the smell, you don't use the body up. That is what a `group:` ingredient means
and the only thing it can mean: a group names no single stack to take a unit
out of. Everything else spends.

**Ingredients go in when the work STARTS**, the rule the ⬢ already lived
under — so a multi-turn project pays up front, abandoning it keeps nothing, and
a GM Undo of the finished thing hands the ingredients back with the ⬢.

Moonshine is the only recipe in the game that costs **0 ⬢** and still has a
real ingredient, and that is deliberate rather than an oversight: the marsh
hands you the Godflesh, the throttle is the Routine, and at 3 ⬢ a bottle it
undercuts a farming day badly enough to be nobody's living. What it costs is
the drinker's eyes, a notch at a time (`FACTORY.md` §8) — and, since the pass
that made ingredients real, one whole Godflesh a bottle, which is what stops
it undercutting the Factory's refining.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `brewing-basic` | Brewing (Basic) | 2 | none |
| `brewing-skilled` | Brewing (Skilled) | 2 | `parentTag: brewing-basic` (cumulative, total 4) |

## 2. Brewing (Basic)

Every ingredient below is **spent** unless the row says *kept*. The Turns
column is the recipe's own `turnsCost`, written out in the YAML now — three of
these were missing it, which read as `null` and fell back to a whole Move.

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `bliss` | 0 | 0 (2/turn) | `cave-fungus` | `euphoric`, `high` (3t) |
| `feces` | 0 | 0 (2/turn) | — | — |
| `alcohol` | 2 | 1 (3/turn) | — | `tipsy` |
| `moonshine` | **0** | 1 | `godflesh` | `tipsy`, `blind-drunk` (2t), `damaged-vision` |
| `miasma` | 2 | 1 | **a corpse** — *kept* | — |
| `poppy` | 2 | 1 (2/turn) | — | `opium-high` |
| `molotov-cocktail` | 2 | 0 (2/turn) | `alcohol` | — |
| `cleaning-powder` | 2 | 1 (2/turn) | — | — |
| `cat` | 3 | 1 | `alcohol` | `night-vision` (1t) |
| `nightshade` | 3 | 1 | `nightshade-herb` | — |

## 3. Brewing (Skilled)

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `pure-luck` | 0 | 1 | `aberrant-heart` | `aberrant-luck` |
| `graga-sweat` | 2 | 1 | `graga-sac` | `brutish-strength` |
| `deadeye-drops` | 2 | 1 | `cave-fungus` | `increased-accuracy` |
| `mercy` | 2 | 1 (2/turn) | `cave-fungus` | `increased-recovery` |
| `mindbreaker-toxin` | 2 | 1 | `cave-fungus` | `hallucinating` |
| `invisibility-potion` | 2 | 1 | `graga-sac` | `invisible` |
| `raven-draught` | 2 | 1 | `ravens-eye` | — |
| `ravenheart-red` | 4 | 1 | — | `tipsy` |
| `distilled-coca` | 4 | 1 | — | `stimulant-high` |
| `advanced-poppy` | 4 | 1 | `poppy` | `pain-immunity` |
| `phrygian-tears` | 4 | 2 | — | — |
| `white-honey` | **6** | 1 | — | — |
| `gunpowder-grenade` | 6 | 1 | `saltpeter` | — |
| `purifier` | 6 | 1 | `cave-fungus` | — |
| `dreamers-draught` | 6 | 1 | `skinless-brain` | — |
| `succubus-draught` | **8** | 1 | — | `mindreading` |
| `forgiveness` | 8 | 1 | — | — |
| `flawless-skin` | 8 | 1 | — | `otherworldly-beauty` |

Four recipes lost a prose ingredient and pay in ⬢ instead, because the
ingredient was the whole gate: `white-honey` 2 → **6** (it cures any poisoning),
`succubus-draught` 2 → **8** (it grants mindreading), and `forgiveness` /
`flawless-skin` keep their 8, which was already doing the work.

An empty **Consumes into** cell is not an oversight. `consumable` with no
`consumesInto` is set where the brew is spent *by a Move* rather than by the
drinker — a poison you administer, a flask you throw, a powder worked into
someone else's wound — so the GM applies the result to whoever it happened to.

## 4. Ingredients

**Every ingredient is a real tag now.** There is no honour-system column left:
either the brewer's sheet carries the thing, or the craft is refused.

| Tag | Where it comes from | How the recipe uses it |
|---|---|---|
| `cave-fungus` | foraged in the caves. 0 ⬢. Eaten raw it gives `high` (2t). | spent |
| `alcohol` | brewed, one tier down | spent |
| `poppy` | brewed, one tier down | spent |
| `saltpeter` | mined in the caverns | spent |
| `graga-sac` | **butchered** out of a {Graga Corpse} | spent |
| `skinless-brain` | **butchered** out of a {Skinless Corpse} | spent |
| `godflesh` | hauled out of the marshes (`FACTORY.md`) | spent |
| `nightshade-herb` | forageable — the loot pass wires it | spent |
| `aberrant-heart` | off a fallen Aberrant | spent |
| `ravens-eye` | forageable — the loot pass wires it | spent |
| `tea` / `sweets` / `honey` | Depot imports; the cook picks one | spent (`anyOf`) |
| **a corpse** (`items-corpse` group) | died, or was killed | **kept** |

The last three tags in that table are new, and **nothing drops them yet**. The
laboring loot-table pass wires acquisition; this pass only had to make the
slugs exist. Until then they arrive by GM grant.

`skinless-brain` is the one ingredient that is also a moral problem. A Graga is
a beast; the Skinless used to be people and, per the Caves brief, can be talked
down. Making an expensive Skilled brew means someone decided not to — and the
brain is spent now, so it is a decision taken once per bottle rather than once
ever. That is the recipe, not an oversight, but it is worth a GM knowing it is
there before a player finds it.

**`nekker-pheromones` is no longer brewed at all.** It is butchered out of a
Nekker Corpse; it lost its `craftable` flag and its row in §2.

**What used to be prose, and where it went.** A forest herb, an Aberrant's
heart and a raven's eye became `nightshade-herb`, `aberrant-heart` and
`ravens-eye`. A rainbow trout's heart, a willing lover's blood, someone's tears
and a lock of Nobility hair are simply gone, with the ⬢ carrying the gate
instead (§3). The old argument for keeping them — that getting one should be a
scene rather than a purchase — held for the social ones and never held for the
huntable ones, where there was no player on the other side, just a GM ruling on
whether somebody's fishing trip counted.

## 5. Yields

A few brews come out in a batch, and **the ration is enforced now** rather than
being a sentence in the player's paper: `requirement.perTurn` is the number,
and a craft past it is refused. The number is still written into the **Alcohol
& Drugs** document's Turns column, phrased the same way every time — "yields up
to N per turn".

| Brew | Per turn | Turns |
|---|---|---|
| `alcohol` | 3 | 1 |
| `bliss` | 2 | 0 |
| `feces` | 2 | 0 |
| `molotov-cocktail` | 2 | 0 |
| `poppy` | 2 | 1 |
| `cleaning-powder` | 2 | 1 |
| `mercy` | 2 | 1 |
| `ravenheart-red` | 2 | 1 |
| `lavish-meal` | 3 | 1 |
| `fine-meal` | 4 | 1 |
| `bone-mask` | 1 | 0 |

**Every row is enforced now.** A 0-turn recipe's `perTurn` is its free
allowance, with units past it spilling into the Move; a 1-turn recipe's
`perTurn` is its batch size, and a batch spends `quantity/perTurn` of the
Move — three Alcohol is one Routine, one Alcohol leaves two thirds of it for
other brewing work (`CRAFTING.md` §2a).

`bone-mask` is not a brew, but it is the other recipe the ration exists for: 0
turns and a `butcher` gate put it outside the Dead Simple pool as well as
outside the Move, so one corpse would have minted masks forever.

**The ⬢ cost is per unit, and it multiplies.** Three alcohols in one turn cost
6 ⬢, not 2. Every yield row in the document carries an `{info:…}` tooltip
saying so, since the table itself has no room to.

Brewing files its Routine through the Craft button, same as any other
craftable tag — `phrygian-tears` and `dreamers-draught` no longer carry
`gambit: true`, since crafting is never a Gambit (`CRAFTING.md`).

## 6. Where a player reads this

The **Alcohol & Drugs** document (`docs/documents.yaml`, key `alcoholdrugs`)
carries ⬢, turns, the batch yield and the ingredient, and nothing else. A
yield row also carries an `{info:…}` token — a `?` glyph whose payload is its
own tooltip sentence, rendered by `DocumentMarkdown.js`. What a brew *does*
lives in the tag's own description and shows on hover — `TagChip.js` renders
the description plus a **Recipe** line built by
`formatTagRequirement` (`db/lib/formatTagRequirement.js`) from the same
`requirement` block these tables come from. Don't restate an effect in the
document; it is already two places.
