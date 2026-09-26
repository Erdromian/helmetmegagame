# Weight, the free zone move, room stashes, and Transfer

What a character can hold, where they put the rest, and how it moves. This
doc owns `db/lib/carry.js`, `db/lib/carryPass.js`, `db/lib/roomStash.js`,
`db/lib/roomAnnounce.js`, `db/lib/mounts.js`, `db/lib/indoors.js`, the free
zone move in `db/lib/locationTravel.js`, the `room:` party kind, the merged
Transfer dialog and the Storage button. Related: `REQUESTS.md` (the two transfer request
types), `CHANNELS.md` §4 (Rooms), `MAP.md` §3 (the travel gate),
`TURN-ENGINE.md` (the carry pass), `TAGS.md` §5 (`carryBonus`).

## 1. The cap

A character carries one load against one cap, live on `/gm/dev`:

| Load | Counts | Base cap |
|---|---|---|
| Weight | `Tag.weightLbs` × quantity, over every `tradeable` tag. Two things weigh nothing: **Assets** (an arelitz carries itself, a house does not move), and everything that was never cargo — skills, injuries, statuses, beliefs. Every item weighs something, since every item is tradeable (`TAGS.md` §5). The one exception is a runtime mint that is not cargo — a Disguise you are wearing. | `GameConfig.carryWeightLbs`, default 71 |

**⬢ are on that row, because ⬢ are an item.** One pound each, stacked in an
ordinary `CharacterTag` row like a sword or a loaf (`docs/tags.yaml`
`resources`), so a fortune in raw material is a cart's worth of work to move and
a character choosing between their savings and their armour is the point.

There were **two** caps here until 9/2026: a second one counting ⬢ at 25 a
head, with its own watermark, its own 1.5× ceiling and its own spill branch in
`settleCarry`. It existed because ⬢ were a number on a sheet rather than a
thing — weightless, so the weight cap had no opinion about them, so they needed
a cap of their own. The moment ⬢ got a weight the second track had nothing left
to do, and it was deleted rather than ported. A character over the ceiling on
raw material now sheds sacks of it by exactly the rule that sheds a spare sword.

The pound is not a new number, either. A **crated** ⬢ has always weighed one
(`RESOURCE_UNIT_LBS`, `DEPOT.md` §0e); loose ⬢ weighing nothing was the
inconsistency, and freight and sheet agreeing is one fewer rule to hold.

The cap is moved by the **sum** of every **active** `Tag.carryBonus`, which
is a signed distance from ×1: Cart `+4`, Giant `+0.75`, Pack Mule `+0.5`, Strong
`+0.1`, Frail `−0.1`. The cap is `base × (1 + sum)`, floored. Nothing carrying a
bonus is stackable, so the sum is per row.

A carry tag's description says what it does in pounds and nothing else now —
`carryBonusLine` used to end "and 12 ⬢" beside the pounds, naming the cap that
no longer exists.

**Additive, not multiplicative** — changed 2026-09-03, when bodies started
carrying penalties. Multiplied, Frail ×0.9 took 60 lb off a character pulling a
cart and 12 lb off a peasant: the same frailty, five times the bite, decided by
gear it had nothing to do with. Added, a frail body costs everyone the same 12
lb. The visible cost is that Cart + Giant is ×5.75 rather than ×8.75, which is
the point — a cart's wheels do not get better because the man pushing them is
large.

**There is a floor of ×0.25** (`MIN_MILLI` in `db/lib/carry.js`). Penalties add
up and the catalog holds enough of them to reach zero; a 0 lb cap would leave a
character permanently Overburdened with nothing they could put down to fix it.

**Active means equipped, for anything equippable.** A Cart you are not pulling
hauls nothing, so its bonus only counts while `CharacterTag.equipped` (§3). A
body — Strong, Pack Mule, Frail, a broken rib — is not `equippable` at all, and
so always counts. `multiplierApplies()` tests `Tag.equippable` rather than
listing slugs, which keeps the rule in the catalog where the rest of a tag's
behaviour lives.

`db/lib/carry.js` holds the math — `carryMultiplier` (the summing function kept
its name), `carryWeight`,
`carryCaps`, `carryHardCaps`, `carryAdmits`, `carryStatus` — with no prisma and
no I/O, so `/character` can render "60 / 71 lb" without dragging the barrel
into the client bundle. The cap on that row carries a `title=` breakdown: the
base, then a signed line per active bonus.

### 1b. What a body is worth

Bodies were decorative here until 2026-09-03: Frail, Old, Fat and every maiming
in the catalog said a character was weak and then changed nothing about what
they could haul, while Giant — the priciest tag in the game at 14 — bought no
carry at all.

| | slugs | `carryBonus` |
|---|---|---|
| Giant | `giant` | `+0.75` |
| Pack Mule | `pack-mule` | `+0.5` |
| Strong | `strong` | `+0.1` |
| Pack Mouse | `pack-mouse` | `−0.5` |
| standing traits | `frail`, `dwarf` | `−0.1` |
| standing traits | `old`, `fat` | `−0.05` |
| maiming | `missing-arm`, `missing-leg`, `crippled-leg` | `−0.1` |
| maiming | `peg-leg`, `missing-fingers`, `mangled-hand` | `−0.05` |
| chronic | `arthritis`, `consumptive` | `−0.05` |
| wounds | `grievous-wound`, `punctured-lung`, `gut-wound`, `broken-bone`, `cracked-ribs` | `−0.1` |
| wounds | `deep-wound`, `dislocated-shoulder`, `sprained-ankle`, `severe-burns`, `blunt-force-trauma`, `frostbite` | `−0.05` |

