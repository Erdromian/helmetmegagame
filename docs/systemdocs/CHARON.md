# The Charon

The ship above the Keep. It is the only way out of the barony that is not a
grave, three people know it is there, and it can be used exactly once.

---

## 1. What it is

A Location, `fortress-6`, drawn one tile above the Keep on the barony1 plate.
Two rooms: the **Cockpit** (`fortress-6-1`) and the **Habitation**
(`fortress-6-2`), the second stocked with 10 tinned butter.

It has **no `LocationLink`**, and that is the whole design. Travel cannot offer
it, the map cannot light it up by adjacency, and nobody can walk to it. The only
door is a button in the **Panic Room** (`fortress-4-d`), which is itself behind
the Baron's or the Baroness's key.

It used to be a room in the Keep called The Charon — a sealed gate with one
sentence of description and nothing behind it. That room is gone.

## 2. Who can see it

Three seats, and only because `db/lib/startingMemories.js` says so: the **Baron**,
the **Baroness** and the **Hand** carry `FORTRESS_ESCAPE` instead of
`FORTRESS_INNER`.

That table is the only way anybody learns it exists. Its own header explains
why a seat cannot normally withhold a place — `recordArrival` paints every
*listed neighbour* of a known Location as a sighting — but the Charon has no
neighbours, so there is nothing to paint from. The Heir, the Successor and the
Arbiter sit in the same rooms and see nothing.

Add a slug to `FORTRESS_ESCAPE` and that seat knows. Leave it off and they
cannot find the ship at all.

## 3. Getting aboard

**Enter the Charon**, on the Panic Room, for anybody who can get into the Panic
Room. Six seats:

> The Charon can only fit six people.

The count and the write are the same transaction (`db/lib/charon.js#relocate`
takes a `guard` that runs inside it), so six people pressing at the same instant
cannot make seven.

Once the ship has gone the button stays, and answers:

> The Charon already launched.

**Leave**, on the Charon itself, puts you back in the Keep. It is a Location
affordance rather than a room one, and it is the only way off — Travel has no
edge to offer.

Both are **raw relocations**: write `locationId`/`zoneId` in a transaction, then
run `applyLocationMoveSideEffects` outside it. `performLocationMove` validates a
`LocationLink` and would refuse, so it is the wrong door.
`db/lib/riteEffects.js#summoning` is the precedent.

## 4. Launching

One button on the Cockpit, doing three things depending on where the ship is in
its own story: start, cancel, or refuse. One button rather than three because
which of them it is depends on state the player can already read in the feed.

Pressing it starts thirty seconds, said out loud into the Charon's feed:

| | |
|---|---|
| T-30 | `The magnetic locks disengage. The Charon will launch in 30 seconds.` + `airlock-force` |
| T-15 | `The Charon will launch in 15 seconds.` |
| T-0 | `The Charon is launching.` |

Pressing it again inside the window cancels: `The launch sequence was
cancelled.` + `airlock`. Pressing it after the ship has gone refuses to the
presser alone, with the console's own noise: `The Charon was already launched.`

**The countdown is a timestamp, not a timer.** `CharonLaunch.launchAt` is the
whole of it, and `db/lib/charonSweep.js` — on the bot's five-second tick beside
the rite sweep — is what reads it. So a player closing the tab, a deploy, or the
bot restarting through the middle of a count all survive: if the bot is down
past `launchAt` entirely, the first tick after it comes back writes the beats it
owes and launches the ship. Late, never lost.

**Idempotence comes off the feed**, the way `gameChannel.js#postTurnToGame` does
it: before writing a beat, look for it, scoped to this countdown. No bookkeeping
column to drift out of step with what players actually read.

A five-second tick means a beat can land up to five seconds late. That is the
price of surviving a restart, and it is the right trade for prose.

## 5. What launching does

`db/lib/charon.js#completeLaunch`, claimed conditionally so two overlapping
sweeps cannot launch the same ship twice:

1. **The rooms travel.** `Room.locationId` is repointed at `space-1` — the same
   two rows, not a second authored pair. The butter, the threads, any corpse and
   anything anybody left on the floor go up with the ship because they are
   already in the rooms that moved.
2. **Everybody aboard travels**, then gets `applyLocationMoveSideEffects`.
3. **The ground Location is retired**, not deleted.
   `placeDeletable.js#hardDeletePlace` refuses while anything points at a
   Location and plenty does — a Vantage, an old CavingRoll, an AuditLog.
   Retiring takes it off the map and out of the travel graph, which is all a
   player can see anyway.
4. **The world hears it.** `soundBroadcast.js#broadcastEverywhere`, which is a
   separate function from `broadcastSound` because a ship leaving the planet is
   not louder near the Keep and `carriesTo` would have stopped it reaching the
   Caves at all — which is exactly where the quieter line belongs.

   > You hear a distant rumbling, and then a spaceship takes off from the Keep.

   Underground (`CAVE_GROUP`, `CAVE_LEVEL`):

   > You hear a distant rumbling.

