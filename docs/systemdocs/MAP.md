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

Geography is authored live at `/gm/dev/zones` now — a GM edits a Zone,
Location or Room's fields directly, and the change lands in the database
immediately, with Discord catching up behind it (`db/lib/discordMirror/`).
`docs/zones.yaml` survives only as the one-shot **importer** for a fresh
game's starting layout (`npm run db:import-zones -- --apply`): it's additive,
never updates an existing row and never deletes one — see `SYNC.md` for the
format and `DEV-PANEL.md` for the editor. That includes which zone a
Location is in: the Zone control on its form moves it, taking everyone
standing there along and making the ways in from the old zone the crossings
that cost — which is how the Undercroft came up out of the Undertown into
the Fortress on 2026-09-23, so the Court's stair is a free hop and the pipes
into the Hollows and the cellar door into the Old Town are what cost a Move.

**How a Location is slugged: it is the map code.** A Location's slug is its
zone plus its system code off the Playscii plate — `town-1` is the Gatehouse,
`fortress-5` the Tower, `undertown-a` the Slums. A Room's is its Location's
slug plus its own number within that Location, in authoring order: `town-2-3`
is the Square's Warehouse. Codes run 1-9 then a-z, and each zone starts again
at 1, which is what the zone prefix is for.

The point is that a slug is a coordinate, not a name. Renaming a place is a
`name:` edit and nothing else, so no constant, test or doc that named it goes
stale — and `docs/assets/maps/nodes.yaml` addresses the same places by the
same codes, so the plate links straight at them.

Zones not yet renumbered still carry descriptive slugs: the Black Hills
(`hills`, plus `gullies` and the rest), the Caves and the Depths. Each of
those keeps a `slug:` override in `nodes.yaml` until its own pass lands.

The Black Hills dropped their zone prefix on 2026-09-20, when the zone was
re-prosed underground: a Location there is now `bridge`, `west-river`,
`passageway`, `refuse-pit`, `sparse-fields`, `cliffs`, `gullies`,
`grand-ravine`, `east-river` or `factory`. The older rule — bare slugs for
built places, zone-prefixed ones for open country — was solving collisions
between a ravine here and a ravine there, and with the Forest and the Marshes
deleted there is no second ravine left to collide with.

The Baron's lift comes down in the **Refuse Pit**, which is what the plate has
always labelled it and what `docs/documents.yaml` has always told the Baron,
the Tribune and the Ordinator: `fortress-4` ↔ `refuse-pit`, `hidden:
elevator-key`, with the Elevator Room at the bottom of the shaft as
`refuse-pit-elevator` rather than the Undercroft's old `undertown-1-6`.

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
nowhere to announce** — none is drawn there today. That is a gate's problem
specifically, not a general rule about the caves being unreachable: a staged
public declaration for either level fans out to every Location channel in it
instead (`ADJUDICATION.md` §1).

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

A Location may carry one `LocationMining` row, authored as a bare `mining:`
value in `docs/zones.yaml` and drifted every turn. **No row means the place
cannot be mined at all**, which is why no Location needs a "wilderness" or
"water" boolean anywhere in the schema: the row is the gate. There were up to
four of these per Location once, one per Laboring kind; mining is the only kind
of day left. See [`MINING.md`](MINING.md) §2.

### 1b. What else a Location is

Beyond its name and description, a Location carries a sparse map of
**attributes** — `Location.attributes`, a JSON object authored as an
`attributes:` block in `docs/zones.yaml` — and, optionally, a `structures:`
list of the built things that were always standing there (the Square's cross),
seeded as `COMPLETE` `Structure` rows by `db/lib/worldSeed.js` — which
`db:import-zones` calls when it stands a Location up, and which the Restart Game
wipe calls again afterwards, so a restart no longer takes them away for good:

```yaml
depot:
  name: Depot
  attributes:
    depot: true
```

Two more keys feed the mood dial (`MOOD.md`): `wilderness` marks a Location
where arriving and ending the turn cost mood (every Forest, Black Hills and
Marshes Location except the factory, the farms and the marshes village), and
`haven` marks a Location whose roof gives extra relief at turn close — the
Inn, the Keep and the Sanctuary.

There used to be a third, `wheels`, an authored exception letting an indoors
Location admit a cart anyway. It is gone, and so is the rule it excepted:
`indoors` no longer parks a mount anywhere, underground included (`CARRY.md`
§3). A roof is a roof, for the mood dial and for building, and nothing more.

Every key must exist in the registry in `db/lib/locationAttributes.js`, which
is the only module that reads the column. An unknown key is reported as a sync
**problem** rather than dropped, because a typo would otherwise be a place that
quietly never says what it is.

The registry maps each key to the sentence the **Examine** button prints
(`MINING.md` §7). Systems that own a place should ask `hasAttribute(location,
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
| Modular | `modular`, `isOpen` | an Open/Close button on the **watchtower** at the gate; impassable while shut. Anyone the tower admits may work it |
| Keyed | `keyed`, `openUntil` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — yes and the way ignores its tag and becomes listed until the window lapses |
| On foot | `onFoot` | too tight, steep or enclosed for a horse or a cart. A **mounted** character is dismounted crossing it. This is the only thing that dismounts anybody; an indoors Location does not |
| Tight squeeze | `tightSqueeze` | a hole no **Giant** fits through, full stop. Listed and refused to anyone holding the `giant` tag — unconditional, not a skill check. **Marked for everybody**, Giant or not, so a party can see where its Giant cannot follow |

**A modular gate on a zone boundary must be the only plain edge between those
two zones.** A hop inside a zone costs nothing, so a second tagless, unwinched
edge joining the same two zones means dropping the gate shuts nobody out — they
walk to the other Location and cross there. The Fortress had exactly that until
2026-09-23: the Gatehouse opened onto the Residences (the portcullis) and also
onto the Sanctuary and the Graveyard, so the winch was scenery. A locked or
hidden way round is fine — a key past the gate is authored on purpose (the
Baron's lift, the Undercroft's pipes) — and so is a second modular gate. The
rule lives in `db/lib/gateBypass.js`; `db/test/gateBypass.test.js` runs it over
`docs/zones.yaml`, and the doctor's `gate-bypass` check runs it over the live
`LocationLink` rows on every bot start (`CHANNELS.md` §6).

**A modular gate is also a window, open or shut.** A line said in a PUBLIC,
non-soundproof Room at one end is echoed into every such Room at the other end,
as the speaker, with each line `-#` (`db/lib/gateEcho.js`, called from
`say.js#recordSpeech`). Private Rooms and Conversations never echo either way.
And Who's here? plus the web HERE column list the people at the far Location
under that Location's name (`whosHere(…, { withAcross: true })`), in rows that
carry no hood token and no menu, so nothing can be done to them through the bars.

**Stealth is the one tag that reads on a crossing**, and it moves the
announcement down exactly one step rather than switching it off
(`db/lib/locationMove.js#announceLevelFor`, a pure function with its own test
in `db/test/gateAnnounce.test.js`):

| the edge says | an ordinary traveller | a **Stealth** traveller |
|---|---|---|
| `TRUE_NAME` (manned) | their real name | what a passer-by saw |
| `CONCEALED` (unmanned) | what a passer-by saw | **nothing at all** |
| `NONE` | nothing | nothing |

The asymmetry is the point, and it is Bascinet's call: you can be quiet, but
you cannot be quiet past a Cerberus who is reading your papers. So a stealthy
traveller through the Fortress gatehouse lands exactly where an ordinary one
lands at a Town gate. This is also the only thing in the game that suppresses
an *individual's* arrival — everything else about announcing is a property of
the edge and treats every traveller alike.

**The winch is in the tower, and reaching the tower is the whole permission
model.** A modular gate's Open/Close button renders on one Room's starter post
— the watchtower at that gate — and on neither endpoint's Location anchor,
which is where it used to live. The four rooms are named in
`db/lib/roomStarterRow.js#WATCHTOWER_ROOM_SLUGS`; the row is composed by
`syncZones.js#roomComponents` and redrawn after a flip by `#refreshGateRooms`,
which every caller of `refreshLocationAnchor` also calls.

**Anyone who can see the button may pull it.** A gate used to carry its own
opener list as well, so two predicates decided one act and had to be kept in
agreement: the tower's `access:` list is computed from held **tags**, while the
opener list also accepted a **Role**, so a gate could authorise somebody who
could not reach it — or admit somebody to the tower who then found the winch
refused them. Only one of those can be the rule, and the room is the one a
player can see. `toggleGate` still checks that the clicker is **standing at the
gate**, because a thread member need not be, and that is the only check left.

A tower whose thread is missing renders a flip nowhere at all, since there is
no longer an anchor copy to fall back on; the Discord mirror and the channel
doctor are the repair.

**Two gates are worked some other way** (Incarn and gates.docx,
`GATEHOUSE.md`), and `db/lib/gateControls.js` names both:

- **An anchor gate** — the portcullis between the Residences and the
  Courtyard. Its button is on **both** Locations' own anchors (and on both
  place cards in `/chat`), drawn for everybody, and it moves only for a worn,
  registered ring carrying `portcullis-key`. Anybody else who presses it is told
  "Nothing happens." The Courtyard's Watchtower no longer works it.
- **A remote lever** — the Black Hills gate between the Bridge and the Square.
  Its lever is in the Town Gatehouse's Gate Controls (`town-1-2`), which stands
  at neither end, so `toggleGate` checks the clicker is standing in that room
  rather than at the gate. No ring: anybody who can get into the room may pull
  it. Its flip is heard at both ends **and** in the Gatehouse.

A shut gate of either kind refuses travel in its own words
(`gateControls.js#shutRefusalFor`) rather than sending the player to look for
a watchtower.

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

Neither `db:import-zones` nor the editor ever rewrites `openUntil` or `isOpen`:
both are play state, not authoring. Restart Game is the one thing that resets
`isOpen` — back to `authoredOpen`, the gate's born value — as part of the
wipe, not as part of importing or mirroring.

### 2c. On-foot ways

`onFoot` is the one thing left that keeps a mount out
(`db/lib/indoors.js#dismountForNarrowWay`). An indoors roof used to do it too,
at the door on arrival; it no longer does anywhere (`CARRY.md` §3). `onFoot` used to refuse the crossing outright rather than dismount for
it, on purpose — see the timing note below for why that mattered, and why
dismounting works just as well now.

**Timing is the whole reason it isn't done on arrival, the way the roof once was.**
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

The **modular button** is `loc:gate:{linkId}` on the watchtower's starter post.
The handler re-checks only that the clicker is standing at the gate — the room
they clicked in is the authority for the rest. The flip is a row lock and a
re-read carrying the state the clicker saw, so two watchmen clicking at once
means one close and one "somebody just did." Both endpoints are redrawn, since
either may have a tower. **A re-sync never reopens a gate somebody shut in
play** — `modular.open` in the YAML is the value a link is *born* with, not one
the sync re-asserts.

### Tight squeeze

