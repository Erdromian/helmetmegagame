# The bomb collar

A collar you can lock round somebody's neck and set off from anywhere in the
zone. The Exactor's instrument (`docs/roles.yaml`), and the reason the Slave
seat is a seat rather than a job title.

## 1. The loose collar and the shut one

| | loose collar | shut collar |
|---|---|---|
| What it is | an **item** | a **trait worn as an accessory** |
| Category | `items` / `items-gear` | `general` / `general-traits` |
| Weighs | 1 lb | nothing |
| Carried? | yes — put down, handed over, stolen, looted | no; it is round your neck |
| On the equip board? | only once it is locked on | yes — `ACCESSORY`, written **equipped** |
| Comes off by | being locked onto somebody | the Collar Key, or the detonator |
| Destroy button? | yes (an item) | **no** |

Each of those comes in two spellings, and §2 says why:

| | loose | shut |
|---|---|---|
| **Blank** — nobody has marked it yet | `bomb-collar` (the catalog row) | `bomb-collar-locked` (the catalog row) |
| **Marked** with glyph *n* | `custom-collar-loose-<n>` | `custom-collar-locked-<n>` |

The shut collar carries **no** `removable: false` line and must not be given
one — the sync throws on it. Destroy is derived from the category now
(`DESTROYABLE_CATEGORIES`, `CRAFTING.md` §5) and `general` never had the
button, so the trait is already unreachable by it.

**It is an accessory, and it is still not an item.** The shut collar is
`equippable` in the `ACCESSORY` slot with the collar's own sprite, so it sits
on the equip board round the neck rather than in the trait list alone. But it
stays in `general` on purpose: an `items` tag is always tradeable
(`ALWAYS_TRADEABLE_CATEGORIES`, `TAGS.md` §5), and a locked collar that could
be handed over, stolen, pickpocketed, searched for or looted off a neck would
not be locked. `general` is what keeps it off every one of those menus.

What "locked on" means in code is `db/lib/equipSlots.js#isLockedOn`: the blank
slug, or anything with the marked prefix (`NOT_LOCKED_ON_WHERE` is the same rule
as a Prisma filter).

- **Apply Collar writes it equipped**, with no slot check — nothing clashes
  with an accessory, and the four-accessory cap does not count a locked-on
  thing. Collaring somebody whose pockets are already full of trinkets is not
  an overflow, and their next equip is not refused for it.