**Discord is left to the mirror.** The ship's channel is not deleted here. The
database is the master and `db/lib/discordMirror/` is what makes Discord match
it (`MIRROR.md`); deleting the channel from inside a game action would take the
two threads with it and leave nothing in their place. The mirror moves them
under the orbit Location's channel, and their starter rows come out different
there — see §7.

## 6. Orbit

`space-1`, **Charon (Space)**, in its own `space` zone.

Its own zone rather than a sixth Fortress location because a Zone owns the
Discord category and the access role: a Baron who has left the planet must not
still hold the role that opens the Keep's channels.

It carries the `offMap` attribute (`db/lib/locationAttributes.js`), and that is
what `/map` reads. An off-map place has no marker on either plate and no edge to
anywhere, so every question the map normally answers — which plate, what is next
door, where you could walk — has no answer. The board says so instead of
pretending: a dithered grey field, the layer switch drawn but disabled, and one
locked reticle in the middle with your own card beside it.
`web/app/(app)/map/MapBoard.js#OffMapBoard`, fed by an early branch in
`web/app/(app)/map/actions.js`.

`offMap` is an attribute rather than a slug check so the second off-map place
needs no code.

## 7. Sleep

The **Habitation**, in orbit only. Confirm:

> Go to sleep and await the shuttle's docking, allowing you to respawn. This is
> irreversible.

It is **not a death**. No corpse, no death mask, nobody frightened. It sets
`Character.status = ASLEEP` and grants the `charon-asleep` tag, named **Asleep**:

> You are asleep. You can respawn.

(The slug is `charon-asleep` and not `asleep` because `asleep` is already
ordinary sleep — a one-turn status debuff that caps fighting at pitiful and
wears off. The two are unrelated. `keepSlug: true` in `docs/tags.yaml` is what
tells the tag sync the divergence is deliberate.)

**ASLEEP is neither alive nor a body.** That is the whole trick, and it lives in
`db/lib/bodies.js#isBody`, which both `curse.js` and `ghost.js` now read:

| | ALIVE | ASLEEP | DEAD |
|---|---|---|---|
| Playing | yes | no | no |
| A body somebody could bury | — | **no** | yes |
| Curses the player | no | **no** | until buried |
| Seat in Deadchat | no | **no** | yes |

So the player may roll a new character at once, there is nothing to bury, and
they get no seat among the dead — they are not dead, and they are about to be
somebody else anyway. A sleeper standing beside a genuinely unburied corpse is
still cursed by the corpse; sleeping hides nothing.

Every other query in the codebase filters `status: "ALIVE"`, so an asleep
character drops out of rosters, turn passes, Who's here and the catatonic death
pass for free. Seats they held are freed the same way.

What sleep *does* share with dying is
`characterDeath.js#releaseEntanglements` — a party must stop following somebody
who has left the game, and a prisoner must not stay pinned by a hand that is now
in orbit. It was split out of the death path for this.

## 8. The files

| | |
|---|---|
| `db/lib/charon.js` | the mechanism, both faces call in |
| `db/lib/charonPlaces.js` | the slugs alone, zero requires, so `placeAffordances.js` can draw buttons without importing the move pipeline |
| `db/lib/charonSweep.js` | the countdown, on the bot's five-second tick |
| `db/lib/bodies.js` | what a body is, shared by `curse.js` and `ghost.js` |
| `db/lib/placeAffordances.js` | the four buttons. `ROOM_AFFORDANCES`' `when` takes `(room, location)` now, because the ship's rooms travel and the same Room row means different things in the two places |
| `web/app/(app)/chat/actions.js` | the four server actions |
| `web/app/(app)/chat/PlacePanel.js` | the two confirms, through `useConfirm()` |
| `web/app/(app)/map/MapBoard.js` | `OffMapBoard` |
| `bot/src/events/interactions/rooms.js` | the Discord twins |
| `docs/assets/maps/barony1.psci` | the marker at (13, 6), one above the Keep at (13, 7) |

## 9. Things that will bite

- **`shipPlace`, never a slug lookup.** The ground Location survives a launch as
  a *retired* row, so it is still perfectly findable by slug — and a line written
  into it lands in a feed nobody can open, which looks exactly like the line
  never being written.
- **`docs/zones.yaml` is additive.** Deleting `fortress-4-c` from the YAML does
  not delete it from a database that already has it. A fresh `dev:setup` is
  clean; an existing game needs a superadmin's hard delete at `/gm/dev/zones`.
- **Nothing puts the ship back.** There is no un-launch on any surface, by
  design. A GM who needs one is doing database surgery.