`tightSqueeze: true` on a `connections:` entry marks a hole no Giant fits
through, full stop. Unlike `requiredTagSlug`, which is a reusable lock
authored with whatever tag slug fits the door, this one is fixed and
**unconditional**: it refuses exactly the `giant` tag, and nothing a Giant
can hold opens it back up. `climbing` and `caving` are skills, and this is a
body that does not fit — the two are not related, on purpose, and a Giant
with either tag is refused exactly the same as one without. There is nothing
else to author on the edge — the rule is the flag.

It composes the same way `onFoot` does, checked right where `onFoot` is in
`crossingCheck` (`db/lib/locationGraph.js`): listed, never hidden, because a
Giant learning they cannot fit is not a secret the way a hidden crawl is. A
character without the `giant` tag is never touched by it at all.

**But everybody is shown it.** `crossingCheck` returns `tightSqueeze: true`
on every listed verdict, passable or not, and the walk resolver carries the
flag stickily down a route the way it carries `dismounts` — a three-hop walk
whose second hop is a squeeze is a walk with a squeeze on it. That is the
opposite of how `openedBy` behaves (passable branches only),
and on purpose: the person who most needs to see a squeeze is the one it
doesn't refuse, the party leader about to walk their Giant friend up to a
hole and lose them there. A refusing branch says no more about its lock than
it did before; the flag is about the shape of the hole, not the key. Every
travel surface draws it:

- `/chat`'s Travel panel and `/map`'s ways-out list and card: a quiet
  **Tight squeeze** chip (`web/app/components/SqueezeChip.js`), with "A tight
  squeeze. No Giant fits through here." on the hover — or "on the way" for a
  walk. Label and sentence live in `web/lib/travelCost.js` beside
  `openedByLabel`, so the two surfaces cannot word it differently.
- `/map`'s board: the way draws **dotted** (`.map-edge[data-squeeze]`), a
  pinched line, distinct from the dashed "shut to you". A Giant still sees it
  in the gate colour, since for them it is shut.
- The bot's picker: the option's description leads with "Tight squeeze, no
  Giant fits —", and the confirm step under **Move to X?** carries the same
  `-#` sentence the web card does. A squeeze that is shut to you for some
  other reason reads "(tight squeeze)" in the **Closed to you right now**
  line, the way the web draws the chip on a shut way too.

A walk also **avoids** a squeeze where it costs nothing to. Of two equally
short roads, the resolver takes the one with no squeeze on it, even where slug
order would have picked the other. A longer road never wins, though: the
squeeze is marked, not avoided at the price of an extra hop.

The Giant themselves sees none of the chips as news — they already read the
refusal — but they get them too; there is no per-tag branch in any of it.

**Because the block is unconditional, every `tightSqueeze` edge needs some
OTHER route left standing for a Giant.** Cutting a region off entirely from
a sixth of the catalog's most expensive tag is a design mistake, not a
feature, and so is a long detour. It's used on one edge today:

- Last Chance's own bored tunnel west into the Fork (`depths-3 ↔ depths-4`)
  — "a tunnel has been bored into a smaller cavern system to the West"
  (depths-3's own description). `caves-5 ↔ depths-4` already reaches the
  Fork directly, so a Giant goes Last Chance, Abandoned Camp, Fork. That's
  two hops, and both cross the Caves/Depths line, so a Giant pays the Move
  twice for what's a free same-zone hop for anyone else.

That way round is an edge that was already on the map before this feature.
Nothing new was added to make it work.

There used to be two more. The Brooding Grounds (`caves-4 ↔ caves-5`) sent a
Giant six hops and two zone crossings round through the Hills for one free
hop. The Razor Tunnels (`depths-5 ↔ depths-6`) became worse once the Depot's
rail tunnel was taken out: the only other way in was the `climbing`-locked
drop from the Grand Ravine, so a Giant without `climbing` could not reach the
Crystal Chambers or the Chasm at all. Both are plain ways now.

**Flagging or unflagging an edge that already exists takes more than a YAML
edit.** `db:import-zones` never updates an edge that's already there (§2, it
only adds). So the original three squeezes were set by a migration
(`20261022010000_tight_squeeze_existing_edges`), and the two above were
cleared by another (`20261112000000_widen_giant_squeezes`), for any database
that already had those edges. To flag any other existing edge, a GM ticks it
in `/gm/dev/zones/links`, and whoever does that needs to check what a Giant
loses by it first.

### No railroad

There used to be a `railroad: true` edge modifier: a rail tunnel from the
Depot to the Chasm (`undertown-5 ↔ depths-7`) that killed anyone who crossed it
while the cargo train was out on the line. Players had no fair way to see the
train coming, so the tunnel, the flag, its column and its GM checkbox were all
taken out (`20261103000000_remove_railroad`). The train itself still runs on
its own clock (`DEPOT.md` §0d); it only carries cargo.

### 2d. A room that opens onto several Locations

From Bascinet's `Multi-locational rooms.docx`:

> Certain rooms can be accessed while standing in multiple locations. This
> allows characters to converse through a window, or over a counter.
> Characters can communicate, and transfer things across locations by dropping
> them in the room, however they cannot target characters on the other
> location with actions that require them to be in the same location (ie,
> attacking or kissing or any other direct action). […] The Who's Here should
> display everyone who is present in the cross-locational room, from both
> locations and they should be inspectable with it. Some multi-locational rooms
> are gated behind different requirements depending on which location a
> character is in.

The doc also names four such rooms — the Meistery onto the streets outside the
Keep, the Merchant onto the streets, and the Incarn's gatehouse onto the fort's
streets and onto the fortress entrance. The last two came with the gates rework
(`GATEHOUSE.md`): the Town Gatehouse's **Gate** opens onto the Bridge, and its
**Gatehouse Window** onto the Square, both publicly. The **Meistery Window**
(`fortress-5-4`, `MEISTERY.md` §2) came with the Meistery: home in the Tower,
behind the Baron's, the Hand's and the Meister's rings, and public onto the
Square (the Residences until 2026-09-28). It is the first side that crosses
zones, Fortress to Town.

**The model.** A Room still has one home, `Room.locationId`, gated by its own
`kind`/`accessTagSlugs` as ever. Each `RoomSide` row is one more Location it
opens onto, with a gate of its own: an empty access list is a public side, any
slug makes that side private. So the Merchant's counter can be private from the
Merchant (the licence) and public from the street.

**`db/lib/roomSides.js` is the one module that reads the table**, and it works
by one trick: `roomAt(room, L)` is the room *as seen from L* — the same object
with that side's gate, thread and sort order swapped in, and `locationId` set
to L. `accessibleRooms()`, the anchor index, the thread sync and every "is this
room where I stand" test then answer for the side a character is on without
knowing sides exist. `loadRoomsAt(prisma, L)` is every room that opens onto L,
overlaid; a new reader of "the rooms here" should use it rather than
`where: { locationId }`.

**What crosses** is the room itself:

- **Its feed.** One place key, `room:<id>`, on every side. `placesFor` lists it
  at each side it opens onto, with `canSpeak` from that side's gate
  (`db/lib/feedAccess.js`). Hearing and learning names follow
  (`memoryHearing.js#presentWhere` → `roomSides.js#roomPresenceWhere`), and so
  does a mention's earshot (`characterMentions.js#earshotForPlaceKey`).
- **Its stash.** Transfer, Steal, the Things drawer, `/storage` and the Storage
  button reach it from any side whose gate lets you in (`CARRY.md` §6).
- **Who is in it.** Who's here? lists the far side under the room's name
  (below).

**What never crosses is a Location.** Every verb on a person — Attack, Kiss,
Heal, Search, Bind, all of them but Transfer (below) — resolves its target
through `presentRows` / `resolveHoodToken` / `isHere`, which stay Location-grain
on purpose. Nobody on the far side is ever in `hoodIds` or any other verb's
picker. That is the doc's "cannot target characters on the other location",
and it is the rule that must not be widened.

**The one exception: Transfer to a person, across every multi-locational
room.** It is the default for any room with a side — no per-room switch, and a
room given a side later gets it too. It began with the Merchant's Counter
(Depot Overhaul.docx: "items can be transferred to characters on either side")
and was made general on 2026-09-28, so the Gate, the Gatehouse Window and the
Meistery Window hand things through the same way, from either side. Transfer's
picker alone lists the far side's people, under an `across:<ref>` key the
action re-resolves at submit (`db/lib/whosHere.js#acrossRecipients` /
`resolveAcrossRecipient`), and the far side's rows in Who's here carry a menu
with Transfer on it and nothing else; `hoodIds` and every other verb are
untouched. The counter was the first room to carry a side on the live map:
`undertown-6-1`, home in the Storefront, open onto the Depot (`DEPOT.md` §0b).

Neither do the room's **fixtures**. A side offers Storage and nothing else
(`placeAffordances.js#roomAffordances`): the bell, the phone, the vending
machine, the intercom, room Search, a watchtower's winch, the rites and
workshop equipment are on the home side's wall, and every one of them still
checks the home Location. Conversations are opened from the home side only.
The one exception is a fixture that is *about* the far side, marked
`sides: true`: the gatehouse's **Request Passage**, which draws only on the
outside of each window, and the Gate's finger-prick terminal (`GATEHOUSE.md`).

**Who's here** (`whosHere(…, { withAcross: true })`, the web HERE column and
the Discord button) carries `rooms`: one group per such room the viewer is IN,
titled `Room · Location`, listing the people on every other side who are in it
too. Rows are `presentRows`' own, so hoods, strangers and labels read exactly
as they do for your own street. They carry the eye — a look lands on the line
you last heard them say, which is readable because the room is in your
`placesFor` — and, on the web, a menu with Transfer alone on it, which opens
the dialog on `across:<ref>`. A hooded or stranger row carries a `lookRef`
rather than a token: `resolveCrossRoomRef` resolves it for `/look` and for a
stranger's face (`/api/avatar/here`), `resolveAcrossRecipient` for Transfer,
and `db/lib/targetKey.js` never calls either.

**Guests are bound to a side.** `RoomGuest.locationId` is where the pass was
given, and it is spent on leaving that Location: a nod over the easy counter is
no key to the strict one (`CHANNELS.md` §4a).

**On Discord** a thread can only be read by somebody who can see its parent
channel, so a room has one thread per side, each under its side's Location
channel and linked from that side's anchor (`CHANNELS.md` §4). The bot's outbox
relays every line between them (`CHAT.md` §4).

**Authoring.** `/gm/dev/zones/rooms/<id>` carries an **Also opens onto** panel
(`DEV-PANEL.md`). `docs/zones.yaml` can name sides too, for a fresh game
(`SYNC.md`). A room's name must be unique at every Location it opens onto,
because the mirror adopts a thread by its name under its parent.

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
`GameConfig.locationMoveCooldownSeconds` (default 30, edited on `/gm/dev`; it
was 60 until 2026-09-08, which felt like a wall, then 3 until 2026-09-24,
which was a click debounce and no brake on anything) gates it, enforced by a
**conditional `updateMany`** whose `WHERE` clause *is* the check
(`lastLocationMoveAt` null or old enough) — the same shape the hunger
decrement and the mount's daily claim use, so two clicks in one tick can't
both pass. A refusal reports the exact seconds left. A **walk** of several
hops claims it once, at its first hop, and swaps the clock for a position check
on every hop after — §3c.

