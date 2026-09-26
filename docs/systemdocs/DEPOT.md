# The Depot

The station at the bottom of the caves: a counter anybody may walk up to, a
railway that brings goods down every other turn, a bank the whole town keeps its
money in, and a turret in the ceiling. This file is the source of truth for all
of it.

Everything the Depot buys and sells has a real price. Price a new ware off the
tables below, not by feel. If you change a number here, change the tag's
`depotPrice` or `sellablePrice` in `docs/tags.yaml` in the same commit — this
file and that one are the same numbers written twice, and nothing checks that
they agree.

**The Depot has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); the Depot prices each ware on its own, because what a thing
costs is a fact about a civilisation Ravenheart cannot see. The tables below
are the ladder — there is nothing above them to derive a price from.

Unlike a brewing recipe, these numbers **are** enforced. `depotPrice` and
`sellablePrice` are read off the catalog row server-side by
`web/app/(app)/depot/actions.js` and `db/lib/depotCounter.js` — never taken from
the client — and a GM does not adjudicate a purchase. The price is then
snapshotted onto the `DepotOrder` or `DepotSale` row, so re-tuning a number here
never changes what an older trade says it was worth.

## 0. The system

- **The money is obols (¢). The catalog prices in ¢.** `depotPrice` and
  `sellablePrice` are coin, and every surface that shows one shows the ¢ glyph.
  One obol is one ⬢, so nothing converts and nothing rounds — but parity is not
  a reason to print the wrong glyph, and the two are not the same kind of thing
  any more.
- **⬢ have exactly one job left: `resourceCost`.** What a recipe charges to
  make something, and what a cure charges to treat somebody. That is the whole
  of it. They used to be the unit everything was denominated in — the wage, the
  price, the sell-back, the tax — and that made them a currency that happened to
  weigh a pound each. They are a **material** now: you earn them by working, and
  you either spend them on a recipe or carry them to the counter and sell them
  for coin. An obol makes value portable — weightless, where a ⬢ is a pound — so
  a fortune in coin fits in a pocket and the same fortune in material is a
  cart's worth of work.
- **Everybody has an account, and most of them are claims on the Keep.** A
  `BankAccount` is fingerprinted to one character. A TREASURY account — nearly
  everyone's — is backed by real `obol` tags in the Vault under the Keep, and a
  withdrawal the Vault cannot cover is refused. An OFFSHORE account, the
  Merchant's and his Dockers', is money the Company holds off-world and has no
  vault behind it at all.
- **Goods arrive physically, on a train nobody calls.** An order is paid for now
  and delivered at the next arrival, as crates in the Railyard, stamped with the
  buyer's name unless they paid to keep it off.
- **Selling is a box, not a negotiation.** Drop a thing in the box on the
  counter and it is gone; the money lands when the train next leaves, minus the
  Meister's cut.
- **The room can kill you.** A turret, off by default, that reads faces. It
  fires on **arrival**, so walking *through* the Depot on the way somewhere else
  is an arrival like any other — a multi-hop walk across the zone (`MAP.md` §3c)
  is the single-hop move repeated, and the gun does not care that you were only
  passing. A walk the turret kills stops there rather than delivering a body to
  the destination.

### What this replaced, and why none of it comes back

The Depot used to be one man's console. `/depot` opened for the Merchant's
Licence and bounced everybody else; goods came down on a shuttle he called by
hand; the money was `Depot.accountObols`, a single float; taxation was a button
on a Leader's sheet. Four things went, and each for its own reason:

- **The shuttle.** It was a button, so goods sat paid-for and undelivered until
  the Merchant woke up. One turn is one real day, so "he will do it later" was a
  day of nothing moving. A train on a fixed cycle cannot be forgotten.
- **The generator.** Fuel ran out and took ordering, the bank, the shuttle and
  the gun down with it. That was survivable when the Depot was a shop. It is a
  market now, and one person's empty tank should not be able to close it.
- **The station's float.** It was a second pot to explain, sitting beside the
  Merchant's own purse with the ATM between them. His OFFSHORE account is that
  pot now, and there is one kind of account in the game rather than two.
- **The open door.** For a while after that, `/depot` opened for *everyone*,
  always, on the argument that a shop window costs nothing to look through. It
  cost the price book and the shelf list: a rail item on every player's rail
  advertised a market most of them had no business reading, from wherever they
  happened to be standing. The door is place-or-key now — wide enough that
  anybody who walks to the counter is served, narrow enough that reading it
  from a cell across town takes a licence or a chip.
- **The tax button.** It filed a levy per person per turn, DM'd each target, and
  could be refused or part-paid. The sell tax is quieter and far harder to
  dodge: a percentage off every sale at the counter, before anybody is paid.

## 0a. The moving parts

| Piece | Where it lives | Notes |
|---|---|---|
| Station state and tuning | `Depot` singleton, `id = 1` | `db/lib/depotState.js` — every mover is a locked clamp, per `lifeweb.js#bumpBlood` |
| Accounts and the Vault | `db/lib/bankAccounts.js` | `BankAccount`, `bumpBankAccount`, the hard backing |
| The counter's three fixtures | `db/lib/depotCounter.js` | The ATM, the drop box and the gun — shared by both faces. The ATM is the one of the three that also stands away from the Depot (§0l) |
| The manifests | `db/lib/depotManifests.js` | Which shelf a ware is on, and what opens it |
| The train | `db/lib/train.js` + the two passes | `trainArrivalPass.js`, `trainDeparturePass.js` |
| The turret | `db/lib/depotTurret.js` | Weighted severity table, bent by the target's `Tag.ballisticArmor` |
| Crates | `db/lib/depotCrates.js` | Runtime `Tag` rows with `custom: true` |
| Per-turn upkeep | `db/lib/depotPass.js` | The turret sweep, and nothing else any more |
| The counter | `web/app/(app)/depot/`, `web/app/components/Depot*.js` | Status strip + six tabs |
| The Meister's terminal | `web/app/(app)/treasury/` | Every account, the backing, the tax rate |
| GM tuning | `/gm/dev?s=depot` | `updateDepot` in `web/app/(app)/gm/dev/actions.js` |

## 0b. Who may do what

**`/depot` is PLACE OR KEY.** It opens for somebody standing in the Depot, and
for somebody carrying a manifest key — the Merchant's Licence or a Silver Chip —
who reads it from anywhere. Everybody else gets no rail item and is redirected
off the page. Standing there is what makes the counter usable: a key alone opens
it read-only, and the page says so.

The keys are the two `requiredTagSlug` entries in `db/lib/depotManifests.js`, so
adding a shelf moves the gate with it. A Depot Keycard is not one — it opens a
crate, not the window. Every GM keeps the page wherever they stand, and it is
read-only for them too.

One predicate answers it everywhere: `depotAccessFor` in
`db/lib/depotCounter.js`, the twin of `canReadTreasury` beside it, asked by the
page, by the nav rail (`web/lib/navItems.js`) and by the Depot link on Chat's
place card. A rail item that redirects is worse than no rail item.

What your tags decide is the **shelf**, and one seat's paperwork:

| Holder | Can |
|---|---|
| **Anyone, standing there** | Open the page. Order off the general manifest, use the ATM at the counter, put things in the drop box beside it, open an account. The ATM also stands in the Den's bar (§0g). |
| **Silver Chip** | …plus the black market: drink, smoke and worse — and the page itself, read-only, from anywhere. |
| **Depot Keycard** | Open a sealed crate (a Silver Chip also opens one whose sealed goods are all Black Market). Sell into the Merchant's account rather than their own. Spends nothing of its own, and no longer opens any door — the Railyard is public. |
| **Merchant's Licence** | …plus the page from anywhere, read-only, and the whole manifest, sealed goods included, the Company's credit line, the gun on the office wall, and the sight of everybody's staged selling. |
| **A key to the Meister's office**, standing in the Keep | `/treasury`: every account, the Vault's backing, and the sell tax rate (§0h). |

The licence is checked, never the Merchant **role** — the licence is tradeable
and a role check would quietly break that. The keycard and the terminal are
checked the same way and for the same reason.

**The split is between a shelf and a job.** A keycard does the work — the
Railyard, the crates, selling into his books — and buys nothing extra and
spends nothing. The licence is the business.

The gates live in `web/app/(app)/depot/actions.js` and `db/lib/depotCounter.js`:
`requireDepotStanding` does the standing and the ACT check, `counterActor` is
its twin for the fixtures, and `requireLicensedMerchant` / `requireAccount` sit
on top.

**Between sittings the counter is shut**, the whole of it — ordering, the ATM,
the drop box, banking, sending, the credit line, the turret. A session boundary
shuts the game and money is the game (`SESSIONS.md` §5). Reading the shop window
is not: `depotCounterState` and `depotTurretRead` stay on `guarded()` while
every verb beside them is `acting()`, which is the whole of how it is enforced.

## 0c. The Railyard, and the train

The Railway is a **real room** — a thread under the Depot channel, authored in
`docs/zones.yaml` as `undertown-5-1`, and **public**. It replaced the Landing
Pad, which was behind a Depot Keycard. Since the Depot and the Merchant were
split it is the Depot's *only* room, so the counter, the drop box and a cash
machine all hang off it.

**Anybody can walk in, and crates land here.** That is a known hole and it is
open deliberately: the alternative is a cargo room only Dockers can reach, which
defeats opening the counter up at all. Bascinet's call, eyes open — "people can
just take whatever… we'll figure out the rest later." Whatever closes it later
is not a lock on this door; a lock on this door is the thing that was tried. Its starter message says whether the train is at the platform —
`live: train` in `docs/zones.yaml`, rendered by `db/lib/roomLive.js` and
repainted by `refreshLiveRooms` every close.

**The train runs on turn parity and nothing else.** The parity is about what
happens at a turn's CLOSE, not about where the train is standing while the turn
is open: closing an even turn rolls it in and unloads, closing an odd turn loads
it and pulls it out (`db/lib/train.js`). So turn 1 is a departure close with an
empty drop box and nothing to load, and turn 2's close is the first arrival —
which brings down whatever was ordered on turn 1, exactly as Bascinet asked,
with no first-turn special case in either pass.

