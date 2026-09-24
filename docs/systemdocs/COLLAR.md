# The bomb collar

A collar you can lock round somebody's neck and set off from across the room.
The Exactor's instrument (`docs/roles.yaml`), and the reason the Slave seat is
a seat rather than a job title.

## 1. Two tags, and they are not the same tag

| | `bomb-collar` | `bomb-collar-locked` |
|---|---|---|
| What it is | the loose collar, an **item** | the shut collar, a **trait worn as an accessory** |
| Category | `items` / `items-gear` | `general` / `general-traits` |
| Weighs | 1 lb | nothing |
| Carried? | yes — put down, handed over, stolen, looted | no; it is round your neck |
| On the equip board? | only once it is locked on | yes — `ACCESSORY`, written **equipped** by Apply Collar |
| Comes off by | being locked onto somebody | the Collar Key, or the detonator |
| Destroy button? | yes (an item) | **no** |

The locked collar carries **no** `removable: false` line and must not be given
one — the sync throws on it. Destroy is derived from the category now
(`DESTROYABLE_CATEGORIES`, `CRAFTING.md` §5) and `general` never had the
button, so the trait is already unreachable by it. The only ways off are the
Collar Key and the detonator.

**It is an accessory, and it is still not an item.** The shut collar is
`equippable` in the `ACCESSORY` slot with the collar's own sprite, so it sits
on the equip board round the neck rather than in the trait list alone. But it
stays in `general` on purpose: an `items` tag is always tradeable
(`ALWAYS_TRADEABLE_CATEGORIES`, `TAGS.md` §5), and a locked collar that could
be handed over, stolen, pickpocketed, searched for or looted off a neck would
not be locked. `general` is what keeps it off every one of those menus.

What "locked on" means in code is `db/lib/equipSlots.js#LOCKED_ON_SLUGS`, one
slug, read by `isLockedOn`:

- **Apply Collar writes it equipped** (`applyCollar`), with no slot check —
  nothing clashes with an accessory, and the four-accessory cap does not count
  a locked-on thing. Collaring somebody whose pockets are already full of
  trinkets is not an overflow, and their next equip is not refused for it.
- **Unequip refuses it** (`equipActions.js#unequipOne`: "is locked on. It
  needs a key."), and no surface offers the toggle: the board's cell has no ✕
  and says *locked on*, and `thingRows.js#thingVerbs` reports it not
  equippable, which is what the rail and the drawer read.
- **Death leaves it on the body.** The death unequip pass in
  `db/lib/characterDeath.js` skips locked-on slugs, so a corpse still wears its
  collar (Detonate reads on a body), and a Revive comes back with it buckled.
- A GM's batch (`db/lib/tagOps.js`) is not gated: a GM may unbuckle it by hand.

Apply Collar spends the item to write the trait. The Collar Key turns the trait
back into an item. The detonator turns whoever wears the trait into mist and
the collar goes with them.

## 2. The three verbs

All three live in `db/lib/collar.js`, which takes `prisma` first and is **not**
on the `@lifeweb/db` barrel — require it by path. The web half is three server
actions in `web/app/(app)/character/actions/misc.js` and one `CollarDialog`.

| Button | Needs, in your hands | Asks permission? |
|---|---|---|
| **Apply Collar** | `bomb-collar` | sometimes — see §3 |
| **Unlock Collar** | `collar-key` | never |
| **Detonate** | `remote-detonator` | never |

Each button is **hidden**, not greyed, and only ever on a fact about your own
sheet — what is in your pockets. That is the metagaming rule in
`web/app/components/actionRegistry.js`, and the collar follows it exactly.

## 3. Apply Collar has three doors

The same shape `db/lib/bind.js` has, plus one:

- **Yourself.** No offer. You are not asking anybody.
- **Somebody helpless or dead** — `needsNoConsent`, read off the derived
  `INCAPACITATING_SLUGS` set in `db/lib/incapacitation.js`. Collared on the
  spot.
- **Anyone else.** An `Offer` of kind `COLLAR` on the shared
  `offer:accept:` / `offer:decline:` prefixes (`db/lib/offerRow.js`), answered
  through `db/lib/dmAnswer.js#acceptOffer` like every other offer. A new kind
  needed no new plumbing, which is the point of those prefixes.

All three doors end in `applyCollar`, so what wearing a collar means is written
once. The accept path re-runs the **whole** gate — an offer can sit unanswered
for hours, in which either side can walk off, be collared by somebody else, or
die — and it re-reads the asker's own stock, because they may have handed the
collar away while waiting.

## 4. Nobody's picker says who is collared

None of the three dialogs filters its roster on who is wearing a collar, and
none of the buttons greys on it. That is deliberate and it is the one rule here
worth not "fixing":

> A list that showed only the collared would hand anybody who picked up a
> detonator the Exactor's entire roster at a glance.

So every dialog lists everybody standing there, hoods included, under their
alias (`web/lib/peoplePools.js#collarTargets` / `collarOthers`, built the way
`bindTargets` is). Detonating somebody who has no collar is refused **by name**,
one person per click. You can learn one answer at a time; you can never read the
room.

`collarTargets` (Apply) carries a self row that no neighbouring pool does —
`peopleHere` never returns you to yourself, and you may collar your own neck.
`collarOthers` (Unlock, Detonate) does not.

## 5. Detonation

A **gib**: `applyDeathToRow(..., { gib: true })`, so every tag is vaporized, no
corpse is minted, and there is nothing left to bury, loot, carry or butcher
(`db/lib/characterDeath.js`, `CORPSES.md`). Two places hear it, both as `-#`
scenery through `db/lib/placeLine.js`, both with the `BOOM` cue on the web:

- The **Location** hears `{name} explodes into mist!` — deliberately the Rite
  of Judgement's own line and its own death reason, so Bascinet rewrites the
  sentence in one place rather than two. `db/lib/collar.js` holds that reason
  as a **literal** rather than requiring `riteEffects.js`, which would drag the
  whole rites system into a file that has no business loading it.
- The **zone's `#summary`** hears `An explosion rings out from {Location}.` —
  the blast and where it came from, never who. Naming the dead to a whole zone
  is a death notice, and the Location line already tells everyone who could
  have seen it.

A character stands in a Location, never in a Room — a Room is a thread with
an access list (`db/lib/roomAccess.js`), not a place a body occupies — so
"the room it went off in" is the Location channel.

The collar is dropped in the open first, before the gib deletes the rows
anyway, so the audit row is honest about where it went.

Something else killing the target between the roster load and the trigger is
not an error: the collar is spent either way and nothing explodes twice.

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