**A wound now moves a cap**, so anything that grants or heals one has to
re-settle carry or the sheet shows a stale number until the next turn pass. The
web writers already do, through `web/lib/afterInventoryChange.js`; so does the
bot's `/heal`. `overburdened` itself must never take a `carryBonus` — it is
granted *by* being over the cap, so lowering the cap from it is a loop.

## 1a. The weight bands

**0 is a real rung.** A key, a letter, a badge, a pair of spectacles: nobody's
carry is decided by their keyring, and pricing paperwork just makes players do
arithmetic about it. Written as an explicit `0` rather than omitted — omitting
`weight:` means the tag is not cargo at all, which is a different claim. A
0-weight unit is also never a candidate for the overflow drop (§5): shedding it
could not help, so it would only waste draws on letters while the
anvil stayed put.

**Price an item off this table, not by feel** — the same discipline the point
scale gets in [`TAGS.md`](TAGS.md) §4a. `db/lib/syncTags.js` throws if an
`items` tag omits `weight:`, so new gear cannot arrive weighing nothing.

| Band | lb | Examples |
|---|---|---|
| Negligible | 0 | key, letter, badge, coin, spectacles, cigarette |
| Trivial | 0.5–1 | vial, tonic, dagger, sling, Graga sac |
| Light | 2–3 | meal, flask, sword, bow, cudgel, a book |
| Medium | 4–6 | spear, mace, helm, halberd |
| Heavy | 8–12 | crossbow, rifle, shield, bear trap, padded armor |
| Very Heavy | 20–30 | mail shirt, breastplate, pavise, Godflesh |
| Massive | 40–75 | plate armor, flamethrower, a corpse (a person's or a creature's) |
| Immense | 100 | workshop equipment, a nuclear device |

**A thing with an obvious real weight gets that weight**, and the band is for
what has none. A longsword is 3 lb, not 5; a halberd is 6, not 12; a war
hammer is 5; a crossbow 8; a knight's helm 6. The bands are ranges since the
realism pass of 2026-09-06 — earlier that day every weight had been cut 30%
by mistake, and the fix restored the old scale and then went item by item.
Light things are light (a dagger is 1 lb, a cigarette nothing) and heavy things
stayed heavy (plate 55, cataphract 65, a Graga corpse 75).

A Foodstuff is 1 lb (the Soilery Rework doc, `SOILERY.md` §2), so a Farm
action's harvest — about 83 of the 100 crops planted (`GameConfig.farmMaxCrops`)
— is about 83 lb landing in one turn-close carry pass. That is over the 71 lb
cap, so a farmer usually comes in Overburdened and stores or hands on the
surplus.

**The base cap is 71 lb** (120 until 2026-09-06, then 84 until later the same
day). A full harness (55) plus sword, dagger and shield (14) is 69 lb, which is
the whole cap: you can do the knight thing and carry nothing else at all. Two
pounds of slack is deliberate — the knight who wants to eat puts something
down, or pulls a cart.

**`{carry:slug}` in a tag description** renders the sentence Bascinet wrote,
computed from the live caps: "You can carry 5 more item tags, and 12 ⬢." Pack
Mule and Cart both end with it. `getCarryReference` in `web/lib/referenceData.js`
pre-formats one line per multiplier tag, streamed from the root layout into
`CarryProvider.js`; `RichText.js` and `ChipText.js` render it as plain text.
The multiplier lives once, in `docs/tags.yaml`, and the description only names
its own slug.

## 2. Over the cap, and the ceiling past it

There are two lines, not one.

| Load | What happens |
|---|---|
| ≤ cap | fine |
| cap → 1.5× cap | it lands; `overburdened` is granted |
| > 1.5× cap | **it cannot be yours at all** |

`HARD_CAP_RATIO` in `db/lib/carry.js` is that 1.5, derived from the cap rather
than stored, so a GM raising the base moves both lines together.

**The ceiling bites in two different places**, because things arrive in two
different ways:

- **Deliberately** — a hand-over through Transfer. `carryAdmits()` refuses it
  before it lands, with a sentence the caller hands straight to the player.
  It has to: otherwise handing someone 300 lb would land, and then shed a
  random slice of what they were *already* carrying onto a public floor where
  anyone could take it. The other deliberate routes (Craft, `/store`, a Depot
  buy, Loot, a stash pull) do **not** call it yet — those are self-inflicted
  rather than a griefing vector, so today they land and shed. Wiring them is
  owed work.
- **Involuntarily** — a mining payout (which is ⬢: `MINING.md`), Caving loot,
  a GM grant, a `consumesInto` chain. It lands, and then `settleCarry` sets the
  excess down in a random public Room where they stand. This is the farmer who
  reaps more than they can carry: past the cap they are Overburdened, past the
  ceiling the rest is simply on the ground.

### What Overburdened costs