**An Overburdened character can't cross into another zone at all.** Over a
carry cap (`CARRY.md` §2), `performLocationMove` refuses the crossing with a
plain `{ ok: false, reason }` before it opens its transaction; hops inside the
zone stay free so they can walk to a room and stash. Only the mover is gated.

**A hop whose edge crosses into another zone spends FREE TRAVEL first, and
only costs the character's Move once there is not enough left for it.** What
a crossing costs is `db/lib/crossingCost.js`: **½ travel between the town
zones** (Town, Fortress, Undertown) and **1 travel for any other crossing** —
out to the Black Hills, down into the caves, anywhere else. Everyone gets
`GameConfig.freeZoneMovesPerTurn` a turn (default 1), an **equipped** mount
adds a far crossing's worth (1 more), and being Overburdened takes it all
away — the full rule lives in [`CARRY.md`](CARRY.md) §2a. So a peasant walks
Town → Fortress → Undertown for nothing, or Town → Black Hills for nothing,
and then spends their Move on the next crossing; the way home waits for next
turn. Travel that is short of a crossing is not lost: ½ left still crosses
the town, it just no longer reaches the hills. `db/lib/locationGraph.js`
stamps `cost` on every destination row so the three pickers quote the number
the mover charges.

**A crossing lands at once, whatever it cost.** The Move is spent and the
character is standing at the destination by the time the call returns — same as
a free crossing and same as a same-zone hop.

It was not always so. Until 2026-09-14 a crossing that cost the Move was a day
on the road: the Move went at once, `Character.locationId` did not move, the
destination was parked on `Character.travelToLocationId`, and
`db/lib/travelArrivalPass.js` walked the traveller and their party over at the
next advance. The point of that was the destination's Discord channels — they
stayed shut for the rest of the turn you left in, instead of opening under you
the second you pressed Confirm. Removing it is Bascinet's call, and the cost is
exactly that: **press Confirm and the far zone's category, `#summary` and
Location channel are yours within the minute**, along with the gate
announcement, the Caving Die, the turrets, arrival mood and the carry settle.
Anyone standing there can Bind, Loot or Harm you the same turn you set out.

Two smaller things moved with it. The turn passes now settle a crosser at the
**destination** rather than the origin — the night's mood reads its
`wilderness`/`haven`. And
`travelArrivalPass` is now a **drain**: nothing files work for it, and it is
kept only to land anybody who was mid-journey when the change deployed. Delete
it once they have.

The two columns stay in the schema, unwritten, beside `missedMealStreak` and
`mindlinkChannelId`.

**Being HELD, or the turn being LOCKED, stops a move outright.** Somebody laid
in wait where you walked in and stopped you, or you are in a fight — see
[`INTERCEPT.md`](INTERCEPT.md) and [`ATTACK.md`](ATTACK.md). And once Moves lock
nobody walks anywhere until the push (`turnGate.js#travelLockReason`, Combat
Overhaul.docx), checked after the session gate and drawn on every way by
`resolveNeighbors` and `routesWithinZone`; a first placement is not a walk, and a
way into the caves says Caving.docx's sentence rather than the plain one
(`CAVING.md` §2f). `performLocationMove` refuses with the hold's
own sentence, beside its incapacitation gate, and `travelOptions` draws every
way shut and says why. A held follower is left behind rather than carried out
(§3a).

UNDOING a Move gives back what the crossing SPENT, and not the crossing:
`web/lib/moveEconomy.js#deleteActionRestoringTurn` — shared by the Dev
Panel's "Give their turn back" and the Moves desk's Reject — deletes the
auto-resolved `Action` a paid crossing filed, and
`db/lib/locationTravel.js#travelClaimsToUndo` is what tells it to also zero
`zoneMovesUsed`/`zoneMovesTurnId` when this turn's free-crossing claim
belongs to that Action (`Action.turnId` is unique per character, so a match
can only ever mean this one). Left alone, the day's free crossings stayed
spent even though the Move that spent them just came back.

**It does not walk them home.** When a paid crossing was a day on the road,
undoing the Action really did call the journey off, because nobody had moved
yet. They have now — a GM who wants them back where they started teleports
them. `travelClaimsToUndo`'s `travelTo*` branch survives only as a drain for
a straggler, and goes with the arrival pass. `escortedById` is not restored
either: a crossing overwrites it with `null` and never remembers what it
was, so there is nothing to give back.

Spending the Move is written as a real, auto-resolved `Action`
(`type: MOVE`, `status: CONFIRMED`, `moveReviewStatus: SOLVED`,
`gmNotes: "auto:zone_change"`), landing in `/gm/turns`' Moves history rather
than the pending queue. Its `zoneId` is the **seat** zone of the destination
(`seatZoneIdFor`) — a hop into the Depths files work the Caves GM can see.
A free move files no Action at all. **Acting and crossing on your Move are
mutually exclusive within a turn, in either order** — the enforcement is
`@@unique([characterId, turnId])` on `Action`.

