# The Caves: the Caving Die and its loot

The Depths' one piece of automatic mechanics. **Bascinet's `Caving.docx` is the
design** for when the die rolls, what a failed roll holds you to, the turn lock
into the caves, and how the Caving tab shows results (§2, §5); where this doc
and that one ever disagree, the design doc wins. Companion to `MAP.md` (zones
and travel), `TURN-ENGINE.md` (where this hooks into a turn advance),
`REQUESTS.md` (the apply-first-review-after pattern a loot find reuses),
`ADJUDICATION.md` (the `/gm/turns` desk this adds a third lens to) and
`TAGS.md` (the catalog fields `sellable`/`sellablePrice`/
`consumesIntoResources`/`consumesIntoOneOf` live in).

## 1. The two levels

`docs/zones.yaml`'s `underground` entry is a `kind: group` row — a GM seat and
a Discord category, never a place a character can stand — whose `levels:` list
is flattened by the sync into two real, standable `CAVE_LEVEL` zones: **Caves**
and **Depths** (`caves` / `depths`). Each is its own zone with its own
Locations, joined by ordinary zone-crossing edges in `docs/zones.yaml`'s
`connections:` — so they need no special cost rule. Going from the surface to
the Caves to the Depths costs a separate turn each, mount or no.

The kinds are kept, rather than promoting both to surface zones, because the
Die fires on a `CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP`
above it. Sharing `underground` as that parent also means the two share one GM
seat, which is what the old Caves seat already did across three levels.

The Bascinet 2 map replaced the old three levels — Caverns, Railroad and
Aberrant Pits, with their Customs, Station and Chrome City — with this pair.
Caves keeps Customs and gains the **Depot** as a Location of its own; the
Station and Chrome City are retired, their prose kept in a comment at the
bottom of `docs/zones.yaml`.

**A public declaration underground lands in every room.** Neither level has a
`#summary` — that is what "no channels of its own" means — so a GM's staged
public declaration for the Caves or the Depths posts into **every Location
channel in that level** instead, full size and word for word, one `Delivery` row
per channel (`db/lib/publicPostTargets.js`, `ADJUDICATION.md` §1). It is a blunt
answer and deliberately so: there is nowhere else down here for it to go, and
before this the declaration was simply marked "no summary channel configured"
and no player ever read it. One consequence to know when writing one: everybody
on the level reads it wherever they are standing, so word it as news travelling
the caves rather than as something happening in the room.

The public **Caving** document (`docs/documents.yaml`, key `caving`) is the
player-facing brief — what the levels are, what to bring, and that the die
exists. `Role.docElements` grants it to `migrant` and `mercenary`, and it's
public so anyone else can find it too.

**The Caving *skill* is a different thing entirely.** `caving` (3 points) opens
the four hidden crawls between the caves and the surface (`MAP.md` §2a). It has
no effect on the Die, and the Die does not care whether you have it — one is a
key, the other is what the dark does to you regardless.

## 2. The Caving Die

**Walking is what wakes the dark.** The Die rolls when a character *arrives* on
a Location in a `CAVE_LEVEL` zone, and at no other moment — a flat `1d6`, no
Gambit modifier, rolled by `db/lib/cavingPass.js#rollCaving(prisma, character,
turn, location, trigger)` and written to a `CavingRoll` row. Going deeper rolls.
Retreating rolls. Standing still does nothing at all. Caving.docx puts it the
same way: rolls happen "only ... when moving into a caves/depths location",
never at the start of a turn and never on the way from a cave up to the
surface — that arrival is on the surface, so the gate below never fires.

There used to be a second trigger — `runCavingPass`, a turn-start sweep over
every `ALIVE` character already underground — and it is **gone**. It punished
the one thing a cave ought to reward, which is not moving: a party camped in a
dead end paid the same 1-in-6 as a party pushing into new tunnels, so there was
never a reason to stop. The arrival roll was a *bonus* on top of it; now it is
the whole rule. `CavingTrigger.TURN_START` stays in the Postgres enum rather
than being dropped, the same posture every other retired enum value in this
codebase gets — nothing writes it any more.

**`rollCavingOnArrival(prisma, character, location)`** owns the whole gate.
Three ways it quietly returns `null`:

- the Location's zone is not a `CAVE_LEVEL`;
- there is no `OPEN` turn (mid-restart);
- anything at all threw.

It sends nothing itself; the DM comes back for the caller's own side-effect
half, the same split `performLocationMove` already uses for the zone-role swap.
Three callers:

- `db/lib/locationTravel.js#performLocationMove` — player travel, including a
  first placement and a mount's second crossing, which is just a second pass
  through the same function. Rolls for the mover and every dragged character;
  the DM(s) ride back on `moved[].cavingDm`.