Being over the cap **zeroes your free travel** (§2a). It is no longer a
refusal: an overloaded character can still cross into another zone, they just
pay their Move to do it, and cannot then act. Only the mover is affected — the
dragged are corpses and the helpless. Escorting is not gated at all: a party
crosses on the leader's allowance.

The tag itself (`docs/tags.yaml`, `OVERBURDENED_SLUG` in
`db/lib/constants.js`) is granted the moment you are over either cap and
cleared the moment you are back under, never by a player and never on a clock.

## 2a. Free travel

Crossing a zone used to always spend your Move, with a mount buying one extra
crossing per *day*. Now:

- Everyone gets `GameConfig.freeZoneMovesPerTurn` travel a turn, default 1.
- A crossing **between the town zones** — Town, Fortress, Undertown — costs
  **½** of it; **any other crossing** costs **1** (`db/lib/crossingCost.js`).
  The allowance and both counters are Float columns, since halves add up
  exactly in a double.
  A hop inside a zone still costs nothing.
- An **equipped** mount adds **rides**: 1 a turn on a fresh arelitz, 2 on a
  tacked arelitz or a motorcycle, and **a ride covers any crossing** — a
  town hop or the hills, one ride each (`MAP.md` §3, `ARELITZ.md` §2a). It
  refreshes every turn, which on a short turn length is several times a day.
  The rides are **on the mount's own tag**: each one ridden takes the tag a
  rung down — Motorcycle, then Motorcycle (1 ride left), then Motorcycle (Spent) — so
  whoever holds it can read what is left, and the turn pass rests it. It is
  **spent first**: the mount's ride goes before the base pool and stays with
  the animal, so unequipping the arelitz later in the turn (a narrow way, or
  by hand) cannot take back travel you never spent. **Only while your escort party
  fits its seats**: go over `fastTravelCapacity` and the mount buys nothing
  this crossing (`MAP.md` §3a). On foot there are no seats and nothing to
  lose, so walking any number of people is free.
- Overburdened sets the allowance to **0**.
- A **lamed** character's allowance is also 0 — a leg too hurt to carry you
  (`crippled-leg`, `cripple`, `missing-leg`, `sprained-ankle`) or too dazed to
  find your way (`pain-shock`). `LAMED_SLUGS` in `db/lib/locationTravel.js`.
  A mount cancels it outright — the arelitz or the bike does the walking —
  and it's the free crossing that's gone, not the ability to cross: pay the
  Move, or have someone Escort you.
- A crossing you cannot afford in full files the `MOVE` Action as it always
  did, and whatever travel was short of it stays for a cheaper hop. Once you
  have acted, you cannot cross.
- Or **push on**, once the Move is spent too: one more crossing a turn on foot
  on a d6 — 1 Sprained Ankle, 2–3 Exhausted, 4–5 Tired, 6 Winded
  (`MAP.md` §3). Once a turn, never while riding, lamed, bleeding out,
  Exhausted or Overburdened. Already Tired, 2–5 is Exhausted.
  Quick-Footed and Caffeinated (and Lucky) keep the better of
  two dice; Fat and Old keep the worse.
- A **free** crossing lands at once. A **paid** one is a day's walk and only
  lands next turn (`MAP.md` §3) — the Move goes now, the traveller stands still
  until the turn turns.

So a peasant walks Town → Black Hills for nothing, spends their Move to come
back, and the next crossing waits for the next turn — or walks Town →
Fortress → Undertown for nothing and still has the Move. That is the whole
model.

`Character.zoneMovesTurnId` + `zoneMovesUsed` track the base pool, and
`zoneMovesBonusUsed` counts how much of that travel went on a mount's ride
rather than the base allowance — only so the two can be told apart; what the
mount has left is read off its rung, never off this counter. All three are claimed by a
conditional `updateMany` whose WHERE is the check, so two tabs cannot both
spend the last one. A differing turn id resets the counter in the same
statement, so nothing ever sweeps the field. `freeZoneMoves()` and
`freeMovesLeft()` live in `db/lib/locationTravel.js`; the sheet shows the
number and Discord's Travel confirm says what the hop will cost before you take
it.

The count does **not** depend on where you are going; the **cost** does.
`freeMovesLeft()` and `freeZoneMoves()` answer one number for the whole list
of destinations, and each destination row carries its own `cost` from
`db/lib/locationGraph.js`, so a surface asks "is `freeLeft` at least `cost`"
per node (`web/lib/travelCost.js#affordsCrossing`). The boat's per-crossing
bonus, which once made the count itself depend on the crossing, is gone.

What the number *does* still turn on is **who is coming with you**, which is
why the last argument is `partySize`: over the seats and `fitsMount()` zeroes
the bonus for that crossing (§3 below). So the surfaces that know the party —
the Travel panel, `/map`, and Discord's Travel picker — pass `party.length`,
and the character sheet, which is asking nothing about a particular journey,
passes nothing and reads the ambient count.

## 3. Mounts, carts, and indoors

`arelitz`, `motorcycle` and `cart` are **equippable**, and
give nothing while stowed — no carry multiplier, no extra zone move, no
passenger seats. They sit in the `MOUNT` slot (`TAGS.md`, "equipSlot"): an
arelitz or a motorcycle is *ridden* (layer 1) and a cart is *towed*
(layer 2), so an arelitz and a cart go together and an arelitz and a
motorcycle do not — one thing per layer.

