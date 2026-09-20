# The Godard Factory

Ravenheart's only real export, and the four verbs that make it: **Harvest
Godflesh**, **Refine**, **Package**, sell. Read this before touching `db/lib/godflesh.js`,
`db/lib/refinery.js`, `db/lib/babble.js`, `db/lib/visionDecayPass.js`, the
`refinery:` / `godflesh:` Location attributes, or the two `EXTRACT_GODFLESH` /
`PACKAGE_ITEMS` request types.

Related: [`MINING.md`](MINING.md) (the other button that spends a day),
`CARRY.md` (crates
and the wagon), `DEPOT.md` (what a cube is worth), `REQUESTS.md` §3 (the two
new types).

## 1. Why it exists

The town's work feeds Ravenheart and produces no surplus. Before this, nothing
in the game did. The Keep's warchest, the Merchant's business and every obol in
circulation now trace back to one wooden warehouse standing in a shallow lake
in the Black Hills, staffed by people nobody counts.

That is the design as much as the economics: the money comes from the one place
on the map with no political weight at all.

## 2. The chain

```
Refuse Pit  --Harvest Godflesh-->  Godflesh  --Refine-->  8 Squeeze
                                             --Package-->  a crate at half weight
                                             --cart-->  the Depot  -->  obols
```

Every step after the first is somebody's whole turn. **Harvest Godflesh is
not** — it costs no Move and runs on its own once-a-turn cooldown (§3), so
cutting and working your day are two separate things. A bare-handed cut averages
7/6 of a lump and a shift needs one, and the Pit and the Factory floor are both
in the Black Hills, so the walk between them is a free same-zone hop
(`MAP.md` §3). What paces a refugee is not the lump but the ladder: a shift
tires you the way a day's mining does (§4), so a refugee refines every other
turn. §6 has the numbers.

A cutting day is otherwise an empty day now. Nothing files itself at the close
any more (`TURN-ENGINE.md` §6), so a refugee who cuts and presses nothing else
has the Godflesh and nothing on top of it.

## 3. Harvest Godflesh

`db/lib/godflesh.js` — pure, Prisma-free, modelled on `db/lib/depotTurret.js`.
The server action is `extractGodfleshRequest` in
`web/app/(app)/character/requestActions.js`.

- **Where.** Any Location carrying the `godflesh: true` attribute. That is one
  Location now: the Refuse Pit, at the bottom of the Baron's lift. The five open
  Marshes and the marsh Village carried it until the Marshes zone was deleted
  (`docs/zones.yaml` says so beside the Pit). The attribute is the match, so no
  tile is named by slug anywhere in code (`db/lib/locationAttributes.js`).
- **What it costs.** Nothing. No Move, no Action row, and the move lock is not
  consulted — cut before the deadline or after it. It used to spend the turn's
  Routine through `fileAutoRoutine`, which is where "once per turn" came from
  for free; since 2026-09-11 it carries its own cooldown instead.
- **How often.** Once per **turn**. `Character.extractTurnKey` holds the claim,
  written by a conditional `updateMany` whose WHERE is the check, exactly the
  shape the Bird's `birdTurnId` has (`BIRD.md`). It keyed on the in-game *day*
  once — a day is two turns, so one cut covered both — and the column was
  `extractDayKey` to say so. The button greys with the refusal rather than
  hiding: where you are standing is worth hiding, having already cut is not.
- **What you need.** A `hatchet`, `battle-axe` or `chainsaw` **equipped**. A
  blade in a sack cuts nothing, the same rule armour follows at the turret.
- **The roll.** 1d6, DM'd whatever it says. Yield is 1, or **2** with a
  Chainsaw. A **6** adds one more on top of whatever you were getting.
- **The 1.** Rolls again on the injury table, and Armored Gloves decide which
  column — the whole distribution moves, not one step:

  | column | outcome |
  |---|---|
  | no gloves | Missing Fingers 0.45 · Mangled Hand 0.40 · Missing Arm 0.15 |
  | gloves | Minor Wound 0.75 · Deep Wound 0.25 |
  | gloves + body armour | Minor Wound 0.90 · Deep Wound 0.10 |

