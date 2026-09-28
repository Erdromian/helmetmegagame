# The Meistery

The Meister's Terminal and the Meistery Window. This is built from Bascinet's
own design document, `E:\Bascinet\V3\Fates\Meistery.docx`. §1 is that document.
Everything after it is how the game does it.

## 1. The design, as written

> New room: Meistery Window
>
> Multi-locational room that can be accessed with Baron/Hand/Meister ring
> through the tower and by anyone through residences. It allows townsfolk to
> speak with the Meister.
>
> "At the bottom of one of the keep's many spires is a small, barred window
> level with the streets of the town. Inside sits the Meister's office. A small
> hole cut through the reinforced glass allows things to be passed through."
>
> Characters inside the meister's office can use the Meister's Terminal action,
> gated behind meister/hand/baron ring access. It contains a full list of all
> treasury accounts, and allows the user to edit the balances or outright
> delete accounts at will. Only the baron is excluded from having their account
> editable. The baron's account will always have a balance equivalent to the
> treasury, allowing them to withdraw as much of it at will as they wish, and
> this account cannot be edited or removed.
>
> Daily wages can also be set and changed for individual fates or characters,
> these are daily increases (or decreases if the wage is set as a negative) to
> a characters balance that occur at the end of each in game day (not
> necessarily each turn).
>
> The terminal also allows a character to connect a ring in their inventory to
> a treasury account, as long as the ring has not already been connected to an
> account.
>
> Tax rate can be set here, this is a fee incurred on all imports/exports
> through the depot which serves to fill the treasury.

(The quote is the doc's, with straight quotes and "keep's" for "keeps".)

Bascinet's calls while it was built (2026-09-28):

- **The terminal replaces the treasury action in the Meister's Study.** The
  Window is a separate room from the Study; it only lets people talk to the
  Meister from the streets. The `/treasury` page and its nav item are gone.
- **Carried over from `/treasury`:** the totals strip and its warning, the
  transactions list (now with wages, balance edits, closed accounts and the
  train's tax), the seat choice when a ring is registered (with the Scepter and
  License rule, RINGS.md §6), and the GM Dev tax field, which now writes an
  audit row too.
- **Both faces.** The whole terminal is on the web and on Discord.
- **The Baron's account** being the treasury itself is a separate change (the
  Crown account). This one only locks it: see §3.

## 2. The rooms and the gate

**The Meister's Study** (`fortress-5-2`, in the Tower) carries the terminal:
a room button, **Meister's Terminal**, on both faces
(`db/lib/placeAffordances.js`, `id: "meisterTerminal"`). Its door now opens for
`[meisters-key, hands-key, barons-key]` — the Hand's ring was added.

**The gate** is `db/lib/meisterTerminal.js#meisterActor`: alive, standing in the
Tower, and holding or wearing one of the Study's own `accessTagSlugs`. The keys
are read off the Room row, so re-keying the Study moves the gate with it. A
guest pass into the Study opens the door but not the terminal, and a ring in a
pocket opens nothing (RINGS.md §3). Writes also refuse anybody who cannot act
(`db/lib/incapacitation.js`). Reads stay open between sittings on the web; on
Discord every `mst:` press is act-gated, the Black Market's posture.

**The Meistery Window** (`fortress-5-4`) is a multi-locational room (MAP.md
§2d): home in the Tower, gated by the same three keys, with a public side onto
the **Residences** (`town-8`). Talk and whatever is dropped in it cross between
the sides, and Transfer works across it, the Merchant's Counter posture
(CARRY.md). It has no terminal — a side offers Storage and nothing else.
Because presence is by Location, whoever is in the Tower holding one of its
keys shows in the Window's Who's here from the street.

## 3. What the terminal does

Every rule is in `db/lib/meisterTerminal.js`; every word a player reads is in
`db/lib/meisterTerminalText.js`.

| | |
|---|---|
| **Totals** | The Vault's coin, what the Treasury accounts claim, what is on order at the Merchant's Terminal, the tax, and tonight's wage bill. When the Vault holds less than the claims: "withdrawals will be refused". |
| **Tax** | `setTaxRate`: a whole percent 0–100 on `Depot.sellTaxRate`, taken on every train's imports and exports (DEPOT.md §0f). Audit `sell_tax_rate_set`. |
| **Accounts** | Every account, Treasury and Offshore alike. Set a balance to any whole figure from -999,999 to 999,999 (`setAccountBalance`), or close the account (`closeAccount`). |
| **Wages** | A daily wage per fate or per character (`setWage`), §4. |
| **Rings** | Connect a ring in your hands to an account (`db/lib/ringRegistry.js#connectRing`), §5. |
| **Ledger** | `db/lib/treasuryLedger.js`, §7. |

**The Baron's account is locked** (`isLockedAccount`): the account of a living
Baron, or any account of class `CROWN`. It shows the Vault's coin as its
balance, and cannot be edited, closed or paid a wage. The class is compared as
a plain string, never in a Prisma `where`, so the code reads the same before
and after the Crown account adds that enum value. Until it does, the Baron's
infoterminal still pays out his stored balance — the terminal and the
infoterminal disagree about his figure until then. A dead Baron's old account
is an ordinary one.

**A balance set by hand moves a claim, not coin.** The difference is one ledger
leg against the bank clearing (`MEISTER_CREDIT` / `MEISTER_DEBIT`, ECONOMY.md
§5), so the books still close, but raising a balance deepens the gap the totals
warn about. A figure under zero is allowed: the Town Gatehouse already opens
accounts owing their fee (GATEHOUSE.md §5).