`arelitz-tack` (renamed from `horseshoes` — an arachnid does not wear shoes)
is **not worn any more**. It is a plain item, spent by the **Tacked Arelitz**
Craft recipe (`docs/tags.yaml`, `requirement.items: [arelitz, arelitz-tack]`,
no Move, once a turn) together with one arelitz, minting an `arelitz-tacked`
— the same animal with 2 rides a turn instead of 1, on its own ladder. It
cannot be taken off again, and it cannot be passed round a party to buy every
rider the extra ride, which is why it stopped being an accessory. It does
nothing for the Motorcycle (no hooves).

**Seats, from `fastTravelCapacity()`:** an Arelitz alone is 2, and a Cart
upgrades that pair to 6 — the biggest ride there is. They count the **rider**,
so an arelitz seats you and one other. Overfilling them is not refused; it
costs the mount's extra crossing and nothing else (`MAP.md` §3a). This function had no
live caller at all until escorting gave it one. The **Motorcycle is 2 and cannot be
upgraded** — it is tested before the arelitz for exactly that reason, so the
Cart's clause can never reach it. A hand-cart towed behind a motorcycle is not a thing, and letting it fall
through would have quietly turned one seat into six.

The motorcycle was inert loot until 2026-09-06 — 100 lb of flavour with no
`equippable` at all. Making it a mount was one slug added to
`FAST_TRAVEL_SLUGS`: the indoors parking and the Motion
Sickness refusal below both read that set (or `STOWABLE_SLUGS`, which is built
from it) rather than naming their slugs, so both picked it up for free.

**Motion Sickness** refuses equipping any of them outright
(`web/app/(app)/character/equipActions.js`) — a Motion Sick character never
rides. A Motion Sick character *dragged along* by someone else's mounted
crossing doesn't get a say: `db/lib/locationTravel.js#vomitOnTheRide`
grants them Vomiting (and DMs them) the moment a mounted mover
crosses a zone with them in tow.

