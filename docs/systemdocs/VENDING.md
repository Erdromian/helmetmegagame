# The vending machine

A machine bolted to the wall of the Merchant's Storefront, stocked with goods
behind glass at prices he set. You feed coins into the slot and take what you
can pay for. The coins you spend drop into a locked till he empties later.

It exists because of a hole `DEPOT.md` §6 names: selling to another player is
the Transfer verb, and Transfer needs both parties standing in the same room at
the same moment. One turn is one real day, so the Merchant cannot man a counter
for all of it, and a buyer who turns up while he sleeps cannot buy. **This is
the asynchronous shelf.** It does not overlap the Depot counter, which sells the
station's imports on the Company's account.

**Read this before touching `db/lib/vending.js`, `db/lib/vendingText.js` or
`Room.vendingMachine`.**

## 1. The shape of it

| | |
|---|---|
| Where a machine lives | `Room.vendingMachine`, a flag, authored in `docs/zones.yaml` |
| How many there are | one, on the Storefront (`undertown-6-1`) |
| Who may use it | anybody who can get into the room |
| How many at once | **one**, and the VIEW is what is exclusive |
| How long you get | 5 minutes, derived from `VendingMachine.holderSince` |
| What a price is | a whole number of obols, 0 to 999. 0 means free |
| Who may unlock it | whoever holds the **`merchants-license` tag** |
| What the till holds | coin from purchases, out only by the licence |
| What the slot holds | coin you fed in, and it is **loose** |

## 2. The two pools are not one pool

This is the whole feature, so it is worth being exact.

- **The float** (`VendingMachine.floatObols`) is coin in the slot. It belongs to
  whoever is standing at the machine, not to whoever put it in.
- **The till** (`VendingMachine.tillObols`) is coin behind the lock. It belongs
  to the licence holder.

A purchase moves coin from the float to the till. Nothing else does.

**Coin left in the slot stays there.** If your five minutes run out with coin
still in, it does not sweep to the till and it is not posted back to you — it
sits in the slot, and the next person to open the machine can spend it or take
it. Forgetting your change is meant to cost you something, and the windfall is
meant to be worth turning up for. `clearStaleHolds` is written to not break this
and says so in as many words; if you ever make the sweep move money, you have
removed the reason the timer matters.

Pressing **Step away** is the polite exit and it *does* hand your change back.
That is the difference between leaving and being timed out.

## 3. The hold

Exclusive on OPENING, not on the first purchase — the design doc's reason is
"to prevent other characters from stealing the obols inserted", so a second
person must not be able to so much as read the float.

**The clock is derived, never stored as a deadline and never ticked by a
timer.** `heldBy(machine, now)` computes it from `holderSince` on every read
(`db/lib/vendingText.js`, so both faces share one implementation). Two things
follow, and both matter:

- The machine is free **the instant** five minutes pass, whether or not anything
  swept it, and whether or not the bot is running.
- The bot being down for six minutes cannot hand somebody an extra six.

This is `db/lib/phone.js#ringsDueBy`'s bargain, for the same reason.

The claim is two conditional `updateMany`s in one transaction, and `count === 0`
is the busy signal — there is no read to race. The first statement clears the
presser's **own** stale holds anywhere, because the unique index on `holderId`
would otherwise refuse a legitimate claim on a second machine on behalf of a
hold that is already dead.

`unlocked` is only ever read through `unlockedNow()`, which ANDs the column with
a live hold. So a crashed process, a dead merchant or a run-out clock all read
as locked, with no sweep required.

### What lets go of it

| Event | What frees it |
|---|---|
| Five minutes pass | nothing has to — the read already says free |
| Walks out, teleports, staged Relocate, a rite | `db/lib/locationMove.js`, beside the phone hang-up |
| Dies, or is deleted | the sweep; and the FK is `ON DELETE SET NULL` |
| Presses Step away | `releaseMachine`, which hands the float back first |
| Goes Catatonic, Unconscious, Bound | **nothing.** See below |

An incapacitated holder is **not** released. `blockerFor(tags, ACT)` refuses
every press instead, so they hold a machine they cannot work until their time
runs out. That is correct: somebody who collapsed at the machine is still
standing in front of it, and the person behind them waits the five minutes they
would have waited anyway.

`tickVending` on the bot's minute cron is the backstop, the shape and the
argument of `phone.js#clearStaleCalls` — the hook list is never finished. It is
**cosmetic**: the next customer is already in by the time it runs. What it adds
is the room line, the DM and the audit row, so a bot outage costs a line of
scenery rather than the feature.

## 4. Unlock and Lock

The gate is the **tradeable `merchants-license` tag, never the Merchant role**.
`DEPOT.md` §2 is explicit about why: the licence is tradeable and a role check
would quietly break that. Two consequences worth stating plainly, because both
are features rather than holes:

- Steal the licence and the machine is yours, till included.
- The Merchant dying does not strand the till. The licence is a tag on his
  corpse, and the till is coin in a box rather than a claim on an account, so
  nobody needs a role check to reach it.

Unlocking also requires holding the machine, so the Merchant cannot restock over
a customer's shoulder while their coin is in the slot.