**Where the train IS is a different question, and `trainHere()` is the one that
answers it.** It lands at the close of an even turn and leaves at the close of
the odd turn after, so it stands at the platform for the length of an odd turn —
turn 1 excepted, since nothing has arrived yet. Reading presence off
`isArrivalTurn()` instead tells everybody the train is in on the one turn it
demonstrably is not; `db/test/train.test.js` pins that.

**`trainHere()` decides more than deliveries now.** The two rail tunnels out of
the Depot (`MAP.md` §2, `db/lib/railroad.js`) read the same predicate to answer
whether walking into one is survivable this turn: at the platform the tunnel is
empty, out on the line it gibs whoever enters. So the parity above is
load-bearing twice over — change what "at the platform" means and you change who
walks out of a tunnel alive.

The cycle:

1. **Order** off a manifest. Obols leave your account now; the goods do not
   exist yet. That gap is the risk of buying.
2. **It arrives.** Every undelivered `DepotOrder` becomes crates in the
   Railyard, one stack of crates per order.
3. **It leaves.** Every unsettled `DepotSale` settles at the price frozen when
   it was dropped, the Meister's cut goes to the Vault as coin, and the net
   credits whichever account the row named.

**Parity decides which half RUNS; rows decide what MOVES.** Each pass opens with
a parity check and then works entirely off `deliveredAt: null` / `settledAt:
null`, claiming each row with a conditional `updateMany` before touching it. A
doubled or resumed turn advance therefore costs a turn of flavour and never a
shipment. `db/test/train.test.js` holds the parity half of that.

## 0d. Crates

A shipment does not arrive as a tidy pile of tags. It arrives packed, in
crates, and somebody has to open them. That makes unloading a job worth paying
a Docker for, puts a delay between buying a pistol and holding one, and means a
crate left in the Railyard can be stolen.

**A crate is packed by weight.** It fills to `PACKAGE_MAX_LBS` — 150 lb of
contents — and then a new one opens. That is the same constant the player-facing
Package button enforces (`FACTORY.md` §5), so a Depot shipment and a
hand-packed crate agree on the ceiling as well as on the halving. What comes out
is a box with a volume rather than a counter: 99 tea in one crate, an anvil most
of the way through another.

Units are mixed before they are packed, so a crate holds a random handful
rather than one tidy line item. `MAX_CRATES` (12) caps the count, past which a
huge order simply means fuller crates rather than a Railyard buried in tag rows.

There is a second cap, on **count** rather than weight: `PACKAGE_MAX_UNITS`
(200). The weight cap does not bound the weightless, and seven Depot wares
weigh 0 lb — `cigarette`, `jewelry`, `spectacles` and the four animals — so
without it a weightless order packs into one crate however large it is.

**A crate is a `Tag` row created at runtime** with `custom: true`, so
`db:prune-tags` skips it (`db/lib/pruneTags.js`). Being a tag means crates get
carry weight (half what went in, §5 of `FACTORY.md`), transfers, room stashes
and theft for free. The row is deleted once nothing references it.

**A crate is opened by consuming it**, from `/character` or the Things drawer,
wherever the crate happens to be — not from a button on `/depot`, since a crate
can walk out of the Railyard in somebody's arms. `crateTagData` sets
`consumable: true`, and `consumeTagRequestImpl` takes a third road out to
`openCrateRequestImpl` — beside the two that already existed for a sealed letter
and the Instant Camera, and for the same reason: what falls out of a crate is a
list of runtime tag IDs, which no catalog slug in `consumesInto` can name. The
keycard gate (`canOpenCrate`) is re-checked in there.

**A crate can hold ⬢.** They ride the order as a line with no `tagId` and land
on the crate row as `consumesIntoResources` — the field the ordinary consume
path already grants — so the Resources half of a shipment needs no special case
at all past the packing.

**A crated ⬢ weighs a pound** (`RESOURCE_UNIT_LBS`), so ⬢ pack against the
same 150 lb rule as everything else: 150 ⬢ fill one crate and it weighs 75 lb.

**A crate says whose it is.** The manifest is printed on the side with the
buyer's stamp in front of it:

```
[SHIPMENT ID RV-4471-K] · ADA VOSS · AV-2017: Coal x 4 | Bandage x 6 | ML-23
```

The **crate label** is picked at the counter: the buyer's name (the stamp
above), **No label** (the stamp reads `ANONYMOUS`), or **Custom**, up to 20
characters in `DepotOrder.label`, printed alone with no fingerprint. Either way
only the `DepotOrder` row then remembers whose it was.

Unless something in it ships sealed, in which case the whole crate reads:

```
[SHIPMENT ID RV-4471-K] · ADA VOSS · AV-2017: SEALED
```

...and only a Depot Keycard opens it — or a Silver Chip, when every sealed thing
inside came off the Black Market. **One sealed line item seals the crate it
lands in**, so nobody knows *which* crate the dangerous thing is in. The seal
hides *what* is in the box; whose box it is stays printed, because those are two
different secrets.

**A non-stackable ware can only be ordered one at a time.** `CharacterTag` is
unique on character+tag, so a crate reading `ML-23 x 2` could only ever hand
over one pistol; the order is refused rather than silently clamped. Opening a
crate never loses a non-stackable ware you already hold: the spare is set down
in a public room of your Location, where Transfer can pick it up, and the notice
says so. With no public room there, the crate refuses to open.

A ware ships sealed by setting `sealedShipping: true` in `docs/tags.yaml`. The
sync refuses it on a tag with no `depotPrice`, since the station cannot ship
what it does not stock. Currently sealed: the two firearms, the flamethrower,
Light Infantry Armour, Soporific, Phrygian Tears, the Homunculus.

## 0e. The manifests

A manifest is a **shelf**, and the thing that opens it. It is the answer to
"what may THIS person order", which used to have one answer because there was
one buyer.

| Manifest | Opened by | Holds |
|---|---|---|
| `general` | nothing — anyone standing at the counter | ⬢ and Ration Boxes |
| `black-market` | **Silver Chip** | the drink and drug shelf, the machete and the collar kit. **Buy-only, all of it** |
| `merchant` | **Merchant's Licence** | everything priced, sealed goods included |

The catalog is `db/lib/depotManifests.js` — zero requires, like `dmKinds.js`,
because the Buying tab is a client component. A ware names its shelf with
`manifest:` in `docs/tags.yaml`; **absent means `merchant`**, which is the
strictest default on purpose: a newly priced ware is his to stock until the
catalog says wider. `db/lib/syncTags.js` refuses a manifest id that is not in
the catalog, and refuses one on a ware with no `depotPrice` — a shelf with
nothing on it says nothing and reads as a rule.

Adding a manifest is one entry in that file plus a `manifest:` line per ware.
Nothing else has to change.

**The Silver Chip** (`silver-chip`) is a metallic poker chip, weightless,
tradeable, and does nothing whatsoever except open that shelf. Not craftable:
a forge that could mint them would mint the market open for everybody.

## 0f. The drop box, and the sell tax

Selling used to be the Merchant sending a shuttle up with whatever was standing
on the pad, paid into the station's float. It is a box anybody can drop something
into now.

**It is on the LOCATION, not one room** (`db/lib/placeAffordances.js`), so it is
reachable from wherever at the Depot somebody happens to be standing — and again
on the Railyard's own post, because that is where somebody meeting the train
already is. Two buttons, one dialog.

- **What goes in is deleted at once.** That is what makes it a one-way door:
  nothing sits in a stash waiting to be stolen back out, and the seller has
  committed. What is left is a `DepotSale` row.
- **The price is frozen at the drop**, so re-tuning `docs/tags.yaml` between the
  drop and the departure cannot restate what was sold.
- **It is fingerprinted.** The row carries the account, the fingerprint and the
  holder's name as a snapshot.
- **The destination is per-row**, one of SELF / TREASURY / MERCHANT, and can be
  re-pointed from the Selling tab until the train takes it. MERCHANT needs the
  Licence or a Depot Keycard — that is the Docker's seat: selling into his books
  instead of their own. It is their default; everyone else's is SELF.
- **A licence sees everybody's staged selling.** Settled rows stay each seller's
  own business.

**The sell tax** is `Depot.sellTaxRate`, whole percent, set from the Meister's
terminal (§0h). It comes off every settled sale before the seller is paid and
lands in the Vault **as coin** — so the Keep's stash grows by exactly what the
sellers were docked, which is what keeps the backing honest while the rate is
above zero.

## 0g. The bank

**An account is a claim, and a TREASURY claim is hard-backed.**

- `BankAccount.balanceObols` is the claim. `Depot.accountObols` is gone.
- The **Vault** is `undertown-1-7`, a real room behind the Baron's key,
  carrying **250 obols** in `docs/zones.yaml`, deliberately short of the
  roughly 315 ¢ the starting purses claim at 100 players (the comment on the
  stash says why: a bank run is meant to be a live possibility from day one,
  and the figure is not to be raised back to 480). Every TREASURY account
  draws on that pile and nothing else.
- **Nobody seeds that pile automatically, and this is the trap.**
  `db:import-zones` never writes a stash — it prints a warning telling you to
  seed it from `/gm/dev/zones` instead (`db/lib/importZones.js`). So the figure
  in the YAML is the intended stock, not the live one. Stock the Vault by hand
  before the game opens and run `npm run db:audit-vault-backing`, which exits 1
  when the claims outrun the coin.
- It matters more than it used to. Seats now open their accounts with money in
  them (`starting_account:` in `docs/roles.yaml`), so an unstocked Vault is not
  a quiet inconvenience — it is forty characters holding a balance the ATM will
  refuse to pay. The purses come to about 310 ¢ at 100 players and 395 at 150,
  which is where 480 comes from.