**Pushing on.** Once the travel is short of a crossing AND the Move is spent
— on a paid crossing or on anything else — a walker can take one more crossing
a turn on a die: the extra gamble to go the distance, a Push on button in Go's place
on the Travel panel, `/map` and the `#turns` picker — Go (Discord's Confirm)
is hidden once the Move is spent, since it could only refuse, and the node's
foot reads `exertion`, or `next turn` when the push on would be refused too
(the refusal is written on the confirm strip). The crossing lands like any
other, files no Action, and is refused while the Move is still unspent (the
surfaces read the turn's Action row, `performLocationMove` reads it again).
So three zones a day on foot is the ceiling: free, paid, pushed. The d6, Lucky keeping the better of
two and nothing else on it (no mood or hunger modifier — a hungry, frightened
walker is exactly who pushes on, and a −4 would make the injury a certainty the
confirm text does not admit): **1** grants Sprained Ankle, **2–3** Exhausted,
**4–5** one rung up the Tired ladder (`db/lib/fatigue.js`), **6** Winded — a
turn's visible mark with no effect (`docs/tags.yaml`).
Fatigue is granted at turn N+1 so it costs the whole next turn, the same clock
a day's mining runs on — so a Tired walker reads 1 ankle, 2–5 Exhausted, 6
Winded. Winded itself is granted at N and swept when this turn closes: it only
marks that you pushed on today, with nothing to carry over. A few traits pull the die (`db/lib/advantage.js#rollWithEdge`): Lucky,
Quick-Footed and Caffeinated each vote to keep the better of
two dice, Fat and Old to keep the worse; the count decides and a tie rolls
once (`EXERT_BETTER_SLUGS` / `EXERT_WORSE_SLUGS`). Refused while riding,
boated on the water, lamed, too hurt to march (`EXERT_REFUSAL_SLUGS`: Arterial
Bleed, Punctured Lung, Gut Wound, Sepsis — none of which restrict
ACT), Exhausted (top of the ladder: nothing left to lose but the ankle would
make it a free gamble) or Overburdened, and once a turn — `exertRefusal` is
the list, and the surfaces ask it before drawing the button. No Action is filed, so a push on never shows
in the Moves history; the `AuditLog` row `exert_crossing` is the record.
`performLocationMove(..., { exert: true })`, `pushOn`, `exertOutcome`.

**Mounts.** A fresh `arelitz` carries its riders across **1 border a
turn**, an `arelitz-tacked` or a `motorcycle` across **2**
(`db/lib/mounts.js#MOUNT_RIDES`). A character holds one mount at most
(`ARELITZ.md` §2b). **A ride covers a whole crossing, near or
far** — a town hop on the animal costs it a ride just as the hills do, and in
the summed travel number each ride is worth `FAR_CROSSING_COST` so every
"can I afford it" gate on the surfaces says yes while a ride is left. It
refreshes every turn rather than once a day, so on a short turn length an
arelitz carries you several times a day. Mounts only count while
**equipped**, indoors or out, and only a way too narrow for them unequips
them (§2c, `CARRY.md` §3).

**The rides live on the mount, not on the rider** (`ARELITZ.md` §2a). Every
ride charged to a mount swaps its tag one rung down a ladder inside the
crossing's own transaction — `motorcycle` → `motorcycle-ridden-1` →
`motorcycle-ridden-2` (`db/lib/mountRides.js#rideMount`) — and the rung's
own name says what is left: **Motorcycle (1 ride left)**, **Motorcycle
(Spent)**. The
turn pass (`runMountRestPass`, key `mountRest`) walks every rung back to the
head, on sheets and stable floors alike. So `fastTravelBonus` is simply the
rides left on the equipped rung, read fresh every time, and **nothing
subtracts a per-rider counter from it**: the ride that was spent already
changed the tag. That is what stops a ride being counted twice, once off the
rider's sheet and once off the animal.

This replaced a rule that read the mount's `acquiredAt` against the turn
start and refused the bonus to any mount that "changed hands this turn". It
existed to stop one arelitz handed round a party buying every rider a
crossing, and it did — but a stable pickup stamps the same timestamp, so an
animal walked fresh out of the stable was refused too, and players wanted
exactly that. The rung closes the leak the honest way: a handoff after a ride
hands over a **ridden** animal, and one from the stable is fresh.

**The mount's ride is spent before the base travel.** It stays with the
animal, so unequipping it later gives nothing back and takes
nothing back — the base pool was never touched. The narrow-way case is
untouched, because `dismountForNarrowWay` runs *inside* the transaction
before any of this arithmetic — a rider who cannot get their animal through
the gap never earns the ride to begin with (§2c).

The base pool is tracked on `Character.zoneMovesTurnId` / `zoneMovesUsed`,
with `zoneMovesBonusUsed` recording how much of that travel went on a mount —
only so the base can be told apart (`baseSpent = zoneMovesUsed −
zoneMovesBonusUsed`); it is never read back as "bonus left". All three are
claimed by a conditional `updateMany` whose WHERE is the check, so two tabs
cannot both spend the last of it. `crossingClaim` is the pure arithmetic:
while the mount has a ride, the whole cost goes on the bonus counter and
`rode` comes back true (the caller then takes the rung down); otherwise the
cost comes off the base. A push on charges the crossing's cost to
`zoneMovesUsed` alone, never the bonus counter, so the base pool reading OVER
the base allowance is how `exertedThisTurn` knows it already happened — there
is no column for it.
A GM's undo of a paid Move zeroes both counters (`travelClaimsToUndo`) and so
forgets the push on along with the free travel; the mount's rung is **not**
walked back up (the animal did carry them; the turn pass fixes it at the
close); GM-gated, accepted.

**Every surface says the two halves apart.** `freeMovesBreakdown` splits the
count into base travel and rides, `travelSentence` says it — "1 travel, plus
1 ride on your Arelitz" — and the sheet's Travel tile, the Travel panel's
header, the map card's crossing line, both confirms and the bot's confirm all
carry it, so a rider always knows which of the two a crossing is about to
spend.

The **`FAST_TRAVEL` Request is retired** — there's no separate route through
`requestActions.js`; a mount is just a larger allowance.

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
time it rolls, so walking is what wakes the dark. Nowhere underground is
exempt; the `safe` attribute that excused two places is gone (`CAVING.md` §2a).

`performLocationMove` returns `{ ok, oldLocation, oldZone, targetLocation,
targetZone, crossedZone, spentTurn, usedHorse, moved: [{ character,
fromLocationId, fromZoneId, toLocationId, toZoneId, zoneChanged, cavingDm },
...], leftBehind: [{ character, reason }], interceptDms }` (mover first) on
success, or `{ ok: false, reason, retryAfterSeconds? }` on refusal. There is
one shape now — the `deferred: true` / empty-`moved` / `travelers` form went
with the deferral. `leftBehind` is the caller's cue to DM, and `interceptDms`
is sent the same way `cavingDm` is: built here, sent by the caller, never
inside a transaction.

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
| `FORCED` | anyone holding an `INCAPACITATING_SLUGS` tag | attaches at once |
| `CONSENTED` | somebody whose standing agreement to *you* has not lapsed | attaches at once |
| `ASK` | any other living character standing with you | files an `ESCORT` `Offer` and DMs them |
| `null` | not standing with you, yourself, dead (a body moves as its corpse tag, `CORPSES.md` §2), held in a fight, **willingly** following somebody else, or **you yourself are being brought along** | not offered |

**A hood comes along like anybody else.** Hauling a stranger is one of the
plainest things you can do to somebody whose name you do not know, so
`escortAuthority` no longer refuses a mask — it used to, which meant a masked
friend bleeding out could not be carried to a surgeon by anyone
(`PROXYING.md` §5). What a hood still costs is the **name**: `escortView(prisma, leader)`
is one round trip that asks `presentRows` who is hidden from this leader, and
`escortName(row, view)` / `escortKey(row, view)` read its answer — a name, or an
alias and an HMAC token rather than an id, because `/api/avatar/<id>` answers
with a face. Reading `presentRows` rather than deciding again is the load-bearing
part: the resolver honours your **sighting** (`PROXYING.md` §5a), so a list that
judged the live row instead would offer a hood under a token that then resolved
to nobody. `hooded` on a party row is what makes the rack draw the
question-mark plate instead of asking for a face.

**A hold says so now.** Being attacked holds both sides until the turn ends
(`INTERCEPT.md`), and `escortAuthority` refuses anyone held — above the
helpless→`FORCED` branch, on purpose, so an ambusher's prisoner is not
somebody else's to walk off with. That is still the rule; what changed is that
`escortRefusal` reads `heldReasonFor` instead of falling through to a flat
"You can't take them along.", so a player is told a fight is what is stopping
them rather than left guessing.

**Force beats an arrangement.** The `FORCED` branch is reached *before*
the `escortedById` guard, so a captor takes their prisoner off whoever is
holding them. It read the other way round until a player found it:
tie somebody up while they were walking with a friend, and the friend kept
them, because asking first had won the column. `attach()` re-asserted the
same rule in its `updateMany` WHERE, so it takes a `takeover` flag that only
a `FORCED` verdict may pass — everybody else keeps the conditional write,
because the race it guards is real: two people asking the same willing
follower still resolve to one party.

**A refusal says which rule refused** (`escortRefusal`, the opposite number of
`escortReason`). It used to be one flat "You can't take them along", which on
a picker that silently omits whoever it will not take reads as the game
pretending somebody standing in front of you is not there. `hereWhere` has
already dropped the far away, the hooded, the buried and yourself before a
candidate is judged, so after the reordering above the only branch a
co-located person can hit is *already with somebody* — and that is safe to
say, because walking with somebody is plain to see. **Their leader is not
named**: the refusal does not need it. The METAGAMING rule
(`web/app/components/HereList.js`) is why the sentence arrives on the click
rather than as a greyed row in the picker.

Three things about it are easy to get wrong:

- **It is Location grain.** The old `canDrag` scooped the whole **zone**, so a
  body could be picked up from across the map. You walk to somebody now.
- **No rank carries anybody.** A Leader used to be able to walk a member of
  their own faction anywhere without asking. Factions are gone, and so is that
  verdict: a healthy, conscious person is always an `ASK`.
- **`ESCORT_SELECT` is a strict superset of `CHARACTER_SELECT`**, because
  every caller now loads a mover with it and hands that row straight to
  `performLocationMove`. Drop `zoneMoves*` and free crossings never run out;
  drop `heldUntil` and an ambush stops working. A test asserts the superset
  holds.

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

**A passenger is not a driver.** `escortAuthority` returns `null` for every
target the instant `leader.escortedById` is set — no exception, FORCED
included, or a captor who gets swept up themselves would still be walking off
with their prisoner in tow. This closed a real hole: somebody already being
brought along could still open their own picker and attach followers of their
own, which left an orphaned sub-party the moment their own leader moved —
nobody's walk ever reads two levels of `escortedById` deep. The web's
`PartyRack.js` reflects this rather than fighting it: while `escortedById` is
set, the rack draws who you're being brought along **with** (your leader,
plus anyone else the same leader has) instead of a "Bring somebody" picker.
`attach()` and `acceptEscort()` are the other half of the same rule — either
one releasing the target's own party (`releaseParty`) the moment somebody
picks them up, so a chain can never form by attaching in the other order
either (an already-leading character getting picked up themselves).

**Seats decide the mount's bonus, not the party's size.** There is no cap on
how many people you take. `fastTravelCapacity` (arelitz 2, arelitz + cart 6,
motorcycle 2, on foot 0 — the rider counts) gates the `isMounted` branch of
`freeZoneMoves`: fit, and the mount buys its rides; go over, and it buys
nothing (and, since no ride is spent, the rung does not move). On foot there
is no bonus to lose, so walking any number of people is free — an overloaded
arelitz is never *worse* than legs, only no better. This is
`fastTravelCapacity`'s first live caller; it had none from the day it was
written until this rework.

**A stale attachment is inert, not dangerous.** `escortAuthority` returns
`null` the moment two people are not co-located, so a row left behind by a GM
teleport costs one poll of a wrong-looking panel and nothing else. The raw
relocation writers clear it anyway.

**Somebody being held is not available to be picked up.** `escortAuthority`
returns `null` for them — above the FORCED branches, so an ambusher cannot walk
off with their own prisoner either; taking them somewhere is what the Gambit is
for. `performLocationMove` re-checks it per follower, because a hold can land
between the pick and the walk, and drops them into `leftBehind` with the reason
`held`. That is the one `leftBehind` reason the leader IS told, because it is
plain to see. See [`INTERCEPT.md`](INTERCEPT.md).

## 3b. The Stepstone — the one move that is not travel

A `catalog: secret` item that a player spends to stand somewhere else. It is a
**raw relocation**, the same shape the Dev Panel's Teleport uses: no ⬢, no Move,
no adjacency check, no cooldown, and no Action filed. It reaches **every
surface Location, known or not** — the fog behind /map does not narrow it.

**The one refusal is the underground.** A `CAVE_LEVEL` zone is never a target,
and `stepstoneRequest` re-checks that server-side rather than trusting the
picker. The test is written as "is `SURFACE`" rather than "is not a cave":
`ZoneKind` has three values and `CAVE_GROUP` is not a place anybody stands, so
phrasing it positively keeps a zone kind added later out of the stone's reach
until somebody decides it should be in. Destination only — stepping *out* of
the caves is fine.

**There is no STOOD-only restriction, deliberately, and the consequence is
real: the stone is a way past every locked gate on the surface.** The `seen`
half of the fog is written for every **listed** neighbour, and §2 above is
explicit that `listed` is weaker than `passable` — a locked door or a shut
portcullis is listed on purpose, so you know it's there and cannot open it.
The stone does not care. The Undercroft is reached
by a `hidden: elevator-key` connection and the Charon is down there; the
ravine camp, the Keep and the Underquarter are all surface Locations behind
gates a stone-holder no longer needs to open. The caves are the one thing still
walled off, which is what keeps the caving gate and the Caving Die meaning
something.

**A hold stops it**, the same as it stops a walk (`INTERCEPT.md`): an ambush is
a hand on your shoulder, and the stone is not the way out of one.

It writes `locationId` **and** `zoneId`, clears `travelToLocationId` /
`travelTurnId` / `escortedById`, and then calls `applyLocationMoveSideEffects`
(§4) like every other writer of `locationId` — which is what gets it the
`LocationVisit` row, the channel overwrite, the zone role, the carry settle and
the corpses it is carrying, for free. `rollCavingOnArrival` runs after, because
stepping into the dark wakes it the same as walking in.

**Anyone escorting the stepper is cut loose**, not merely left behind — the
step clears their `escortedById` the way `db/lib/characterDeath.js` does when a
leader leaves play. Left dangling, `partyOf()` would go on counting followers
standing in another zone, which can cost a mounted leader the horse's extra
crossing for a party that is not with them.

And because a teleport crosses no graph link, `announceGateCrossing` has no
edge to read and posts nothing: you arrive without the gate line a walker would
set off, which is the closest thing the item has to stealth.

## 3c. Walking across a zone

**"Hop" is this file's word, not a player's.** Every surface that counts steps
for somebody — `walkFoot` on /map, the Discord destination line,
the travel confirmation — says **moves**: "1 move", "3 moves". Keep the code and
the prose here on "hop" if you like, but never print it.

**Pick somewhere farther in your own zone and the game walks you there, hop by
hop.** `db/lib/locationWalk.js#walkWithinZone` is the whole of it, and the first
thing to know about it is what it is **not**: it is not a mover, and it is not a
teleport. Every step is the ordinary single-hop pair every other caller runs —
`performLocationMove` for the database half, then `applyLocationMoveSideEffects`
for the Discord and game half. This file writes no `Character.locationId` of its
own.

That is the design rather than an implementation detail. Because each hop is the
real one, **everything fires at every stop on the road**: the Depot and
gatehouse turrets, anybody laying in wait, the gate lines, arrival mood, the
Caving Die, the carry settle and the fog write. Walking past a watched
crossroads gets you caught there. A walk is a shortcut through the clicking, not
a shortcut past the game.

**It costs nothing**, because a hop inside a zone costs nothing (§3). No travel,
no Move, no confirm dialog. That is also exactly why it is the only thing the
map's double-click may do (§6c).

**On the web, a walk is the map's alone.** The travel strip over the chat lists
only the ways next door; it used to carry a second "Further in <zone>" list of
walks, and that was taken off so the strip reads as the doors out of here. The
Discord Travel picker still offers walks.

**The road is fog-limited.** `routesWithinZone` / `pathWithinZone` in
`db/lib/locationGraph.js` are the second multi-hop question in that file, beside
`soundRange` and allowed there for the same reason — nothing outside it may read
`LocationLink`. Three rules, and each is load-bearing:

- **Only through places the character already knows.** The fog set is `seen`,
  not `stood`, because `loadMap`'s own `visible()` draws the board off `seen` —
  a finder using the narrower set would refuse a rhombus the player is looking
  at, for a reason they cannot see.
- **The fog set is handed IN, never read here.** `db/lib/locationVisits.js`
  already requires `locationGraph.js`, so requiring it back would close a cycle
  and resolve to a half-built exports object at require time — a silent
  `undefined`, not a clean error. Callers pass `knownLocations(…).seen`.
- **Same zone, every step of it, not just the endpoints.** It falls out of the
  `where: { zoneId }` on the location query rather than being re-checked per
  node, so a road cannot duck out of the zone and back in through somewhere
  nobody looked at.

Every edge is judged by `crossingCheck`, the very verdict `performLocationMove`
reaches again at each hop — there is no second copy of the gating rule here. The
Caving Die's hold is deliberately **not** asked: it only ever shuts a way *up*
out of the caves, which a same-zone walk never takes, so the mover asks it, in
its own words, at the hop that meets it. Its severity-10 stop is asked, once, up
front (`CAVING.md` §2e). A **hold** is asked, once, up front, the same
`heldReasonFor` call `resolveNeighbors` already makes for the adjacent list —
being held shuts every way, not just the ones that cross a zone
([`INTERCEPT.md`](INTERCEPT.md) §4), so a held character has no first hop to
take and there is nothing to offer. Before this, the picker showed a farther
Location as walkable while marking every *adjacent* one shut for the same hold
— a real destination the mover would always refuse the moment it was picked.
Neighbour lists are sorted by slug
before the search, `soundRange`'s reason sharpened — the surface that *shows* a
route and the walk that *takes* it must pick the same road, or somebody is shot
by a turret on a street they were never told they would pass.

`WALK_HOPS` is a module constant, not a `GameConfig` field: a safety rail so a
mistake in the graph cannot become a thirty-hop run of Discord calls.

**The debounce is claimed once, by the first hop.**
`GameConfig.locationMoveCooldownSeconds` is a brake on the next click, not a
toll on every step, and waiting it out between hops would make a four-hop walk
a minute and a half of refusals. So hop 1 makes the ordinary claim — two tabs
starting a walk in the same tick still resolve to one — and every later hop
passes `skipCooldown`,
which **swaps** the conditional `updateMany`'s clock for `locationId: <where we
read them>` rather than dropping it. That is a narrower guard, not a missing
one, and the right one for a walk: the thing a walk must never do is step on
from a position it no longer occupies, so an escort, a GM teleport or a Stepstone
landing mid-route stops it. `data` is untouched either way, so every hop
re-stamps `lastLocationMoveAt` and the **last** hop is the one the next click
waits on. `skipCooldown` is refused outright on anything but a same-zone hop, so
it can never become the hole that skips the free-crossing arithmetic.

**It stops at the first refusal and keeps the ground covered.** `ok: false` only
when the very first hop refused and nobody moved; anything later is `ok: true,
complete: false` with `stoppedBy`, and the player is standing where the last hop
put them. Every surface leads with **"You got as far as the Yard."** and then
prints **the mover's own sentence**, never one written at the surface — that is
what keeps a hidden crawl's refusal identical to a nonexistent edge's (§2a).

**The mover has no death gate, and the walk supplies one.** This is the sharpest
edge in the feature. `performLocationMove`'s incapacitation check is
`blockerFor(tags, ACT)`, and death sets `status: "DEAD"` while *stripping* tags
rather than granting a blocker — so a walker the Depot gun killed at hop 2 would
march on and be delivered to the destination as a corpse. The loop re-reads the
mover between hops and checks `status` itself. The re-read is mandatory for
three more reasons besides: `status`, `heldUntil` and `tags` are all written by
`applyLocationMoveSideEffects` *after* the mover already returned. It re-reads
with `ESCORT_SELECT`, because the next hop hands that row straight back to the
mover, which re-authorises the party off it.

**The party follows the whole way, and nothing was needed to make it so.** Each
hop reads `escortedById` inside its own transaction, so followers are carried
step by step and roll their own turret and Caving dice at every stop. One the
road refuses at hop 3 is left standing at hop 3 rather than back at the start —
which is right, they walked that far. The mover's own `escortedById` is cleared
at hop 1, the ordinary "walking under your own power detaches you" rule (§3a),
so setting off on a walk puts down whoever was carrying *you*.

**The caller must not run its own side-effect loop.** `walkWithinZone` returns
`sideEffectsApplied: true` and both faces branch on it. Reusing the single-hop
loop over the merged `moved` list would fire every turret twice and re-roll
every Caving Die — the easiest thing here to get wrong.

**What it costs in traffic** is worth knowing rather than discovering. Each hop
is a transaction plus a full arrival: the channel overwrite swap, room access,
thread invites, `notifyPresence`, a gate line. The Discord sidebar still steps
through each Location, because each stop really happened — and that is what
`WALK_HOPS` is small for. Same-zone hops write no archive rows either way, since
those are gated on `crossedZone`.

**The player no longer waits for that traffic, and this is the one thing to
understand before touching the walk.** An arrival is two halves, split at the
`DISCORD_TOKEN` guard that was always in `applyLocationMoveSideEffects`:

- **`applyArrivalFacts`** is the game — the fog, a narrow-way dismount, a hand on a
  shoulder, a turret's kill. Awaited, **per hop, in order**. The
  next hop does not start until a turret has had its say, which is what makes
  the paragraph above this one true.
- **`applyArrivalDiscord`** is the telling — channels, roles, threads, the
  lines, the DMs. It is **handed back**, not done, the way `interceptDms` always
  was: the walk collects one entry per arrival in `arrivalFacts`, and the caller
  runs them sequentially afterwards. The web's `travelTo` runs them in `after()`;
  the bot runs them inline, having no response to hold open.

`applyLocationMoveSideEffects` is now a wrapper over both, so a GM teleport, a
first placement, a rite and the turn's arrival pass are unchanged.

Why it had to move: eight hops of a full arrival is 32 or more sequential Discord
round trips, and one rate-limited call in `db/lib/discordRest/core.js` can sit on
a sleeping connection for the better part of two minutes (three attempts against
a 30s cap, plus a deferred bucket reset). So a walk could leave a player's click
hanging for many minutes with nothing drawn — see `ARCHITECTURE.md` §4,
"awaiting Discord inside a server action freezes the web app". The Move is still
spent and the character is still standing at the destination when the call
returns, exactly as §3 promises; it is only the telling that lands over the next
few seconds, which is the lag §3 already tolerates.

One Discord call stays in the game half on purpose, and it is a death: a
turret's burst. A death announced late reads as a death that did not happen,
and it is rare enough to cost a living arrival nothing.
`db/test/locationArrival.test.js` is a source check that holds the seam — add a
Discord call to the facts half and it fails by name.

## 4. The Discord half

**`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)`** is
the single function every caller runs after its DB write commits — never
from inside the transaction, the same reasoning `db/lib/dm.js` documents. It is
a wrapper over the two halves §3c describes, `applyArrivalFacts` then
`applyArrivalDiscord`; a caller with nobody waiting on a response wants this one
and need not know they are separate.
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

### 4a. Two fogs, and they never mix

There are two "fog" tables and they have opposite lifetimes. Do not reach for
one when you mean the other.

- **`LocationVisit`** (`db/lib/locationVisits.js`) is the **map** fog, behind
  `/map` (§6). It is per character, it only ever grows, and **nothing ever
  unlearns a row** — seen once, drawn forever.
- **`Vantage`** (`db/lib/vantages.js`) is the **channel** fog, per turn. A row
  says "this character walked out of here and is still watching it", and it is
  **one step and no further**: the light stays on only while that place is
  still directly next door to where they stand. Walk on past it and it goes
  out; the day turning puts out whatever is left (`CHANNELS.md` §3aa).

  The zone has nothing to do with it. Walking out through a gate leaves the
  street behind you lit exactly as any other single step would — whether that
  gate happens to be a zone boundary is not the player's business, so a
  vantage can sit in a zone its owner is not standing in. This used to be the
  zone rule instead, which meant a turn's walking lit every street you had
  passed through and handed one person a reading seat over half a zone.

  How it is read cheaply: `Vantage.anchorLocationId` is where the character
  stood when the row was last confirmed next door, so a read is one equality
  rather than a walk of the link graph. Adjacency is worked out **once**, by
  `applyLocationMoveSideEffects`, on the move that changes it — which also
  means a row left behind by a prune that failed to run reads as dark the
  instant they move.

`applyLocationMoveSideEffects` writes both, a few lines apart, which is exactly
why they need different names. It takes a `walked` flag, defaulting **false**,
and only the Travel button and the web's own travel action pass it — a
teleport, a rite, a spawn, Xom and a staged "Relocate to" record the visit on
the map but light nothing, because nobody walked out of anywhere.

## 5. Tax runs and the Lifeweb

Travel cost is also what a **tax run** costs. Handing ⬢ or an item to a
person requires the same zone — so a payment across zones is still a journey
somebody physically makes, checked against `Character.zoneId` exactly as
before.

The Lifeweb is the same rule with a fixed address: bleeding or feeding
someone to the Web needs the Mortus standing in the Fortress zone, because
that is where the tower is (`REQUESTS.md` §5a). The target is anyone
standing in the same Location as the Mortus, or the Mortus themselves — the
ordinary people-picker roster, so a hood or a stranger is offered by token
under what they look like (`STRANGERS.md` §6). It used to be every living
character in the zone, by real name.

## 6. The web `/map` panel

`/map` is the travel graph drawn over the Ravenheart plate: one **crosshair**
per Location, sitting on the very cell of the art that place was drawn as, one
line per edge the character may see, with the plate itself underneath. It replaced the retired four-rhombus zone panel, which went out
with per-zone-only travel and left this note in its place for a while.

Two hosts, **one component** (`web/app/(app)/map/MapBoard.js`): the `/map`
route, and an overlay on `/chat` opened by the place card's **Open map** and
closed with Escape, the backdrop or Return to game. On a folded viewport the
button navigates to the route instead of opening the overlay — a full-bleed
board inside the phone's "Here" sheet would be a dialog inside a dialog, and
§6e is what makes the route the better place to land anyway.

**Drag to pan, pinch or wheel to zoom**, with `−` / `+` / Reset as the path
for anyone who does neither. The whole view is `{x, y, k}` in a ref, written
straight onto one `<g>`; nothing about the board is React state, because a
pointermove that re-rendered fifty nodes and eighty lines drops frames on a
phone. The plate underneath is one `<image>` holding a picture
`plateRender.js` made once — see §6f.

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

**The fog does not start fully closed, and for most seats it barely starts at
all.** Map.docx: "all roles excluding migrants and late parties start off with
memory of all locations and connections outside of the caves and depths". That
is `db/lib/mapMemory.js`:

- **The floor.** Every live Location outside a `CAVE_LEVEL` zone, not
  `offMap`, that has at least one **non-hidden** way to another such place.
  That second half is the whole guard against a leak, and it is a rule rather
  than a list. It keeps out the Charon (`fortress-6`, no way at all), the ship
  in orbit (`offMap`) and the Hole in the Wall (only hidden crawls, and a climb
  up from the Depths). A locked way still counts, because a door you can see
  and not open is on everybody's board anyway (§2a).
- **Seen, not stood.** The floor is written as sightings: a hollow crosshair
  and a name, with no description and no rooms. You know the Keep is there,
  not what is inside it. It is one bulk write rather than `recordArrival` per
  place, because that paints every listed neighbour too, and would hand over
  the cave mouth off the Bridge and the Depot.
- **The outsiders** skip the floor: the Migrant and the late joins (the
  Tribunal and the Bastard's party, `db/lib/lateJoin.js`). The Mercenary and a
  threat spawn get it like anybody else.
- **Connections need no store.** A way draws when both ends are known and
  `crossingCheck` lists it, so "every connection" follows from "every place",
  and a hidden way still shows only to somebody who can go through it.
- **New characters only.** Everybody already alive keeps the map they had.

`seedStartingMap` is what all three creation paths call (`createCharacter`,
`reincarnate.js`, `threatSpawn.js`): the floor, then the per-role table below
on top of it. The map is a memory in the Memories sense as well, so Concussed
and Amnesiac scramble it (`MEMORIES.md` §6a).

**The role table is the `stood` layer on top.** A character is made having
stood in the places their life would have taught them — the home cluster, plus
the road their trade actually walks. A Sheriff opens the board already seeing the bridge he has
walked for years; a Banneret sees every step of the run up to town. The table is
`db/lib/startingMemories.js`, keyed by role slug. `createCharacter` calls
`seedMemories()` once, after the transaction commits — after, because
`travelOptions` reads the tags it just granted.

**The town is not something the fog is for.** Every seat that lives in
Ravenheart — the court, the Cerberon, the clergy, the trades, the Undertown —
starts knowing all ten of the town's places and the gate up to the fortress,
the `RAVENHEART` constant in that file. There is no version of a life here that
does not teach you the Square and the Cathedral, and a Courtier opening the
board on a fogged town read as a bug rather than as a secret. The seats the
town stays dark for are the **outsiders**, and only those: the Migrant walking
in through the caves, the Mercenary at the mouth, the Tribunal and the
Bastard's party marching into the Black Hills. Under that floor each seat adds
what its own work walks — the Den's people the streets they work and the cellar
under them, the Bum the same streets and no cellar, a Factory seat the road up
and the end of the Undertown the Squeeze is sold at, the Mortus the way down to
the Tower and the tunnels out of it.

**The Undertown is mostly ordinary now that it is built.** Nine of its places
have a plain way in, so `UNDERTOWN_STREETS` is what somebody who lives down
there knows, and the seats are tiered off that: `DEN_HOUSE` adds the Den
Interior for the five seats who work it, `UNDERTOWN_TRADE` is the three places a
Factory seat comes up to. Three are held back by hand in `UNDERTOWN_WITHHELD` —
the **Hole in the Wall**, which is the one genuinely hidden place left down
there; the **Island**, across the water behind Strong Swimmer; and the **Order
Chambers**, which everybody already sees hollow off the Cathedral and nobody
starts out having been inside. Note that the **Hollows** is *not* one of them:
it used to be called the Alleys, which invites the wrong conclusion, but it is a
plain street off the Slums. The town's own **Alleys** are `town-5`, and they are
in `TOWN_ALL`.

`KIT_MEMORIES`, the second half keyed by a starting tag, is no longer empty: it
carries one entry, `ravenhearter` to the ten town places. That is a **floor, not
the mechanism** — the role table above is what actually decides each seat, and
six Undertown and Factory seats who plainly live here carry no such tag. What
the entry buys is that a role added to `docs/roles.yaml` which nobody remembers
to add to the role table degrades to "knows the town" instead of to a blank map.
That is not hypothetical: the Soiler shipped unable to see the Soilery they
farm.

**`db/test/startingMemories.test.js` is what keeps the table honest**, and it is
worth knowing what it asserts before editing either master. Every slug in the
table resolves to a Location in `docs/zones.yaml`; every role in
`docs/roles.yaml` has an entry, so adding a seat fails the run until somebody
decides what it knows; `fortress-6` appears under exactly the Baron, the
Baroness and the Hand; and no table names a place whose every edge is hidden.
That last one is derived from the connection list rather than listed, so a
secret added later is covered without anybody remembering the test — with a
hand-written blocklist beside it for the Undertown, which was authored live at
`/gm/dev/zones` and whose edges `docs/zones.yaml` therefore does not know.

**Leaving a slug out of that table is not a guarantee it stays dark**, and it is
worth being clear about why. `recordArrival` paints every *listed* neighbour of
a seeded Location, and a locked way is listed — so a seat seeded in the Caves
reaches `caves-1` through the gate it may not open whether the table names it
or not, which is correct: you can see a door you have no key to.
What leaving a slug out really protects is a **hidden** way, since
`travelOptions` drops those before the sighting write ever runs. The table is
therefore written to the standard of "would this seat's life have taught them
this", not "is this a secret" — the cargo-bay seats stop at `caves-2`
rather than the Migrants' camp, because the camp is one open road from the
brooding grounds and two from the mouth of the Depths.

### 6b. What the fog must never leak

**The fog is server-side, not CSS.** An unknown Location is absent from
`loadMap`'s payload; it is not sent and hidden. A server action is a public
endpoint.

**A GM's Show all is the one way round the fog for somebody playing.** A GM
with no living character has always read the whole plate. A GM who is playing
gets their character's map like anyone, plus a **Show all** chip beside Names
(Map.docx). It asks `loadMap({ revealAll: true })`, and the server re-checks
the GM seat before lifting anything, since a player can post `true` too. On
Show all every place and way is drawn, nothing is scrambled, and a hidden way
is sent with `hidden: true` and drawn faded. Before, a hidden crawl and a
locked door looked the same on the one board that draws both.

**A scrambled memory is fog as well.** A name a Concussed or Amnesiac
character cannot recall is garbled on the server, and a way they have lost is
not sent at all, unless it touches where they stand (`MEMORIES.md` §6a).

**An edge draws only when both ends are known *and* `crossingCheck` says
`listed`.** That is the §2a rule applied to a picture: a locked door draws
dashed and says why, a hidden crawl draws nothing at all and reads exactly like
two places with no way between them. The three `hidden: caving` crawls are the
only unknown ways into the Depths, and this is what keeps them that way.

**The plate switch offers only the plates holding somewhere known.** Offering
Undertown earlier would announce that it exists.

**Only the ART is public.** `npm run map:build` writes two files per plate, and
the split is this rule rather than tidiness:
`web/public/assets/maps/<id>.json` is fetched by the browser and holds cells,
glyphs and a bare list of marker COORDINATES; `docs/assets/maps/<id>.nodes.json`
holds the names and slugs and is read server-side only, through
`web/lib/mapPlates.js`. One file would have published the whole gazetteer —
every place on the plate, named, to anyone with curl — fogged or not. The
coordinates go with the art because the rendered picture puts the light on them
in plain sight anyway.

### 6c. Travel

The map is a second **door** onto travel, never a second mover. Picking a
reachable node opens the same confirm strip the Travel panel uses, reading the
same numbers through `web/lib/travelCost.js#travelFoot` — extracted from
`TravelNodes.js` precisely so the two surfaces cannot disagree about what a hop
costs — and Go calls the same `travelTo`, which re-derives every gate
server-side regardless.