- The Dev Panel's zone edit and **Bulk Move** — the raw GM relocations. They
  roll too, on purpose: being *dropped* into the Depths by a GM used to be the
  one free walk in, which is exactly how the die first looked broken. Both send
  the DM plainly rather than through `notifyCharacter()`, since the die is the
  game speaking, not the GM.
- The staged **"Relocate to"** on `/gm/turns`, which calls it from
  `db/index.js`'s side-effect half rather than from the staging code — it could
  not run inside `applyOneStagedEffect`, because `rollCaving` opens its own
  transaction and that function is already in one. Out in the side effects the
  write has committed, and it is where every other staged DM goes out from.
  It has to happen somewhere: the turn-start pass used to sweep up anyone a GM
  had dropped underground, and without this a staged relocation into the Depths
  would roll nothing at all until the character walked.

### 2a. There is no safe ground any more

`Location.attributes.safe` used to exempt a Location from the Die, and Customs
and the Depot were the only two that wore it. Both are gone: the attribute was
deleted from the registry outright, and with it the one line in
`cavingPass.js` that read it. **Underground is the whole gate now** — every
`CAVE_LEVEL` arrival rolls, with no exception anywhere on the map.

It went with the watchtower. Customs was a sentry, a floodlight and a campfire,
and nothing stalked a place that busy; the Entrance that replaced it is a dark
cave mouth where a few people are dying, and its one room says so out loud —
*"It's not safe here."* An exemption that survived the fiction justifying it
would have been the map telling a player the opposite of the prose.

The cost is real and was accepted deliberately: the Entrance is where every
migrant lands (`docs/roles.yaml`), so a 1 on somebody's first step into the
game is now possible. That is the first impression the Entrance is meant to
make.

**One consequence worth stating plainly.** Same-zone travel is free, so a caver
who walks the level rolls once per step where the old turn-start pass rolled
once per day. Camping is free and exploring is expensive — which is the design,
but it is a large increase in TROUBLE for anyone actually moving, and the GM
load on the Caving lens rises with it. §2b is the other half of that arithmetic:
there is no ceiling on the steps.

### 2b. Every arrival rolls

**There is no cap.** Walk from one cave into the next and each rolls; walk
*back* through the four rooms you came in by and each of those rolls again.
First visit or fifth, the die does not care. A multi-hop **walk** across a cave
level (`MAP.md` §3c) is no exception and needs none: it is the single-hop move
repeated, so every stop on the road rolls, for the walker and for everyone they
are carrying.

It used to care. `CavingRoll.@@unique([characterId, turnId, trigger,
locationId])` capped it at one roll per Location per turn, and `rollCaving`
swallowed the repeat's `P2002` as "already rolled". The argument was
anti-pacing: make the Die a cost of *exploration* rather than a slot machine
you feed by walking in and out of a doorway. What it actually produced was a
caver backtracking out of the Depths through four rooms of known monsters in
total silence, which reads as a broken die and not as a rule — nothing on the
way in tells you the way out is free. The index is dropped
(`20260914010000_caving_every_arrival`) and the P2002 branch is gone with it;
a P2002 out of `rollCaving` would now be a real bug.

**What replaced the brake: a ceiling on the 1s, not on the rolling.** The
only thing rationing rolls is `GameConfig.locationMoveCooldownSeconds` — the
wait between two walks inside one zone, **30 seconds** by default (it was 3
until 2026-09-24). So a player standing between two adjacent cave rooms can
roll twice a minute: a loot faucet, a `CAVE_TROUBLE` mood drain (`MOOD.md`),
and a supply of unresolved `TROUBLE` rows on the Caving lens. What bounds all three is §2e — the tenth 1
of the turn (severity 10) stops them walking at all, and nothing rolls for somebody who is
not walking. Between the two, the cooldown is still the lever a GM has on
`/gm/dev`: a cave step can be priced at a minute without anybody touching
code.

The public brief has always described it this way, incidentally: "each
movement from a location to another within the caves has a chance to trigger
an encounter", and "hunkering down in a single location reduces your chances"
(`docs/documents.yaml`, key `caving`). Only now is that exactly true.

`CavingRoll.locationId` is nullable only because the rows written before the
Die became arrival-only have none; every new row sets it. It gates nothing —
it is what lets the lens say *where*.

### 2c. A 1 keeps you underground

Caving.docx: *"Having failed caving rolls awaiting the turn push prevent a
character from moving from a cave/depths location to an aboveground
location."*

**Any `TROUBLE` row on the open turn stops the caver going up to the surface
until the push.** Until this existed the row waited for a GM and the caver did
not wait with it — they walked out of the Depths, and a GM ended up
adjudicating a monster in the dark for somebody standing in Town.

