# Mining: the Mine button

How a character turns a day into ⬢, and sometimes into stone. One button, one
coefficient per place — press **Mine** where there is a seam to work, spend the
whole turn, and get paid on the press.

**A pickaxe is the gate, and Prospecting is the boost.** Anybody holding a pick
can dig, and gets ⬢ and a draw on the loot table for it. The skill multiplies
the ⬢ by 1.7 and moves the draw to a richer column — it makes a day worth more,
it never makes one possible.

**In the Black Hills the same button says Gather.** Same gate, same rate, same
press — but nobody up there is breaking a seam, so the verb is worded for the
ground and the draw comes off a table of food rather than stone (§3c,
`db/lib/gathering.js`). Everywhere this doc says Mine, read Gather for the
hills unless it says otherwise.

Read this before touching `db/lib/mining.js`, `db/lib/miningYield.js`,
`db/lib/gathering.js`, `web/app/(app)/character/actions/mine.js`, the
prospecting or gathering half of `db/lib/cavingLoot.js`, the `mining:` values in
`docs/zones.yaml`, or any `miningBonus:` in `docs/tags.yaml`.

Related: [`CAVING.md`](CAVING.md) (the Caving Die, whose table machinery the
loot roll reuses), [`TRINKETS.md`](TRINKETS.md) and [`SMITHING.md`](SMITHING.md)
(what the stones are FOR), [`SOILERY.md`](SOILERY.md) and
[`FACTORY.md`](FACTORY.md) (the other two day-spending buttons),
[`TURN-ENGINE.md`](TURN-ENGINE.md) (the drift pass's slot), [`MAP.md`](MAP.md)
(where the coefficients are authored and edited), and
[`ECONOMY.md`](ECONOMY.md) (the `MINING` faucet).

## 0. What this replaced

There was a system called **Laboring** here, and it was the largest in the
game. It is worth knowing what went, because a lot of the repo's history only
makes sense against it:

- Labor was a third `MoveKind` beside Routine and Gambit, picked from the Move
  modal. Filing nothing at all filed one for you — an auto-labor pass ran at
  the head of every turn close and worked the whole idle roster.
- It had an eight-rung tag ladder: two general tiers that paid anywhere, four
  side-grades (Hunting, Farming, Fishing, Prospecting) scaled by a per-kind
  coefficient on each Location, and two masteries.
- Every Location carried up to four `LocationYield` rows, one per kind.
- Two systems that are not Laboring were built on top of it because it was
  there: the Godard Factory's refining shift, and Soilery's Farm button.

All of it is gone. **A day's work is a button now**, pressed where the work
actually is, and mining is the only one of the four kinds left. Filing nothing
files nothing — the day simply passes.

**A day's pay has weight.** ⬢ is a one-pound item (`TAGS.md`, `CARRY.md`), so a
payout is a stack landing in somebody's hands like any other. Mining is an
*involuntary* gain, so it is never refused for want of room — it lands, and the
carry pass sets down whatever will not fit at the turn close.

## 1. The skill

One tag, `prospecting`, name **Prospecting**, 7 points. No `parentTag`, no
`requiredTag`, nothing above it and nothing below it. You either know rock from
ore or you do not.

**It is a multiplier, not a gate** (changed 2026-09-18), and since 2026-09-20 it
is a multiplier on *both* halves of the yield rather than a gate on either. It
used to refuse the button outright — "You wouldn't know rock from ore" — on the
reasoning that an unskilled day paying nothing was a trap. What that actually
did was hide a whole verb from most of the roster and make the Caves somewhere
only one build had any business going. Anybody can shift rock; you do not need
to be told which way up a pick goes. **The gate is the Pickaxe now** (§1a).

So it buys two things, and nothing else:

| | ⬢ | Loot column |
|---|---|---|
| With Prospecting | base **× 1.7** | the skilled one |
| Without | base | the plain one |

There is **one** base range, `6–12`, and everybody who can swing a pick gets it.
The skill's 1.7 multiplies into the same number the two dials do, so it is worth
the same *proportion* everywhere: a rich seam beats a poor one for both diggers,
and the skilled digger beats the unskilled one in both places. That ordering is
the whole reason it is a multiplier and not a second flat range — a flat
unskilled band would have let an unskilled day in a good seam out-earn a skilled
one in a bad seam, which is the wrong way round.

The loot roll is **no longer skipped** without the skill. An unskilled digger
draws on the plain column and a prospector draws on a column about 20% richer
(§3b) — so a slave with a borrowed pick still turns up stones, just poorer ones.
`db/lib/moveEffects.js` reads the skill only to pick the column.

`soilery` is its sibling in the same tag group (`skills-work`) and gates the
Farm button. Neither gates the other.

## 1a. The Pickaxe is the gate

`pickaxe`, name **Pickaxe**, 2 points. **You cannot press Mine without one** —
`computeMiningAccess` refuses, the button greys, and the server action throws the
same string. It was "Prospector's Pick" until 2026-09-20; a tool named after the
skill read like it belonged to the skill, and it belongs to anybody.

**Held, not equipped.** `ctx.tagSlugs` is the whole check. The pick's own
`miningBonus` still wants to be worn for its +1 (§4), so carrying one in the pack
lets you dig at base — which is the right answer for a borrowed pick and needs no
extra plumbing.

Made on a Hatchet's terms (`smithing`, 3 ⬢, a quarter turn), because it is the
same piece of forge work. The Depot stocks it at 13 ¢. The Prospector and the
Slave start with one, and there are three in the Exactor's Office
(`undertown-9-3`) — the Slaves' tools being in his safe rather than their hands
is his whole grip on them.

## 2. What a place is worth

One `LocationMining` row per minable Location, and **the row is the gate**:

- **No row** — you cannot dig here at all. The Mine button does not appear, and
  Examine leaves the line off entirely rather than printing a permanent `×`.
  This is a permanent fact about the place, not something worth checking back
  on.
- **A row drifted to 0** — the button still appears and Examine still prints a
  word. That *is* worth checking back on.

**The button shows everywhere, and the row is what greys it** (§3a). It used
to be shut outside the `caves` zone — "You need to be in the caves." — which
kept the Depths and the Black Hills out of a system whose coefficients they
both carry. That check is gone: `resolveMiningRateFrom` reads whatever
`LocationMining` row a character stands on, and a place with none says
"There's nothing to mine here." (or "…to gather here.", §3c).

`base` is authored in `docs/zones.yaml` as a bare `mining:` value and is what
`current` reverts toward. `current` is the live coefficient, re-drifted at
every turn close, and it is the only number a payout reads.

| Where | `base` |
|---|---|
| The Black Hills | 0.2–0.3 |
| The Caves | 0.9 |
| The Depths | 1.1 |
| `depths-7` | 1.4 |
| Everywhere else | no row |

The Black Hills are surface rock: worth working if you are already up there,
never worth the walk on its own. Underground is where mining actually pays.
`depths-7` is the exception the map earned — it is the one place with an
authored ore vein (`depths-7-3`), and flattening it to the Depths' baseline
would have deleted the only "dig HERE" anybody wrote down.

Geography is authored live at `/gm/dev/zones` now, not by re-syncing YAML
(`MAP.md`). A superadmin edits one Location's `base` there; `db:import-zones`
creates a row only for a Location that does not have one, and never updates.

## 3. Resolving one day

`db/lib/mining.js#resolveMiningRateFrom` is the whole of it, in order:

1. **Exhausted** refuses. Tired does not — see §5.
2. **Incapacitated** refuses (`INCAPACITATING_SLUGS`): bound, bleeding out, on
   the floor, out cold.
3. **No pickaxe** refuses — "You need a pickaxe to break rock." (§1a).
4. **No row, or a row at 0** — "There's nothing to mine here." This is the only
   place-shaped refusal there is, and it is what greys the button in Town.
5. **The base range**, `6–12` for everybody, times
   `GameConfig.productionCoefficient` (the global dial, 0.9 out of the box)
   times the Location's `current` times **1.7 if they hold Prospecting**. All
   four are one multiplication, which is what keeps the skill worth the same
   proportion everywhere. The result carries `prospecting: true|false` back to
   the caller, which is what picks the loot column; nothing downstream should
   re-derive it from the tag.
6. **Tools** are added flat, after the scaling, so a tool is worth the same
   everywhere (§4).
7. **Soft Hands** halves what is left, rounded down.
8. **Lifeweb failure** keeps a twentieth of that (`LIFEWEB_SPUTTER_THRESHOLD`).

The result is a machine `"min-max"` string on `Action.resourceRollExpression`,
parsed back by `db/lib/resourceDelta.js#rollResourceRange`. **Never append
anything to it** — "(+3 Pick)" fails that regex and pays nothing. Say the bonus
in the note instead.

**Lazy takes its quarter after the roll**, not off the range, and the stored
expression is cut the same way so the sheet prints the range the payout is
actually inside.

The payout lands **at the press**, not at the turn close: the ⬢, the loot roll
and the fatigue step all apply inside the filing transaction, and
`appliedEffects` is stamped so the staged push skips the row. That is what
Labor did, and for the same reason — a roll against a range is not a judgement
anybody makes, so there is nothing to wait for.

### 3a. The button is always there

`web/app/(app)/character/page.js` shows Mine to everyone, everywhere, and lets
the greys do the talking. There is **no zone check**, which is a change worth
knowing about: the page used to test `zone.slug === "caves"`, which shut the
Depths and the Black Hills out of a system whose coefficients they both carry.
The `LocationMining` row is the gate and always was (§2); the page just has to
let it be.

## 3b. The prospecting loot table

On top of the ⬢, **every** Mine press draws once on a weighted table. **It is
the Caving Die's machinery, reused** — same file
(`db/lib/cavingLoot.js`), same six tier names, same two-stage draw: land on a
tier by the standing zone's column, then pick uniformly inside it.

This replaced a whole subsystem on 2026-09-18. There used to be a
`MiningDropOption` table synced from `docs/miningdrops.yaml`, with its own
rarity module, its own EV module, its own audit script and its own pre-save
hook — about fifteen hundred lines to say what forty lines beside the Caving
Die now say. The YAML bought GM-editability without a deploy, and that was
never worth what it cost. Do not bring it back.

### The columns

Two per zone, because Prospecting boosts the draw rather than unlocking it. The
plain column is what a pickaxe alone gets you; the skilled one is what the tag
buys, roughly 20% richer.

| Tier | Caves | Caves +P | Depths | Depths +P |
|---|---|---|---|---|
| Ultracommon | 62% | 54.4% | 18% | 5% |
| Common | 26% | 31.2% | 24% | 25% |
| Uncommon | 9% | 10.8% | 28% | 32% |
| Rare | 2.8% | 3.36% | 22% | 27% |
| Extremely rare | 0.15% | 0.18% | 6% | 8% |
| Nearly impossible | 0.05% | 0.06% | 2% | 3% |

The Caves' skilled column is computed: every tier above Ultracommon times 1.2,
with the remainder taken off the top row. The Depths' is **hand-set**, because
the same arithmetic there lands Ultracommon at 1.6% — correct, and it reads as a
bug rather than a boost, since 82% of that column is already above Ultracommon.
5% is the smallest number that still looks deliberate.

**The Black Hills are not on this table.** They draw on the gathering table
instead (§3c). A zone on neither table — Town, the Forest — has no column at
all, and that absence IS the rule: `drawProspectingLoot` returns null for it
rather than throwing, which is the one way it differs from `drawLoot`. Working
somewhere with nothing in the ground is an ordinary outcome, not a
misconfiguration, and the skill does not buy a column where there is none.

### The contents

| Tier | What is in it |
|---|---|
| Ultracommon | Hematite, Malachite, Garnierite — the three ores |
| Common | Citrine, Milk Quartz, Onyx, Moonstone, Pyrite, White Jade |
| Uncommon | Silver, Fire Opal, Sphalerite, Tetrahedrite, Old Coin |
| Rare | Opal, Topaz, Amethyst, Kunzite, Purse, Supply Kit |
| Extremely rare | Platinum, Lockbox, Mining Helmet, Jewelry |
| Nearly impossible | Star Sapphire, Black Diamond, **Arkenstone** |

Almost all of it is one kind of thing: an ingredient a smith slots into a
Trinket for its `inlayValue` (`TRINKETS.md`). That is the point of the rework —
a prospector's good days are worth much more through a smith than over the
Depot counter, so the two roles have to find each other. The five entries that
are not ingredients (Purse, Supply Kit, Lockbox, Mining Helmet, Jewelry) sit at
the rare and extremely-rare rungs so the table has something in it besides
inlay values.

The three ores are deliberately near-worthless raw — 1 ¢ — and worth having
only once smelted into Iron, Copper or Nickel at a forge (`SMITHING.md`). A
metal also Consumes straight into ⬢, free and instant, so a prospector with no
buyer to hand still eats.

### Lucky does not touch this

The old mining drop die was a 1d6 and **Lucky bent it** (`rollWithAdvantage`).
The prospecting table has no die to bend: every press by a holder of
Prospecting draws, and the draw is a weighted pick, not a roll to beat. So
Lucky is worth nothing to a prospector now, where it used to be worth a little.

That is a real change and it was not asked for — it fell out of dropping the
d6. If Lucky should matter here, the honest way is to give it a second draw and
keep the better tier, not to re-introduce a face nobody reads. Left alone for
now rather than invented.

The Caving Die still honours Lucky, and there it decides **whether** you find
rather than **what**: `cavingPass` rolls 1d6 with advantage and only a 6 draws
(`CAVING.md` §2).

### Validation

`validateCavingLoot(prisma)` checks **all three** tables' slugs against the live
Tag catalog and every weight map's columns for summing to 1, once at process
startup (`bot/src/index.js`, the web's instrumentation hook), never per roll. A
typo fails the boot rather than a player's press. That is the whole reason this
is code and not YAML, and it is why deleting a tag the table names is caught
loudly instead of quietly.

## 3c. Gathering, in the Black Hills

The Black Hills carry `mining:` coefficients (0.2–0.3, §2) and always did, so
a day up there paid ⬢ and turned up nothing. From 2026-09-22 it turns up
**food**. Nothing about the press changed except the words and the table:

| | Underground | The Black Hills |
|---|---|---|
| The button | **Mine** | **Gather** |
| The gate | a pickaxe | a pickaxe |
| The ⬢ | `6–12` × the dials × the place, ×1.7 with Prospecting | the same |
| The draw | the prospecting table, plain or skilled column | the gathering table, one column |
| Examine's line | `**Mining**: Scarce` | `**Gathering**: Scarce` |
| The Action row | "Working a seam." | "Gathering in the hills." |

**The verb is decided in one place**, `db/lib/gathering.js`, by zone slug:
`GATHERING_ZONE_SLUGS` is `["hills"]`, and a zone not on it mines, so a new
zone with a `mining:` value is a seam until somebody says otherwise. The module
has zero requires, because the sheet's action registry is a client component
and reads it for the label. `resolveMiningRateFrom` returns `verb` and
`gathering` off it; the sheet page (`workVerb`), the confirm dialog, the help
sentence, the refusals ("You need a pickaxe to dig anything up out here."), the
paid line, the audit narrative (`details.verb`) and Examine all read the same
entry rather than testing the zone themselves.

**Prospecting changes nothing about the draw up there.** The skill reads ore,
and there is no ore in the hills. It still multiplies the ⬢ by 1.7, because
that half of the skill is knowing how to work a day, not what to look for.

**The pickaxe is still the gate.** That is a flavour mismatch — you do not
snare a hare with a pick — kept on purpose so this change alters no economy:
who may press the button, and what a press pays in ⬢, are exactly what they
were. If the hills should feed people who own no pick, that is a separate
decision about the ⬢ side too, and the gate to loosen is `computeMiningAccess`.

### The gathering table

`GATHERING_TABLE` in `db/lib/cavingLoot.js`. Every entry is food, and most come
as a small **stack** — one onion is not a day's work. An entry is
`{ slug, quantity }`; the two stone tables stay bare slugs, and `drawFrom` reads
either. The `miningDrop` effect grants the stack and writes `quantity` into its
snapshot, so Undo takes back exactly what was granted; a snapshot with no
`quantity` predates the table and was always one stone.

| Tier | Weight | What is in it |
|---|---|---|
| Ultracommon | 50% | Cave Fungus ×2, Onion ×2, Carrot ×2 |
| Common | 30% | Crayfish ×2, Meat, Skinned Cave Rat |
| Uncommon | 14% | Deep Morel, Honey, Meat ×2 |
| Rare | 4.5% | Boar Loin, Deer Liver |
| Extremely rare | 1% | Boar Loin ×2, Deer Liver ×2 |
| Nearly impossible | 0.5% | Arelitz Egg |

Boar Loin and Deer Liver had **no source at all** before this: `COOKING.md` §11
listed them under Hunting, and the Hunting tier went with Laboring (§0). The
rare rungs are where they live now. The egg at the bottom is a wild clutch —
carried to a stable it hatches on the stable's own clock (`ARELITZ.md` §4).

**What it is worth, honestly: a supplement, not a diet.** Hunger burns 35 a
turn (`db/lib/hunger.js`), and an average press brings home somewhere around
10–15 hunger once cooked — a third of a person-day, plus the ⬢. Three people
gathering feed about one. It is the hills having a larder at all, so that a
town with no Merchant's Licence and a worn-out field is not living on Ration
Boxes alone; it is not a replacement for the Soilery.

## 4. Tools

A tag with a `miningBonus:` block adds a flat number of ⬢ while it is held (or
worn — `equipped` defaults true). Two carry one:

| Tag | Bonus |
|---|---|
| Pickaxe | +1 |
| Mining Helmet | +1 |

The Pickaxe is the odd one, because it is also the **gate** (§1a): you cannot
mine without one at all, and its +1 is what wearing it rather than stowing it
buys on top.

There was a `kind:` key naming which of the four Laboring types a bonus paid
into, and a typo in it silently made a tool worthless. A bonus is just a bonus
now.

**Structures pay everyone standing at their Location**, as synthetic tools, and
they do **not** stack: the best one only, so a location-wide bonus cannot
multiply by occupancy. Ties keep the older structure. A structure must be
`COMPLETE` — the same reading `equipmentReach.js` takes, which is what gives
Damage teeth.

**Nothing uses that today.** The Claim Stake was the only structure carrying a
`placement.miningBonus`, and it was deleted on 2026-09-20 — a 6 ⬢ Builder-Skilled
build for a permanent +1 at one Location was strictly better than carrying the
tool that does the same thing, and it made the good seams campable in exactly the
way the drift pass (§6) exists to prevent. So `structureTools()` returns `[]` for
every Location in the game. The machinery is left standing on purpose: it is a
general rule with no example right now, and adding a structure back is one YAML
block with no code change.

**Weapon bonuses do not stack either** — only the best-paying weapon counts.
Nothing mining carries one today, but the rule is cheap and a pick is one edit
away from being a weapon.

## 5. Fatigue

A day's mining steps the **Tired → Exhausted** ladder
(`db/lib/fatigue.js#nextFatigueSlug`). Tired blocks nothing by itself; a second
day running escalates it to Exhausted, which refuses the next day until it
decays. Left alone, Exhausted degrades to Tired and Tired clears, so the
practical shape is that somebody mining flat out works every other turn.

A shift at the Factory and a day of Farm step the same ladder (`FACTORY.md` §4,
`SOILERY.md` §5a), so mining, refining and farming tire each other: a day of one
leaves you Tired for the others.

That module is **not** a mining file, despite living beside one for a long
time. A day on the Factory floor climbs the same ladder the same way
(`FACTORY.md` §4). Two of its other callers have nothing to do with a day's
work: the dawn affliction pass escalates it for a bad night's sleep, and
travel push-on escalates it for the Exert die (`MAP.md` §3). Keep it neutral.

## 6. Drift — what the land does on its own

`db/lib/miningYield.js`, `TURN_PASSES` slot `"miningYield"`, late in the close.
Mean-reverting random walk with occasional jump events:

```
target  = in an event ? eventTarget : base
current = clamp(current + reversion * (target - current) + noise, 0, 2)
```

An event moves the **target**, not `current`, so a swing arrives over turns and
decays on its own once the window closes — there is no separate recovery path.

The slot is late on purpose: what this writes is what the **next** turn's
mining is worth, so a day already paid keeps the coefficient it was priced at.
This mattered more when the auto-labor pass ran at the head of the same close;
it is still the right ordering.

There were four sets of these parameters, one per Laboring kind, and farming's
rolled a single world-wide event so a blight hit every field at once. A seam
runs out one seam at a time, so the global-event path went with the rest.

## 7. The Examine button

Fourth button on every Location anchor
(`db/lib/locationAnchorRow.js`, handler `handleExamine`). **Information only**:
it files nothing, costs nothing, and anyone standing there may press it whether
or not they hold Prospecting. Scouting is the point.

It is the **only** surface that shows what the ground is worth — not `#summary`,
not the anchor, not the Mine button's own tooltip. And it shows a **word, never
a number**. Working out that Bountiful beats Ample is the player's job, and the
numbers move anyway.

| `current` | word |
|---|---|
| no row | the line is left off entirely |
| 0 | `×` |
| < 0.30 | Barren |
| < 0.60 | Scarce |
| < 0.90 | Modest |
| < 1.20 | Sufficient |
| < 1.55 | Ample |
| ≥ 1.55 | Bountiful |

At base, only `depths-7` wears Ample; nothing wears Bountiful.

## 8. File map

| File | What it owns |
|---|---|
| `db/lib/mining.js` | The two rates, the location cut, the tools, and which verb the place wears |
| `db/lib/gathering.js` | `GATHERING_ZONE_SLUGS` and the words each verb carries — label, help, confirm, refusals, the paid line |
| `db/lib/cavingLoot.js` | `PROSPECTING_TABLE` and `GATHERING_TABLE`, their zone weights, `drawProspectingLoot` |
| `db/lib/moveEffects.js` | The `miningDrop` effect: the draw, the grant (a stack, for a gathered find), the undo |
| `db/lib/miningYield.js` | Drift math, the turn pass, the quality words |
| `web/app/(app)/character/actions/mine.js` | The button: files the Move and pays it |
| `db/lib/fatigue.js` | The Tired → Exhausted ladder (shared, not ours) |
| `db/lib/syncZones/parse.js` | `collectMining` |
| `db/lib/tagShapes.js` | `normalizeMiningBonus` / `validateMiningBonus` |
| `db/lib/examineLocation.js` | The Examine readout |
| `docs/zones.yaml` | Every `mining:` value |
| `docs/tags.yaml` | Prospecting, Soilery, the Pickaxe, and every `miningBonus:` |