**Closing an account** writes whatever it held or owed off first
(`ACCOUNT_CLOSED`), then deletes the row. A ring linked to it keeps its doors
and loses its account (`Tag.ringBankAccountId` is `SET NULL`), so it can be
connected again (§5); Documents printed for it open nothing. It is refused while
the account has goods on order from the old counter (`DepotOrder` cascades with
the account, so they would never arrive) or a sale still waiting to settle into
it. Audit `treasury_account_closed`, with how many rings were unlinked.

## 4. Wages

`Wage` holds one row per fate (`roleId`) or per character (`characterId`) —
exactly one of the two, by a CHECK constraint in migration
`20261120000000_meistery` that Prisma cannot model. A character's own row
overrides their fate's, and a character row of `0` exempts them. The Baron takes
none, as a fate or as a person. Bounds: ±9,999 ¢ a day.

**Paid by the `wages` turn pass** (`db/lib/wagePass.js`, TURN-ENGINE.md §2),
just before the train, after every pass that can kill:

- A close pays the day it belongs to when the NEXT turn will open on a new day
  (`nextDayFor`, the floor settle's measure). That is exact when
  `GameConfig.turnsPerDay` counts the days.
- On the midnight clock a turn can close before midnight and its successor open
  after it, so every close also pays **yesterday** if yesterday is still
  unpaid — the backstop, which also covers a wages pass that threw.
- `WagePayout(dayNumber)` is the claim, inserted in the same transaction as the
  credits, so no re-run pays a day twice. The migration marks every day already
  over as paid, so the backstop never back-pays history.

Who is paid: every living character with an account, in account-id order (the
order `bankSend` locks in). A deduction floors at 0, or at the balance if it is
already under zero: a wage never puts anybody into debt. Anybody with no
account is skipped, not given one. No DMs. Ledger reasons `WAGE` /
`WAGE_DEDUCTION`, claim legs only; the audit row is `wages_paid`.

**Restart Game** deletes every `Wage` and `WagePayout`: a fate's wage hangs off a
Role that survives a restart, and the day numbers start again at 1.

A GM moving the day on `/gm/dev` (`updateCurrentTurn`) can skip or repeat a wage
day. That is left alone.

## 5. Connecting a ring

A ring in the worker's hands with no account (`ringBankAccountId` null) can be
connected. Two cases:

- **A ring the terminal has never seen** (a smith's, RINGS.md §6) is registered:
  the worker picks which seats' doors it opens — a seat with `authorised_by`
  needs that item in their hands — and which account it reaches.
- **A ring that was registered once** and lost its account when the Meister
  closed it only gets an account back. Its doors stay what they were, so closing
  an account and reconnecting the ring can never add a door.

The account is the engraved person's own (opened if they have none), or any
existing one — on Discord, typed by its fingerprint. The swap is a
compare-and-swap on `ringBankAccountId`, so two presses cannot connect one ring
twice. Audit `ring_registered`, with `reconnected`.

## 6. The two faces

| | Web (`/chat`, the Study's room panel) | Discord (the Study's room post) |
|---|---|---|
| Open | **Meister's Terminal** opens a dialog (`web/app/(app)/chat/MeisterTerminalDialog.js`) | **Meister's Terminal** opens an ephemeral panel, edited in place (`bot/src/events/interactions/meisterTerminal.js`) |
| Totals, tax | always on top; a number field | the panel's home; **Set tax** opens a modal |
| Accounts | a searchable table; a row opens its card: set balance, own wage, Close account (the shared confirm) | 15 a page, a select, a search modal; the card has Set balance, Wage, History, Close account (a confirm step) |
| Wages | every fate with a field; the character overrides and an add row | the fates in a select, 25 a page, then a modal; a character's own wage is on their card |
| Rings | the ring, the seats (for a new ring), the account | a select of rings, up to two seat multi-selects, then the account |
| Ledger | read when the tab opens, filterable, one account at a time | 15 a page |

The web actions are in `web/app/(app)/chat/actions.js` (`meisterTerminalView`,
`meisterSetTax` …). A superadmin reads the same books, read-only, under
`/gm/dev?s=depot` ("The Meister's books", `web/app/(desk)/gm/dev/MeisterBooks.js`);
every change made at the terminal is on `/gm/audit` under **Meister**.

## 7. The ledger

`db/lib/treasuryLedger.js` builds the list at read time: every claim leg on an
account (deposits, withdrawals, transfers, opening balances, the Documents fee,
closed accounts, balances set by hand, wages), the tax the train paid into the
Vault (`IMPORT_TAX`, `EXPORT_TAX`, the legacy `SELL_TAX`), and the old counter's
General orders and settled sales. In the whole-bank view each payout of wages is
folded into one row, or they would bury everything else inside a week; filtered
to one account, its own wage rows show one by one.

## 8. Where the code lives

| | |
|---|---|
| `db/lib/meisterTerminal.js` | the gate, the books, every write |
| `db/lib/meisterTerminalText.js` | every word, the Baron's seat, the bounds (zero requires) |
| `db/lib/wagePass.js` | the wage pass |
| `db/lib/ringRegistry.js` | connecting a ring |
| `db/lib/treasuryLedger.js` | the ledger |
| `db/prisma/migrations/20261120000000_meistery` | `Wage`, `WagePayout`, the Study's key, the Window on a running game |
| `db/test/meisterTerminal.test.js` | the rules, the gate, and the writes against Postgres |

**On a running game**, the migration adds the Window and its side; their Discord
threads come with the next `db:mirror` (or "Reconcile now" on `/gm/dev`), which
also redraws the Study's post without the old Sell tax button. The Meister's new
role description needs a hand `npm run db:sync-roles`, since roles do not sync
on deploy.