**It takes the way UP and nothing else.** The Caves and the Depths stay open to
each other, and so does every room on a level, so a party can regroup, camp or
push deeper while they wait. An intercept is a hand on your shoulder; this is a
locked door at the top of the stairs. It used to shut every way out of the
*zone* the 1 was rolled in — which also shut the stairs between the Caves and
the Depths, and let a 1 rolled in the Caves be walked away from by stepping
down a level. Neither was the design. The zone is gone from the rule both ways:
a 1 anywhere underground counts wherever underground the caver now stands.

The hold ends with the **turn**, not with the roll being resolved. A GM's
**Mark resolved** says the encounter has been decided; what was decided — the
staged effect, message or death wired to the roll — only reaches the caver at
the push. When the hold was keyed on `resolvedAt` instead, a caver was free the
moment the GM finished deciding and hours before the bite landed, so the
consequences of a 1 in the Caves arrived on somebody standing in the Forest.
The push closes the turn, so the hold can never outlive it either: a 1 nobody
adjudicates lifts on its own at the push, with nothing to sweep.

`cavingRestrictionsFor(prisma, characterId, standingZoneKind)`
(`db/lib/cavingPass.js`) is the one predicate, and `cavingRefusalFor(restrictions,
intoZoneKind)` turns its answer into a refusal for one move. It is the Caving
twin of `heldReasonFor` (`INTERCEPT.md`) and deliberately not the same thing:

- **It is a query, not a comparison.** The answer lives in `CavingRoll`
  (`kind: TROUBLE`, on the turn that is still `OPEN`, any zone) and nowhere on
  `Character`, so unlike a hold it costs a lookup.
- **It is only asked of somebody standing underground.** On the surface it
  answers nothing without a query. So a GM who relocates somebody out of the
  caves has not also stranded them wherever they land — the rule is about
  leaving the caves, and they have left.

Five gates read it, and all five are player paths:

| Where | What it does |
|---|---|
| `db/lib/locationTravel.js#performLocationMove` | The authoritative refusal, for a hop from a cave level to anywhere that is not one |
| the same function's escort loop | A held follower is detached and left standing, `leftBehind` reason `caving` |
| `db/lib/locationGraph.js#resolveNeighbors` | Draws every way up to the surface **shut** with the same sentence, so no picker offers a hop the mover will refuse |
| the Stepstone (`db/lib/verbs/self.js#stepstone`) | The stone only lands on the SURFACE, so from underground it is exactly this way up |
| Bat Form (`db/lib/batForm.js`) | Flight crosses no link, so it is refused outright while held — even a flight inside the caves, since it never rolls the Die |

Every GM path is untouched on purpose — the Dev Panel's Teleport and Bulk
Move and the staged **Relocate to** never call `performLocationMove`, and a GM
moving somebody is the adjudication, not an escape from it. The Rite of
Summoning (`db/lib/riteEffects.js`) is untouched too, for the reason it
already ignores `heldUntil`: it is somebody else's act on the character, not a
walk.

**Mark resolved does not free anyone.** It is the desk's word for "decided",
and the Caving lens' "Needs attention" status is the list of results a GM has
not decided yet — not the list of people who cannot leave, which is everybody
with a 1 on the open turn. A GM who does want somebody out early has the Dev
Panel's Teleport, which ignores the hold by design.

### 2d. The push lets go of what nobody adjudicated

Caving.docx: *"Unresolved caving outcomes are resolved automatically at the
turn push, with whatever was staged in them being pushed."*

**The staged half needs nothing of its own.** The staged push
(`db/lib/stagedPush.js`) delivers every staged effect and message on the turn,
wired to a caving result or not, resolved or not — a GM who staged a bite and
never pressed Mark resolved still lands the bite.

**A `TROUBLE` roll still unresolved after that is resolved by the push**
(`db/lib/cavingPass.js#releaseUnresolvedCavingRolls`, run from `db/index.js`
after the staged push). This is the desk's bookkeeping, not the hold's: §2c's
hold ends with the turn whether or not anyone resolved the roll. But the Caving
lens goes **read-only** on a past turn (`ADJUDICATION.md` §3), so a roll nobody
reached would otherwise sit under "Needs attention" forever with nobody able to
reach it. History caving stays read-only; this is the release valve instead.

What it writes: `resolvedAt`, and nothing else. **`resolvedByDiscordUserId`
stays null, and that null is the marker** — a `TROUBLE` row is created
unresolved and the only hand that resolves one always writes an id, so resolved
with no resolver can only mean the push. `gmNotes` is untouched: the game has
nothing to say about a monster it never adjudicated. The Caving lens reads the
same rule and prints *"Resolved automatically at the push"*, so a GM reading
back a past turn is never told a colleague handled something nobody did.

A GM resolving the same roll at the same instant is not overwritten and not
double-counted: the pass re-reads only the rows its own update actually
changed (`resolvedAt` set, `resolvedByDiscordUserId` still null) before
naming names, so a roll the GM reached first is left with the GM's resolver
id and never shows up as the push's doing.