**A click only picks**, on both surfaces and every pointer, and the card's (or
the strip's) **Go** is the ordinary door onto `travelTo` — including for a place
several hops away, which is how a walk is taken on a phone. A second click on
the place you already picked unpicks it on the map, and on the Travel panel
leaves the strip where it is.

**A zone crossing asks again on top of that.** Go opens the shared
`useConfirm()` dialog, naming the zone, what the crossing spends, and how many
people come with you. Both surfaces build that sentence from one place,
`web/lib/travelCost.js#crossingConfirm`, for the same reason they share
`travelFoot`.

#### The gesture, and the two limits on it

**A double-click on the map walks you there, and Enter does the same thing.**
It is a shortcut for a mouse, not the way the feature works — everything it can
do, Go on the card can do, on any device.

This was taken out once, and the history is why the limits are shaped the way
they are. The second click used to be Go for a hop inside your own zone. Two
complaints ended it. A player double-clicked while reading the menu, crossed a
zone he had not chosen and took somebody with him; then on a phone, where the
Travel panel is a drawer full of small nodes, a tap that landed on the node
already chosen moved somebody with no sentence in front of it at all.

So the gesture is back under exactly the two limits that answer those two
complaints, and `canGestureTo` in `MapBoard.js` is both of them in one place:

- **Never across a zone.** That is the first complaint, closed at the root
  rather than warned about: a hop inside your own zone spends no travel, no
  Move, and nothing anybody else has to live with. There is nothing left for a
  stray double-click to waste. A crossing still wants the strip, the confirm
  dialog and a deliberate press — `canGestureTo` is deliberately a SHORTER list
  than `canTravelTo`, and that gap is the whole design.