**A roof never takes the reins.** A mount and a cart ride into any Location,
`indoors: true` or not, underground included (Bascinet's call, 2026-09-27).
Surface roofs stopped parking mounts first; the Caves and the Depths, the last
places that did, followed. `parksMounts`, `parkMountsIndoors`, the equip
refusal and the `· indoors` marks on the travel pickers all went with it. The
readers that ask about the **roof** — `examineVision.js`, `paper.js`,
`mood.js#placeClassOf`, `structures.js` — keep reading `indoors` as they
always did, and Examine still says **Indoors** or **Outdoors**.

The one thing that still keeps a mount out is a **connection** marked
`on_foot: true` in `docs/zones.yaml` — a way too tight, steep or enclosed for
it (`MAP.md` §2c). Crossing one dismounts rather than refusing: the mount and
the cart are unequipped and stay in the pack, and the player puts them back on
from the equip board (an **Automatically ride my mount** switch used to do
that; it was removed, and `Character.autoMount` is an orphan column now). The
dismount runs *inside* the crossing's own transaction, before the free-move
accounting reads it, or a rider could bank the mount's ride on a crossing it
never survives. Nothing is dropped for it — see §4.

## 4. Settlement: pull-based, post-commit

`settleCarry(prisma, characterId)` is the one function that makes a sheet agree
with its caps. It is **pull-based** — it recomputes from the current row
rather than being told what changed — for the same reason
`roomAccess.js#syncCharacterRoomAccess` is: the writers that change what a
character holds are many and scattered, ten of them bypass
`tagWrites.js#dropCharacterTag` with a raw `deleteMany`, and the ⬢ half moves
through a wholly different set. A push from any one of them would miss the
rest. And it is **post-commit**, never inside a caller's transaction, because
an overflow drop has to talk to Discord.

It runs, in this order, at:

- **Every web writer that touches tags or ⬢**, through
  `web/lib/afterInventoryChange.js`: settle → re-read the row → narrowcast
  sync → room-access sync → `deliverCarryDrop` in `after()`. That order is
  the rule: a drop can take a private-room key off the sheet, so membership
  must be recomputed from the post-drop holdings. Every request action in
  `requestActions.js`, the Depot's three, `/store`, the GM grant/revoke
  surfaces, the Dev Panel, `gmTransfer.js`, and — once, generically — the
  desk's `resolveRequest`, over every character id it can find on the
  request's effect. That last one keeps REQUESTS.md's promise that adding a
  type costs one `REQUEST_EFFECTS` entry.
- **Every arrival**, in `db/lib/locationMove.js#applyLocationMoveSideEffects`,
  immediately before the room-access sync and immediately after the mounts are
  parked (§3). This is the hook that retries a deferred drop (§5) and settles
  Caving loot picked up on the way in.
- **The bot's `/heal`**, beside its existing room-access sync.
- **Turn close**, as the `carry` pass (`db/lib/carryPass.js`), after `hunger`
  and before `lifewebDecay` so it sees the final sheet: staged
  pushes, the expiry sweep and the ⬢ upkeep all happen earlier in the close
  and none of them may settle in place. One transaction per character, drops
  returned to `runSideEffects` rather than sent. Caving loot granted at turn
  open is settled by the next close or the next inventory action, whichever
  comes first.

Returned, never sent: `settleCarry` hands back
`{ characterId, over, granted, removed, drop }` and `deliverCarryDrop` does the
Discord half — the DM and the aliased room line (§6).

**It also enforces the hold limits** — one mount, up to 3 unruly or young
arelitz (`ARELITZ.md` §2b). That half runs before the weight half, sets its
excess down in the same room, and rides the same `drop` as `drop.limit`, so no
caller needed a second branch; `deliverCarryDrop` gives it its own sentence.
It does not wait for the load to grow, and `{ drop: false }` skips it.

## 5. The overflow drop

**Drops are acquisition-driven, and only acquisition-driven.** Nothing comes
off a sheet because a cap SHRANK. Unequipping a cart at an inn door, handing
one over, a GM lowering the base cap — all of those make a character
Overburdened and no more.

**`Character.carryWeightSeen` is what tells the two apart.** It holds the load
at the last settle, and the shed fires only when
the load has **grown** past the ceiling — never when the cap fell beneath a
load that did not move. Without that comparison the settle cannot distinguish
"you picked something up" from "you put your cart down", and since a narrow
way unequips a cart (§3), the second reading would empty it onto the floor
every time somebody climbed a stair. (The old watermark tracked the *multiplier*,
for the narrower job of noticing a Cart had left; this one tracks the load,
because the load is the thing the rule is actually about.)

The watermark advances to the post-shed load at the end of every settle —
**except** when the shed was deferred for want of a public room, where it is
deliberately left behind so the growth stays unclaimed and the next settle
retries. The write is a conditional `updateMany` on the previous pair, so two
settles racing on the same growth cannot both shed.

**What drops.** `drawDrops` takes the droppable units **newest-acquired
first** — `CharacterTag.acquiredAt`, bumped on every top-up
(`tagWrites.js#addToStack`, `tagEffects.js#restoreCharacterTag`), not just the
row's original creation — until the excess is covered, shedding back to the
**ordinary cap** rather than to the ceiling — landing someone exactly on 1.5×
would leave them one letter from spilling again every turn. This was a
Fisher–Yates shuffle until 2026-09-13: a random pick could shed whatever a
character already owned to make room for something somebody had just handed
them, which turned Transfer into a way to make a stranger drop their own
things onto a public floor for the taking. Newest-first means the thing that
just arrived is what goes back on the ground; an older holding is only ever
touched once that isn't enough on its own. Weightless units are not candidates
at all, or this would spend draws on letters while the anvil stayed put. Two
things are never in the bag: multiplier tags (dropping the Cart to fix being
over would shrink the cap again and loop) and equipped gear (being disarmed by
an overfull pack reads badly). Every ⬢ over the ⬢ ceiling spills the same way.
Audit: `carry_overflow_dropped` with the manifest.

**Nowhere to put it down** — unplaced, or a Location with no public room — and
the character simply stays over the ceiling with the watermark held back; the
next settle, on arrival or at turn close, retries for free. Audit:
`carry_drop_deferred`.

## 6. Room stashes

Every Room, public or private, holds unlimited tag stacks (`RoomTag`, one row
per tag, `@@unique([roomId, tagId])`), and ⬢ are one of them — a `resources`
row like any other. A room is where you put what you can't carry, which since
⬢ started weighing a pound each is most of a fortune.

**Two rooms hold nothing at all.** `Room.destroysContents` — the Godard
Factory's Spillway and the Servant Wing's Latrines — makes both writers into a room
(`giveTagTo`, `moveParty`) no-ops, so what goes in is gone. Undo can still hand
it back to the sender, because the effect records `destroyed: true` and skips
the receiving half; without that the ordinary path throws on a stash that never
held anything. See `FACTORY.md` §9.

**Eleven rooms hold their sound in.** `Room.soundproof`, set from
`soundproof: true` in `docs/zones.yaml`, is read by `db/lib/shout.js#soundproofAt`
— a shout there never carries out, and prints
`**Muffled**: shouts do not carry out of here.` on the room's own starter. A
Location is never soundproof itself; only the Room can be.

Two things a stash does differently from a pocket, both in
`db/lib/tagWrites.js`:

- `addToRoomStack` has **no non-stackable pin**. Two players can each leave
  their Longbow and the row goes to 2; the pin is a rule about what one
  character can hold, and `addToStack` re-applies it on the way out. That is
  also why `transferRequest` clamps a non-stackable pull out of a room to 1,
  and refuses it outright to someone who already holds one — a silent pin
  would move 1 while the request said 2, and Undo would take 2 back.
- `dropRoomTag`'s **decrement is the check** — a conditional `updateMany` —
  because a room is the game's first multi-actor inventory: two players in
  the same public room can pull the same stack in the same tick.

`expiresTurn` rides along from the holder's row (the earlier clock wins when
stacks merge), and the two blind sweeps in `db/index.js` shed `RoomTag` rows
the same way they shed `CharacterTag` ones — a stashed meal still rots.
`tagExpiryPass.js` stays character-only, so no *affliction* chain fires on a
floor. **One progression does reach a room stash**: a corpse left lying in one
goes off after three turns (`db/lib/corpseRotPass.js`, `CORPSES.md` §3). It
runs before the sweep and nulls the holding's `expiresTurn`, which is what
stops the blind `deleteMany` deleting the body instead of rotting it — so the
sweep never sees it and needs no exemption list.