One `caving_auto_resolved` audit row per push names every roll and caver it let
go — "who can suddenly walk out of the Caves" being the question that row is
there to answer.

### 2e. Severity 10 and you go nowhere

Caving.docx: *"Having a pending cave result of a severity of 10 inhibits all
movement between locations."* The refusal is the doc's own sentence:
*"You are too worn out to keep going, best to hunker down and prepare for
whatever evil awaits."*

**A caver's tenth 1 of the turn stops them moving at all** — not the next room,
not the surface, not a Stepstone — until the push. Every 1 is a point of
severity on their one result (§5a), wherever underground they rolled it. The
hold in §2c keeps a monster's victim where the monster is; this keeps a loot
farmer from being one. Every arrival rolls and the walk cooldown is the only
brake on the rolling, so before this a caver could pace two rooms all turn,
banking 6s and leaving a queue of unadjudicated 1s behind them for a GM to
invent monsters for.

It is the same query as the hold read at a higher number:
`cavingRestrictionsFor` answers `{ hold, stuck }`, one row is the hold and
`CAVING_TROUBLE_CAP` (10) is the stop. A stuck caver is always also held.
Three things follow from it being the same rows:

- **It ends with the turn**, the way the hold does, and for the same reason —
  the push closes the turn and nothing has to sweep it. Mark resolved does not
  lift it either.
- **It counts every 1 on the turn**, the Caves and the Depths together, since
  the design counts the result's severity and not a zone's.
- **It only binds somebody standing underground** (Bascinet, 2026-09-27). A GM
  who teleports a stuck caver up to Town has made the ruling, and they are free
  to move there. On the surface nothing is asked at all.

The DM for the tenth 1 says so in the same breath as the roll — *"Caving Die:
1 — Something is wrong down here. A GM has been notified. You are too worn out
to keep going, best to hunker down and prepare for whatever evil awaits."* —
counted inside the roll's own transaction, so the DM that says it is written by
the roll that made it ten.

Five gates read it, one more than the hold, because a walk inside a level is
something the stop refuses:

| Where | What it does |
|---|---|
| `db/lib/locationTravel.js#performLocationMove` | The authoritative refusal — every hop, the next room included |
| the same function's escort loop | A stuck follower is detached and left standing, the same `leftBehind` reason `caving` a held one gets |
| `db/lib/locationGraph.js#resolveNeighbors` | Draws **every** way shut with the stop's sentence, where the hold shuts only the ways up |
| `db/lib/locationGraph.js#routesWithinZone` | No walk at all — asked once, up front, the way a hold is; the hold itself is not asked here, since a walk never leaves its level |
| the Stepstone and Bat Form | Refused in the stop's words before the hold's |

The GM paths stay untouched, exactly as in §2c: Teleport, Bulk Move and the
staged **Relocate to** are the adjudication, and a GM moving a stuck caver is
the one way they move before the push. There is no switch for the number;
ten is `CAVING_TROUBLE_CAP` in `db/lib/cavingPass.js`.

### 2f. No walking into the caves in the turn lock

Caving.docx: *"Characters are not allowed to move into caves/depths locations
when the turn is locked to give the GMs time to adjudicate all failed rolls."*
The refusal is the doc's own sentence: *"It is too close to the turn push, wait
till next turn to move in the caves."*

The lock already shuts **all** travel (Combat Overhaul.docx,
`db/lib/turnGate.js#travelLockReason`, `ATTACK.md`), so the caves are closed in
the lock with or without this rule. What this adds is the sentence: a way whose
far end is a `CAVE_LEVEL` Location is refused with the caving line, and every
other way keeps the plain *"Moves are locked for this turn…"*.
`travelLockReason(db, { intoZoneKind })` picks it for the mover, and
`lockedTravelSentence(kind)` for a picker drawing many ways off one answer.

The refusal is said where the move is refused — the way drawn shut in the web
picker and on the map, the server's refusal, and the bot's ephemeral reply —
and never as a separate DM (Bascinet, 2026-09-27), the way every other travel
refusal already works.

### What each face means

| Die | Kind | What happens |
|---|---|---|
| 1 | `TROUBLE` | Nothing auto-applies. The row lands **unresolved** on the Caving lens for a GM to adjudicate — monsters are a GM call, briefed by the GM-only `cavingmonsters` document (`documents.yaml`). The player gets one short DM immediately: *"Caving Die: 1 — Something is wrong down here. A GM has been notified."* The caver also takes −10 mood, tripled by Teratophobia (`MOOD.md`), **and cannot go up to the surface until the turn ends** (§2c). Each 1 adds one to the severity of the caver's one result for the turn (§5a). |
| 2–5 | `QUIET` | Stamped resolved at creation. No GM attention — the row exists as a record, hidden from the Caving lens until a GM ticks **Show other rolls** (§5). The player still gets one line: *"Caving Die: 3 — Nothing happens."* |
| 6 | `FIND` | Draws a loot tier and a tag (below), grants it, and DMs the player what they found. Also resolved at creation — the grant already landed. A **non-stackable** tag the caver already holds goes into a room instead (§2g). |