Unlocked, he may empty the till, put something in, take something out, and set a
price. Every one of those is refused flat while locked. **Emptying the till
never touches the float** — a customer's loose coin is not his, even with the
door open.

Restocking has its own control rather than reusing `transferRequestImpl`. That
function threads `{kind: "character"|"room"}` through `takeTagFrom`/`giveTagTo`,
the audit `place`, the `auditNarrative` payload, AB-BA lock ordering, the
Spillway branch and the ⬢ leg — teaching it a third party kind touches the most
used inventory path in the game, for a dialog that also needs a price per row.

## 5. Two traps, both live

**`addToStack` silently no-ops on an already-held non-stackable tag.**
`db/lib/tagWrites.js`: "An already-held NON-stackable tag is left entirely
alone… Nothing written, nothing recorded," and it returns the existing row.
Unguarded, buying a second Longbow takes the coin and delivers nothing. So
`buySlot` and `unstockMachine` check for it and refuse **before charging**. The
machine's own shelf needs no such pin — a `VendingSlot` may hold three of a
non-stackable for the same reason a `RoomTag` may — and the pin re-applies on
the way out.

**Without `VendingSlot.poisonedCount` the machine launders poison.** A tainted
pie in, a clean one out. Poison is drawn on the way out with the same
hypergeometric `drawPoisonedUnits` a hand uses, and merged on the way in under
`tagWrites.js`'s "poisons don't mix, they dilute". The buyer is **never told**,
and neither is the audit row's narrative — a warning is itself the tell
(`MEDICAL.md`).

## 6. The money

`⬢` never enters the machine. Obols and `resources` are both refused as wares:
coin goes in the slot, not on the shelf. That is a rule about the fiction and
also the thing that keeps the machine off form `BALANCE`, which is the one form
the repo's only reconciliation code actually covers.

The machine is one ledger party, `machine:<id>` (`economyLedger.js#machineParty`),
covering **both** pools — the float and the till are two trays in one box, so a
purchase moving coin between them has not changed hands and books nothing. Its
live balance is `floatObols + tillObols`, and anybody who ever writes a `COIN`
reconcile must read both or report a drift the size of every unemptied till in
the game.

| Act | Legs |
|---|---|
| Insert | `character → machine`, `COIN`, `VENDING_INSERT` |
| Withdraw | `machine → character`, `COIN`, `VENDING_WITHDRAW` |
| Buy | `machine → character`, `GOODS` at catalog value, `VENDING_SALE`. **No coin leg** |
| Stock in / out | `character ↔ machine`, `GOODS`, `VENDING_STOCK` |
| Empty the till | `machine → character`, `COIN`, `VENDING_TILL` |

The goods legs ride the `econ` option on the ordinary `tagWrites.js` primitives.
Only the coin legs are hand-written, because the machine's end is a column
rather than a stack row. That is the one tax the column shape imposes, and it is
cheaper than the alternatives — see `ECONOMY.md` §3 for why none of this reads
as drift today.

## 7. The words

Every string a player reads is in **`db/lib/vendingText.js`**, which has zero
requires, ever. `web/app/(app)/chat/PlacePanel.js` is a client component, and one
`require` of `@lifeweb/db` there drags PrismaClient into the browser bundle and
crashes `/chat` on open. `db/lib/vending.js` re-exports it so a server caller
keeps one import. The clock lives there too, for the same reason: the dialog
counts down, and the seconds on screen must not disagree with the refusal behind
them.

The file is registered in `scripts/copy/sources.js` under `COPY_CONSTANTS` and
`DUAL_SURFACE_FILES`, so `npm run copy:extract` catches the short labels the
loose pass would skip, and says on every entry that a rewrite moves two faces.

Three rulings on how loud the machine is, all Bascinet's, all pinned by a test
in `db/test/vending.test.js` so a later tidy-up cannot quietly reverse one:

- **The room is told what was bought.** `roomBoughtNamed` is what `buySlot`
  posts. That makes the shelf worth watching and the buyer worth following,
  which is the trade — the draft named nothing, on the Depot counter's
  precedent, and was overruled. `roomBought` is kept beside it, still
  anonymous, for if that is ever reversed.
- **The expiry line names whose time ran out.** The draft signed nobody, on the
  argument that being timed out in public is a humiliation; overruled. It fires
  on a real expiry and nothing else — "their time is up" is a lie about a holder
  who died or walked off, so those two free the machine silently.
- **Insert and Withdraw post no room line.** Kept. Coin-by-coin scenery is noise
  at 100+ players, and `roomOpened` already told the room somebody is at the
  machine. There is no string for either, and that absence is the decision.

## 8. Adding a second machine

Tick **Vending machine** on `/gm/dev/zones`, or author `vending: true` in
`docs/zones.yaml`. Nothing holds a list of machines: `db/lib/vending.js`
resolves off the column, the way `Room.stable` and `Room.phone` do, so a second
one is a YAML edit rather than a code change. The row itself is created lazily
by `ensureMachine` on first open, so no script is needed.

Unticking the box hides the button and nothing else — the machine, its shelf and
whatever coin is in it all survive, so a GM who unticks by accident has not
emptied somebody's till.

One deploy consequence: adding a button changes `Room.postHash`, so the next
mirror pass edits that room's starter message. That is intended, not drift.