**A GM can write to a stash from the adjudication desk.** "+ Room" on
`/gm/turns` stages tags onto a floor and mints or burns the room's own ⬢,
applied at the turn-end push like any other staged effect — so seeding a cave
or dropping what a Gambit left behind happens in the same queue as everything
else, rather than by hand in the Dev Panel. `ADJUDICATION.md` §1 has the shape.

One trap while you are in here: `RoomTag.tagId` cascades from `Tag`, but
`CharacterTag.tagId` is **RESTRICT**. Deleting a catalog row somebody is
carrying throws; clear the holdings first.

**Who can reach a stash.** Standing in the room's Location, and admitted to
the room — `roomAccess.js#accessibleRooms`, the same predicate the
thread-membership sync uses, so the transfer gate and the door can never
disagree about The Charon. `web/lib/transferReach.js#canReachParty` carries
the rule.

"Admitted" is two things, not one: holding one of the room's `access:` tags,
**or** a `RoomGuest` row somebody wrote with `/add` (`CHANNELS.md` §4a). A
guest reaches the stash exactly as a key-holder does — being in the room is
being in the room, and a visitor who can read the thread but is told the floor
isn't theirs would just be confusing. Load both halves with
`roomAccessKeys(prisma, characterId)`; passing keys alone is how the two
answers drift apart.

Since the 9/2026 roster change every reach rule is Location-grain
(`db/lib/presence.js`), so a room and a person are judged at the same grain.

**A public stash is public.** Anyone at the Location can list its contents
(the Storage button, or the Transfer dialog) and walk off with them. That is
the point of a floor, and it is also a trace: the goods often say who passed
through. Private rooms leak nothing to anyone their key — or their host — hasn't
admitted.

**Not every unit is on the floor.** A stack keeps a second count,
`RoomTag.hiddenQuantity`, for what is under it; nothing here reads it, and the
Search button is the one thing that moves it up into `quantity`. The whole of
that lives in [`SEARCH.md`](SEARCH.md) §9, including the rule that every
deleter of a row at zero must check both counts.

### 6a. Left on the floor

**What a character leaves in a public room sinks under the floor after a
whole in-game day.** A keyed room — one with an `access:` list — is a stash,
and what is left in one stays on the shelf. Everywhere else, a stack somebody
set down and walked away from goes from `quantity` into `hiddenQuantity`,
and from then on only a Search (`SEARCH.md` §9) brings it back up.

- **The stamp.** `RoomTag.floorDay` is the in-game day (`Turn.dayNumber`) a
  character last set something down on that stack. Four paths write it, all
  through `db/lib/floorSettle.js#stampLeftOnFloor`: the Transfer dialog into
  a room (items and ⬢ alike), the Overburdened spill (§2), a craft's spare
  set down for want of a hand (§5), and the turn-end push's craft spare. A
  later drop onto the same stack writes it again, so the clock restarts for
  the whole stack. Nothing else stamps: a seed, the GM desk, the Vault's
  coin, a Stable's foals, a structure's yield and a train's freight stay
  where they were put.
- **The settle.** A turn pass, `floorSettle` (`TURN-ENGINE.md` §2), right
  after the expiry sweep, sinks a stamped stack whose day is two or more
  behind the day the next turn opens on. Left on day 5, it is still there all
  of day 6 and can go when day 7 begins — at least one full day in view. The
  stamp is cleared as it sinks, and when the floor count runs out (a Take, a
  Steal).
- **Only out of clutter.** A stack sinks only while the room shows **three
  or more** stacks on its floor, counting itself and counting everything
  there — ⬢, an arelitz, things that never sink. One at a time, oldest drop
  first, each one taking one off the count, so a floor is never swallowed
  below two things: two things lying in a room are two things anybody would
  see. A stack held back keeps its stamp and goes on a later turn if the room
  fills up. The pass counts each floor under that Room's row lock, so a Take
  landing mid-pass is counted, not raced (`floorSettle.js#planSettle`).
- **Only loose objects sink** (`floorSettle.js#canSink`): the Items
  category, ⬢ and coin included. Never an **asset** — an arelitz or a
  youngling, a dog, a hound, a monkey, a bird, a rat, a cart — and never a
  **building** (every `placement:` tag: the forge, a watchtower, the
  gallows). Never a **corpse** of either kind (`corpseKind`): burial, rot,
  butchering and the death smell look for it on the floor. And never
  anything of **40 lb or more**, too big to lose: the Workshop and Packaging
  Equipment, plate and cataphract armour, the flamethrower, the spacesuit,
  the device.
- **Where nothing sinks**, even stamped: a keyed room, the Spillway, a Stable
  (the arelitz pass counts the herd on the floor). Nor does a stack on an
  expiry clock, which rots in plain sight instead — so hidden stock never
  carries a clock, which is what the expiry sweep relies on.
- **Poison sinks with it.** `RoomTag.hiddenPoisonedCount` is
  `poisonedCount`'s twin: the poisoned units go under with the rest, the
  payload stays on the row while either count holds any, and a Search brings
  both back up together. Without it, a poisoned pie would be the one thing
  left on the shelf.