- **The ATM** moves obols between an account and physical `obol` tags. For a
  TREASURY account the coin comes physically out of the Vault, and a withdrawal
  the Vault cannot cover is **refused, never clamped** — a clamp would hand
  somebody less than they asked for and say nothing.
- **There are three of them** — the counter's, the Inn's and the Den's. Same
  machine, same accounts, same Vault behind them; §0l has the list and what
  did not follow it out of the Depot.
- An **OFFSHORE** account skips all of that. There is no pile behind it.
- **The Company's line** (`Depot.debtObols`, capped at `creditCapObols`, 75) is
  drawn and repaid in obols, and credits the Merchant's own account. The cap is
  **refused** rather than clamped. Nothing in code punishes a standing balance —
  the Company is not code.

**Send pays another account, or hands the claim back.** A third ATM button,
same standing gate as the other two. The picker names **holders, not
fingerprints** — a fingerprint half-tells you whose an account is, and a
dropdown of them would undo every anonymous order anybody has ever placed. It
lists the living only.

Paying a person is two locked account rows in one transaction, taken **in id
order** so two people paying each other at once queue rather than deadlock.
Nothing physical moves, so the room-lock rule below does not apply and the
Vault is not touched on either side.

**Sending to the treasury SURRENDERS the claim.** The treasury is a room, not
an account (`ECONOMY.md` §2), so there is nowhere to pay into: the balance
falls and the coin behind it stays exactly where it was. The Keep ends up
better backed rather than richer. That is the honest answer, and it is worth
knowing before reading the backing audit — a run of donations makes the claims
fall while the pile holds still.

**The Vault can be robbed, and that is the point.** It is a room with a stash in
it. Emptying it does not zero anybody's balance; it makes every balance
unwithdrawable, which is a far more interesting thing to do to a town.

**An account opens with its seat's `starting_account:` already in it.**
`web/app/(app)/character/createActions.js` bumps the new account by
`Role.startingAccountObols` at creation, so the claims exist from day one and
the Vault above is stocked short of them on purpose. A seat may also carry
physical obols in `starting_tags`, granted with a `Name xN` suffix
(`Obol x25`), parsed by `db/lib/startingTags.js`.

**Who gets one at creation** is `bank_account:` in `docs/roles.yaml`:
`treasury` for nearly every seat, `offshore` for the Merchant and his Dockers,
and **absent for the Black Hills** — the Tribunal arrives without one. Anyone else (a spawned antagonist, a threat handed a body
mid-game) opens one at the counter with a **Create an account** button: one
click, no cost, opens empty.

**THE ORDERING RULE, and it is the only one: room lock first, then the
account.** `db/lib/tagWrites.js#dropRoomTag` takes the room lock first, so a
deposit and a withdrawal that took them the other way round would deadlock.

**Debtor** is a separate faucet, off the drawback catalog rather than
`docs/roles.yaml`: taking the tag grants 20 obols in the creation transaction
(`DEBTOR_STARTING_OBOLS`, `db/lib/wantedPoster.js`), and the character owes
40 back. The debt is owed to either the Merchant or the Exactor — two tags,
**Debtor (Merchant)** (`debtor`) and **Debtor (Exactor)** (`debtor-exactor`),
which conflict, and neither seat may take its own. That debt is only ever
paper. Owed to the Merchant, three notices go up ("DEBTOR: {name}. Owes: 40
obols. Send the dockers."), a loose sheet each in the Merchant's Office and
the Storefront, and one pinned to the Depot noticeboard. Owed to the Exactor,
two go up ("{name}. Owes the house: 40 obols."), in the Exactor's Office and
the Den's Bar, and nothing is pinned — the Den has no board, and his debts are
not announced at the Depot. Nothing collects either automatically.

## 0h. The Meister's terminal

`/treasury`, and the gate is **place and key, not a tag**: a living character
standing at the `keep` Location who can get through the Meister's office door.
`canReadTreasury` in `db/lib/depotCounter.js` is the one predicate, and the page,
its one control and the nav rail all ask it — a rail offering an item that
redirects is worse than no item.

There was a **Meister's Terminal** tag for about a day and it is gone. The
terminal is a thing on a desk, so reaching the desk is the permission. The door's
keys are read off the Room's own `accessTagSlugs` (`meisters-key` or
`barons-key` today) rather than named in code, so re-keying the office in
`docs/zones.yaml` moves the gate with it.

**It comes and goes as its holder walks in and out of the Keep**, which is the
cost of that decision and the one thing nothing else in this app does —
`/lifeweb` and `/depot` gate on a tag and check standing inside their actions
instead. A superadmin reads it (host access, not game permission) but does not
get the dial; `web/app/(app)/treasury/actions.js` re-checks the real gate.

It shows every account — fingerprint, holder, role, class, balance — the Vault's
coin against the sum of the TREASURY claims, and what is staged to sell. The one
control is the **sell tax rate**, 0–100%, written to `Depot.sellTaxRate` with an
audit row. Click an account, or follow `?account=<id>`, to see only that
account's history.

**The Transactions list** (`db/lib/treasuryLedger.js`) is built at read time from
three places: deposits, withdrawals, transfers and opening balances off
`EconomyEntry`,
orders off `DepotOrder`, and settled sales off `DepotSale`. It shows only the
**General manifest's** side of the bank. An order with even one Black Market or
Merchant line is left out whole, as are sales into the Merchant's books and the
Company's credit line. That is judged line by line, never by
`DepotOrder.manifestId`, which records only the last ware carted. An order
stamped `ANONYMOUS` or with a Custom label shows under that stamp with no
fingerprint, and never in its account's own view. The account table names every
fingerprint, so showing it there would unmask the buyer.

**A transfer is two rows, not one** — the sender's and the recipient's, each
under its own account, because an account-to-account payment has a bank on both
ends and a single row would lose one of them. Filtered to one account, it is
whichever end that account is standing on. A claim surrendered to the treasury
has only the one end, so it draws as one row against the sender.

The ATMs tab no longer shows a player the Vault's total, and its Withdraw
dialog caps at the balance rather than the Vault for the same reason. A
withdrawal the Vault can't cover is refused server-side.

The number worth reading first is the **backing**. Under the line, somebody is
going to walk up to the ATM and be told no through no fault of their own. Set
the rate too high and people stop selling; set it too low and the Vault drains
and the town's money stops working.

## 0i. The turret

The first automated harm mechanic in Bascinet. Nothing else in this codebase
rolls damage — injuries have always been GM-adjudicated (`HARM_CHARACTER`) or a
narrative Gambit outcome — so there was no armour model to extend. What it
borrows instead is the *shape* of `db/lib/cavingLoot.js`: a weighted draw whose
columns must sum to 1.

**The switch is a physical thing in a room now.** A red *Toggle Turret* button
on the Merchant's Office starter post (`db/lib/placeAffordances.js`), which is
what that room's description — "a desk, filing cabinets, and a big red button" —
has promised since before anything could press one. It works exactly like the
Censor's, and for the same reasons: you have to be standing in the office,
re-checked at *submit* rather than at open, and you have to type `ARM` or
`DISARM`. Discord has no confirm dialog and a misclick on a red button should
not be able to shoot the shop. The state is re-read at submit, so two people in
the office at once cannot both flip it the same way. It also wants the Licence,
which the Censor's does not: the gun is the business's, not the room's.

It used to be a control on `/depot`'s Station tab. A switch that kills people
should be a thing you walk to.

**There are two turrets.** This one, and the gun on the rotor in the Gatehouse
yard (`db/lib/gatehouseTurret.js`, §0j below). They share everything except
where they stand, what turns them on and who they spare, so the sweep, the
arrival roll and what a bullet does to a sheet live once in
`db/lib/turretPass.js`. The ballistics — the severity ladder, the armour curve,
the weighted draw — stay in `db/lib/depotTurret.js`.

**It reads faces, not papers.** The turret spares exactly one thing: a
character whose **presented** name matches `Depot.merchantFace`. Not the
licence, not the keycard, not the role. So:

- A concealed Merchant is shot by his own gun.
- A Docker who steals the card is still shot.
- Anyone who comes back wearing the Merchant's name walks past it.
- With no face on file it fires on **everyone**, so **arming it is refused
  until there is one**. That was a one-click suicide with a GM-only cure:
  disarming needs you standing in the Depot, and walking in rolls the gun on
  you first.

**The face is written when the Merchant is created.** Creating a character on
the `merchant` role calls `setMerchantFace` with that character's own name
(`web/app/(app)/character/createActions.js`, in the best-effort side-effect
block; the writer is in `db/lib/depotState.js`). There is no field for it on
`/gm/dev` — the face is the Merchant's, written at creation.

It is set **once and never resynced**, because a face does not change when the
papers do. Two consequences worth knowing, both deliberate:

- Concealing himself later still gets the Merchant shot — he presents an alias,
  which is not the face on file. That is the trap working, not a bug.
- A **dead Merchant's face stays on file.** The gun goes on sparing a name
  nobody is wearing until the next Merchant is created, which overwrites it, or
  a GM edits it. Nothing clears it on death.

It fires **on entry** (`db/lib/locationMove.js`, before the Discord guard —
being shot is a database fact) and **again at the end of every turn**
(`db/lib/depotPass.js`), the way Caving rolls do. **Armed is now the only
condition**: there is no generator left for it to depend on.

**Being shot is very bad.** This is what a burst does to somebody wearing
nothing — the shipped table, `DEFAULT_TURRET_TABLE` in `db/lib/depotTurret.js`:

| graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|
| 10% | 4% | 9% | 16% | 20% | 41% |

Three fifths dying or dead, a quarter wounded, one in ten untouched. Standing in
front of an armed machinegun in shirtsleeves is meant to be close to fatal, not
a coin flip on being fine. The graze is a **flat dodge**, rolled first and the
same for everybody, armour or none: armour bends the rest of the curve, never
that tenth.

**Armour bends that curve; it does not replace it.** Every piece of gear carries
`Tag.ballisticArmor`, 0.0–1.0, and only while `equipped`. Worn pieces combine
multiplicatively on what gets *through*, capped at 0.95, and the combined figure
raises the roll to a power:

```
protection = min(0.95, 1 - Π(1 - ballisticArmor))
odds       = protection / (1 - protection)
h          = random() ^ (1 + ARMOR_GAIN * odds)   // ARMOR_GAIN = 0.25
```

`h` then walks the five wound bands, renormalised over the nine tenths the dodge
leaves. At zero protection the exponent is 1, so the draw *is* the table. The
bend is on the **odds** rather than on the raw figure: linear in a number
capped at 0.95, light infantry, heavy infantry and the best kit in the game
landed within a couple of points of each other on every outcome, and half of all
armoured wearers walked away untouched. The exponent is deliberate rather than a subtraction or a
scale: both of those reach a point where death becomes literally impossible, and
"there exists a jacket that makes a machinegun safe" is a worse rule than any
number could fix.

| kit | protection | graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|---|---|
| nothing | 0.00 | 10% | 4% | 9% | 16% | 20% | 41% |
| a Knight's Helmet | 0.20 | 10% | 4% | 10% | 17% | 20% | 40% |
| a Censor's Helmet | 0.31 | 10% | 5% | 10% | 17% | 19% | 38% |
| plate and a Knight's Helmet | 0.41 | 10% | 6% | 11% | 17% | 19% | 37% |
| Light Infantry Armour | 0.66 | 10% | 10% | 14% | 18% | 18% | 31% |
| Heavy Infantry Armor | 0.76 | 10% | 15% | 15% | 18% | 16% | 26% |
| Cataphract Armor | 0.86 | 10% | 25% | 16% | 16% | 13% | 19% |
| cataphract, Soulbreaker Helm and a Pavise | 0.94 | 10% | 47% | 14% | 11% | 8% | 11% |

A helmet alone barely moves the needle, and the whole forged ladder together
only gets a wearer from 39% to 44% left neither dying nor dead; the curve only
opens up past the infantry armours. Cataphract Armor still leaves a third of
its wearers dying or dead, and the best kit in the game about one in five.
(Rows recomputed 2026-09-23 with the armour rebalance, `SMITHING.md` §4a; the
"Armour, piece against piece" table of `npm run economy:report` carries the
same column for every piece.)

Armour is read off `Tag.ballisticArmor` directly, so it can never fall behind
the catalog. See `TAGS.md` for the two columns and the word scale players
actually see.

No single piece forged in Ravenheart reaches Overkill on its own any more —
that takes a full kit, or the Tribunal's own Cataphract. The catalog's claim
about the place holds: "nothing forged in Ravenheart stops a bullet".
The turret is where that line finally means something mechanical, and it is why
nothing forged sits above 0.3 ballistic.

**The table is not tunable, from the Dev Panel or anywhere else.**
`turretTable()` in `db/lib/depotTurret.js` returns `DEFAULT_TURRET_TABLE` and
ignores its argument, so both guns roll the shipped odds and always have. The
Dev Panel used to carry a JSON editor for it and the code a column comment
saying one existed; neither was true. Retuning means editing that constant.
A single piece of gear is still retuned on its own tag, which is the knob that
does work.

**The gun makes a noise, and it is heard past the room.**
`db/lib/turretBurst.js` posts `RRATATAT!` full-size into the Location the gun
stands in, and the same word as `-#` subtext into every other Location channel
in that zone. It fires on **every** burst, grazes included — a gun that only
made noise when it drew blood would be one nobody could learn to avoid — and
**once per burst, never once per victim**: the turn-end sweep shoots everyone
standing there in one go, and five identical lines for five people would read as
five guns. An empty room makes no noise at all.

**The DM names the wound.** The gun's own flavour line comes first, then the
plain fact on its own line: *"It does not check who you are first."* is the
right thing for a machinegun to say and tells a player nothing about whether
they are walking away or bleeding out, which they then had to open the web app
to discover (`turretDmFor` in `db/lib/turretPass.js`). A graze still sends no
DM — the channel burst already says the gun fired.

A `dead` result goes through `db/lib/characterDeath.js#applyDeathToRow`, so it
gets a corpse, an archive line and the Discord role owed back like any other
death.

## 0j. The other turret, in the Gatehouse

The triple-barrelled gun on the rotor in the fortress yard, which the Baron's
charter has described as "off" since before anything could switch it on.
`db/lib/gatehouseTurret.js`.

It is this turret's opposite in the one way that matters: **it spares nobody.**
No face, no keycard, no rank. Armed, it fires on whoever is standing in the
Gatehouse — the Cerberon, the Baron, the person who armed it. Armour still picks
a column, which is the point of the Cerberon's mail: the gun is survivable if
you are dressed for it, and not otherwise.

It carries no tunable table and no Dev Panel section. `rollTurret(tags, source)`
reads only `source.turretTable`, so passing `null` gets the shipped table for
free — that is the whole reason a second gun needed no new config.

Its entire state is `GameConfig.gatehouseTurretArmed`, off by default. Its
switch is the same shape as the Merchant's: a red button on the Censor's Office
starter post, a typed word, re-checked at submit. Flipping it speaks one `-#`
line into the Gatehouse through `db/lib/ambientLine.js` and writes one
`gatehouse_turret_toggled` audit row naming the character who pressed it.

It fires on the same two triggers as the Merchant's: on entry
(`db/lib/locationMove.js`, which asks both guns; each checks the destination
slug first and costs one indexed read to say no) and at the end of every turn,
as its own `gatehouseTurret` pass. Separate from `depot` in `TURN_PASSES` so a
failed Depot pass cannot swallow it and a resume re-runs only the one that did
not finish.

## 0k. The counter

`/depot`. A status strip that never scrolls away — greeting, your balance, and
where the train is — over five tabs: **ATMs**, **Selling**, **Buying**,
**Price list**, **Ledger**.

There is no Manifests tab, and there should not be one. A tab listing every
shelf and what opens it tells a man with no chip and no licence exactly what he
is missing and what is on the other side of it — which is the whole secret the
manifests exist to keep.

The strip is down to two things because those are the two facts that decide
whether anything you are about to do works, whichever tab you are on.

| Tab | What it is |
|---|---|
| **ATMs** | Your account, its class, the Vault's coin if it backs you, Withdraw / Deposit, the credit line if you hold the licence, and your own transactions. **Create an account** if you have none. |
| **Selling** | Your staged and settled sales, a destination dropdown per staged row, a **Default destination** that seeds the next drop, the drop box itself, and — with a licence — everybody's staged selling. |
| **Buying** | One section per manifest your tags open, a cart, an **Order anonymously** tick, and when the crates land. |
| **Price list** | The reference book, cut to what you are entitled to read: the shelves your tags open, plus a buy-back row for anything in your own hands. |
| **Ledger** | Your own `DEPOT_*` audit rows. |

No paragraph of explanation, no tooltips: a control whose name does not say what
it does is the bug, not the missing tooltip.

Prices print in ¢ throughout, whole, with no decimals anywhere. There is no
⬢/¢ toggle and there should not be one: a price is coin now (§0), and parity is
not a reason to offer the other glyph.

**The ATM, the drop box and the gun are not on this page.** They are fixtures on
walls — `db/lib/placeAffordances.js`, and the ATM's walls are listed in
`db/lib/depot.js#ATM_ROOM_SLUGS` — so each is a button on a Room's starter
post on Discord and a dialog in Chat's place panel on the web, and `/depot`
carries the tab you compare numbers on. The rules behind all three live once in
`db/lib/depotCounter.js` so both faces answer the same way; the Discord half is
deliberately thinner, because it is for the moment you are standing at the
machine with your phone out.

## 0l. There are three ATMs

The counter's own machine is on the Storefront. The other two are in **the
Inn's bar** (`town-7-2`) and **the Den's bar** (`undertown-8-1`), and each is
the machine alone: no counter behind it, no ordering, no drop box, no sell
window, no credit line. A player drinking in town or in the Den can check a
balance, take coin out, put coin in and open an account, and that is the whole
of it.

Both are named once, in `db/lib/depot.js` — `ATM_ROOM_SLUGS` for where the
button draws (`db/lib/placeAffordances.js`) and `ATM_LOCATION_SLUGS` for where
the machine answers. `counterActor` in `db/lib/depotCounter.js` takes a place
rather than assuming the Depot, and exactly three functions pass the wider one:
`counterState`, `openCounterAccount` and `bankMove`. Everything else —
`bankSend`, the drop box, the sell path, the gun — keeps the bare Depot gate,
which is what stops the Inn quietly becoming a second counter.

**A machine away from the Vault is still backed by it.** A TREASURY account
withdrawing at the Inn takes real coin out of the Keep's Vault and is refused
when the Vault is short, exactly as at the Storefront. Where a claim window
stands has never decided what is behind it.

To put a third machine somewhere, add its room and its location to those two
sets. Nothing else needs to know.

## 0m. The slot machine, in the Den

Not the Depot's, and in this file because it is the other money fixture bolted
to a wall. It stands in the **Den's Casino** (`undertown-8-3`) and the code is
`db/lib/slotMachine.js`, with the table and the prompt split into the
zero-require `db/lib/slotText.js` so Chat's dialog can read them without
dragging Prisma into the browser.

Three dice, 5 ¢ a spin, in real coin out of your hand:

| outcome | ways of 216 | pays |
|---|---|---|
| three alike | 6 (2.8%) | **50 ¢** — "Jackpot!" |
| a run, any order (1-2-3 or 4-5-6) | 12 (5.6%) | 15 ¢ |
| exactly a pair | 90 (41.7%) | 6 ¢ |
| nothing | 108 (50.0%) | — |

Half of spins pay, and the expected return is 4.72 ¢ against a 5 ¢ stake — a
**5.6% house edge**. The edge is in the money rather than in how often the
lights come on, which is how a real machine keeps its cut and still feels worth
another five. `db/test/slotMachine.test.js` fails if a retune leaves that band.

