# Searching a room

A proposal, 2026-09-24, and built the same day. The rules as they stand live
in [`SEARCH.md`](../systemdocs/SEARCH.md) §9; this file is the record of why,
and of what was decided differently on the way. Two things changed in the
building: the person search's `§6` this file cites became `§9`, since
`SEARCH.md` already had a §6; and the Underground test is `zone.kind ===
"CAVE_LEVEL"`, the one `locationAttributes.js` already makes.

## 0. The problem

A room stash is a shelf. Anyone standing at the Location presses **Storage**
and reads the whole of it, and Take or Steal carries it off. The only die in
the neighbourhood is Steal's, and that die decides whether the room hears
about it, not whether you find anything (`THEFT.md` §1a).

So the first player into the Old Mineshaft walks out with the Black Powder, the
first one into the Fishing Hut walks out with 14 Obols and 8 ⬢, and the
Poorhouse Key sits in an open bunk room waiting for whoever gets there. Players
have noticed, and they are right that it is odd: the goodies are seeded as if
they were hidden, and then shown to everybody.

Of the 104 stashes in `docs/zones.yaml`, 73 are behind a key and 31 are open.
§9 lists the open ones and what should go behind a check.

## 1. The shape, in one paragraph

A stash gets a second count per stack: how much of it is **hidden**. Hidden
units are invisible to Storage, Transfer, Take and Steal. A new **Search**
button on the room, once per character per room per turn, rolls a d6 nobody is
shown and moves some of the hidden stacks into plain sight, where they are
taken with the verbs that already exist. Finding a thing is not pocketing it.

Everything below is a delta from that.

## 2. The model: `RoomTag.hiddenQuantity`

```prisma
model RoomTag {
  quantity       Int @default(1)   // on the floor: what Storage lists and Take moves
  hiddenQuantity Int @default(0)   // under the floorboards: what a Search turns up
  ...
}
```

Two counts on one row rather than a `hidden` boolean, for one reason: the
`@@unique([roomId, tagId])` means a room holds ONE row per tag. With a boolean,
somebody dropping an Alcohol into the Den's Bar would increment the hidden
Alcohol row and their bottle would vanish under the floor. With two counts,
`addToRoomStack` increments `quantity` and nothing a player drops is ever
hidden by accident.

The other reason is that every reader already filters on `quantity`. The
Storage handler (`bot/src/lib/roomStorage.js`), the Transfer holdings query
(`character/actions/transfer.js`) and `formatStashLine` all select
`where: { quantity: { gt: 0 } }`, so a row that is entirely hidden is invisible
to all of them today, with no edit. A row with both counts shows only the
visible part.

Two writers need a line each:

- `dropRoomTag` (`db/lib/tagWrites.js`) deletes the row when `quantity` reaches
  0. It must keep the row while `hiddenQuantity > 0`, or taking the last
  visible bottle throws away the hidden ones.
- `resourcesOf` (`db/lib/resourceStack.js`) reads the ⬢ stack's `quantity`.
  Reach and the Transfer dialog want the visible count, but the economy
  ledger's reconciliation (`ECONOMY.md`) wants the room's whole balance. Hidden
  ⬢ are real ⬢. Give the ledger a `heldResourcesOf` that sums both, and leave
  `resourcesOf` as the visible count. This is the one place the two counts can
  drift apart quietly, so it gets a test.

Poison rides on the row as it does now. A poisoned hidden meal that is found
is a poisoned visible meal.

## 3. Authoring: a `hidden:` block in the stash

```yaml
stash:
  items:
    rock: 3
  hidden:
    black-powder: 1
    hematite: 1
```

`parseStash` (`db/lib/syncZones/parse.js`) normalises it into a third list,
`{ resources, items, hidden: [[slug, n], ...] }`, and that is the shape
`Room.stashSeed` stores. `resources` may appear under `hidden:` too, since ⬢
are a stack like any other.

`seedRoomStashRows` (`db/lib/roomStashSeed.js`) pours `hidden` into
`hiddenQuantity` and `items` into `quantity`. A slug named in both lists seeds
one row with both counts. **The `seededStashSlugs` guard does not change**: a
slug is poured once per game whichever list it came from, so the 139-duplicate
accident of 2026-09-10 stays closed.

The `/gm/dev/zones` Stash panel gets a second textarea, **Hidden**, in the same
`slug: n` form as the seed box, and lists hidden rows with their own chip so a
GM can see what a room still has under the floor. Nothing else on that panel
changes: it still only adds, once, and never adjusts play state.