Every DM leads with the face — *"Caving Die: 6 — You found something: Padded
Armor."* — so a player reads their own roll and not just its outcome. A
`QUIET` used to send nothing, but players could not tell a quiet roll from
a die that never rolled, so it now says so in one line.

### 2g. A second of something that does not stack

A non-stackable tag is one row on the sheet, so granting a second copy does
nothing — and a find of one the caver already held used to vanish, with the DM
still saying *"You found something"*. Now a **tradeable** one is left in a
room: `rollCaving` picks one at random from the rooms at the Location the
caver just walked into that they can get into — the same `accessibleRooms()` every
door reads, so a key or the worn ring's tokens count, never a retired room and
never one that destroys what is put in it. The tag goes onto that room's stash,
not stamped as left on the floor, so it does not sink. The DM says so:
*"Caving Die: 6 — You found something: Mining Helmet. You already have one,
so you leave it in Old Mineshaft."*

`CavingRoll.lootAlreadyHeld` marks the roll, `CavingRoll.lootRoomId` records
the room, and the audit row's `roomId` / `roomName` say the same. Every cave Location has a public room, so there is
always somewhere; if a map edit ever left one with none, the find goes the old
way and is lost.

A doubled tag that is **not** tradeable — Smithing (Gunpowder), Convoy
Directions — is not put in a room, because nobody could take it back out
(Transfer refuses anything that cannot change hands). Nothing changes, as
before, and the DM now says so: *"… You found something: Convoy Directions.
You already have it."* The same line is sent in the no-room case above, and
the Caving lens offers no Undo for either, since nothing was added.

## 3. The loot table

`db/lib/cavingLoot.js` — **code, not YAML**, because this is mechanics (a
weighted draw), not player-facing catalog data the way a tag's price is. A
`FIND` draws in two stages: a tier by the standing zone's column below, then
a slug uniformly within that tier.

**This file holds TWO tables now.** The prospecting loot table
(`PROSPECTING_TABLE` / `PROSPECTING_WEIGHTS_BY_ZONE`) moved in beside the Caving
Die's on 2026-09-18, replacing a whole YAML-driven subsystem — see
[`MINING.md`](MINING.md) §3b. They share the six tier names, the zone-column
shape, `drawFrom`, and `validateCavingLoot`, which checks both tables' slugs
and both weight maps at startup.

They do **not** share numbers, and should not be unified. A cave arrival and a
day at the seam are different events, and the Depths being generous to a caver
says nothing about what a pick turns up there. The one behavioural difference:
`drawLoot` THROWS on a zone with no column (cavingPass only calls it after
establishing a CAVE_LEVEL, so that would be a bug), while
`drawProspectingLoot` returns null (the Black Hills are minable and hold no
stones, which is ordinary).

| Tier | Caves | Depths |
|---|---|---|
| Ultracommon | 65% | 15% |
| Common | 25% | 22% |
| Uncommon | 8% | 28% |
| Rare | 1.95% | 25% |
| Extremely rare | 0% | 7% |
| Nearly impossible | 0.05% | 3% |

Each column sums to 1, asserted by `validateCavingLoot()` at startup. The Caves
is where ultracommon loot dominates — that's where people go to farm
`{tag:cave-fungus}` — while Nearly Impossible barely exists there (a fixed
0.05%) and grows to 3% in the Depths; that top tier is meant to come mostly
from GM-run quests, not the die.

**Quests are hand-placed, and the public document now promises them by that
name.** Nothing spawns one — there is no schedule, no table, no
`LocationEvent`, and no GM tool. A Quest exists because a GM put it somewhere
and told people. The player brief says they "randomly appear in cave
locations", so if nobody places any, the caves are the die and nothing else.
This is the deliberate arrangement, not an omission: the top loot tier is meant
to be authored, not rolled.

The Depths took the **old Aberrant Pits column unchanged**, rather than the
middle Railroad one, because it is now the only deep place on the map and has
to carry what all three tiers below the surface used to.

`LOOT_TABLE`'s contents, by tier — see the file for the exact slug lists;
weapon/armor entries pull representative slugs off `SMITHING.md` §3/§4's
ladder rather than every entry in it:

- **Ultracommon** — Cave Fungus, Saltpeter, Purring Maggot, Rock.
- **Common** — Cudgel, Purse, Cracked Bone Club, Sling, Skinned Cave Rat, Old
  Coin, Coal.
- **Uncommon** — Alcohol, Cleaning Powder, Fine Meal, Bear Trap, Rope, Honey,
  Buckler, Spear, Work Knife, Knuckle Duster, plus low-tier weapons and armor.