- **Never down a road that would take your horse off you.** The one thing a
  walk does that cannot be undone for free (§2c). Go still offers it, with
  `· on foot` written on the node first.
- **A mouse, tested on the pointer itself.** `PointerEvent.pointerType`, kept in
  a ref on every `pointerdown`, and **not** a `(pointer: fine)` media query —
  which is true on a tablet with a mouse paired to it *while a finger is on the
  glass*, and would hand the second complaint straight back. A finger reports
  `"touch"` and a pencil `"pen"`, so a tap can never be a gesture on any device.
  `.map-hint` is hidden under `(pointer: coarse)` for the same reason, so a
  phone is never told about a shortcut it does not have.

**And the stops are named before the gesture is made.** The card reads
`Through the Market and the Yard.` above Go, from
`web/lib/travelCost.js#walkLine`. That sentence is what turns "a gesture moved
me somewhere" back into "I chose to walk through the Market and the Yard", and
it is load-bearing rather than decorative: if it ever gets cut for space, the
gesture should be cut with it.

**Order matters in the handler, and is easy to get wrong.** A browser fires
`click`, `click`, `dblclick` — so the second-click unpick has *already* set
`sel` to null by the time `onDoubleClick` runs. The handler therefore acts on
its own node and asks `sel` nothing; written as `if (sel === n.id)` it would
never once fire, and would read as the feature simply not working.

**Enter is the same affordance with a keyboard.** It is a **document-level**
`keydown` that only exists while a node is picked, not a focusable rhombus.
Fifty SVG `<g>`s in the tab order in front of Go is worse than no keyboard
support at all, and `role="button"` on each would have a screen reader read the
whole plate as a toolbar. It stands aside whenever `document.activeElement` is a
`button`, `a`, `input`, `textarea`, `select` or anything in a `[role=dialog]` —
so Enter on Go, on the layer switch, or inside the confirm dialog this very
handler can open is never handled twice. There is still deliberately **no
Escape**: on `/chat` the map sits in a Modal that already owns it.

**Tapping the plate itself unpicks**, on both surfaces. A node's own handler
owns its clicks and the drag guard still applies, so this is only ever a tap on
open ground. It is a second way out of a card, beside Cancel and the node's own
second click, because on a phone a description sitting over most of the board
with nothing obvious to do about it is a trap.

For a long time it said that and did not do it. `card` fell back to `here`
whenever nothing was picked, so on a phone the sheet was never empty, and
clearing `sel` — which is all this handler does — changed nothing a player
could see. Cancel could not help either: it is gated behind `!isHere`, so the
one card that was always up was the one card with no button to shut it. The
fallback is a desktop-only thing now (§6e), which is what finally makes this
paragraph true. On a phone there is a **✕** on a picked card as well, and this
same tap puts an opened sheet back down to its bar.