**The house is a person.** Stakes credit the living Exactor's account and
payouts are drawn from it, so a good night at the machine costs him and a bad
one keeps him — and his account is TREASURY-class, so the coin leg goes through
the Keep's Vault exactly as the ATM's does (§0g). Nothing here mints an obol.

Three consequences worth knowing:

- **It refuses a spin it could not pay out on**, checked against the jackpot
  rather than against what this pull happens to roll, and *before* it takes the
  coins. A machine that swallows your five and then cannot hand over the
  jackpot is a con. In practice the Exactor has to keep about 50 ¢ banked or
  the Casino goes dark, which is a job somebody has to do.
- **No Exactor, no machine.** If nobody is alive in the seat it refuses, and
  says the coin box's owner is nowhere to be found.
- **The room is told, and the player is told separately.** The line names
  whoever the room would *see* — a hooded player reads as "A young man", the
  same as anywhere else — and it goes out on both faces at once, with the same
  sound (`db/lib/sfx.js`'s four `slot-*` tokens).

## 1. What it is

A railway terminus in the Caves, tethered to an orbital station the Merchant's
sponsors own. It is the only route in or out of Ravenheart for anything
manufactured, and since the rework it is **a public market**: anybody standing
there trades with it, off whatever shelf their tags open. The Merchant's seat is
still the best one — the whole manifest, the credit line, the gun — but it is a
seat at a counter other people also use.

Stock is infinite. Price is the only limiter, and it is meant to be
prohibitive — a working person saves for a Boombox and never sees a pistol.

| | |
|---|---|
| Page | `/depot` (`web/app/(app)/depot/page.js`) — place or key (§0b): standing there, or carrying a manifest key, which reads it from anywhere. Read-only unless you are standing there |
| Location | `undertown-5` — the Depot, in Undertown, with its own edge to Customs. `db/lib/depot.js#DEPOT_LOCATION_SLUG` names it. Reading works anywhere; trading needs you standing there. |
| Rooms | `undertown-5-1`, the Railway — the train, the crates, the drop box and an ATM, and the Depot's only room. The Merchant's own three are next door at `undertown-6`: `undertown-6-1` Storefront (the second ATM), `undertown-6-2` Merchant's Office (the gun), `undertown-6-3` Cargo Bay (behind a keycard). The Inn's and the Den's bars carry ATMs of their own (§0l) |
| Gates | the page itself, `depotAccessFor` (§0b), then the manifests (§0e), plus `depot-keycard` for a sealed crate (or `silver-chip` when its sealed goods are all Black Market). `/treasury` gates on standing in the Keep with a key to the Meister's office (§0h) |
| Audit kinds | `request_depot_order`, `request_depot_drop`, `request_depot_atm`, `request_depot_credit`, `request_depot_account_open`, `request_depot_crate_open`, `depot_turret_toggled`, `sell_tax_rate_set`, `train_ran` |
| Constants | `db/lib/depot.js`, `db/lib/train.js`, `db/lib/depotManifests.js` |

## 2. The Licence

`merchants-license` is **a** door to the page rather than *the* door: a Silver
Chip opens it too, and so does simply walking to the counter (§0b). What the
licence is is the **widest shelf** plus the business: the whole manifest including
sealed goods, the Company's credit line, the gun on the office wall, and the
sight of everybody's staged selling. It is re-checked inside every server action
that depends on it. The Merchant starts with it.

It is `tradeable: true` on purpose. Handing it over really does hand over the
business — and, per its own text, the turret's goodwill. That is a decision
worth being able to make, and it is why the gate is the tag and never the role:
a role check would quietly break the trade.

There is no GM half to this page, and it needs none: a GM keeps `/depot`
wherever they stand — reading a market is adjudication, not play — and it is
read-only for them the same as for anybody away from the counter. `/gm/dev`
already does everything a GM would want beyond that. A superadmin reads `/treasury` without walking to the Keep —
host access rather than game permission, the way `/lifeweb` works — but does not
get the tax dial.

## 3. Buying

What the station charges, per unit. Almost every ware is `purchasable: false` —
not buyable at character creation — and almost every ware sits on the
**merchant** manifest, so for those the Licence really is the only way to get
one made offworld. That is the point of the seat; what changed is that ⬢ and
Ration Boxes are on the general shelf, and the drink and drug shelf is one chip
away (§0e).

**⬢ themselves are a ware, at 3 ¢ each in and 1 ¢ each out.** They are the
one line on either table the order path handles by hand — `RESOURCE_WARE_ID` is
the `resources` tag's own slug rather than a cuid, so it can never collide with
a real ware's id, and `depotOrderImpl` splits it out before anything reaches a
`Tag` lookup. It is on the general manifest, so anybody may order it. The 3:1 spread is doing real work. It means
importing food is a losing trade, which is the whole reason it exists: the
Merchant should be shipping things Ravenheart cannot make, not undercutting its
farmers with cheaper grain. And because the buy price is strictly above the
sell price, no amount of round-tripping prints an obol — the same invariant
`db/lib/syncTags.js` enforces for every priced tag, just held by hand here
since there is no row to check.

**It was 2:1 until 2026-09-20, and the buy side is what moved.** At 2 ¢ the
station was an unlimited ⬢ faucet with no scarcity behind it, so a crafter never
had to find a prospector — which makes the Mine button's whole payout
(`MINING.md`) a thing nobody needs to buy. 3 ¢ widens the price a prospector can
ask from 1–2 ¢ to 1–3 ¢, which is the room a negotiation needs.

**That price only means anything because obols stopped paying recipes**, the
same day (§4, "The two open holes in this"). While a smith could settle a recipe in coin at 1:1, the
import price was a number only non-smiths ever met. The two changes are one
decision and should be reverted together or not at all.

**Do not raise it past 3 without re-reading §4's smithed-gear formula.** That
formula is `resourceCost + wage` and credits material at **1 ¢ per ⬢** while the
station charges 3, so a smith who buys rather than mines is already eating twice
his `resourceCost` in unpriced cost. At 3 the low rungs still clear; at 4 Dead
Simple and Simple stop paying for anyone without their own supply.

**Paper undercuts everything, and the station sells it by the ream.** A
`stack-of-paper` is 3 ¢ and consumes into twenty sheets, so writing costs a
scribe almost nothing — which it has to, or nobody writes and the whole of
`PAPERWORK.md` is a menu people look at once. Loose `paper` is no longer on the
shelf: a weightless 1 ¢ line was a thing every order padded itself out with,
and the ream is the same paper at a fifth the price. It is also the only ware
with no sell-back price at all: a resale market in blank paper is not a thing
anybody needs.

**Sell-back is 60% of the buy price**, rounded, with a floor of 1 ¢. The
station still takes 40%, which is margin enough that round-tripping a rifle
for its own sake is a slow way to lose money.

Two wares carry a **wage floor** instead: `trapping-gear` and
`gladiator-helmet`, plus `workshop-equipment`. Each is craftable, so its
`sellablePrice` is what a *maker* earns under §4's bands, not what a reseller
gets back — 60% would have been a pay cut.

That rule bites on a rebalance, not just on the original pricing: re-price a
rung and check this list before shipping, since a wage floor can never drop.

**Three wares left that list by losing their sell-back entirely**, and it is
worth saying so rather than quietly shortening the list. `alcohol` and
`phrygian-tears` are on the Black Market, and the whole of that shelf is
buy-only now (§0e) — a brewer can still make either and still sell either to
another player, but the Depot will not take one back at any price.
`distilled-coca` is simply gone from the game, along with the coca chain
behind it.

That is a real cut to a brewer's income and it was taken deliberately: a drug
you can dump at the counter for coin is a wage, and a drug you have to find a
buyer for is a trade. The wage-never-goes-down rule still holds for everything
that still has a wage.

**The floor never applies to a 0-turn recipe.** At `turnsCost: 0` the Dead
Simple ration mints margin as a FREE action, so `fishing-rod` sells at the
Dead Simple convention (cost + the rung's flat markup, currently 5) instead of
60% of its import price.

Six are also creation picks, marked in the Notes column: `jewelry` (2 pt),
`instant-camera` (2), `sword-cane` (7), `surgical-equipment` (9),
`poison-snooper` (9) and `neoclassic-rw10` (14). All six are
`purchasableAfterStart: false`, so there is still no mid-game second source —
you bought one on day one or you buy one off him. The Poison Snooper is the
deliberate addition of the six: knowing which cup is poisoned, over and over,
is worth three-quarters of a starting budget, and its price stays steep so
buying one mid-game is still a real decision.

| Ware | ¢ | Sells back | Notes |
|---|---|---|---|
| `tea` | 2 | 1 | +15 mood (`MOOD.md` §5), the same as Maggot Milk |
| `changa` | 2 | — | Black Market. Three turns pinned at max mood, then an even roll between a Seizure and death |
| `heroin` | 2 | — | Black Market. Puts the dial at the top and hands over a permanent Heroin Addict (`MOOD.md`, `DESIRES.md`) |
| `stack-of-paper` | 2 | — | **The cheapest paper on the shelf**, deliberately. A ream: consumes into twenty blank sheets, and writing on one mints the letter (`PAPERWORK.md`). Sells back for nothing, so buying and reselling is pure loss. Loose `paper` is not stocked. |
| `firecracker` | 2 | 1 | |
| `art-supplies` | 3 | 2 | What a `painting` spends — the Artist's one running cost |
| `eth-lod` | 3 | — | Black Market. +20 mood, and it takes every pain tag off |
| `honey` | 3 | 2 | Food: 12 hunger raw |
| `sugar-candy` | 3 | 2 | Food: 6 hunger raw |
| `alcohol` | 4 | — | He stocks the local brew too |
| `kzozel-yantar` | 4 | — | Black Market. Consumes into `tipsy` |
| `collar-key` | 4 | — | Black Market. Turns a shut collar back into a loose one, into the UNLOCKER's hands (`COLLAR.md`) |
| `cigarette` | 4 | — | A Mudghara import, and the pricier vice — it costs more than a `tea` or a `coffee`. |
| `coffee` | 5 | 3 | Consumes into `caffeinated` (2t) |
| `rat-mask` | 5 | 3 | Force conceal (`PROXYING.md` §5). Not craftable — the Merchant is the only source, and it is priced below real gear on purpose: a paper-thin disguise shouldn't compete with it. |
| `love-tablets` | 7 | — | Black Market. +80 on a kiss, to BOTH sides — the one appearance bonus that is not crossed (`KISS.md`) |
| `black-market-autoinjector` | 8 | — | Black Market. The military autoinjector's whole cures list, and a stack of `damaged-vision` with it |
| `gelabine` | 8 | — | Black Market. Also a Skilled brew (0.5t, one `cave-fungus`). Takes every addiction off and leaves you Aching |
| `sake` | 9 | — | Consumes into `tipsy`. Under `ravenheart-red`'s 14 — its only price, since it has no `depotPrice` of its own |
| `whip` | 10 | 7 | Equippable |
| `machete` | 11 | — | Black Market. Equippable, 0.3 tiers as a `sword` |
| `boombox` | 12 | 8 | An instrument (`SOUND.md`, "Performances"): one hand, WEAPON slot. The Makeshift Stage still wants one on the floor |
| `lute` | 12 | 8 | An instrument, as the boombox |
| `accordion` | 12 | 8 | An instrument, as the boombox |
| `iron` | 13 | 8 | Craftable (`smithing`, spends `hematite` — `SMITHING.md`) — the fourth exception to "almost nothing here is craftable," below. It took `steel`'s numbers and its slot when steel and coal left the game on 2026-09-18. |
| `silver` | 19 | 10 | What `silver-knife`/`silver-spear` spend (`SMITHING.md`). Prospecting's to source (`MINING.md` §3b); this is the fallback. Repriced up from 8/5 on 2026-09-18 so an uncommon find is not worth less than an ingot smelted from ultracommon rock. |
| `jewelry` | 14 | 8 | Also a 2-pt creation pick |
| `mining-helmet` | 15 | 9 | Caving loot he also imports. A Simple Helm's plates plus a lamp, so it prices level with one — the lamp is station work, not forge work |
| `bomb-collar` | 15 | — | Black Market. The loose collar; Apply Collar spends one to write `bomb-collar-locked` (`COLLAR.md`) |
| `buffout` | 20 | — | Black Market. Also a Skilled brew (0.25t, `changa` + `cave-fungus`). +1.5 melee, none of Changa's risk |
| `poison-snooper` | 22 | 13 | **The exception:** also buyable at creation, 9 pt |
| `remote-detonator` | 23 | — | Black Market. Kills whoever wears a shut collar, and leaves no body |
| `sword-cane` | 24 | 14 | Also a 7-pt creation pick |
| `instant-camera` | 27 | 16 | Also a 2-pt creation pick |
| `microscope` | 31 | 19 | |
| `phrygian-tears` | 32 | — | Also a Skilled brew, at 4 ⬢ — see §4 |
| `surgical-equipment` | 33 | 20 | Also a 9-pt creation pick |
| `light-infantry-armour` | 37 | 22 | Stops a bullet. Nothing forged here does. |
| `hound` | 40 | 24 | |
| `soporific` | 41 | — | Inflicts `asleep` (1t) |
| `bb-pistol` | 68 | 41 | Equippable |
| `ambrosia` | 80 | — | Black Market. Also an Expert brew (1t, five `cave-fungus`). **+4 tag points**, the only item in the game that grants any |
| `silencer` | 83 | 50 | Equippable. The Merchant starts holding one |
| `homunculus` | 84 | 50 | |
| `antibiotics` | 92 | 55 | Cures every stage of infection |
| `horse` | 100 | 60 | **The dearest thing that is not a weapon or armour.** Also a 9-pt creation pick, and `purchasableAfterStart: false` — so mid-game the Merchant is the only horse in Ravenheart |
| `silver-sword` | 138 | 83 | |
| `chainsaw` | 140 | 84 | Cuts two Godflesh per Extract, and farms at +2 ⬢ — `FACTORY.md` |
| `neoclassic-rw10` | 150 | 90 | Neoclassic R&W10. Also a 14-pt creation pick. |
| `energy-shield` | 162 | 97 | **The dearest thing on the shelf that is not a gun.** Stops bullets outright and softens a melee blow — the best odds against the Fortress turret in the game, though a minor wound is still very possible. Caving loot he also imports. |
| `ml-23` | 167 | 100 | A 9mm pistol |
| `motorcycle` | 191 | 115 | Caving loot he also imports |
| `adamantium-sword` | 212 | 127 | |
| `flamethrower` | 217 | 130 | Caving loot he also imports |
| `ctt43-rifle` | 238 | 143 | A .308 semi-automatic |
| `kpfw-6-avtomat` | 496 | 298 | The dearest thing on the counter |

Three of these need code, not just catalog data:

- **`horse`** and **`motorcycle`** are `FAST_TRAVEL_SLUGS`
  (`db/lib/mounts.js`), so each buys the same extra zone crossing every turn
  while equipped. "Not through the caves" is **adjudicated, not enforced** —
  as the horse's own catalog text already says. Worth knowing, since he buys
  the thing standing in the Caves.
- **`coffee`** consumes into `caffeinated`, a status tag that exists only for
  it. **`soporific`** does *not* consume into `asleep`, and that is on purpose:
  you administer it to somebody else, so a self-targeting grant would put the
  drinker to sleep instead of the victim. It is spent by a Move and a GM
  applies `asleep` to whoever it happened to — the same "empty **Consumes
  into**" convention `BREWING.md` documents for a thrown flask or a poison.
  Nothing else in the catalog grants `asleep`.

The rest of the caving loot table stays found-only. The Motorcycle and the
Flamethrower are the only two artifacts the station will sell, on the reasoning
that it has no trouble getting either — it is Ravenheart that has trouble
hauling one up out of the Caves.

**Almost nothing here is `craftable`.** That is the point: if Ravenheart could
make it, importing it would be pointless. The exceptions are brews and drugs —
`alcohol` and `phrygian-tears` on the old shelf, `gelabine`, `buffout` and
`ambrosia` on the new one — which he stocks for somebody who would rather not
wait on a brewer. Each is priced well above what brewing one costs, and that
gap is the market a brewer sells into (§4). None of them can be sold BACK, so
that market is other players and not the counter.

**`iron` is the fourth**, and the first that isn't a brew — a
smith with no Prospector bringing up ore can buy the ingot outright instead
of smelting it himself. Same reasoning as the three brews: priced above what
the `smithing` recipe itself costs (`SMITHING.md`), so the Merchant is a
faster source, not a cheaper one. `silver` is not craftable at all, so it
never faced this question — it is simply stocked.

### Field gear

`fishing-rod` at 12 and `trapping-gear` at 26 are Merchant stock rather than
smith work. Both are craftable too, so the depot price is the impatience
premium, not a monopoly.

Both used to carry a Laboring bonus, which is where this section came
from. Laboring is gone and only three tags pay into a day's work now
(`MINING.md` §4) — one of which, the Mining Helmet, the Merchant does stock.

### Cooking ingredients with no other source

Ten cooking ingredients carry a `cooked:` block, `catalog: all` and a
`sellablePrice`, but no ongoing way onto a sheet — no farming, no
butchering, no caving loot, nothing past a one-time room-stash seed or
starting-kit grant (`COOKING.md` §11 lists the real, repeatable sources; a
stash or a starting kit is a seed, never a top-up — once it's spent, it's
gone for the rest of the game). Most were left behind by a rename: `cheese`
and `eel` are deliberate near-duplicates of `hard-cheese`/`river-eel`, and
neither picked up the older tag's source; `fish-roe`, `ravens-eye` and
`trout-heart` were all "dropped by the labor loot pass," which no longer
exists. Boar Loin, Deer Liver and Crayfish were always credited to
"Hunting"/"Fishing" in `COOKING.md`, and neither verb has ever existed in
code.

A `depotPrice` is the fix for `cheese` and `sugar`, the two that are plain
foodstuffs sold back at 2 ¢ already, so the buy price starts one to two
above that:

| Ware | ¢ | Sells back | Blocks (no substitute in the recipe) |
|---|---|---|---|
| `cheese` | 4 | 2 | Pizza Slice, Fondue — the starting-kit "Cheese x3" on four cook-adjacent roles runs out fast |
| `sugar` | 8 | 2 | a sweet extra ingredient for a meal; nothing else supplies it |

Both ¢ figures are pushed above the plain sell+1/2 pattern the rest of the
catalog follows — see below.

`eel`, `haggar`, `tunnel-trout`, `boar-loin`, `deer-liver`, `crayfish` and
`fish-roe` carry the identical gap and are deliberately left off the shelf
here rather than priced in — Fish Stew, Fried Fish, Foie Gras, Honeyed
Crayfish and Caviar all still depend on whichever of these a table happens
to have on hand. `COOKING.md` §11 tracks the gap; fixing it is a smaller,
separate cut from this one.

### The raw-eating ceiling

**No purchasable raw food may be a better deal, hunger and mood combined,
than a Ration Box.** Eating anything raw pays a flat −10 mood
(`db/lib/hunger.js#RAW_FOOD_MOOD`) before the food's own `cooked.mood`
lands, so an ingredient with a big enough mood figure can net a *better* raw
bite than the Ration Box's own 25.5 hunger / −5 mood for 3 ¢, even while
paying more ¢ per unit of hunger alone. A point of mood counts as 1.5 points
of hunger for this comparison (`npm run economy:report -- --mood-weight
1.5`; the report's own default is 2, but 1.5 is the number this catalog is
priced against), which puts the Ration Box's own ceiling at 6.0 points/¢
(`(25.5 + 1.5×−5) ÷ 3`).

`sugar`, `cheese`, `honey` and `sugar-candy` were all checked against it.
`honey` and `sugar-candy` carried the identical hunger (12, via the old
default for a food that granted Ate Meal; each now sets its own `cooked.hunger`)
and mood (20)
`sugar` does, at the same 3 ¢ starting price, so the same failure and the
same fix apply to all three alike:

| Ware | Before | After | Why |
|---|---|---|---|
| `cheese` | 3 | 4 | mood 15 |
| `sugar` | 3 | 8 | mood 20 |
| `honey` | 3 | 5 | same shape as `sugar` — pre-existing, not a new addition |
| `sugar-candy` | 3 | 5 | same shape again; "unrelated to cooking" (its own comment), so this is purely the raw-eating fix |

`aberrant-heart`, `ravens-eye` and `trout-heart` are the same shape of gap —
`BREWING.md` §4 says so outright — but they stay off this shelf on purpose:
each is `catalog: gm`, and the doc names their intended fix as the
prospecting loot table or a fallen monster, not an import. Stocking a
fallen Aberrant's own heart at the counter would say the opposite of what
the tag is for. `adders-bite` looks like the same shape (also `cooked:`,
also no depotPrice) but isn't a gap at all: it already has a real,
repeatable source on the Thanati's own black-market shelf (`THANATI_WARES`,
`THANATI.md` §3), which is exactly the kind of restricted, narrative-gated
source this section is protecting for the monster-trophy ingredients too.

## 4. Selling

What the station pays him, per unit. This is the other half of the loop —
players make things, he buys them for whatever he can talk them down to, and
the difference between that and the column below is his margin. Nothing in code
sets what he pays a player; that is his negotiation.

**⬢ sell back at 1 ¢ each**, through the drop box like any other ware. This is
the only way material becomes money, and it costs two thirds of its face value,
since the station charges 3 ¢ for the same ⬢ coming down (§3). Anybody may do it
now, which is the point: a labourer with a cart of material and no buyer has a
counter to walk it to.

Seven bands. Cooked food was unpriced until the Soilery rebalance; Tobacco,
the one cash crop, was an eighth until the Soilery Rework removed it, and the
raw food crops left the list entirely:

| Band | Priced at | Examples |
|---|---|---|
| Brews | build cost + margin; the batch recipes get a thinner one | `ravenheart-red` 16, `forgiveness` 18, `pure-luck` **113**, `dreamers-draught` **62** |
| Smithed gear | the price it had, with `resourceCost` fitted to a wage by skill points — see below | Dead Simple 6, Simple 16 (Spear, Dagger, Phrygian Spear 9), Moderate 30, High Quality 62, Gunpowder 74 (Bore Pistol 56) |
| Cave and bulk goods | unchanged from the Caves Update | `graga-sac` 8, `cave-fungus` 3, `saltpeter` 3, `skinless-brain` **25** |
| Factory goods | a day's output at ~3× a good farming day | `squeeze` **5** a cube — 8 cubes is a shift, so 40 ¢ (`FACTORY.md` §6). Cut from 7 on 2026-09-20. Buy-only in the other direction: the station sells nobody a cube |
| Salvage and valuables | what portable wealth is worth | `jewelry` 8, `heirloom` 12, `old-coin` 1, `painting` **41** |
| Body parts | low, on purpose | `eye` 10, `heart` 10, `hand` 6, `foot` 5, `stomach` 5, `tongue` 4 |
| Cooked food | deliberately almost nothing — see below | a snack 1, a basic meal **2**, a skilled meal **4** |

**Cooked food sells for almost nothing, and that is the design.** Every meal
class carries a `sellablePrice` (1 Basic, 2 Skilled, 4 Lavish), and
`db/lib/customCraftMint.js` copies `sellable`/`sellablePrice` onto the minted
`custom-craft-…` dish, so what a player actually cooked is what the counter
will take.

The number is low **so that the counter is a floor and not a market**. A cook
who dumps a meal at the drop box gets 2 ¢; the Innkeeper can offer 5 and still
resell at whatever a hungry player will bear. That spread is the Inn's whole
business, and it only exists while the Depot's own price is bad. Raise it and
the Inn stops being worth walking to. There is no coded Innkeeper mechanism
and there should not be one — the role is narrative (`docs/roles.yaml`), and
§0h's rule that the Inn must not quietly become a second counter still holds.

**Foodstuffs sell for nothing at all.** `foodstuffs`, the one thing the Farm
button grows, is not `sellable`, so the drop box refuses it outright. Farming
pays in food, and since the Soilery Rework there is no cash crop. See
`SOILERY.md`. The five Ration Box draws are
likewise unpriced, so the box cannot be bought at 3 ¢ and flipped.

**The station buys body parts now** (`CORPSES.md`, `TORTURE.md` §6). It is a coin
faucet hanging off a free action — Mutilate costs nothing and every death mints
a body — so the number that matters is the whole LADDER, not one part:
`db/lib/mutilate.js` takes nine pieces off one subject, which at these prices is
**61 ¢ a body**, against 30–42 ⬢ of material for a specialised day's labour. Price the
ladder, never the piece; the first pass priced the piece and a corpse came to
94 ¢. The ladder was 49 ¢ until 2026-09-20, which left butchering worth less
than a day's honest work for something far nastier to do. The eye and the heart are dearer than the rest because the rites eat those
two (`THANATI.md` §9), so a cultist and the Merchant now want the same organs.

**The Thanati's own shelf is not this depot** (`THANATI.md` §3). It is a code
list, `THANATI_WARES`, with one price per ware, spent out of the hideout room's
floor and the buyer's pockets — ⬢ and obols together, since an obol is one ⬢.
No `depotPrice` on any of it, and nothing there ever reaches the station.

**Three prices sit off the bands above on purpose.** `skinless-brain` is 25 —
clear of a Graga Sac's 8, without standing level with a whole day of industry
(it is the only ingredient in the catalog that has to be talked out of being a
person first). `dreamers-draught` is 62, above its own ingredient, because the
point of that recipe is that the brain is the cheap part. `painting` is 41 —
over its 4 turns that is ~10 ¢/turn, above every smithing, crafting and brewing rung (`artist` is not on the wage table).

**`human-flesh` is deliberately not sellable at all.** Butchering is free and
every death mints a corpse, so a price on it would be a code-enforced coin faucet
hanging off a free action. It stays `tradeable`, so the market for it is other
players.

**Smithing, crafting and brewing are priced by one wage table, and the wage is what the
Merchant's floor pays for the work.** A maker who imports every ⬢ at 3 ¢ (§3), crafts, and
sells to the station clears a profit per Move, and prices stay where they were: the recipe's
`resourceCost` is what moves to fit. For a recipe that works no input,

`sell − 3 × resourceCost ≈ round(rate × turnsCost^1.3)`

with a recipe that has no Move cost spreading the rate over its own `perTurn` cap instead.
`rate` follows the cumulative skill points the recipe is gated
behind, and nothing else:

| Skill gate | Cumulative pt | Rate, ¢ per Move | Where |
|---|---|---|---|
| `crafting` | 2 | 2 | Hat, Longbow, Shield, Pavise; the quarter-Move pieces clear 0 |
| `smithing`, `brewing-basic` | 5 | 4 | Simple gear, Cleaning Powder, Molotov Cocktail |
| `smithing-skilled`, `brewing-skilled` | 10 | 8 | Moderate to Exceptional gear, the ordinary brews |
| `brewing-expert` | 15 | 12 | Cybernetic limbs, Portable Surgical Pack |
| `smithing-gunpowder` | 19 | 15 | Gunpowder |

These rates are **before the Merchant's cut**. The report assumes a craft sold through the Merchant
leaves the maker **half of its profit on each item, and never less than 1 ¢ taken** (on a craft that
earns anything at all; one that loses money pays nothing, and the cut is never more than the profit).
So a craft that clears 2 ¢ an item keeps 1, one that clears 20 keeps 10, and a quarter-Move piece
that clears 1 ¢ keeps nothing. Selling to another player skips the cut, which is what a maker who
finds a buyer gets. The table is set on the raw profit, and the report shows both.

The top of the table is the Gunpowder rung: about 15 to 18 ¢ a turn raw once the two-Move
pieces take their `turnsCost^1.3` bonus, which is 7 to 9 after the Merchant's cut. The entry rung
clears 2 ¢ raw and 1 after. The floor is thin on purpose, and the real money is in selling above it
to somebody who wants the thing, but a maker who sells only to the Merchant still earns something. What
the table guarantees is the SHAPE: more skill points always pay more, and no recipe inside a
rung is an outlier. The old table priced ⬢ at 1 ¢ (an obol was "one ⬢"), so at the 3 ¢ the
station charges nearly every recipe lost money, and the only ones that made any — the ore
smelts, Glass Eye, Wooden Leg — were outliers that nothing in the other trades matched.
Both are gone.

`turnsCost^1.3` is still the reward for tying up more Moves in one item: a two-Move piece
earns about 2.5 times what a one-Move piece does, not twice. A quarter-Move piece rounds to a
whole ¢ of profit or none, so it moves in steps of 4 ¢ a turn; that is why the quarter-Move
pieces of `crafting` and `smithing` sell for exactly their material. Round those DOWN when
they will not land clean, never up, or the rung above is overtaken.

**The entry rung nets 1 to 2 ¢ a turn after the cut, where whole ¢ allow it.** A one-Move piece that
clears 2 ¢ keeps 1 and a half-Move piece that clears 2 ¢ keeps 1 an item, 2 a turn. The Hat (4 → 5 ¢),
Longbow, Shield and Pavise (16 → 17 ¢) and Cleaning Powder (4 → 5 ¢) had been left at 1 ¢ of profit,
which the Merchant's minimum cut takes whole, so a maker who sold them to him earned nothing. They
clear 2 ¢ a Move now: 1 ¢ a turn after the cut for the four crafted pieces and 2 for Cleaning Powder.
The quarter-Move pieces cannot follow, because a quarter-Move piece that clears 2 ¢ keeps 1 and
four fit in a turn, so 4 ¢ a turn, as much as a `smithing` maker; they stay at 0.

**Set a price by the WAGE, not by a multiplier on the price.** The margin is a small
difference of two larger numbers, so a percentage on the price lands as a wildly uneven
percentage on the wage. To reprice a recipe, read the rate off the table, apply the formula,
and run `npm run economy:report`: its claims table fails if any recipe drifts off its rung
(2 ¢, half the rate, or a craft and a half of profit, whichever is widest, on the raw profit)
or if a higher rung pays less than a lower one.

**Prices stay, and the material cost moves.** No recipe that works no input had its sell
price changed, and no shelf price moved except Iron's, apart from the five entry pieces
below. What changed is `resourceCost`: it was
fitted to the price, as close to the rung as a whole ⬢ allows, so 59 recipes now land on the
table. Examples: Simple gear 6 → 4 ⬢, Moderate 13 → 7, High Quality 25 → 15, Musketoon 28 → 15,
Bore Pistol 18 → 9, Workshop Equipment 25 → 15, Longbow and Shield 6 → 5, the Dead Simple pieces
3 → 2. The Spear, Dagger and Phrygian Spear were 6 ⬢ for 8 ¢; they are 3 ⬢ for 9 ¢ now, so a
quarter-Move piece breaks even, like the other Dead Simple pieces. The rest is rounding: a quarter-Move craft moves
in steps of 4 ¢ a turn, so the Pickaxe (2 ⬢, 8 ¢) clears 8 ¢ a turn raw, the Autoinjector (its
inputs cost more than its shelf price) sits under its rung, and the Badge and the Mulligan Potion
(a 2 ¢ price and a 17 ¢ shelf) cannot be fitted, and neither can the Trench Knife or the Knuckle
Duster (a 6 ¢ and a 3 ¢ shelf; each takes 1 ⬢ of scrap so the maker is at least not out of
pocket). The claims table leaves those six out by name.

**A recipe that works an input is priced off the input instead.** Pure Luck is a brew of an
Aberrant Heart; Black Powder is Saltpeter refined; a Silver Knife is a silver ingot worked. These are
worth their wage, plus their ⬢, plus **nearly twice the sell price of a raw input** (a cave find, an
organ, a crop) — 1.9 times, in the catalog — so working a material roughly doubles it. An input that
is itself crafted counts once, because its own price already carries the work; that is what stops the
premium compounding up a chain of recipes:

`sell = round(rate × turnsCost^1.3) + 3 × resourceCost + Σ inputs` (raw input × 1.9, crafted × 1)

These deviate from the wage table on purpose, by up to 0.9 times the raw input, and the ⬢ cost of
each was still fitted so the price stays near where it was wherever the input leaves room. The ones
that moved most: Black Powder 6 → 30, Crude Grenade 24 → 32, Bomb 74 → 151, Pure Luck 65 → 113 (its heart is 55), Deadeye Drops and
Mindbreaker Toxin 5 → 17, Bliss 3 → 8, Silver Knife 13 → 24 (half a Move, two to a Routine).

**Saltpeter is the scarce input, so what comes out of it is dear.** It has no source but the cave
finds (about one arrival in fifty), so Black Powder, the Crude Grenade and the Bomb keep their
original ⬢ costs (3, 6 and 28) instead of having them cut to hold their old price, and sell for more
because of it: 30, 32 and 151. The wage on top is the same as any other recipe on the rung.

**The three bars are the exception, and stay at their old prices** (Iron 8, Copper 6, Nickel 5, with
Iron's shelf at 13). A bar is a 1 ¢ ore and a quarter Move, so by the formula it would sell for 2,
but the ore cannot be bought: it comes out of the ground at about one press in five, so the ore is
the bottleneck and the bar's price can be large beside it. A smith who does have ore earns far above
the wage table (about 28 ¢ a turn on Iron), and that is meant. It also keeps an ingot worth more sold
than cracked: an ingot consumes into Resources (Iron 5, Copper 4, Nickel 3), which at the 1 ¢ sell-back
is less than the Merchant pays for it. The shelf price of 13 keeps buying Iron and cracking it from
paying, and would print coin if it were ever under 5. The four recipes that spend an ingot (Rapier,
Katana, Brigandine, Plate Armor) take 13, 13, 13 and 19 ⬢ now, fitted to their unchanged prices.

**Alcohol is made of Foodstuffs, not Resources.** Two Foodstuffs and a quarter Move, no ⬢, so it costs a brewer about 2 ¢ against the 4 ¢ shelf price
and the brews that spend it (`ravenheart-red`, `molotov-cocktail`, `cat`) are not pushed up by it.

`ravenheart-red` is an ordinary skilled brew now, priced by the table like the rest. The tag's
description still calls it "Ravenheart's only export", which is a story about the offworld
buyer and no longer a reason to pay it more.

A price table that is edited by hand beside a YAML file that is edited
separately will drift, and drift in the direction nobody checks. Before quoting
a wage in this file, derive it from the catalog rather than from the last person
who wrote it down: sell price, less `resourceCost` at 3 ¢, less what each entry in
`requirement.items` costs the shelf, over the `turnsCost`. Every one of those numbers is in
`docs/tags.yaml`.

**One brew is on both tables.** `phrygian-tears` costs 4 ⬢ to brew and 32 ¢ to
import. That is not an error and it is not a loophole: the import price is what
you pay for having no brewer, and the gap is exactly the market a brewer sells
into. `distilled-coca` was the other until the coca chain left the game.

A buy price at or below a sell price would let anyone with a licence print coin
in a loop. `db/lib/syncTags.js` warns on every sync if that ever inverts.

### The two open holes in this — both closed

This used to be real. Before the Request table was dropped (2026-09-11,
`REQUESTS.md`), `ADD_TAG` trusted a client-supplied `resourcesSpent` with no
server-side charge and no per-turn cap, so a Merchant who also took Brewing
II could file it for `ravenheart-red` declaring 0 ⬢ spent, sell the
brew here for a code-enforced 14 ¢, and repeat — unbounded within a single
turn.

It closed as a side effect of that rework, not a dedicated fix aimed at this
page. `craftRequestImpl` (`web/app/(app)/character/requestActions.js`)
computes a recipe's cost from its own catalog `requirementResources` — never
from anything the client posts — and `resolveCraftPayer` refuses outright,
re-checked inside the transaction's lock rather than trusted from the
fast-fail read, if `cost > payer.balance`. There is no path left where a
craft is charged for less than the recipe says.

**The second hole opened the day the counter did, and it is the reason two
numbers moved.** Selling used to be the Merchant's alone, which meant
`sellablePrice` was a reference figure with no button behind it — so a free
4-a-turn craft ration was a convenience rather than an income. Once anybody
standing at the Depot can drop a thing in a box and be paid for it, the same
ration is 12 ¢ a day, free, on every sheet in the game. Dead Simple costs a
quarter of a Move now and pays +1 rather than +3 (§4), which closes it.

**The third was the mint.** A smith could strike `obol` at Smithing (Skilled),
1 ⬢ in and 1 obol out, ten a turn, for no Move at all. At par that looks like no
margin — but an obol is weightless and a ⬢ is a pound, so it turned a cart of
raw material into something that fits in a pocket, free, forever. The recipe is
gone from `docs/tags.yaml` and does not come back. Coin enters the world through
the station and nowhere else, which is what makes a purse worth exactly as much
as your ability to reach a counter.

**The other half went on 2026-09-20.** Paying a smithing recipe's cost *with*
held obols (`resolveObolSpend`) is gone too. It was not a mint, so it survived
the first pass — but it contradicted §0's whole point, that ⬢ are material and
coin is money, and it made §3's import price meaningless to the one trade that
buys the most ⬢: a smith could settle the same bill in coin at 1:1 rather than
pay 3 ¢ a unit. A recipe is paid in ⬢ now, by every family, with no exception.
(Both notes here and in `docs/tags.yaml` used to cite `requestActions.js`; that
file is a re-export wrapper and never held the logic — it lived in
`web/app/(app)/character/actions/crafting.js`.)

## 5. The credit line

**Superseded by §0g.** The line is denominated in obols, lives on
`Depot.debtObols`, is capped by `Depot.creditCapObols`, and now credits the
Merchant's own account rather than a station float. `Character.depotDebt` was
dropped long ago — the licence is tradeable, so the debt travels with the
business rather than with whoever is holding the card.

Everything else is unchanged: draw puts money in the account, repay takes it
back out, the cap is refused rather than clamped, and nothing in code punishes a
standing balance. It is visible to GMs, and that is the enforcement.

## 6. Retail

Selling to another **player** is still not on this page. It is the existing
`TRANSFER_TAG` and `TRANSFER_RESOURCES` pair on `/character`, which requires
both parties standing together (`CARRY.md`).

What changed is that selling to the **station** is no longer the Merchant's
alone: the drop box (§0f) takes anything from anybody. That does not make him
redundant, it moves what he sells — he is the only shelf with the good things on
it, and the trip down to the Caves is still a trip. The Docker seat is if
anything sharper for it: a keycard sells into his books rather than its own,
which is a job you can hire somebody for.

**The one exception is the vending machine on his Storefront**
(`docs/systemdocs/VENDING.md`). It is the Merchant selling to a player with
neither of them present: he stocks it and sets the prices, a customer feeds it
coins and takes what they can pay for, and the money waits in a locked till for
him to collect. That is the whole point of it — one turn is one real day, so he
cannot stand behind a counter for all of it. Everything else about retail is
still the Transfer verb and still needs both parties in the room.

## 7. Where a player reads this

The **Merchant** document (`docs/documents.yaml`, key `merchant`) carries the
price bands and how the counter works, and goes to the Merchant and his Dockers.
The role charter in `docs/roles.yaml` carries the pitch. What a ware *does*
lives in the tag's own description and shows on hover, the same way a brew's
effect does — don't restate it in the document, it is already two places.

Since the counter opened to everybody, the parts that are no longer his alone —
that there is an account with your name on it, that the box in the Railyard buys
things, that the train runs every other day — belong in the **handbook**
(`docs/handbook.md`) rather than in a document only two people are handed.