- **Unequip refuses it** (`equipActions.js#unequipOne`: "is locked on. It
  needs a key."), and no surface offers the toggle: the board's cell has no ✕
  and says *locked on*, and `thingRows.js#thingVerbs` reports it not
  equippable, which is what the rail and the drawer read.
- **Death leaves it on the body.** The death unequip pass in
  `db/lib/characterDeath.js` skips locked-on tags, so a corpse still wears its
  collar, and a Revive comes back with it buckled. A key still opens it on a
  body, which is one way to get a marked collar back.
- A GM's batch (`db/lib/tagOps.js`) is not gated: a GM may unbuckle it by hand.

## 2. The glyph

Every collar that has been locked on carries a glyph — Γ, Ж, Þ and so on,
`db/lib/collarGlyphs.js#GLYPHS` — and the glyph goes wherever the collar goes.
The remote lists collars **by glyph, never by who is wearing them.**

That is the whole trick. Somebody with a stolen key takes collar Ж off a slave,
locks it round somebody else's neck, and the Exactor's remote still shows Ж
glowing in the zone. Unless he walks over and reads the clasp, he has no idea it
moved — and if he sets it off, the wrong person dies.

**Why a glyph is its own pair of tags.** It has to survive a trade, a theft, a
stash, a corpse. A column on `CharacterTag` could not do that — a stack of
collars is one row — so each glyph is a minted pair of `Tag` rows, the
paperMint / customCraftMint pattern: `custom` (the sync never sees it),
`ephemeral` (Restart Game sweeps it), `customOfSlug` pointing back at the
catalog row it copies, and not stackable, since no two collars share a glyph.

**When a collar gets its glyph.** The catalog rows are a collar nobody has
marked yet. `db/lib/collar.js` marks one:

- the moment it is **locked on** (Apply Collar), and
- whenever a blank shut collar is found round a neck — `stampBlankCollars`,
  which runs when a character is **created** wearing one (the Slave), when the
  **remote is read**, and before a **key turns**. That catches the starting
  collar and anything a GM granted by hand.

A glyph is **never reused** inside a game, even once its collar is gone. One
that came back on a new neck would be a trick nobody played. Past the 26
single glyphs the game hands out pairs.

**Who can read a glyph.** Anybody who can see the collar. It is in the tag's
name (`Bomb Collar Ж (Locked)`), so the wearer reads it off their own sheet and
anyone who 🔍-inspects them reads it too. The Exactor learns a collar's glyph
when he locks it on (the notice says it), and can check whose neck one is on by
opening the remote while they stand in front of him (§4).

## 3. The three verbs

All three live in `db/lib/collar.js`, which takes `prisma` first and is **not**
on the `@lifeweb/db` barrel — require it by path. The web half is four server
actions in `web/app/(app)/character/actions/misc.js` (the three verbs, plus
`readRemoteRequestImpl` for the remote's list) and one `CollarDialog`.

| Button | Needs | Reaches | Asks permission? |
|---|---|---|---|
| **Apply Collar** | a loose collar in hand | somebody here, or yourself | sometimes — see below |
| **Unlock Collar** | `collar-key` | somebody here, alive or dead | never |
| **Detonate** | `remote-detonator` **and the Exactor's ring, worn** | any living neck in your zone | never |

Each button is **hidden**, not greyed, and only ever on a fact about your own
sheet — what is in your pockets, and for Detonate, what is on your finger. That
is the metagaming rule in `web/app/components/actionRegistry.js`.

**The remote answers to the Exactor's ring.** `canWorkRemote` is the detonator
in hand **and** a worn, registered ring whose tokens include `exactors-key` —
the token the Exactor's seat puts on his ring (`ring:` in `docs/roles.yaml`,
`RINGS.md` §3). It reads the ring alone (`rings.js#wornRingAccess`,
`roomAccess.js#wornRingTokens`), never a held tag, and a ring in a pocket works
nothing. `remoteRefusal` is the same gate re-read from the database for the
server actions and the Discord verb.

So the remote is keyed like a door, not like a seat. Anybody can buy, steal or
loot a remote, and on its own it is a box with a button on it. Steal the
Exactor's ring **as well**, put it on, and the remote answers to you — that is
the one way to take the power from him. A smith's ring that the Meister
registers to the Exactor's seat carries the same token and works it too. The
Collar Key stays open to anybody on purpose: freeing somebody is a fair thing to
steal the means for. Killing somebody takes two things.

With the Exactor's ring off every finger, every collar in the game is dead
weight until somebody puts it on.

### Apply Collar has three doors

The same shape `db/lib/bind.js` has, plus one:

- **Yourself.** No offer. You are not asking anybody.
- **Somebody helpless or dead** — `needsNoConsent`, read off the derived
  `INCAPACITATING_SLUGS` set in `db/lib/incapacitation.js`. Collared on the
  spot.
- **Anyone else.** An `Offer` of kind `COLLAR` on the shared
  `offer:accept:` / `offer:decline:` prefixes (`db/lib/offerRow.js`), answered
  through `db/lib/dmAnswer.js#acceptOffer` like every other offer.

All three doors end in `applyCollar`, so what wearing a collar means is written
once. It spends the collar and writes the shut one in a single transaction, with
the target's row locked, so two collars racing onto one neck cannot both find it
bare.

**Which collar.** When you hold more than one, the dialog asks — a marked one
keeps its glyph onto the new neck, and that is the choice the trick needs. The
offer carries the collar you picked in `Offer.tagId`, so the accept locks on
that one. Left to itself, `pickLooseCollar` reaches for a blank one first.

The accept path re-runs the **whole** gate — an offer can sit unanswered for
hours, in which either side can walk off, be collared by somebody else, or die
— and re-reads the asker's own stock, because they may have handed the collar
away while waiting.

## 4. Who can see who is collared

**Apply and Unlock never say.** Neither dialog filters its roster on who is
wearing a collar, and neither button greys on it:

> A list that showed only the collared would hand anybody who picked up a key
> a map of who could be freed, and whose collar to take.

So both list everybody standing there, hoods included, under their alias
(`web/lib/peoplePools.js#collarTargets` / `collarOthers`). Unlocking somebody
with no collar is refused **by name**, one person per click.

**The remote is the one exception, because it answers to one ring.** The
Exactor put those collars on. It lists every collar round a living neck in his
zone, by glyph (`remoteReading`). A name goes beside a glyph only for somebody
standing in his own Location, where he can read the clasp himself — and it is
the name **he** holds for them, off `rosterHere`, so a hood stays a hood. For
everybody else in the zone the remote shows the glyph alone.

What the remote gives away, and means to: a glyph vanishes when its wearer
leaves the zone, dies, or has the collar unlocked, and a new one appears when
somebody locks a collar on. It does not say which of those happened.

The Exactor's own neck is left off the list. The remote is not how he dies.

## 5. Detonation

**Range: the zone of whoever holds the remote and wears the ring** — the
Exactor, unless somebody has taken both from him. Any living neck with that
glyph in the same zone as him, whichever Location they are standing in. A slave can still run —
but only out of the zone; he can walk from Location to Location pressing
buttons. The caves are their own zones, so a slave prospecting underground is
out of range of an Exactor who stays on the surface.

**It takes the head, not the body.** An ordinary death through
`applyDeathToRow`, with **no** `gib`. A corpse is minted where they fell, and
everything they were carrying stays on it to be looted (`CORPSES.md` §1). This
used to be a gib that vaporized the body and every tag on it, which gave the
Exactor every reason never to set off a slave who had run off with something
valuable — the threat stopped working the moment it mattered. The collar itself
is taken off first and goes with the head.

Two places hear it, both as `-#` scenery through `db/lib/placeLine.js`, both
with the `BOOM` cue on the web:

- The **Location** hears `{name}'s collar goes off, and takes their head with
  it.`
- The **zone's `#summary`** hears `An explosion rings out from {Location}.` —
  the blast and where it came from, never who. Naming the dead to a whole zone
  is a death notice, and the Location line already tells everyone who could
  have seen it.

The dead player is DMed `DETONATION_DEATH_REASON`.

**The Exactor is told the glyph, and nothing else**: `Collar Ж went off.` If the
wearer was standing in front of him he saw it happen. If not, he finds out who
it was the way everybody else does — which is exactly how he learns he was
tricked.

A character stands in a Location, never in a Room — a Room is a thread with an
access list (`db/lib/roomAccess.js`), not a place a body occupies — so "the room
it went off in" is the Location channel.

A key turning at the same moment is not an error: whichever gets to the row
first wins, and the loser is told `Collar Ж doesn't answer.` Something else
killing the wearer between the lookup and the trigger is not an error either:
the collar is spent and nothing explodes twice.

## 6. What it does NOT do

- **It does not restrict anybody.** A collar blocks no verb, no movement, no
  speech. It is a threat, not a restraint — `acceptCollar` returns `collaredId`
  rather than `boundId` precisely so `afterBind`'s room-access and carry work
  never runs for one.
- **It costs no Move and no ⬢.**
- **It is not craftable**, in any of its three pieces. A forge that could strike
  a collar key would free every slave in Ravenheart on a Dead Simple recipe, and
  one that could strike collars would let anybody start a slave trade without
  ever paying the Merchant. Import from the Black Market, or steal.
- **It does not check the Slave's contract.** The 50 obols on that paper
  (`db/lib/slaveContract.js`) is fiction a GM adjudicates against. Nothing
  counts a balance and nothing fires when one is reached.