The pass writes one `floor_settled` audit row a turn, naming the stacks it
moved. Nobody is told in game; the next person to press Storage sees less
on the shelf, and a higher count on the line under it.

The stash survives the message wipe (it lives in the database, not the thread),
is cleared by a Restart Game wipe (`wipeGameData` deletes `RoomTag`, ⬢
included now that they are a stack) — and then poured straight back, because
the wipe re-seeds the authored board before it finishes (`db/lib/worldSeed.js`,
`LAUNCH.md` §2 step 10) — and cascades away with its Room if a superadmin hard-deletes
it from `/gm/dev/zones` (retiring one leaves the stash in place). Deleting a
Tag from the catalog cascades its **room** stacks
(`RoomTag.tagId` cascades) but not the copies people carry
(`CharacterTag.tagId` is RESTRICT) — see the trap above.

## 7. Transfer

One dialog — **Move things** (`web/app/components/actions/MoveThingsDialog.js`,
modes `transfer` and `loot`) — is Transfer, Loot, Take, Drop and Give. Two
chip rows say the direction (From: you, a Room here, or somebody helpless;
To: you, a person here, or a Room), then every stack the source
offers is a row with a count (`StackRow.js`: name · − n + · All), plus a ⬢
box.

**The name is a `TagChip`, and the weight sits beside it** (2026-09-10). This
dialog was the one list in the app showing a bare name, and a player said what
that cost: *"Right now I have to pick up equipment and try putting it on to
figure out where it goes."* The chip's hover is the same card the Depot, the
Tag Catalog and the sheet's own rail already show — In a fight, Armour, Weight,
**Worn** (`describeEquipFit`: "Held · takes two", "Head · Liner"), Cost. The
weight is inline rather than on the hover because it is the fact that decides
the answer while the dialog is open, with the carry cap in the projection line
below. **A helpless person's pockets are the exception**: those rows keep a
plain name and a weight and get no chip, because the loot filter is `tradeable`
rather than `catalogVisibility`, so a secret tag somebody is carrying is already
named there and handing over its description, recipe and cost too would be a
second leak (`REQUESTS.md` §5b). It replaced two dropdowns, a checkbox list with a "How many?" field per
tick, and a separate Loot dialog that was a third dropdown over the same body.
The people are the same roster every picker uses (web/lib/peopleHere.js), and
the whole thing is re-read the moment the dialog opens
(`actions/useRoster.js`). Out of a person's pockets **is** Loot — the server
hands that source to `lootCharacterRequest`, so the helpless gate, the mood
hit and the "your body was searched" notice fire whichever button opened it;
you can't reach into a standing person's pockets, and listing what's in them
would show their hidden tags (REQUESTS.md §5b). The Loot button opens the same
dialog with you left off the From row. The projection line
("After this you carry 60 / 71 lb and 6 / 25 ⬢") warns in accent when the
result is over a cap and submits anyway — going over is allowed up to the ceiling (§2).

Server side, `transferRequest` in `requestActions.js` resolves both parties
(`db/lib/parties.js`, which now knows `room:<id>`), checks reach once,
validates every line against the source's holdings, and in one transaction
files **one `TRANSFER_TAG` per line and one `TRANSFER_RESOURCES` for the ⬢** —
so a GM can still undo any single piece from `/gm/turns`. The two request
types are unchanged in kind; `TRANSFER_TAG`'s effect gained `from`/`to`
parties beside its legacy `fromCharacterId`/`toCharacterId` mirrors, and Undo
synthesizes the pair from the legacy fields for rows filed before rooms
existed. `moveParty` maps the three kinds through a table so `applyTransfer`'s
`(kind, id)` lock ordering is untouched.

After the commit: `afterInventoryChange` for every character end, the usual
DM to a receiving character, and for a room end a **line in the room's
thread** (`db/lib/roomAnnounce.js`): "*Ada leaves Graga Sac ×3 and 12 ⬢
here.*" The room is told the presented name, the same one a shout uses — your
own, a forced name, or "*A young man takes a Lantern.*" if you are concealed.

**Steal is the one exception, and it is worth knowing before you trust a room
thread as a record.** The Steal verb ([`THEFT.md`](THEFT.md) §1) moves things
out of a stash on this same path and suppresses that line on a good d6 — so a
stack going missing with nothing said about it is ordinary now, and the audit
log is the only complete account of what a stash held. The switch is
`transferRequestImpl`'s SECOND parameter rather than a field on its input, for
the reason THEFT.md §1d gives.

**You can hand something to a stranger in a hood** — the one action that
reaches a concealed person. The row reads "a young man" and its value is
`hood:<token>` rather than `character:<id>`; `PROXYING.md` §5 has the rule and
the handle. Transfer also sits on a hood's row in the HERE column now, beside
Converse and Add, because the dropdown used to be the only way to find it.

Two things specific to this dialog. The recipient list is **one `whosHere()`
call**, named people and hoods together, and not `peopleHere()` plus
`whosHere()`: those split on different things — the `concealed` column versus
what is actually over the face — so a character in a sack was offered twice,
the second time under their real name. And the receiving DM names the giver
the same way the room line above does: "Ada handed you …", or "A young man
handed you …" from a hood.

