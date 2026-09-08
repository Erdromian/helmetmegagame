# Geography and travel

Where characters are and how they move. For the *Discord* side — channel
layout, provisioning, who can see what — see `CHANNELS.md`. This page is the
game side.

## 1. The model

There are two levels now. A **`Zone`** (Town, Fortress, Forest, Black Hills,
Marshes, and the two underground levels Caves and Depths) is a region — a
category, and for a `SURFACE` zone a `#summary` channel. A **`Location`** is
where a character actually **stands**: one text channel under its zone's
category, opened by a **per-member permission overwrite** rather than a role
of its own (`CHANNELS.md` §3 for why).
`Character.locationId` is the authoritative "where is this character"
answer; `Character.zoneId` is a **denormalized mirror** of
`location.zoneId` — every writer of `locationId` writes both, and the
channel doctor's `character-place` check flags a mismatch (`CHANNELS.md`
§6).

`docs/zones.yaml` is the sole master (`SYNC.md` for the sync's destructive
semantics, including the format).

**How a Location is slugged.** A built place takes a bare slug and a bare
name — `keep`, `factory`, `cathedral`, `customs`. Open country takes its zone as
a prefix — `forest-creekside`, `hills-gullies`, `marshes-village`,
`depths-obelisk` — because a ravine and a river are things every zone has one
of, and the slug is also the Discord channel name. The wilderness used to be
numbered instead (`forest-7`, `Depths 3`), with the hand-drawn map's number
buried in the slug and a different one in the display name; the drawing's
number now lives in `map_node:`, which nothing but a person reads. The Black
Hills zone slug is `hills`.

Zones still come in three kinds:

| `kind` | Zones | Standable itself? | Discord |
|---|---|---|---|
| `SURFACE` | Town, Fortress, Forest, Black Hills, Marshes | no — its Locations are | category + `#summary`; each Location its own channel |
| `CAVE_GROUP` | Underground | no | the shared "Underground" category only |
| `CAVE_LEVEL` | Caves, Depths | no — its Locations are | no channels of its own; its Locations parent onto the Underground category |

`Underground` exists only to be that parent. The kinds are kept rather than
promoting Caves and Depths to surface zones because the Caving Die fires on a
`CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP` above it; sharing
one parent also means Caves and Depths share one GM seat, which is what the old
Caves seat already did across three levels. The consequence to know about is
that neither has a `#summary` of its own, so **a gate underground would have
nowhere to announce** — none is drawn there today.

A zone itself is never a place you can stand in any more — only a Location
is. Every presence zone (`SURFACE` or `CAVE_LEVEL`) must list at least one
Location in `docs/zones.yaml`, or the sync throws. `Zone.seatZoneId` still
decides which GM table a row belongs to (`GAMEMASTERS.md` §2); it hasn't
moved, since a Location doesn't need its own seat.

New characters get their starting place from their role: `starting_zone` (and
an optional `starting_location`) in `docs/roles.yaml` resolve to
`Role.startingZoneId` / `Role.startingLocationId`, and `createCharacter`
grants the zone role and the Location role immediately (`CHARACTERS.md` §3).
If a role names no `starting_location`, it's the first Location (by `sort`)
of its `starting_zone`.

### 1a. What a Location is worth

A Location also carries up to three `LocationYield` rows — one per `LaborKind`
(HUNTING / FARMING / FISHING) — authored as a `yield:` block in
`docs/zones.yaml` and drifted every turn. **No row means that labor is
impossible there**, which is why no Location needs a "wilderness" or "water"
boolean anywhere in the schema: the row is the gate. See `LABORING.md`.

### 1b. What else a Location is