Both checks — the blade and the body armour — are lists of catalog slugs
matched against what is equipped, so a smith's SIGNED piece resolves back to
what it is a copy of before the match (`Tag.customOfSlug`, `CRAFTING.md` §4a).
A Battle Axe with somebody's name on it still cuts, and a named Breastplate
still moves you to the bottom row. Any new rule here that reads a held slug
needs the same resolution.

Gloves cost 3 ⬢ to craft and all three Factory roles start with a pair, so a
lost hand is nearly always somebody who took them off. That is the intended
reading, and it is why the DM says which column you were in.

It also refuses while Bound, Dying, Paralyzed or Catatonic — or mid
Seizure, which is the one it exists for. That gate matters more now, not less:
the day claim cares about the calendar and nothing else, and there is no Move
check left behind it, so without `blockerFor(..., ACT)` a man on the floor could
wade into the Pit with an axe.

The button **hides** away from the Pit rather than greying — the same posture
all four day-verbs take. That is not a breach of the metagaming rule in
`web/app/components/actionRegistry.js`: that rule forbids leaking who is
standing near you, and where *you* are standing is already yours. A
permanently dead Harvest Godflesh icon in the Fortress would just be furniture.

## 4. Refine — the day that pays in goods

`db/lib/refinery.js`, entered from the **Refine** button
(`web/app/(app)/character/actions/refine.js`).