The two older actions, `transferTagRequest` and `transferResourcesRequest`,
still exist for their `LOOT` direction and for anything else that calls them.

## 8. The Storage button

Every Room's starter post carries **Storage**, and beside it **Search**
([`SEARCH.md`](SEARCH.md) §9). Storage is
(`db/lib/roomStarterRow.js`, `room:storage:{roomId}`, hashed into
`Room.postHash` with the body so existing threads get it on the next
Discord mirror run and never again). `bot/src/lib/roomStorage.js` answers it,
ephemeral, to anyone standing in the room's Location, in Bascinet's format:

```
-# 15 ⬢ | **Tags**: Graga Sac ×3, Lantern, Cart
-# Nothing is stored here.
```

Reading is free; moving things is the web's Transfer. A Discord select menu
caps at 25 options, which is why there is no native deposit/withdraw flow.

**`/storage` reads every stash at once** (`handleStorageCommand`, same file):
one block per Room the character can see where they stand — public Rooms, and
private ones their keys, a guest row or a quest open — in the same format,
closing on a line that says moving things is Transfer, on the web. It works
from a DM, which is the point: the button is on each Room's first post, and on
a phone finding the thread and scrolling to its top is most of the effort.
Both the button and the command are open out of session, since reading is not
an act (`SESSIONS.md` §5).

**Taking things out of a stash is From: the room, To: yourself.** You are in
your own "To" list — that is the whole of looting a room, and the dialog left
it out for a while, which made every stash in the game a one-way drop.

## 9. Where the code lives

| Piece | File |
|---|---|
| Math, `settleCarry`, `deliverCarryDrop` | `db/lib/carry.js` |
| Turn-close pass | `db/lib/carryPass.js`, wired in `db/index.js` (`TURN_PASSES` `"carry"`) |
| Random public room, manifest and Storage formatting | `db/lib/roomStash.js` |
| Aliased room line | `db/lib/roomAnnounce.js` (+ `aliasSubject` in `db/lib/concealedIdentity.js`) |
| Room stack writes | `db/lib/tagWrites.js#addToRoomStack` / `dropRoomTag` |
| `room:` party, balance table | `db/lib/parties.js`, `db/lib/resourceTransfer.js` |
| Reach | `web/lib/transferReach.js` |
| Corpses in reach (same rule) | `db/lib/corpses.js` (`CORPSES.md`) |
| Post-commit tail | `web/lib/afterInventoryChange.js` |
| Merged action | `web/app/(app)/character/requestActions.js#transferRequest` |
| Undo, party-shaped moves | `web/lib/tagEffects.js#takeTagFrom` / `giveTagTo` |
| Dialog, grid, readout | `components/actions/MoveThingsDialog.js`, `StackRow.js`, `ActionGrid.js`, `LedgerBand.js` |
| `{carry:slug}` | `web/lib/referenceData.js#getCarryReference`, `CarryProvider.js`, `RichText.js`, `ChipText.js` |
| Free travel, travel gate | `db/lib/locationTravel.js#performLocationMove`, `freeZoneMoves`, `freeMovesLeft` |
| Mounts: what counts while equipped | `db/lib/mounts.js` |
| Dismounting on a narrow way | `db/lib/indoors.js`, `db/lib/locationTravel.js`, `db/lib/locationMove.js` |
| Storage button | `db/lib/roomStarterRow.js`, `db/lib/syncZones.js`, `bot/src/lib/roomStorage.js` |
| Caps on `/gm/dev` | `web/app/(desk)/gm/dev/page.js`, `web/app/(app)/gm/dev/actions.js` |
| Constants | `OVERBURDENED_SLUG` in `db/lib/constants.js` |
| Load watermark | `Character.carryWeightSeen` |
| ⬢ as a stack | `db/lib/resourceStack.js`; `resources` in `docs/tags.yaml` |
| Weight bands | `weight:` in `docs/tags.yaml`; `Tag.weightLbs` |

## Crates

A crate weighs **half what is in it**, rounded up, never under 1 lb
(`db/lib/depotCrates.js#crateWeight`). That is the whole point of packing
something, and it is why a wagon of Squeeze reaches the Depot at all
(`FACTORY.md` §5). It was a flat 15 lb until 9/2026, which made a crate of obols
heavier than the obols and a crate of armour lighter than one piece of it.

Two things make crates now, on one arithmetic:

- **A Depot shipment** lands as several, split by `splitIntoCrates`.
- **The Package button**, from anywhere with Packaging Equipment in reach: up to
  150 lb of what you are carrying, plus a line you type yourself, which is
  **not** checked against the contents.

Both are runtime `Tag` rows, `custom: true`. They are ordinary cargo for every
purpose here: they count against the cap, they can be transferred, stashed and
stolen. Opening one replaces its weight with whatever was inside, which is
always heavier. A player-packed crate is an ordinary `consumable`, so the
Consume button opens it; the Depot's own sealed ones want the keycard and the
`/depot` panel.

Obols are the other end of the ladder: `weight: 0`, the Negligible band, the
same as a key or a letter. Compressing ⬢ into something you can actually carry
is most of the point of them. See `docs/systemdocs/DEPOT.md` §0e and §0g.