**A `destroysContents` room may not hold hidden stock.** The Spillway eats what
goes into it; a hidden stack there would be a trough with a false bottom. The
seed and the panel both refuse it.

## 4. The verb

**Search** sits on the room's starter post beside Storage
(`db/lib/placeAffordances.js`, custom_id `room:search:{roomId}`, hashed into
`Room.postHash` so existing threads pick it up on the next mirror run), and on
the open room's panel in `/chat` (`RoomPanel.js`, where a room's affordances
draw now) beside Storage. Both call one function in `db/lib/roomSearch.js`.

- Anyone standing at the Location, admitted to the room, presses it. Admitted
  is `roomAccess.js#accessibleRooms`: a key or a `RoomGuest` row. A locked room
  can have hidden stock too; the door is the first check and the search is the
  second.
- **No consent handshake.** A room is not a person. There is no Offer, no DM
  with buttons, nothing in anybody's waiting-on-you list.
- **It costs no Move, files no `Action`, and no turn pass touches it.** What
  holds it back is one ration: **once per character per room per turn** (§6).
  *(Changed the same day it was built: Bascinet asked for a quarter of the
  Move on top, so it shares the crafting ledger now — `SEARCH.md` §9c. On
  2026-09-25 that became half the Move, and the ration became one room a
  turn: the same room may be searched again, a second room may not.)*
- A hood does not refuse it, for the reason Search on a person gives: a hood
  hides who you are, not what you are doing with your hands.
- Blocked by anything that blocks `ACT`, and by `blind`.
- A room with nothing hidden still rolls and still spends the ration. If it
  didn't, a search that came back instantly would tell you the room was empty.

## 5. The die

A d6 through `rollWithAdvantage`, so Lucky applies, quietly, the same admission
`SEARCH.md` §3b makes. Modifiers, a **closed** table in `db/lib/roomSearch.js`,
the Steal discipline: Hunger and the mood bands do not apply, because this
costs no Move and has no cooldown, and folding them in would make a hungry
character unable to find their own boots.

| | value |
|---|---|
| Eagle Eyes | +2 |
| Night Vision, in the Underground | +1 |
| Hallucinating | −2 |
| Wasted | −2 |
| Tipsy | −1 |

Drink is worst-rung-only and never sums, as in `steal.js`.

Then the rule the person search already has, reused rather than rewritten
(`search.js#revealCount`, `pickRevealed`):

```
found = floor(clamp(total, 1, 6) / 6 × hiddenStacks)
```

where a **stack** is one `RoomTag` row with `hiddenQuantity > 0`, and a found
stack comes out whole. So a room hiding ONE thing gives it up only on a
modified 6, and a room hiding four gives one up on a 2. That is the texture
`SEARCH.md` §3a describes, and it lands on the author instead of the target:
hide the Black Powder alone and it takes a while; hide it beside three rocks
and somebody finds something on their first try. §9 leans on that
deliberately, leaving scenery in plain sight so a room does not read as empty.

Why stacks and not units: counting units makes 14 Obols a fourteen-part reveal,
which is pleasant, and makes 1 Black Powder a one-in-six, which is the same
either way. It also means an author can grade a find by splitting nothing.
Counting stacks keeps one rule shared with the person search, and a GM who
wants a gradual find can seed `obol: 7` in `hidden:` twice under two rooms.
Start with stacks; units are a one-line change later if it feels wrong.

Why not a 4+ target like Steal: a target says found or not found, and then a
second rule has to say how much. `revealCount` is one rule that answers both.

## 6. The ration is a table

*(Superseded 2026-09-25. The ration is now ONE ROOM A TURN, read under the
Character row lock, and `RoomSearchAttempt` is one row per search with no
unique index; at half a Move each, a character searches one room at most
twice a turn. `SEARCH.md` §9e has the current rule. What follows is the
original reasoning.)*

`RoomSearchAttempt`, `@@unique([searcherId, roomId, turnId])`, the
`SearchAttempt` discipline (`SEARCH.md` §3): the insert is the claim, spent by
the press whether or not anything was found, and race-proof without a
cooldown. `turnId` is a claim token, not a foreign key.

Keyed to the searcher and the room, not the Location, so a Location with four
rooms is four searches a turn. That is what a Location with four rooms should
be.