`canTravelTo(node, here)` is the one predicate the board and the card read for
**Go**, so a place can never offer it while its own card is showing a refusal.
It has two ways to say yes: next door and open, or `walkable` — somewhere
farther in your own zone, reached through places you already know (§3c).
`canGestureTo` is the narrower second predicate above, and the only one the
double-click and Enter read.

### 6d. The raster plate, and what replaced it

**Gone.** `/map` drew a 2144x1792 PNG until 2026-09-20, placed Locations from a
hand-kept table of image pixels (`docs/assets/map-nodes.json`), and cut the one
blue the artist had drawn — the water — into an alpha mask so a token could
repaint it. All of it went with the drawn plates below: the art follows the
theme by naming channels now, so there is nothing left to mask, and the places
come out of the art rather than out of a parallel table.

One sentence survives the section. `Zone.mapPolygon` / `mapLabelX` /
`mapLabelY` are still there and still always null: they described the retired
four-rhombus panel, and nothing reads them.

### 6f. The two Playscii plates

**The world went underground, and the map was redrawn for it.** There are two
plates now, both authored in [Playscii](http://vectorpoem.com/playscii/) and
both committed under `docs/assets/maps/`:

| Plate | Holds | Later |
|---|---|---|
| `barony1.psci` | Town, Fortress, Black Hills | Caves, placed in the rock |
| `barony2.psci` | Undertown | The Depths, placed in the rock |

Wilderness is gone as a zone — it was folded into Black Hills, which is why
that zone's codes `6`-`A` are `recode`d in the node table rather than
repainted in the art.

**The `.psci` is the master and nothing exports a PNG any more.** §6d's plate
was a raster with a parallel table of pixel coordinates, which is what forced
`make-map-river.py` into existence: the art carried one hardcoded accent
(`#57a9bc`) and the only way to theme it was to cut it out to an alpha mask.
`npm run map:build` (`scripts/map/build-maps.js`) compiles both `.psci` files
into `web/public/assets/maps/<id>.json` plus
`docs/assets/maps/<id>.nodes.json` (§6b says why that is two files), and two
things fall out of that:

- **Every cell names a CHANNEL, not a colour.** `void`, `stone`, `lit`,
  `heat`, `filler` — mapped from the Playscii palette index by
  `docs/assets/maps/nodes.yaml`. The colour is a CSS token chosen at render
  time, so the whole plate follows the theme and the river hack retires with
  it.
- **Node positions come out of the drawing.** Layer 5 of each map is a hidden
  layer of markers: the glyph is the location's system code (`1`-`9`, then
  `A`-`Z`) and the marker's *colour* is its zone. Nothing keeps a pixel
  coordinate by hand. `nodes.yaml` only says what each code is called.

The build fails loudly on a marker with no entry in the table, an entry with
no marker, a duplicate code in a zone, or a marker colour the table does not
name. Adding Caves is one more `- fg:` group in `nodes.yaml` once the markers
are painted — no code change.

Three details are worth writing down because they were established by
measurement, not by reading a spec, and a future change could quietly undo
them:

- **The charset is `kenney_1bit_16`, 32x32 glyphs of 16px**, vendored at
  `docs/assets/maps/charset/`. It is pure white on transparency, so a glyph is
  a 1-bit mask; the build packs only the glyphs a map actually uses into the
  JSON as base64 rather than shipping a cropped atlas PNG. `'0'` is glyph 947
  and `'A'` is 979 — read off the sheet, not assumed.
- **The transforms are BAKED INTO THOSE MASKS**, one slot per (glyph,
  rotation) pair in use, and the compiled cell is `[index, slot, channel]`
  with no rotation left in it. Playscii's transform table therefore exists
  exactly once, in `scripts/map/build-maps.js`. It is written down that way
  because the first renderer kept its own copy with two cases transposed and
  turned 79 of `barony1`'s cells — most of them cave wall — the wrong way
  round. Baking costs 141 slots instead of 106 glyphs, about 4.5KB. **A
  renderer that cannot rotate cannot rotate wrongly**; do not reintroduce a
  runtime transform.
- **The palette is 1-indexed**, slot 0 being Playscii's transparent one. The
  five channels are indices 1, 2, 3, 12 and 13, and `nodes.yaml` deliberately
  maps **no** channel to slot 0 — an unmapped slot is reported, never drawn.
  That is not fussiness: slot 0 was briefly given a channel of its own, which
  painted 34 house glyphs nobody had drawn on purpose across the east side of
  Town. They were only in the file because a transparent foreground is
  invisible in Playscii, so nothing ever showed the mistake.
- **Glyph 168 is a solid block**, and it is what the rock is painted with —
  689 cells of `barony2` alone. That is the "wallage" the vignette exists to
  thin out. The renderer fades it by *coverage*, dithering the block down
  toward nothing, not by dimming it to a flat wash.

**Anything under that block is invisible in Playscii and not in the browser**,
because the vignette thins the rock until whatever was buried shows through.
The build **reports** those cells; it deliberately does not cull them. The
obvious rule — drop everything under an opaque glyph — would have thrown away
the **rust river** at the east end of `barony1` (19 `heat` cells at x 33-38,
y 16-23), which is buried in the rock on purpose and is meant to read through
the stone as it thins. `npm run map:scrub` is the tidy-up for the rest: it
clears transparent-slot glyphs and buried cells from the masters, keeps the
`heat` ones, matches every cell's exact contents before touching it, and is a
dry run unless given `-- --apply`.

**`web/app/(app)/map/plateRender.js` is the one renderer, and it is not a
loop.** The picture depends on the plate and the palette and on nothing else —
not on fog, not on what is picked, not on where the view is — so it is drawn
once into an offscreen canvas and handed to the board as a data URL. Panning
it costs a transform on an `<image>`. There is no canvas in the document, no
requestAnimationFrame and no per-frame work anywhere on the board, which is
the rule DESIGN-SYSTEM.md sets for every surface.

What it does, in order, with the knobs frozen as constants rather than shipped
as controls:

- **A distance field**, cell to nearest place, computed once per plate. It is
  measured from the ART's own markers (`lights`, the bare coordinate list in
  the JSON) and not from the places this character knows. Light that followed
  the fog would recompute on every arrival — and would BE a leak, since a
  bright patch is a place and you would see one glowing somewhere you had
  never heard of.
- **The vignette**, `{inner: 3, outer: 11, floor: 0.06}` cells, on the `stone`
  channel only. It is spent as **coverage** through a 4x4 Bayer dither, never
  as alpha: fewer dots further out is what a thinning wall looks like, and the
  same dots at lower opacity is a grey wash. The floor is what keeps a far
  corner a wall rather than a hole.
- **The light**, `{reach: 7, ambient: 0.45}`, off those same places. There was
  a second term lighting everything near the rust, and it is **gone rather
  than switched off** — Bascinet asked for the burn out, and a flag nobody
  sets is a flag somebody sets back. The `heat` channel still PAINTS: the
  river buried at the east end of `barony1` is meant to read through the
  thinning stone, which is the whole point of not culling it.

The colours are handed in, never named: `MapBoard` reads `--map-void`,
`--map-stone`, `--map-filler`, `--map-lit` and `--map-heat` off the live theme
and passes them down. That is how a canvas keeps "zero hardcoded colours"
true.

### 6g. The plate and the master are the same places now

Until 2026-09-19 the plate and `docs/zones.yaml` were two descriptions of the
barony that had drifted apart: the plate drew a Gatehouse, a Soilery, an Alleys
and a Residences that the master did not have, and the master still carried a
`forest` and a `marshes` for a surface the setting had destroyed. The rework
made them agree for Town, the Fortress and a skeleton Undertown.

**Slug == map code** is what keeps them in step. A Location is `town-1`, a Room
is `town-2-3`, so the plate's node addresses its Location directly and
`build-maps.js` derives the slug rather than looking it up. A `slug:` override
on a node now means only one thing: that zone has not been renumbered yet.

**`npm run map:check` is the guard** (`scripts/map/check-places.js`), read-only
and exit-1 on a problem. It asks five questions:

1. Is every slug unique across zones, locations and rooms?
2. Does every `access:` and `stash:` slug — `items:` and `hidden:` both — name
   a real tag? Nothing else checks this — the importer cannot, because tags
   sync *after* zones.
3. Does every connection name two real Locations, each edge stated once?
4. Does every node on the plate have a Location, and every Location in a
   renumbered zone have a node?
5. Can you walk there? An unreachable Location is a Discord channel nobody can
   ever stand in.

A Location in a zone still on the `PENDING` list, or one with no rooms written
yet, is reported as a **note** rather than a problem — that is the Undertown's
twelve skeletons waiting for their own pass.

**Stashes seed themselves now.** A `stash:` block rides onto the Room as
`Room.stashSeed` when `db:import-zones` creates it, and the Restart Game wipe
and Start Game each turn the whole lot into real `RoomTag` rows in one pass
(`db/lib/roomStashSeed.js`, through `db/lib/worldSeed.js`), guarded by
`Room.seededStashSlugs` so nothing is ever poured twice. A Location's
`structures:` ride along in the same pass. Standing a game up used to mean a
superadmin pressing "Seed these items now" once per room, by hand, across
eighty-odd rooms.

**A place is marked by a crosshair, not a number.** Two glyphs out of the
charset's own reticle row (474-479), named in `nodes.yaml` under `uiGlyphs`
and packed into the JSON's `ui` block because the art never draws them:

- **`faint` (476)** — four corner ticks, 24 lit pixels — sits on every place
  you can see. Enough to say something is here; quiet enough to put on fifty
  cells at once.
- **`locked` (475)** — corner brackets and centre ticks — sits only on the
  place you have picked and the place you are standing in, and carries the
  name under it.

The board draws them as **SVG paths, one subpath per lit pixel**, rather than
onto the canvas under them. That is what keeps `data-zone`, `data-state` and
`data-picked` colouring a mark from a token the way everything else on the
page is coloured, and what leaves every handler on the node untouched — a mark
is still an element you click. It is also what makes the hit area worth
naming: a crosshair is four corner ticks with a HOLE where the target appears
to be, so `.map-node-hit` is live on a mouse now, one cell wide, which is also
as wide as it may be before it reaches the next place along (the two closest,
the Den and its interior, are one cell apart).

Where you stand reads white and what you picked keeps its zone's colour, so
the two loud marks never read as the same thing. Two details are load-bearing
rather than decorative, both found by looking at it: a faint mark needs a
**1px dark drop behind it** or it vanishes, because its corner ticks land
exactly where a building's own white outline already is; and it needs to sit
near half opacity rather than a third, for the same reason. Numbers were what
this replaced — fifty digits floating over the art read as a spreadsheet, not
a map.

**Names are on by default** (Map.docx). They were off for a while, on the
argument that fifty captions compete with the art. But a map you have to switch
on before it tells you anything read as a picture. The **Names** chip turns them
off, and the two loud marks are named whatever it says.

**Every name is placed, not dropped under its mark.** With all of them showing,
the old rule — centred one line under the crosshair — piled neighbours onto
each other: The Old Cock Inn ran through the Square, the Den through the Den
Interior. `MapBoard.js#placeLabels` measures each name in the label font and
tries under, over, right, left, then the corners, then a line further out. It
takes the first spot that clears every name already placed and every
crosshair. The loud names go first (where you stand, what you picked), then
places stood in, then places seen. It works in plate pixels, so zoom never
changes the answer.