This was a Labor filed while standing on the floor until Laboring was removed,
and `db/lib/refinery.js` was reachable only through the `LABOR` move kind.
The shift is its own verb now, modelled on Farm: it **spends the whole Move**,
commits at the press, and the cubes come off the line at the turn push
(`db/lib/moveEffects.js`'s `refined` entry).

- **Where.** `refinery: true`, a Location attribute rather than a slug
  (`db/lib/locationAttributes.js`). The button hides anywhere else, the same as
  the other three day-verbs.
- **The input** is one Godflesh, in the worker's hands **or** in any Room stash
  at the Location they can get into. `hasEquipmentInReach`'s predicate, so the
  Logistics Room serves the whole floor and nobody hauls a 28 lb lump around
  all day to prove they own it.
- **The output** is 8 Squeeze, and the Godflesh is consumed.
- **No skill needed.** The floor wanted one until 2026-09-10, on the grounds
  that it is work rather than a vending machine. The trouble was that the
  Laboring ladder priced ⬢ and a shift here pays none, so the gate bought
  nothing and stood the Factory's own people off its floor. Anybody who can get
  in can work it, and Prospecting has nothing to say about a refinery.
- **It tires you.** A shift steps the Tired and Exhausted ladder the way a day's
  mining does (`db/lib/fatigue.js`): Tired blocks nothing, a second shift in a
  row makes you Exhausted, and Exhausted refuses the next shift until it lapses.
  Somebody refining flat out works every other turn. The step lands at the turn
  push with the cubes: the `exhausted` entry in `db/lib/moveEffects.js` reads
  the Refine button's marker as well as the Mine button's. Refine did this while
  it was a Labor, lost it in the 2026-09-18 Labor strip without anyone deciding
  it should, and has it again since 2026-09-20. The button greys, and the action
  refuses, with the same sentence Mine gives (`refineFatigueRefusal`).
- **Five at a time.** At most 5 people may refine in one turn
  (`REFINERY_MAX_WORKERS` in `db/lib/refinery.js`). The sixth is told "Too many
  people are producing Squeeze at the factory this turn." and keeps their Move,
  and the button greys with the same sentence. The count is the shifts already
  filed this turn, checked once for a fast refusal and again under an advisory
  lock taken per turn, so two people pressing at once cannot both take the
  fifth seat. It is a constant, not a `/gm/dev` knob.
- **No `miningBonus` applies.** A refinery is not a coefficient, and a pick is
  not a tool for it.
- **No loot roll.** Refining pays in Squeeze, not in stone (`MINING.md` §3b).

**Losing the race is not silent.** Three refugees and one lump in the Logistics
Room is the NORMAL case whenever the stash runs thin. The button checks the
floor before it spends anybody's day, but `applyRefinery` re-checks under the
transaction at the push, so the two who lost the race get "nothing to refine —
no Godflesh here" and a `-#` line telling them why, rather than silence.

**Why it lives in `MOVE_EFFECTS` and not in the button.** `read` can only see
the `Action` row, and whether a shift was a *refining* one depends on where the
character stood. So `refined.apply` decides, and returns 0 at every other
Location. That is what lets it work from a bare row, which the turn-close path
(`db/lib/stagedPush.js`, nothing in memory) needs. Returning `null` there would
have been a real bug: `applyMoveEffects` falls back to the `read` value when
`apply` reports nothing, so every ordinary Move in the game would have been
stamped `refined: 1`.

**Where you stood, not where you are.** It reads `Action.locationId`, stamped at
filing time, and only falls back to the live location for rows filed before that
column existed. `Action.zoneId` was not enough: a free zone move costs no Action
(`CARRY.md` §2a) and the cubes land at the turn close, so a character could file
on the Factory floor and walk out — or file at the Pit and walk in — and
collect the wrong thing either way.

## 5. Package

`packageItemsRequest`, gated on Packaging Equipment in reach. There are two in
the world — the Logistics Room floor and the Merchant's Cargo Bay — and it is
not craftable.

Up to **150 lb** of held goods, plus a line the packer types, become one runtime
`Tag`: `custom: true` and a `custom-` slug, exactly the shape
`db/lib/depotCrates.js` mints, so `db:prune-tags` skips it and no
`docs/tags.yaml` sync can upsert over it.

**The crate weighs half what went in**, rounded up, floor of 1. Depot shipments
now use the same arithmetic — `CRATE_WEIGHT_LBS = 15` is gone, and a crate of
obols no longer outweighs the obols. `PACKAGE_MAX_LBS` is shared with them too:
a Depot shipment packs itself to the same 150 lb ceiling this button enforces
(`DEPOT.md` §0e), so the two kinds of crate agree on the cap as well as on the
halving.

**Unpacking needed no new code.** The crate is an ordinary `consumable` whose
`consumesInto` lists its contents, repeated per unit, so the Consume button
already on the sheet opens it. A Depot crate is opened the same way now
(`DEPOT.md` §0e), though it takes its own road out of the consume path, since
what falls out of one is a list of runtime tag IDs rather than catalog slugs.

A crate cannot go inside a crate. Halving twice is a free carry exploit, and it
would nest a `consumesInto` chain arbitrarily deep. Refused on both faces.

**A mount cannot go in one either.** Horse, Cart, Fishing Boat and Motorcycle
carry no weight at all — you ride them, you do not carry them — so the floor of
1 put a flat-bottomed boat in a one-pound box, and a hand-cart could be walked
indoors or past a Cerberus as anonymous cargo. Refused on both faces, by
`equipSlot: MOUNT` (`isMount` in `web/lib/tagRequests.js`). **The Depot is the
deliberate exception**: Horse and Motorcycle are wares with a `depotPrice`, and
every shipment arrives crated (`DEPOT.md` §0e), so `db/lib/depotCrates.js` packs
them as before. This refusal is the hand-packed button only.

**The line on the side is not checked.** `[CONTAINS]: whatever they typed`. That
is the feature — it is how you smuggle something past a Cerberus, and the GM
desk says so out loud on the request row.

**It is also optional, and not everyone is offered one.** A crate with no line
gets no `description` at all rather than an empty `[CONTAINS]:`. And writing on
a crate is writing: the field is rendered only for a packer who can read —
letters AND eyes, `readBlock` from `db/lib/reading.js`, the same rule the paper
actions use — and the server refuses a posted label from anyone else with the
same one sentence, so which of the two stopped them never leaks.

There is a second cap, on **count** rather than weight: `PACKAGE_MAX_UNITS`.
The weight cap does not bound the weightless, and a crate's `consumesInto`
repeats a slug per unit, so a crate of obols (0 lb, stackable, no ceiling) would
otherwise write an array as long as the pile.

**Undo goes to whoever is holding the crate**, not to the packer, and refuses
outright if the crate has already been opened. Both matter: the crate is
cargo — it gets handed over, carted and stolen — so returning the contents to
the packer would be a way to rob the person you sold it to, and restoring them
alongside an already-unpacked crate would mint 150 lb of goods out of nothing.

**Packaging Equipment is `tradeable: false`.** Its `removable: false` opt-out
(`CRAFTING.md` §5) only blocks the Destroy menu; while it was tradeable, anyone with a Factory Key could carry
the bench off or tip it into the Spillway, and there are exactly two in the
world with no recipe to make a third.

## 6. The numbers, and where they come from

**A cube weighs 17 lb; a crated cube weighs 8.5.** (It was 20/10 until
2026-09-06, Bascinet's call. A catalog-wide 30% cut the same day took it to
12 by accident and was reverted — `CARRY.md` §1a. What did stick from that
day is the **base carry cap: 71 lb, down from 120 via 84**.) Working back from
the target: 5 turns of production is ~2.5 producing turns, because a shift tires
you (§4), 3 refugees × 8 cubes × 2.5 = 60 cubes, and a Banneret with Horse +
Cart carries 71 × (1 + 4) = 355 lb. 60 cubes is 1020 lb raw, 510 crated — so a
wagon **no longer clears a five-turn run in one trip**. It takes about 41 cubes,
a bit over three turns' worth; the rest waits in the Logistics Room for the
next wagon. Five refiners is the ceiling on the floor: 5 × 8 = 40 cubes a turn,
200 ¢ of Squeeze.

**The wagon comes inside.** The Factory is `indoors: true`, but a surface roof
no longer parks a mount — only an underground one does (`CARRY.md` §3) — so the
cart stays equipped on the factory floor and loads where the crates are. It
carried the `wheels` attribute for this once, back when any roof took the reins;
that attribute is gone and nothing here needed to change, because the Factory
stands in the Black Hills. The roof is untouched either way: the mood dial and
the no-building rule both still read the column.

Through the crate cap: 150 lb packs **8** cubes into a 68 lb crate, and
355/68 ≈ 5.2 crates ≈ 41 cubes.

A refugee's 8-cube day is 136 lb against a 71 lb cap and a 106 lb ceiling,
so they cannot even hold their own output, let alone walk it anywhere: past
the ceiling the overflow drop fires on the *intended* loop every day. **4**
cubes (68 lb) fit under the cap; **6** (102 lb) fit under the ceiling,
Overburdened. They stash the rest in the Logistics Room and the carry pass
handles the overflow. The cart and the storeroom are the business; that is
deliberate, not an oversight.

**A cube sells for 5 ¢.** (It was 4, then 5, then 7, all on 2026-09-10, and
back to 5 on 2026-09-20.) Note the glyph: a cube is priced off `sellablePrice`,
so the number is **¢** and always was — this paragraph said ⬢ until the
2026-09-20 pass, which is the quiet kind of error `DEPOT.md` §0 exists to stop.

A refining day is **40 ¢** for 8 cubes, and a full 60-cube wagon is **300 ¢**.

**A shift pays 40 ¢, and you can work one every other turn.** Refine spends a
whole Move (`web/app/(app)/character/actions/refine.js` calls `requireFreeMove`)
and tires you (§4). Extract does not spend a Move: it claims `extractTurnKey` and
nothing else (`extractGodfleshRequestImpl` in
`web/app/(app)/character/actions/misc.js`, §3 above). A cut averages 7/6 of a
lump bare-handed (1, plus a 1-in-6 bonus lump on a 6) and 13/6 with a chainsaw,
and a shift needs exactly one, so the lump never binds a refiner who works every
other turn. Solo, a refugee makes **20 ¢ a turn**, with or without a chainsaw.
The chainsaw changes who can be fed, not the wage: it leaves about one spare lump
a turn, so one chainsawer supplies several refiners. What the wage costs is the
die. One cut in six is a 1, which is a wound with gloves on and a lost hand or arm
without (§3), and the Factory roles all start with gloves.

**A crafter fills the off turns.** Crafts, cutting Godflesh and Butcher never
climb the ladder, so somebody who refines every other turn and crafts on the
rest earns more than either alone: about 24 ¢ a turn with the 2-point Crafting
skill, 25 with Smithing I, and 28 with Smithing II. Farming does not fit beside
it, because Farm and Refine both lock out the same ladder.

**Farming and mining pay less, and neither pays in ⬢ the way this section used
to say.** Farming pays no ⬢ at all (`SOILERY.md` §1). A Farm action sows up to
50 plants, about 5 in 6 come up, and a crop sells for 1 ¢, so one action nets
about 38 ¢ after the 4 ¢ seed bag. It then locks the farmer out for 3 turns, which
is about **13 ¢ a turn**. Crops sell for 1 ¢ on purpose (2026-09-20): farming is
for eating, and at 2 ¢ it netted about 79 ¢ an action, the best wage in the game
after the Factory. A Prospector at the Caves brings up about 8 ⬢ a press, worth
8 ¢ at the 1 ¢ sell-back, and mines every other turn: about **5 ¢ a turn** with
the loot roll (`MINING.md` §3b and §5), or about **9 ¢** with the ⬢ valued at the
Depot's 2 ¢ import price, which is the most a buyer who must hold real ⬢ will
pay. A smith will pay no more than 1 ¢, because a smith can pay a recipe's ⬢ in
obols one for one. Set against those, the Factory is about 1.6 times a farmer and
4 times a Prospector at the sell-back, 2 times at the import price. A skilled smith's best easy recipe
(Glass Eye) pays about 17 ¢ a turn buying ⬢ at the Depot, or 28 mining it.
`npm run economy:report` recomputes every one of these from the catalog and
prints where the docs and the code disagree, so check there before quoting a
wage in this file.

The 7 ¢ price made a supplied refining day 56 ¢ — three times the best
smithing rung and the highest wage in the game by a wide margin, off an
action with no roll and no skill gate. The cut is the 2026-09-20 rebalance
(see `TRINKETS.md` §2 for the other half of it).

Squeeze has no `depotPrice`. The station sells nobody a cube.

## 7. What a cube does to you

Both Godflesh and Squeeze are `consumable`, because somebody was always going
to try.

- **Godflesh** → Vomiting. It is dead meat from a marsh.
- **Squeeze** → **Seizure** (1 turn), which `expiresInto` **Stupid**.

`seizure` is in `INCAPACITATING_SLUGS` (`db/lib/incapacitation.js`), which in
one line gives it movement blocking, lootability and draggability. It is
deliberately **not** in `FINISHABLE_SLUGS` — nobody asked for executing the man
on the floor.

**Stupid is permanent and incurable.** No `requirement:` block at all, which is
what makes the Heal menu refuse to offer it. Its `desires.locks` shuts every
Desire in the game except the `alcohol` and `stupidity` families, which is why
the `stupidity` family exists at all: a character with nothing reachable has
been benched rather than changed, and there has to be *something* left. What is
left is Moonshine and going to look at the statues.

It also garbles everything they say. `db/lib/babble.js` composes into
`bot/src/lib/proxy.js` where `textCorrection.js` already sits, and preserves
length while destroying content — a long anguished paragraph produces a long
anguished noise. Deliberately **not** a cipher: there used to be one for
letters (`db/lib/gribble.js`, since deleted — paper replaced it,
`PAPERWORK.md`), and it was reversible by anyone holding the right tag, which
was right for a letter and wrong for this. There is nothing to decode here.

Worth knowing before you touch that path: `proxy.js` had no per-character tag
check at all before this, only the global `tupperAutocorrectEnabled` flag.

## 8. Moonshine, and going blind

`brewing-basic`, **0 ⬢**, **no Move** (since 2026-09-20), and
`requirement.items: [godflesh]` — the Refuse Pit gives you the ingredient.
**One Godflesh per bottle, and it is used up**, like every other spent
ingredient (`BREWING.md` §4). It used to be a hold-check, which made the still a
strictly better use of a haul than the Factory; spending it puts the two in
honest competition. With no Move and no ration on a 0-turn recipe, the lump is
the whole throttle. Moonshine sells for 3 ¢, against the 40 ¢ the same Godflesh
makes as cubes, so it is not an income tap.

Drinking it grants Tipsy, **Blind Drunk** (2 turns, blocks Examine with no
corrective) and one **Damaged Vision**, which is permanent and stacks.

**At five, `db/lib/visionDecayPass.js` takes the whole stack and grants Blind.**
That tag already existed — −8, tier-7 cure, `removesInto: [night-blind]` — and
is reused rather than re-slugged. The pass is its own thing because nothing else
in the engine reads a stack *count* as a threshold: `expiresInto` fires off a
clock and knows nothing about quantities.

**Blind now actually closes doors**, which it did not before:

| door | file |
|---|---|
| the Look at button | `db/lib/examineVision.js` |
| the 🔍 reaction | `bot/src/events/messageReactionAdd.js` |
| working the Bird | `db/lib/bird.js#canReadLetters` |
| reading anything written | `db/lib/reading.js#readBlock` |

The last two are the interesting ones. Literacy and the eyes are asked as **one
question** so no caller can check half of it — and `readBlock` is the fuller
form, since it also catches Blind Drunk itself and Nearsighted with the
spectacles in a sack.

A blind recipient gets exactly what an illiterate one gets: the real letter, on
their sheet, as an object they can carry to somebody who reads
(`PAPERWORK.md`). **So Moonshine has a second cost now.** Five drinks and you
cannot read your own mail, your own orders, or the noticeboard in the Square —
and the game will not tell anybody watching whether it was the drink or the
letters you never had.

## 9. The Spillway

The Godard Factory's fifth room, and the only room in the game with
`Room.destroysContents`. Authored as `destroys: true` in `docs/zones.yaml`.

The seam is deliberately **`web/lib/tagEffects.js#giveTagTo` and
`db/lib/resourceTransfer.js#moveParty`** — the two choke points for putting
anything into a Room — rather than a branch in `transferRequest`. Nothing is
written, so nothing can be fished back out.

**There is a third writer into rooms, and it is excluded rather than routed
through the same seam:** `db/lib/roomStash.js#pickRandomPublicRoom`, which the
carry pass and corpse placement use to shed overflow. A destroying room is never
eligible. That is not a nicety — a refining shift makes 136 lb of Squeeze
against a 71 lb cap, so the overflow drop fires on the *intended* loop every
day, and one of the Factory's three public rooms is the trough. Tipping
something in has to stay a thing you do on purpose.

**Undo is the part that needed care.** A destroyed line records `destroyed:
true` on the effect, and both undos skip their receiving half: the Spillway
holds nothing, so the ordinary path would throw *"That room no longer holds
that"* (or fail the conditional balance write) and wedge the whole Undo. The
sender's end is still reversed, so a GM can hand the goods back — which is the
honest inverse, since the only thing that really happened was that somebody lost
something.

The room announces it as scenery like any other room event, through
`db/lib/roomAnnounce.js`, but with its own line: "leaves it here" would be a lie
about a trough.

## 10. Where the code lives

| Concern | File |
|---|---|
| The die, the yield, the injury table | `db/lib/godflesh.js` |
| Refining: reach, apply, revert | `db/lib/refinery.js` |
| The snapshot | `db/lib/moveEffects.js` (`refined`) |
| Both server actions | `web/app/(app)/character/requestActions.js`, `web/app/(app)/character/actions/refine.js` |
| Undo | `web/lib/tagEffects.js` |
| What a GM sees | `/gm/audit`, rendered by `web/lib/auditNarrative.js` |
| Buttons | `web/app/components/actionRegistry.js`, `RequestActionsProvider.js` |
| Gates | `web/app/(app)/character/page.js` |
| Location attributes | `db/lib/locationAttributes.js` (`godflesh`, `refinery`) |
| Crates, both kinds | `db/lib/depotCrates.js#crateWeight` |
| Stupid's garble | `db/lib/babble.js`, `bot/src/lib/proxy.js` |
| Damaged Vision → Blind | `db/lib/visionDecayPass.js` |
| Spillway | `db/lib/parties.js`, `resourceTransfer.js`, `web/lib/tagEffects.js` |
| The once-a-turn claim | `extractTurnKey` / `extractedThisTurn` in `db/lib/godflesh.js`, `Character.extractTurnKey` |
| Constants | `PACKAGING_EQUIPMENT_SLUG`, `PACKAGE_MAX_LBS`, `PACKAGE_LABEL_MAX` in `db/lib/constants.js` |
| Geography, roles, papers | `docs/zones.yaml`, `docs/roles.yaml`, `docs/documents.yaml` |