No cooldown beyond the turn. A group of three at the Fishing Hut gets three
rolls a turn, and a stash hidden as one stack survives three rolls about 58% of
the time. Over a month of turns hidden stock is delayed, not kept. That is the
point: the first person through the door no longer gets it, and the person who
comes back does.

## 7. What everyone is told

- **The searcher** gets an ephemeral line (or the web's toast):
  `You search the Fishing Hut. You find: Obol ×14, Flooded Crate.` or
  `You search the Fishing Hut and find nothing.` The die is never in it.
- **The room thread** hears one ambient line, through `ambientLine.js`, naming
  the face the room saw: `-# A young man rummages through the Fishing Hut.`
  Whether anything was found is not in the line. It is scenery and a trace, the
  same trade Take's room line makes; Storage will show what changed to anyone
  who looks.
- **Found stacks move onto the floor**, `hiddenQuantity → quantity`, and stay
  there. The searcher takes them with Take or Steal like anything else.

That last point is the one worth defending. Straight-to-pocket looks kinder,
and it is the thing `steal.js` was written to avoid: reach, the tradeable
filter, the non-stackable clamp, the carry ceiling, the `TRANSFER_TAG` audit
rows a GM undoes from `/gm/turns` and the `afterInventoryChange` tail all live
in `transferRequestImpl` once. A search that pocketed would need every one of
them again, or would skip the carry ceiling and hand an Overburdened character
a crate. A find that sits on the floor for the next second costs the searcher
nothing they were not already going to spend, and a Steal straight after it is
the quiet version.

One audit row, `room_search`, with `turnId` set (`REQUESTS.md` §1a) and
`{ die, rolls, advantage, modifiers, hiddenStacks, revealedTagIds }` in its
details. That is the only place the die is written down, like
`search_accepted`.

## 8. Edges

- **Restart Game** deletes every `RoomTag`, both counts with it, clears
  `seededStashSlugs` in the same transaction and re-pours the seed. Nothing
  new.
- **Retiring a room** leaves hidden stock in place, as it does visible stock.
  A hard delete cascades it away.
- **Rot** (`tagExpiryPass.js`, `corpseRotPass.js`) finds `RoomTag` rows by
  `expiresTurn` and sheds them. A hidden meal should rot too, so whichever
  pass drops the row has to drop both counts, not just `quantity`. Small, but
  it is a second decrement to write.
- **`{carry:slug}` and the Examine readout** count visible only. A hidden
  Lantern is not lighting anything.
- **Quest rooms** (`QUESTS.md`) get the same `hidden:` box in the staging
  panel; a GM-minted room with a hidden clue is most of what quests want.
- **The `hideableFromSearch` predicate does not apply.** That is about what a
  person may palm. A room's hidden set is whatever the author put there, with
  no visibility rule, since a room has no plain sight to leak through.
- **A dead or Catatonic character** is stopped by the `ACT` blocker. A GM
  mid-adjudication is untouched, since nothing files an `Action`.

## 9. Which rooms, and what goes under the floor

The open stashes from `docs/zones.yaml` on 2026-09-24, Charon excluded as
asked. **Hide** is what moves to `hidden:`; **leave** is what stays on the
shelf as the lure. Rooms holding only Rock or Feces are not listed and do not
change.

| Room | Hide | Leave in plain sight |
|---|---|---|
| Undertown › Den › Bar `undertown-8-1` | Alcohol ×4, Cigarette ×6 | — |
| Undertown › Den Interior › Drug Lab `undertown-9-2` | Mindbreaker Toxin, Nekker Pheromones, 8 ⬢ | Cave Fungus ×2 |
| Undertown › Den Interior › Dining Room `undertown-9-1` | Ration Box | — |
| Undertown › Island › Fishing Hut `undertown-h-1` | Obol ×14, 8 ⬢, Flooded Crate, Crayfish ×2, Dustfish ×2, Fish Roe ×3 | Moldy Bread ×2 |
| Undertown › Basements › Hideout `undertown-e-3` | Dagger | — |
| Undertown › Basements › Winery `undertown-e-4` | Moonshine ×4 | — |
| Undertown › Poorhouse › Bunks `undertown-7-1` | Poorhouse Key | — |
| Undertown › Order Chambers › Interrogation Room `undertown-b-1` | Torturing Equipment | — |
| Undertown › Order Chambers › Holding Cells `undertown-b-2` | — | Feces ×2, Moldy Bread |
| Undertown › Merchant › Storefront `undertown-6-1` | Tea, Sugar Candy | — |
| Underground › Approach › Old Mineshaft `caves-2-2` | Black Powder, Hematite | Rock ×3 |
| Underground › Approach › Abandoned Hut `caves-2-1` | Cheese | — |
| Underground › Entrance › Customs `caves-1-1` | Skinned Cave Rat | — |
| Underground › Brooding Grounds › Dense Mycelium `caves-4-2` | Deep Morel | — |
| Underground › Abandoned Camp › Shroom Mound `caves-5-2` | Deep Morel | — |
| Underground › Abandoned Camp › Main Camp `caves-5-1` | Obol ×2 | Rock ×4 |
| Town › Soilery › Farms `town-3-1` | Work Knife | — |
| Fortress › Garrison › Mess Hall `fortress-1-4` | Alcohol, 2 ⬢ | — |
| Black Hills › Godard Factory › Main Floor `factory-main-floor` | Hatchet | — |
| Black Hills › Godard Factory › Pub `factory-pub` | Hatchet | — |
| Black Hills › Passageway › Heaping Trash `passageway-heaping-trash` | Skinned Cave Rat | — |
| Black Hills › Sparse Fields › Office `sparse-fields-office` | — | Paper ×9 |
| Fortress › Keep › Library `fortress-4-2` | Caspian's Diary, Prophecies of Sir Thomast | Paper ×23 and the other 15 books |

Two judgment calls in that table, both easy to overrule:

- **The Library stays mostly open.** A library's books are on shelves, and
  hiding all seventeen makes the one library in the game read as an empty
  room. The two that read like secrets go under the floor.
- **The Office's paper stays out.** Paper is the thing you write letters on,
  and hiding it makes the Bird harder to use for no reason.

## 10. The live game

The game is running, so this is not only a YAML edit. Some of these rooms have
already been emptied, and what is gone is gone. For the rest, a one-off script
(`db/scripts/ops/hideAuthoredStock.js`, dry run unless `--apply`) reads each
room's new `stashSeed.hidden`, and for each slug moves `min(quantity,
seeded)` units from `quantity` to `hiddenQuantity`. It never adds a unit and
never touches a slug not in the seed, so a bottle a player dropped in the Bar
stays on the shelf.

It changes what players can see on the floor mid-game, so it is a
"say what you are about to run and wait for a yes" step, and `db-guard.py`'s
`CONFIRMED=1` gate applies. Run it in the same push as the YAML change, after
the migration.

## 11. Order of work

1. Migration: `RoomTag.hiddenQuantity`, `RoomSearchAttempt`. Decline the usual
   `migrate diff` drops (CLAUDE.md, Notes for future work).
2. `parseStash`, `stashSeedEntries`, `seedRoomStashRows`: the `hidden` list.
   Tests in `db/test/` for the seed shape and the guard.
3. `dropRoomTag` keeps a row with hidden stock; `heldResourcesOf` for the
   ledger; the rot pass sheds hidden units. Tests for the first two.
4. `db/lib/roomSearch.js`: the modifier table, the reveal, the readout, the
   ration insert, the audit row. Pure functions tested the way `steal.js` and
   `search.js` are.
5. The button on both faces: `placeAffordances.js` + a bot handler, and the
   room row in `/chat`.
6. The Stash panel's Hidden box, and the same on the quest staging panel.
7. `docs/zones.yaml` per §9, and `MAP.md` §6g's checklist ("does every
   `stash:` slug name a real tag?") extended to `hidden:`.
8. The §10 script, run once with a yes.
9. Move §4 to §8 into `SEARCH.md` as a second half, and `CARRY.md` §6 gets a
   paragraph pointing there.

## 12. Open questions

- **Straight to pocket?** §7 argues no. If play shows that a find lying on the
  floor for a moment gets sniped by the person standing next to you, the
  answer is to make Search call `transferRequestImpl` with `announceTake:
  false` right after the reveal, which is Steal's exact shape, and not to
  write a fourth path.
- **Should the room hear the rummage line at all?** It is a trace, which is
  the CARRY.md argument for Take's line. Dropping it makes searching a room
  completely silent, which is more than Steal gets.
- **Stacks or units** (§5). Stacks is the smaller change. Revisit if the Obols
  feel all-or-nothing.
- **Is +2 for Eagle Eyes too much?** It is a 2-point general tag doing nothing
  mechanical today. Giving it a job is most of the point of the row.