- **Rare** — Ravenheart Red, Cat, Salvage Plate, Supply Kit, Jewelry, Bliss,
  Gas Mask, Instrument, Mining Helmet, plus mid-tier weapons and
  armor.
- **Extremely rare** — EMP Grenade, refined gunpowder, Skeleton Wedge,
  Jester Outfit, Starting Wares, Military Autoinjector, Autocannon Shell,
  Fragmentation Grenade, Neoclassic Duelista, plus top-tier weapons and armor.
- **Nearly impossible** — Energy Shield, Power Fist, the Neoclassic
  Revolver, Stepstone, Dark-Eye Lenses, Motorcycle.

`validateCavingLoot(prisma)` checks every table slug against the live Tag
catalog and every column's weights sum to 1, and throws loud if not — call it
once at process startup, not per roll, so a typo in the table fails the
deploy instead of handing a player nothing on the one 6 they rolled all
week.

Smoke test one loot draw from a scratch character with
`db/lib/cavingPass.js#rollCaving` directly rather than walking a real character
into a real cave — see the file's own comment for the cleanup order (delete the Request
before the character; `CavingRoll`/`CharacterTag` cascade).

## 4. A FIND is a Request

The grant goes through the same apply-first-review-after machinery every
player action uses (`REQUESTS.md`), just system-filed instead of
player-initiated: `rollCaving` grants the tag and writes the `CavingRoll` row
and an audit line in the same transaction as the grant — a roll can never
exist without its loot, or the reverse.

Taking a find back lives **on the Caving lens and nowhere else**, which is
what the loot is: a caving correction belongs in the caving log, not in a
general review queue. `undoCavingFind({ rollId })`
(`web/app/(desk)/gm/turns/actions.js`) drops the granted tag and stamps
`CavingRoll.lootUndoneAt`. A find left in a room (§2g) comes back out of that
room, never off the caver's own copy, and the Undo refuses if somebody has
already picked it up. The roll itself stands — a GM is undoing the loot,
not the die.

The stamp is the claim, not a flag read beforehand: the update matches only
while `lootUndoneAt` is still null, so two clicks drop exactly one tag. The
roll already carries `lootTagId` and `lootTagName`, so nothing else has to be
looked up — this used to point at a `CAVING_LOOT` Request and go through the
shared undo handler, until player actions stopped filing Requests at all
(`REQUESTS.md` §1).

## 5. The Caving lens

A third lens on `/gm/turns`, next to Moves and Requests
(`web/app/(desk)/gm/turns/QueueRail.js`), keyed `c` alongside `m`/`r`.

**Only failures show by default** (Caving.docx: *"Caving results which were not
failures are hidden from the caving adjudication tab for GMs by default but can
be seen again with a toggle."*). The 2–5s and the finds are behind a **Show N
other rolls** box beside the search, the same shape as the Moves lens' "Show N
travel" — a hundred players in the Depths would otherwise put a hundred quiet
rolls in front of a GM every day. One switch covers the open turn and History,
remembered with the rest of the rail's view (`showCavingOthers`, session
storage). Unresolved results rank first, and the Status filter still narrows to
"Needs attention" or "Resolved". When everything matching is hidden, the empty
line says how many other rolls the box would bring back.

Rows show the die face, the kind, the character, the zone, and — for a `FIND`
— the tier and what was found. A caver's `TROUBLE` rows on the turn are ONE
row (§5a), which says its severity — *"Severity 3"*, and *"Severity 1"* for a
lone 1 — and at 10 (§2e) wears a **Stuck** pill, with the desk header saying so
in a sentence. The pill and the sentence are for the open turn only: History
keeps the severity but drops both, since that turn's push already let the caver
go. The
fold is `foldCavingRolls` in `web/lib/cavingLabels.js`, recomputed from the rows the desk already holds
rather than fetched, so the live stream keeps it current; that module carries
its own copy of `CAVING_TROUBLE_CAP`, since `cavingPass.js` cannot reach a
client bundle, and `db/test/cavingTally.test.js` fails if the two disagree.
The kind's label comes from
`CAVING_KIND_LABELS` in `web/lib/cavingLabels.js`, shared by the rail's DTO
and the desk header; it lives in its own module because when the desk owned
the only copy, the rail printed every row's kind as "undefined" for months.

### 5a. A caver's failed rolls are one result

Caving.docx: *"A character's failed caving rolls should be aggregated into a
singular outcome for GMs to resolve. Each time a character fails a roll, it
contributes +1 to the severity of the caving result, this number is displayed
on each characters caving result in the caving tab of the adjudication page."*
Combat Mode.docx adds that the snapshot a GM adjudicates it from is the one
taken at the **most recent** failed roll.