**A way is a white line with a black rim** (Map.docx): `.map-edge` over
`.map-edge-rim`, with `vector-effect: non-scaling-stroke` so both stay one
crisp screen width from the floor of the zoom to 16×. It used to be a faint
pencil line at a third opacity that players could not follow across the art.
State is still readable: a way shut to you is dashed, a tight squeeze dotted.

**A gated way says what opens it.** Hover it, or tap it on a phone, and a
card reads "Tower Key opens this way.", plus "So does a signet ring that
carries it." when some seat's ring carries that token (`RINGS.md`). The name
comes from `needs` on the edge, sent only for a way already in the payload, so
a hidden crawl the character cannot use is never named.

**A red stair marks a way to the other plate** (Map.docx): the charset's own
staircase (glyph 194, `uiGlyphs.stairs` in `nodes.yaml`), at the top right of
the place's cell. Hover or tap names the far side ("Down to:" from the Barony,
"Up to:" from under it), and the place's card says the same in a line, for a
phone. It is worked out from the edges already in the payload (`stairsOf`), so
a stair follows the same rules as the way it stands for. A hidden crawl you
cannot use draws no stair, and neither does a way your scrambled memory has
lost. It is keyed on plates, not zones, so the Undercroft (a Fortress place
drawn on the Undertown plate) takes the stair up to the Court.

**A stair needs only one end.** A way draws its line only when you know both
places, but a stair belongs to the place it leaves from: knowing the Square is
knowing its stair down to the Slums. So when you know one end and not the
other, loadMap still sends that stair in `stairsAt`, as the near place's id and
the far side's name. The hover and the card name the far side as usual. It
gets no line, no node and no id, so it is not on the map until you learn it
some other way. The name goes through the same scramble as every other place
name. Before this, a character who knew every town place but none of the
Undertown saw no stairs in the town at all.

`Zone.mapPolygon` / `mapLabelX` / `mapLabelY` stay as dead as §6d leaves them;
none of this reads them.

### 6h. Two plates, not two layers

The board used to have a **Surface / Underground** switch, keyed on whether a
zone was a `CAVE_LEVEL`. It is a **plate** switch now, keyed on which plate
draws the place, and the old axis was wrong anyway: `docs/zones.yaml` declares
Undertown `kind: surface`, so a cave-level test would have put nothing at all
on the second plate.

**The view does not carry across a switch.** Surface and Underground were one
drawing shown twice, so `{x, y, k}` meant the same thing on both and keeping
it read as two faces of one place. The Barony and Undertown are two separate
41x24 worlds that share no coordinate, so carrying it would land you at the
same numbers in a different country. A switch re-frames.

**What the plate cannot place.** A Location with no cell on either plate is
drawn nowhere and listed everywhere: it arrives in the payload, appears in
**Ways out** and **Further in**, and gets a card and a **Go** like anything
else — it just has no crosshair. That is every `caves-*` and `depths-*` place
today, waiting on art in the rock. It is deliberately not a dropped row: they
are real places a character walks to, and a dropped row is a place with no way
out of the room. `hills-mountain` was the third case and is simply gone — the
Black Hills have no pass any more, and the `climb-the-mountain` desire went
with it.

### 6e. The board on a phone

For a while the map was readable on a desktop and a picture of a map on a
phone: there was no pinch handler at all, `touch-action: none` had already
taken the browser's own away, and the only zoom left was two ~20px buttons in
a corner. Three things fix it, and they are all in `MapBoard.js` and the
`/map` block of `globals.css`.

**Pinch is two pointers and one number.** Every pointer down on the board is
kept by id in a ref; a second one ends the pan and starts a pinch, measured by
`gauge()` as the distance between the fingers and the plate pixel between
them. Each move hands `zoomBy` the ratio of the distances, the **old**
midpoint as its anchor and the **new** one as where that anchor should land —
which is the whole trick, because it makes a two-finger drag pan and zoom in a
single write. `to` defaults to `at`, so the wheel and the buttons are
unchanged. Two things are easy to get wrong and are handled: lifting one
finger of two re-seats the pan on the finger that is *left* (on the midpoint,
the map leaps by half the gap between them), and `panned` is set the moment a
second finger lands, so the click that fires when the last one lifts is never
read as picking a place.

**The zoom floor of 1 still holds**, and pinch-panning survives it: at the
clamp the factor is swallowed and the translation is not, so a two-finger
drag at full extent still moves the board.

**A node is about two pixels across at the floor**, so each carries an
invisible `.map-node-hit` square — the `.check-hit` idea in SVG. It is inert
on a mouse, which does not need it and would only lose precision. `HIT` is 27
plate pixels half-width, which is not a taste: the two closest Locations on
the plate sit 54.6 apart, and anything wider turns a tap in the Fortress into
a lottery. `applyView` writes `--map-hit` on every frame to shrink that toward
44 CSS px once you are zoomed in far enough to have the room. Below about
2.7× the cap binds and the target is simply as big as it may be — which is
honest: fifty nodes over 375px cannot each own 44px, and pinch is the answer
to that, not arithmetic.

**There is no zoom bar on a phone.** Pinch is the zoom, and the bar was sitting
over the top-left corner of the plate — Headwaters and the Mountain live under
it — to buy back a control nobody was reaching for. Reset went with it and is no
loss: `applyView`'s clamp means you cannot get lost off the plate, and pinching
out to the floor shows the whole thing. Only the layer switch is left up there,
and a tablet wide enough for the two-column layout keeps the bar.

**The sheet is opaque.** The card is a `.panel`, and a panel is a translucent
wash (`--sunk-wash-deep`). Beside the board that did no harm, but over it the
plate showed through, and players on phones reported the whole map looking
see-through (Map.docx). Under 640px it takes `--surface`, like the HUD boxes.
The `/chat` overlay, if it is open when the window narrows, keeps the whole
screen too, instead of becoming the modal's 92dvh sheet over the dim.

**Under 640px the card is a sheet over the board, not a column beside it.**
It used to be a strip underneath taking 40% of an already short screen, which
letterboxed the plate. Over it, the drawing runs on underneath and anything
the sheet covers is one drag away.

**It has three heights there, and the resting one is a single line.** They come
off `data-picked` and `data-open`, and the component behind them is
`useMapNarrow.js` — a 640px media query, matching this block exactly, because
CSS drawing a sheet while the component still fills a column is its own bug.

| | What the sheet is | Roughly |
|---|---|---|
| nothing picked, shut | the name of where you stand, and a chevron | one line |
| nothing picked, open | that bar, plus Ways out and Further in | up to 62dvh |
| something picked | that place's card, far enough to show Go | up to 62dvh |

It had two, and the resting one was wrong in a way that took a player report to
see. The cap said 32dvh, but what sat under it was a whole location card —
description, Inside lists and both way-lists — because `card` fell back to
`here` and `data-picked` was keyed on `chosen` instead, so the CSS and the
contents disagreed about whether anything was picked. A third of a short screen,
permanently, over the one thing the page is for, with neither documented way out
working (§6c). **So on a narrow screen `card` does not fall back to `here`.**
A wide one still does, and should: there the card is a column beside the board,
it covers nothing, and an empty column would be worse than a full one. The `.map-hud` wrapper is
`display: contents` on a desktop, so the layer switch and the zoom bar each keep
the corner they have always had; on a phone it is a column, which is what let
the two stack rather than fight over 486px of a 390px screen — and is now
carrying the layer switch alone.

## 6i. Off the map

A Location carrying the `offMap` attribute has no marker on either plate and no
edge to anywhere, so every question this panel normally answers — which plate,
what is next door, where you could walk — has no answer for it. Rather than
draw an empty barony around somebody who is not in the barony, `/map` says so:
a dithered grey field, the layer switch drawn but **disabled**, and one locked
reticle in the middle with that place's own card beside it.

`web/app/(app)/map/actions.js` branches on it early — before `travelOptions`,
`routesWithinZone` and the rest, none of which mean anything for a place with no
links — and returns one node, no edges, and `offMap: true`.
`MapBoard.js#OffMapBoard` draws it. A GM reading the whole plate is deliberately
not sent down that branch: `unfogged` has no location of its own to be off the
map at.

The Charon in orbit is the only place carrying it today
([`CHARON.md`](CHARON.md)). It is an attribute rather than a slug check so the
second one needs no code.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, walking the party, the Caving roll; no Discord |
| `db/lib/locationWalk.js` | `walkWithinZone` — several hops inside one zone on one press (§3c). NOT a mover: every hop is `performLocationMove` and then `applyLocationMoveSideEffects`, which is what makes the turrets and the ambushes real at every stop |
| `db/lib/escort.js` | The escort authority, the party, and the consent handshake — §3a. The ONLY module that decides who follows whom |
| `db/lib/travelArrivalPass.js` | a DRAIN. Nothing files work for it; it lands anybody left mid-journey by the removal of deferred travel (§3) |
| `db/lib/intercept.js` | Laying in wait, and the hold it puts on somebody — [`INTERCEPT.md`](INTERCEPT.md). The ONLY module that decides who a watch catches |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half, shared by every caller |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess` — private Room membership, one unit per private thread (§2d) |
| `db/lib/roomSides.js` | Rooms that open onto several Locations — §2d. The ONLY module that reads `RoomSide`; `roomAt` / `loadRoomsAt` are what every side-aware reader goes through |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `db/lib/mounts.js` | `FAST_TRAVEL_SLUGS`, `isMounted`, `fastTravelCapacity` (the seat count §3a gates the mount's bonus on) |
| `db/lib/turnFormat.js` | `turnDay` — the in-game day a mount's second crossing is claimed against |
| `db/lib/locationGraph.js` | `LocationLink` reads and the gating verdict — the only module that touches the edge model. Also the two multi-hop questions: `soundRange` for how far a shout carries, and `routesWithinZone` / `pathWithinZone` for a walk (§3c) |
| `db/lib/locationAttributes.js` | The attribute registry, its sync-time validation, and the prose Examine prints |
| `db/lib/locationVisits.js` | The fog: what one character knows of the map. The ONLY module that reads or writes `LocationVisit` |
| `db/lib/mapMemory.js` | The map everybody but the outsiders starts knowing, and `seedStartingMap`, which every creation path calls — §6a |
| `db/lib/startingMemories.js` | The places a seat starts having STOOD in — role slug to Location slugs — §6a |
| `web/app/(app)/map/` | `loadMap()`, the board, and the route — §6 |
| `web/app/(app)/map/plateRender.js` | The plate, drawn: channels, the stipple, the light, and the crosshair paths — §6f. Client-side, React-free, and the ONLY thing that turns a plate into pixels |
| `web/lib/mapPlates.js` | Server-only: which plate places a slug, and where on it. The place table never reaches the browser — §6b |
| `web/lib/travelCost.js` | `travelFoot` — what a hop costs, in the words both travel surfaces print. `walkFoot` / `walkLine` are the same job for a walk |
| `docs/zones.yaml` | The master: zones, Locations (with their seeded `structures:`), Rooms, and `connections:` with its edge types |