Beyond its name and description, a Location carries a sparse map of
**attributes** — `Location.attributes`, a JSON object authored as an
`attributes:` block in `docs/zones.yaml` — and, optionally, a `structures:`
list of the built things that were always standing there (the Square's cross),
seeded as `COMPLETE` `Structure` rows by the zone sync (`SYNC.md` §2):

```yaml
customs:
  name: Customs
  attributes:
    depot: true
```

Two more keys feed the fear dial (`FEAR.md`): `wilderness` marks a Location
where arriving and ending the turn cost fear (every Forest, Black Hills and
Marshes Location except the factory, the farms and the marshes village), and
`haven` marks a Location whose roof gives extra relief at turn close — the
Inn, the Keep and the Sanctuary.

Every key must exist in the registry in `db/lib/locationAttributes.js`, which
is the only module that reads the column. An unknown key is reported as a sync
**problem** rather than dropped, because a typo would otherwise be a place that
quietly never says what it is.

The registry maps each key to the sentence the **Examine** button prints
(`LABORING.md` §9). Systems that own a place should ask `hasAttribute(location,
"depot")` rather than comparing slugs — that is the point of the layer.

Two things are deliberately *not* attributes. `indoors` stays a real column,
because carts and mounts act on it (`db/lib/indoors.js`, `db/lib/mounts.js`)
and a JSON field is not something to query on; Examine merely prints it
alongside the attributes as though it were one. And gate state is never
authored — it is read live off the `LocationLink` rows, since a GM can flip an
edge at any time.

JSON rather than a column per fact because these are sparse, additive prose
triggers. The moment something needs a `where` clause, it wants a column.

## 2. The adjacency graph

`connections:` in `docs/zones.yaml` is the master. Each entry becomes **one
`LocationLink` row** — one row per undirected edge, not a mirrored pair, with
`aId`/`bId` held in ascending Location slug order. That is what makes an
attribute impossible to disagree between the two directions, and a modular gate
impossible to leave open one way and shut the other. The graph is over
Locations, not zones, and spans zones freely.

**Nothing decides passability outside `db/lib/locationGraph.js`.** A few places
read `LocationLink` rows for other reasons — the doctor validates the slugs an
edge names, and the bot's gate and keyed handlers read one row to check
*authority* — but no second implementation of "may this character cross"
exists, and none should. `db/lib/locationGraph.js` is the one
module that knows an edge could have your location on either side:

| Function | Use |
|---|---|
| `linksFor(prisma, locationId)` | every edge touching a location |
| `linkBetween(prisma, a, b)` | the one edge between two locations, either way round |
| `crossingCheck(link, { tagSlugs })` | the pure verdict: `{ listed, passable, refusal }` |
| `canToggleGate(link, { tagSlugs, roleSlug })` | may this character work a modular gate |
| `resolveNeighbors(prisma, character, locationId)` | every destination, gated and sorted |
| `travelOptions(…)` | the same, filtered to what may be *shown* |

`performLocationMove` refuses a hop with no edge — or one the character may not
use — with the verdict `crossingCheck` returns, and refuses standing still with
"You're already there." An unreachable Location is a sync **warning**, not an
error.

### 2a. Typed edges

An edge is not just "you may walk this." Six behaviours, and they **compose** —
the Gatehouse-to-Road edge is a manned gate *and* a modular one at once, which
is why `LocationLink` carries fields rather than one enum.

| Behaviour | Column | Effect |
|---|---|---|
| Open | — | the default |
| Gate | `announce: TRUE_NAME` | posts the crosser's **real name** into the destination zone's `#summary`. `/conceal` does not help: there is a Cerberus here reading papers |
| Unmanned gate | `announce: CONCEALED` | posts only what a passer-by would have seen — "An old woman has entered the Gate" |
| Locked | `requiredTagSlug` | crossing needs the tag, and the way is **listed**, so a player sees the door and learns what opens it |
| Hidden | `requiredTagSlug` + `hidden` | needs the tag **and** is absent from every travel list. Refuses in the same words a nonexistent edge does, deliberately — a different refusal would tell a player the way is there |
| Modular | `modular`, `isOpen`, `openerRoleSlugs`, `openerTagSlugs` | an Open/Close button on the **watchtower** at the gate; impassable while shut |
| Keyed | `keyed`, `openUntil` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — yes and the way ignores its tag and becomes listed until the window lapses |
| On foot | `onFoot` | too tight, steep or enclosed for a horse or a cart. A **mounted** character is dismounted crossing it, same as walking into an indoors Location |

**The winch is in the tower.** A modular gate's Open/Close button renders on
one Room's starter post — the watchtower at that gate — and on neither
endpoint's Location anchor, which is where it used to live. The four rooms are
named in `db/lib/roomStarterRow.js#WATCHTOWER_ROOM_SLUGS`; the row is composed
by `syncZones.js#roomComponents` and redrawn after a flip by
`#refreshGateRooms`, which every caller of `refreshLocationAnchor` also calls.
Two things follow. The tower's `access:` list has to admit everyone the gate's
`modular:` block authorises, or somebody may work a gate they cannot reach —
`canToggleGate` accepts an opener **Role**, but room membership is computed
from held **tags** only. And a tower whose thread is missing renders a flip
nowhere at all, since there is no longer an anchor copy to fall back on; the
sync and the channel doctor are the repair.

Two things about the gating that are easy to get wrong:

- **`listed` is weaker than `passable`.** A locked edge is listed and refuses.
  A hidden one is neither. Any surface that renders a list must filter on
  `listed`; the mover checks `passable`. `travelOptions` does the first for you.
- **The refusal is re-derived server-side, every time.** A picker that dropped
  an option is a hint; `performLocationMove` runs `crossingCheck` again on
  its own — once for the mover and once per follower (§3a) — because a server
  action is a public endpoint and a client can post any location id it likes.
- **A propped-open keyed way satisfies its own tag requirement**, which also
  makes a hidden one listed. That is not a leak, it is the whole feature: a
  door somebody held open has to be visible to the people meant to follow them
  through it.

A gate's **announcement is posted from the Discord half**
(`applyLocationMoveSideEffects`), derived from the edge rather than passed in,
so every writer of `Character.locationId` gets it for free and a GM's teleport
onto a non-adjacent Location announces nothing. It is a plain bot message, not
`postAsCharacter` — a webhook post under the traveller's own name and face
would defeat the whole point of the unmanned form.

### 2b. Keyed ways

A **keyed** way asks the person who just used their key whether to hold it open
behind them. `shouldPromptKeyed` gates that: only a key-holder is asked, because
propping a door is the key-holder's decision and not a courtesy anyone walking
through inherits, and only while the way is shut, so a stream of traffic through
an open one does not re-ask every single person.

The ask is a **DM**, never anything in a channel — a keyed way is usually
secret, and asking in the open would tell the room it exists. The crossing
itself only poses the question; `openUntil` is stamped by the button handler,
so a player who never answers leaves the door shut, which is the safe default.

Nothing closes it again. `isHeldOpen` compares `openUntil` against the clock,
so the window lapses on its own with no pass, no cron and no row to clean up.
`resolveNeighbors` takes one clock reading for a whole list, so a way cannot
lapse halfway down it and render as both open and shut at once.

`db:sync-zones` never rewrites `openUntil`, for the same reason it never
rewrites `isOpen`: both are play state, not authoring.

### 2c. On-foot ways

`onFoot` is the edge-level sibling of `Location.indoors`: same effect
(`db/lib/indoors.js#dismountForNarrowWay`, right beside `parkMountsIndoors`),
earlier moment. Both keep a horse and a cart out of somewhere they do not
fit; `onFoot` used to refuse the crossing outright rather than dismount for
it, on purpose — see the timing note below for why that mattered, and why
dismounting works just as well now.

**Timing is the whole reason it isn't a plain reuse of `parkMountsIndoors`.**
An equipped mount buys one extra free zone-crossing per turn (`freeZoneMoves`,
`db/lib/locationTravel.js`), so dismounting only on arrival — after that
crossing's own cost was already computed — would let a rider bank the bonus
on a ride that never survives the threshold, which made every secret passage
into the Fortress rideable for free. `performLocationMove` dismounts them
*first*, inside its own transaction, before `freeZoneMoves` ever runs, so the
crossing is costed as the walk it actually is. `applyLocationMoveSideEffects`
never repeats the check itself when the caller already has the answer — see
the comment on its `dismounted` parameter.

It is also the one gate that reads what a character has **equipped** rather than
what they hold: `isMounted(equippedSlugs(tags))`, so a horse stowed in a pack is
not a horse you are riding. `resolveNeighbors` therefore loads tags in
equip-shape rather than through `heldTagSlugs`, which returns bare slugs and
would have counted a stowed horse. The refusal is listed rather than hidden,
because unequipping the horse is a fix the traveller can apply on the spot.

The **modular button** is `loc:gate:{linkId}` on the Location anchor
(`db/lib/locationAnchorRow.js#locationGateRow`). Authority is re-checked in the
handler against the edge's opener Roles and tags; the flip is a conditional
`updateMany` carrying the state the clicker saw, so two watchmen clicking at
once means one close and one "somebody just did." Both endpoints' anchors are
reposted, because the gate has a button on each side. **A re-sync never reopens
a gate somebody shut in play** — `modular.open` in the YAML is the value a link
is *born* with, not one the sync re-asserts.

## 3. What a move costs

**`db/lib/locationTravel.js#performLocationMove(prisma, character,
targetLocation, { dragged })`** is the one function both faces call for the
database half of a move. It does **no Discord work** — same split
`advanceTurn()`/`runSideEffects()` uses, and for the same reason: the bot has
a gateway client and the web app only has REST.

**A first placement is free.** A character with no `locationId` yet can land
anywhere, spends nothing, and files no Action — it isn't travel, it's
arrival. The adjacency gate is skipped entirely.

**A hop inside the same zone is free, on a cooldown.**
`GameConfig.locationMoveCooldownSeconds` (default 60, edited on `/gm/dev`)
gates it, enforced by a **conditional `updateMany`** whose `WHERE` clause
*is* the check (`lastLocationMoveAt` null or old enough) — the same shape the
hunger decrement and the mount's daily claim use, so two clicks in one tick
can't both pass. A refusal reports the exact seconds left.

**An Overburdened character can't cross into another zone at all.** Over a
carry cap (`CARRY.md` §2), `performLocationMove` refuses the crossing with a
plain `{ ok: false, reason }` before it opens its transaction; hops inside the
zone stay free so they can walk to a room and stash. Only the mover is gated.

**A hop whose edge crosses into another zone spends a FREE ZONE MOVE first,
and only costs the character's Move once those run out.** Everyone gets
`GameConfig.freeZoneMovesPerTurn` a turn (default 1), an **equipped** mount
adds one, and being Overburdened takes them all away — the full rule lives in
[`CARRY.md`](CARRY.md) §2a. So a peasant walks Town → Forest for nothing,
spends their Move to reach the Fortress, and the way home waits for next turn.

**A crossing that costs the Move only lands NEXT TURN.** It is a day on the
road: the Move is spent the moment the player confirms, but
`Character.locationId` is not written. The destination is parked on
`Character.travelToLocationId` (with `travelTurnId`, the turn it was declared
in), and `db/lib/travelArrivalPass.js` — **last** in `TURN_PASSES` — walks the
traveller and everyone they dragged over at the next advance. That is what
keeps the destination's channels shut for the rest of the turn they left in,
instead of opening under them the second they press Confirm. A **free**
crossing and a same-zone hop are untouched and still instant.

While a journey is pending the character is **frozen where they stood**:
`performLocationMove` refuses every move with "You're on the road to X", and
the Travel button offers nothing at all until the arrival pass walks them
over — there is no turning back (the Turn back control was removed on
2026-09-07). Nothing is announced at departure; the ordinary arrival lines fire next
turn, plus a "You arrive at X" DM. Every raw relocation (a GM teleport, Bulk
Move, the staged "Relocate to") clears the pending destination too, or the
pass would undo the teleport at Dawn, and so does death. Each of them clears
`escortedById` in the same statement (§3a).

Spending the Move is written as a real, auto-resolved `Action`
(`type: MOVE`, `status: CONFIRMED`, `moveReviewStatus: SOLVED`,
`gmNotes: "auto:zone_change"`), landing in `/gm/turns`' Moves history rather
than the pending queue. Its `zoneId` is the **seat** zone of the destination
(`seatZoneIdFor`) — a hop into the Depths files work the Caves GM can see.
A free move files no Action at all. **Acting and crossing on your Move are
mutually exclusive within a turn, in either order** — the enforcement is
`@@unique([characterId, turnId])` on `Action`.

**Mounts.** `horse` and `motorcycle`
(`db/lib/mounts.js#FAST_TRAVEL_SLUGS`) each add one free crossing, **and it refreshes every
turn** rather than once a day — a horse carries you at Dawn and again at Dusk.
They only count while **equipped**, and they are unequipped for you at the door
of any indoors Location (`CARRY.md` §3).

The allowance is tracked on `Character.zoneMovesTurnId` / `zoneMovesUsed`,
claimed by a conditional `updateMany` whose WHERE is the check, so two tabs
cannot both spend the last one. The **`FAST_TRAVEL` Request is retired** —
there's no separate route through `requestActions.js`; a mount is just a
larger allowance.

**Travel brings your escort party.** Who follows is not a parameter and never
reaches `performLocationMove` from a client — it is read off
`Character.escortedById` inside the move's own transaction. See §3a. Party
members get no Action, no cooldown claim and no mount claim of their own —
one `updateMany` moves them all — and the move writes one
`characters_escorted` `AuditLog` row naming the mover, the destination,
everyone brought and everyone the way refused. `lastLocationMoveAt` is set
for them too, so a character who's just been walked somewhere doesn't get an
extra free hop the instant they can act again.

**The Caving Die rolls on arrival** for the mover and everyone in their
party, on any `CAVE_LEVEL` destination — and arrival is now the *only*
time it rolls, so walking is what wakes the dark. A Location wearing the
`safe` attribute is exempt; Customs is the only one (`CAVING.md` §2).

On a deferred crossing the die waits with everything else: nobody has arrived,
so `travelArrivalPass` rolls it next turn through the thunk.

`performLocationMove` returns `{ ok, oldLocation, oldZone, targetLocation,
targetZone, crossedZone, spentTurn, usedHorse, moved: [{ character,
fromLocationId, fromZoneId, toLocationId, toZoneId, zoneChanged, cavingDm },
...], leftBehind: [{ character, reason }] }` (mover first) on success, or
`{ ok: false, reason, retryAfterSeconds? }` on refusal. A deferred crossing
adds `deferred: true` and returns **`moved: []`** — every caller drives its
role swaps off that list and nothing has moved — with the party in
`travelers` instead, for the DM that tells a passenger they are being walked
somewhere. `leftBehind` is filled on both, and is the caller's cue to DM.

## 3a. Escorting — the party you carry

**You attach people once and they follow you.** This replaced two mechanics
that answered the same question with the same predicate written twice: the
`MOVE_CHARACTER` request, which shoved one person one hop for free with no
consent, and the drag picker on the Travel confirm, which had to be re-ticked
before every single hop. Both are gone. `db/lib/escort.js` is the one
authority, and `Character.escortedById` is the one column.

**`escortAuthority(leader, target, turnNumber)` is the whole rule set**, and
it is pure, so the panel, the bot's picker and the server-side re-check share
one answer:

| Verdict | Who | On click |
|---|---|---|
| `FORCED` | a corpse; anyone holding an `INCAPACITATING_SLUGS` tag; a member of the faction you lead | attaches at once |
| `CONSENTED` | somebody whose standing agreement to *you* has not lapsed | attaches at once |
| `ASK` | any other living character standing with you | files an `ESCORT` `Offer` and DMs them |
| `null` | not standing with you, hooded, yourself, buried, or already following somebody else | not offered |

Three things about it are easy to get wrong:

- **It is Location grain.** The old `canDrag` scooped the whole **zone**, so a
  body could be picked up from across the map. You walk to somebody now.
- **It needs the faction RELATION, not `factionId`.** `isUnaffiliated` reads
  `leader.faction`, and returns `true` for `undefined` — so a select that
  loaded only the id quietly refused every faction leader. That was live in
  `canDrag`, which `performLocationMove` re-ran against a `CHARACTER_SELECT`
  row that had no `faction`. `ESCORT_SELECT` carries it, and
  `db/test/escort.test.js` pins the case.
- **`ESCORT_SELECT` is a strict superset of `CHARACTER_SELECT`**, because
  every caller now loads a mover with it and hands that row straight to
  `performLocationMove`. Drop `travelToLocationId` and a character on the road
  walks off it; drop `zoneMoves*` and free crossings never run out. A test
  asserts the superset holds.

**Consent lasts two turns.** Accepting stamps `escortConsentToId` and
`escortConsentUntilTurn` (`turn.number + CONSENT_TURNS`) on the **responder's**
row and attaches them there and then. Inside the window they are picked back
up with no second DM; outside it, they are asked again. One agreement at a
time — you cannot promise your feet to two people. The ask rides the existing
`Offer` table and the existing `bot/src/lib/offers.js` router; only
`handleOfferAccept`'s kind switch knows it is new. Its buttons are green and
grey (`escortButtonRow`) rather than the blurple `offerButtonRow`, because
being taken along is an invitation and refusing one is not a refusal.

**A follower the way will not take is dropped, not a refusal.** Each one is
run through `crossingCheck` with **their own** tags and their own mount — a
crawl the leader has the Caving for is still a crawl their companion cannot
follow them down. One who fails is detached and left standing, and the mover
goes on. Dragging used to throw the whole hop away instead. **The leader's DM
must never say why**: naming a hidden edge's refusal would announce that the
edge is there (§2a). It says only "You can't move X through here."

**Walking under your own power detaches you.** Every branch of
`performLocationMove` clears the mover's own `escortedById`, so a willing
follower leaves by leaving. A helpless one never reaches that line. Death
releases everyone following the dead character and clears their own standing
agreement — but **not** their `escortedById`, because a corpse is still
something a person can carry.

**Seats decide the mount's bonus, not the party's size.** There is no cap on
how many people you take. `fastTravelCapacity` (horse 2, horse + cart 6,
motorcycle 2, on foot 0 — the rider counts) gates the `isMounted` branch of
`freeZoneMoves`: fit, and the mount buys its usual extra crossing; go over,
and it buys nothing. On foot there is no bonus to lose, so walking any number
of people is free — an overloaded horse is never *worse* than legs, only no
better. This is `fastTravelCapacity`'s first live caller; it had none from the
day it was written until this rework.

**A stale attachment is inert, not dangerous.** `escortAuthority` returns
`null` the moment two people are not co-located, so a row left behind by a GM
teleport costs one poll of a wrong-looking panel and nothing else. The raw
relocation writers clear it anyway, beside the `travelTo*` they already
cleared.

## 4. The Discord half

**`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)`** is
the single function every caller runs after its DB write commits — never
from inside the transaction, the same reasoning `db/lib/dm.js` documents.
Grant-before-revoke throughout: it swaps the Location role, and — only if
the zone changed too — the zone role and the narrowcast reconcile; then
`syncCharacterRoomAccess` for wherever the character now stands and
`applyPendingInvites` for any standing Conversation invite there. Every call
is individually catch-logged; the channel doctor is the safety net for
whatever it misses. See `CHANNELS.md` §3–§4 for the roles and the private
Room membership it drives.

Every caller — the Travel button on `#turns`, `/location`, character
creation, a GM's raw edit or teleport, GM Bulk Move, and the staged
"Relocate to" applied at the turn push — runs
`performLocationMove` (or a raw relocation, for the GM/creation paths) then
this function. Any new writer of `Character.locationId` must call both, or a
player either sees the wrong place or none.

## 5. Tax runs and the Lifeweb

Travel cost is also what a **tax run** costs. Handing ⬢ or an item to a
person requires the same zone — so a payment across zones is still a journey
somebody physically makes, checked against `Character.zoneId` exactly as
before. See `FACTIONS.md` §3b.

The Lifeweb is the same rule with a fixed address: bleeding or feeding
someone to the Web needs the Mortus **and** the target standing in the
Fortress zone, because that is where the tower is (`REQUESTS.md` §5a).

## 6. The web `/map` panel

`/map` is the travel graph drawn over the Ravenheart plate: one rhombus per
Location, one line per edge the character may see, with the plate itself
underneath. It replaced the retired four-rhombus zone panel, which went out
with per-zone-only travel and left this note in its place for a while.

Two hosts, **one component** (`web/app/(app)/map/MapBoard.js`): the `/map`
route, and an overlay on `/play` opened by the place card's **Open map** and
closed with Escape, the backdrop or Return to game. On a folded viewport the
button navigates to the route instead of opening the overlay — a full-bleed
board inside the phone's "Here" sheet would be a dialog inside a dialog.

### 6a. The fog

**A player sees the country they have walked, not the board.** Two grades:

| Grade | Means | Draws |
|---|---|---|
| `stood` | been there | solid core, full label, description |
| seen | only ever one step away from it | hollow core, muted label, **no** description |
| — | neither | absent from the payload entirely |

**Seen once, drawn forever.** Walking away never takes a place back off the
map, so it only ever grows — which is also why the board can count itself
("12 of 55") and have that mean something.

`LocationVisit` is the record, and `db/lib/locationVisits.js` is the only
module that touches it. There was nowhere to derive this from: `AuditLog` has
no `locationId`, `ArchiveEntry` is keyed to a zone rather than a Location, and
a free in-zone hop files no `Action` at all.

Three things about it are easy to get wrong:

- **The write hangs off `applyLocationMoveSideEffects`**, not
  `performLocationMove` — §4's rule is that the first is what *every* writer of
  `Character.locationId` runs, so a GM teleport, a first placement, a rite and
  the arrival pass all record themselves. Hooking the mover would have left
  each of those a hole.
- **The neighbour write is a `createMany` with `skipDuplicates`**, and that is
  load-bearing rather than an optimisation: it is what makes walking past a
  door unable to downgrade a place you have actually stood in back to a
  sighting.
- **It reads `travelOptions`, never `LocationLink`.** A hidden crawl the
  character cannot use is therefore never recorded, and can never be revealed
  by the map later.

`loadMap()` re-records the character's current Location on every open, so a
sighting the post-commit hook dropped heals itself the next time they look.

**The fog does not start fully closed.** A character is made knowing the places
their life would have taught them — the home cluster, plus the road their trade
actually walks. A Headman opens the board already seeing the Farms he has taxed
for years; a Banneret sees every step of the run up to town. The table is
`db/lib/startingMemories.js`, keyed by role slug, with a second half keyed by
the Commoner kit crates so a farmer and a hunter wake up knowing different
roads. `createCharacter` calls `seedMemories()` once, after the transaction
commits — after, because `travelOptions` reads the tags it just granted.

Two slugs are in nobody's list on purpose: `caves-brooding-grounds`, the far end
of the smugglers' crawl, and `hills-mountain`, which has no edge to the rest of
the Black Hills at all. Handing either one out would give away a way in. Every
other guard here still applies, because `seedMemories` writes through
`recordArrival` rather than around it.

### 6b. What the fog must never leak

**The fog is server-side, not CSS.** An unknown Location is absent from
`loadMap`'s payload; it is not sent and hidden. A server action is a public
endpoint.

**An edge draws only when both ends are known *and* `crossingCheck` says
`listed`.** That is the §2a rule applied to a picture: a locked door draws
dashed and says why, a hidden crawl draws nothing at all and reads exactly like
two places with no way between them. The three `hidden: caving` crawls are the
only unknown ways into the Depths, and this is what keeps them that way.

**The Underground switch is hidden until the character knows somewhere
underground.** Offering it earlier would announce that a second layer exists.
`customs` draws on both layers — it is the threshold, and hiding it from the
surface would make the way down start nowhere.

### 6c. Travel

The map is a second **door** onto travel, never a second mover. Picking a
reachable node opens the same confirm strip the Travel panel uses, reading the
same numbers through `web/lib/travelCost.js#travelFoot` — extracted from
`TravelNodes.js` precisely so the two surfaces cannot disagree about what a hop
costs — and Go calls the same `travelTo`, which re-derives every gate
server-side regardless.

### 6d. The plate

`docs/assets/map-nodes.json` places every Location on the art in image pixels,
read at runtime through `web/lib/mapNodes.js` (the `web/lib/handbook.js`
pattern, `docsPath()` rather than `__dirname`). A Location the table does not
place is simply not drawn, rather than stacked on the origin. Surface nodes sit
on the drawing; Caves and Depths are a schematic layer, since the plate draws no
tunnels.

The art is a raster and never follows the theme — but it was drawn with exactly
one accent in it, `#57a9bc`, the water, and that blue answered to nothing. So
the river is cut to an alpha mask (`docs/assets/make-map-river.py` →
`web/public/assets/map-river.png`) and painted through it with `--map-river`,
which each theme sets for itself. Everything else drawn on the plate — the
rims, the cores, the ways — is tokens all the way down.

`Zone.mapPolygon` / `mapLabelX` / `mapLabelY` are still there and still always
null: they described the retired panel's four rhombi, and nothing reads them.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, walking the party, the Caving roll; no Discord |
| `db/lib/escort.js` | The escort authority, the party, and the consent handshake — §3a. The ONLY module that decides who follows whom |
| `db/lib/travelArrivalPass.js` | the turn pass that lands a paid crossing — the relocation and the archive row; no Discord |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half, shared by every caller |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess` — private Room membership |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `db/lib/mounts.js` | `FAST_TRAVEL_SLUGS`, `isMounted`, `fastTravelCapacity` (the seat count §3a gates the mount's bonus on) |
| `db/lib/turnFormat.js` | `turnDay` — the in-game day a mount's second crossing is claimed against |
| `db/lib/locationGraph.js` | `LocationLink` reads and the gating verdict — the only module that touches the edge model |
| `db/lib/locationAttributes.js` | The attribute registry, its sync-time validation, and the prose Examine prints |
| `db/lib/locationVisits.js` | The fog: what one character knows of the map. The ONLY module that reads or writes `LocationVisit` |
| `db/lib/startingMemories.js` | The map a character is made knowing — role slug and Commoner kit to Location slugs — §6a |
| `web/app/(app)/map/` | `loadMap()`, the board, and the route — §6 |
| `web/lib/travelCost.js` | `travelFoot` — what a hop costs, in the words both travel surfaces print |
| `docs/zones.yaml` | The master: zones, Locations (with their seeded `structures:`), Rooms, and `connections:` with its edge types |