**The rows stay as they are.** Every 1 is still its own `CavingRoll`, because
the hold, the severity-10 stop and the push's release all count rows
(§2c–§2e). The folding happens on the desk:
`web/lib/cavingLabels.js#foldCavingRolls` turns every `TROUBLE` row one
character rolled on one turn — in the Caves, the Depths or both — into **one
row on the rail and one desk**, whose severity is how many there were
(`severityLabel`). It used to fold per zone, which split a caver who rolled 1s
on both levels into two results; the design says one.

- **Keyed by the oldest roll.** The id never changes while the caver keeps
  failing, so a GM's selection and keyboard cursor hold. The Result box and
  everything staged on the desk hang off that one id. A link to any later roll
  opens its group (`groupOf`).
- **Shows the newest roll** — its die, its room, its zone, its time — and its
  severity ("Severity 3").
- **Needs attention while any 1 in it does.** A fresh failure after a GM marked
  the group resolved reopens it, and the rail and desk say how many are new.
- **Save and Mark resolved act on the group**, worked out on the server from
  the roll (`db/lib/cavingPass.js#troubleGroupWhere`), never from ids the desk
  sent. Resolve stamps every unresolved member. The audit row lists them all.
- The desk header's "Caving to answer" counts results, not rolls.

**The snapshot.** Every `TROUBLE` row stores the caver as they stood at that 1,
in `CavingRoll.presentedState` — the same shape a chat line freezes
(`db/lib/examineSnapshot.js`): tags with their equipped flags, and whether they
were in combat mode (`COMBAT-MODE.md`). The desk's **At their last failed roll**
panel reads the newest one that has a snapshot (`getCavingSnapshot` in
`web/app/(desk)/gm/turns/actions.js`): combat mode on or off, the Combat tile,
what they were wearing and their health tags. The tags are read against the
live catalog, the snapshot rule everywhere. A roll from before this has no
snapshot, and the panel says so.

`CavingDesk.js` (modeled on `MoveDesk.js`, much thinner) is where a GM
narrates a `TROUBLE` roll. It carries the same **Result** box and **Stage as
message** bridge the Move desk has: the box is the GM-facing canon of what
happened, and Stage as message promotes it into a real DM to the roll's own
character (a `StagedMessage` wired to `cavingRollId`, delivered at the push
like any other). The Result box is *not* itself the thing the player receives
— Save and Mark resolved only store the notes, so narration left in the box
alone never reaches anyone. That gap is exactly why caving-desk
messages used to go missing: the desk had the notes box but no Stage-as-message
button, so a GM working "the same as a Move" had no send step. Alongside it are
the same `EffectComposer` / `RoomEffectComposer` / `DeathComposer` /
`MessageComposer` / `PublicComposer` set every desk uses (wired to
`cavingRollId` instead of `moveId` — both `StagedMessage` and `StagedEffect`
carry the column, `SetNull` on delete same as `moveId`), and
a **Save** and a **Mark resolved** button. No cooperative lock like a Move — two GMs opening
the same roll can't race a solve that pays anyone twice, since resolving is a
one-way stamp with nothing to apply.

**Save is always there, resolved or not**, and it writes the Result box without
touching the roll's status or who resolved it. Mark resolved goes away once the
roll is resolved, and for a while it was the only button that ever stored the
notes — so a GM who resolved an encounter and then wanted to fix the Result
typed into a box that still accepted text and silently discarded it. That is the
same trap the Move desk fell into and fixed (`MoveDesk.js:415`); the two now
behave alike. Both buttons are the one server action,
`resolveCavingRoll({ mode })` in `web/app/(desk)/gm/turns/actions.js`, which
audits a save as `caving_roll_saved` and a resolve as `caving_roll_resolved`, so
`/gm/audit` doesn't read as if the roll was resolved five times.

A `FIND` row has nothing to resolve and no Result box, so it opens without
either button: what was found, and the **Undo this find** button described in
§4.

**The History lens reads Caving too.** `/gm/turns`'s History lens carries a
**Moves / Caving** switch beside its Turn picker (`historyKind` on the rail's
sessionStorage). Flip it to Caving and the lens lists that resolved turn's
rolls, mapped by the same `cavingRollRow` (`web/lib/moveRows.js`) the open turn
uses. Opening one shows `CavingDesk` in **read-only** mode — no composers, no
Mark resolved, the Result box disabled — but its staged rows still show, and an
unapplied one stays editable, the same rule `MoveHistoryDesk` follows. No Save
there either — a pushed turn's narration is settled. A
`/gm/turns/caving/<id>` link naming a past roll deep-links straight to it
(`page.js`'s `initialCaving`, the Caving twin of `initialHistory`).

## 6. `sellable` / `sellablePrice`

Two `Tag` columns, the seller's half of `purchasable`/`purchasableAfterStart`
— whether the Merchant's Depot will buy a tag off him, and for how many ⬢.
`syncTags.js` requires the two to travel together: `sellable` without a
positive `sellablePrice` is an error, and so is a price set without
`sellable: true`.

This update set them on six tags and left them inert, with no sell flow
reading either. **The Merchant Update built that flow** — `/depot` and the
`DEPOT_SELL` request — and widened the six to about 106, across brews, smithed
gear, bulk goods and salvage. The six originals kept their numbers: Graga Sac
(8), Cave Fungus (3), Saltpeter (3), Jewelry (8), Old Coin (1), Military
Autoinjector (10). See [`DEPOT.md`](DEPOT.md) §4, which is now canonical for
all of it.

Three of the caving artifacts are also on the Depot's *buy* shelf — the
Motorcycle and the Flamethrower, which the station has no trouble sourcing and
Ravenheart has every trouble hauling out of the Caves, and the **Mining
Helmet** (14 ⬢), which is station work rather than forge work: the plates are
a Simple Helm's, the lamp is not. Nothing else on the loot table is purchasable
at any price.

**Two of the new entries are not only loot.** `rock` is seeded by hand into
thirteen rooms across the Caves, the Depths, the Black Hills, the Mountain and
the Headwaters (`docs/zones.yaml`), so the ground is a source and the die is a
bonus. `purring-maggot` is the loot; **`maggot-milk` is not on the table at
all** — it is what a holder of Brewing I makes of one maggot for 1 ⬢, and
it calms exactly as much as tea does (`db/lib/mood.js` `CONSUME_RELIEF`) while
the raw maggot only poisons.

## 7. Two catalog fields this update added

Both documented in full in `schema.prisma`'s `Tag` model comments and read by
`web/lib/consumeGrants.js`; see `TAGS.md` §5b for `consumesInto` itself.

- **`consumesIntoResources`** — the Resources half of consuming a tag.
  `Purse` (consumes into 3 ⬢, no tag) and `Supply Kit` (8 ⬢ plus one
  Alcohol) are the first users. Applied by `consumeTagRequest`
  (`web/app/(app)/character/requestActions.js`) through the ordinary
  `creditResources` primitive, and snapshotted into `Request.effect` so
  `CONSUME_TAG`'s Undo debits it back exactly.
- **`consumesIntoOneOf`** — a parallel array to `consumesInto`, same length
  and order, for an even random pick between alternatives —
  `{ oneOf: [...] }` in `docs/tags.yaml`, the same shape `expiresInto`
  already used. `Skinned Cave Rat` is the first user: 50/50 nothing or
  Vomiting. Nothing is previewed on `/character` — a player clicks Consume in
  the tag's tooltip and finds out — so `resolveConsumeGrants`, which commits
  to one, runs only in the server action.

## 8. The Radio rename

Unrelated to the die itself but shipped in the same update: `radio-system`
and `radio-bracelet` were renamed to `radio-system-watch` /
`radio-bracelet-watch`, both descriptions gaining "Tuned to the Watch's
frequency." `syncTags.js` upserts by slug and never renames, so the old rows
are simply left behind for `db:prune-tags` once nothing holds them.

They were renamed a second time when the Watch became the Cerberon, and are
now `radio-system-cerberon` / `radio-bracelet-cerberon` ("Radio System
(Cerberon)" / "Radio Bracelet (Cerberon)"). Same mechanic, same leftovers.

## 9. Where the code lives

| Concern | File |
|---|---|
| The die | `db/lib/cavingPass.js` |
| The loot table | `db/lib/cavingLoot.js` |
| The one trigger | `db/lib/cavingPass.js#rollCavingOnArrival` |
| The hold a 1 puts on the way up, and the stop at severity 10 | `db/lib/cavingPass.js#cavingRestrictionsFor`, `#cavingRefusalFor` (§2c, §2e) |
| The turn lock's sentence for a way into the caves | `db/lib/turnGate.js#travelLockReason`, `#lockedTravelSentence` (§2f) |
| The trigger's callers | `db/lib/locationTravel.js#performLocationMove` (mover + dragged), the Dev Panel's `teleportCharacterImpl`, `web/app/(app)/gm/dev/actions.js#applyBulkAction` (its Move verb) |
| Arrival DM senders | whichever face's location-move caller runs `performLocationMove` sends `moved[].cavingDm`; the two GM paths send their own |
| Kind labels, the fold, the severity label, the failures-only filter | `web/lib/cavingLabels.js` |
| Loot grant, and taking it back | `db/lib/cavingPass.js`, `web/app/(desk)/gm/turns/actions.js#undoCavingFind` |
| Where a doubled non-stackable find is left | `db/lib/cavingPass.js#roomToLeaveIn` (§2g) |
| Consume mechanics | `web/lib/consumeGrants.js`, `db/lib/syncTags.js` |
| The Caving lens | `web/app/(desk)/gm/turns/QueueRail.js`, `CavingDesk.js` |
| The document | `docs/documents.yaml` (key `caving`) |
| The public brief text | same entry — kept in sync with players by hand |
