# Rings

Signet rings replaced the seat keys, the wax stamps and the self-serve bank
account. This is built from Bascinet's own design document,
`E:\Bascinet\V3\Rings.docx`. §1 is that document. Everything after it is how the
game does it.

## 1. The design, as written

> Fate specific keys are to be replaced by rings. All characters which spawn in
> Ravenheart excluding Bums and Slaves have their own unique ring engraved with
> their initials.
>
> ATMs are to be renamed to infoterminals.
>
> Rings may be equipped on a new finger equippable slot. They do not get in the
> way or wearing gloves or other hands equippables.
>
> Wearing it grants access to all rooms and terminals accessible by their role,
> as well as use of certain items that are locked and only usable by certain
> individuals. Wearing it allows a character to access their treasury account
> through an infoterminal. Wearing a stolen ring grants access to all of these,
> except for infoterminals. Infoterminals will request a characters pin if
> either the ring is on a different character, or the character has forgotten
> their pin due to head trauma/brain damage. It is meant to make entering a pin
> something done automatically, unless a character is unable to do so
> themselves.
>
> Characters who do not have rings can have them minted by the smiths. A smith
> can craft a ring, and when crafting may choose a character to which the ring
> will be assigned. These rings then have to be taken to the meister in order
> to put them into the database, assigning permissions and connecting them to a
> new or existing treasury account.
>
> Rings additionally function as seals. Certain roles rings cannot be smithed,
> including any who have their own dedicated seal. Seals are to be removed and
> rings will be used in their stead.

Bascinet's calls while it was built (2026-09-26):

- **Every seat key goes into the rings.** The Inn's and the Den's guest-room
  keys stay keys, so the Innkeeper and the Exactor can still lend them out. The
  Collar Key went into the rings later (PR #211): the Exactor's and the
  Pusher's rings carry `collar-key`, and the item is gone (`COLLAR.md` §3).
- **Who spawns with a ring is a per-seat switch** (`ring.spawns`), picked seat by
  seat. The default is every Town, Keep and Undertown seat except Bum and Slave.
- **Only an office's own ring seals.** The nine seats that used to keep a wax
  stamp — Baron, Hand, Meister, Censor, Esculap, Bishop, Inquisitor, Merchant,
  Banneret — start with a ring of their own name and description, and those are
  the only rings that leave a seal. Every other ring, and every ring a smith
  makes, leaves no seal of any kind. A smith can still make a ring the Meister
  registers to an office seat's doors; it opens them, and says it won't seal.
- **Forgery copies an office's seal.** Holding an office's ring, a forger cuts a
  wax seal carrying its mark. That is the only way to get an office's wax seal.

## 2. What a ring is

A ring is its own minted `Tag` row (`db/lib/ringMint.js`), the same
`custom` + `ephemeral` door as a photo, because each one is engraved for one
person and registered to its own doors and account:

| Column | What it holds |
|---|---|
| `ringOfCharacterId` | Who it was engraved for. Snapshot id, no FK. Non-null is what makes a row a ring. |
| `ringInitials` | The engraving, "A.V." — first and last name only, never the honorific or a quoted title (`initialsOf`). Kept on its own because the name need not carry it. |
| `ringRoleSlugs` | The seats whose doors it was registered to. |
| `ringAccessSlugs` | The union of those seats' `Role.ringAccessSlugs`, copied here so every door check reads it off the worn row. `db:sync-roles` refreshes it when a seat's list changes. |
| `ringRegisteredAt` | Nothing opens until this is set. |
| `ringBankAccountId` | The account an infoterminal reaches with it. |
| `sealMark`, `sealOffice` | Set only on an office's own ring. `db/lib/paper.js#isSeal` then treats it as a seal. |

It goes on the new **`FINGER`** equip slot (`db/lib/equipSlots.js`): one ring at a
time, taking nothing from the hands or the four accessories. It weighs nothing,
is tradeable, and shows on a look only while worn. Pickpocketing can't take a
worn ring (`THEFT.md` §2b); Loot can, off somebody who can't stop it.

A seat's ring lives in the `ring:` block in `docs/roles.yaml`, read by
`db/lib/syncRoles.js` onto the `Role` row:

```yaml
ring:
  spawns: true
  opens: [armory-key, cerberus-key, barons-key, tower-key, elevator-key]
  seal_office: Baron
  seal_mark: "A raven clutching a banner."
  name: "Baron's Ring"
  description: "A heavy gold ring engraved with the initials {initials}. …"
```

The four office keys come as a set or not at all; `{initials}` is filled in.

## 3. Doors

**The door tokens are the retired seat keys' slugs.** Every room's `access:` and
every locked way in `docs/zones.yaml` still names `barons-key`, `tower-key` and
so on. The key *items* are gone from every starting kit and stash, and their
copy recipes with them, but the tag rows stay as the tokens a ring carries. So
no door needed rewiring and the channel doctor's "that tag exists" check still
holds.

`db/lib/rings.js#accessSlugsOf` is the one rule: what you hold, plus the
`ringAccessSlugs` of the registered ring on your finger. A ring in a pocket
opens nothing.

- `db/lib/roomAccess.js#heldTagSlugs` uses it, so every caller of
  `roomAccessKeys` — rooms, threads, stashes, the Meister's Terminal, the phones,
  vending, search — follows the ring with no change of its own.
- Travel takes its held set from the caller's own select, so
  `withRingTokens` adds the worn ring's tokens there (`locationGraph.js`,
  `locationTravel.js`, the keyed-way prompt, `gates.js#holdKeyedOpen`). A way
  the ring opened reports `openedBy: "ring"` (the Ring recipe's slug), so the
  travel note reads "Your ring grants you access." rather than naming a key
  nobody holds (`web/lib/travelCost.js#openedByLabel`).
- Things that check for an item: the Censor's warrant badge
  (`WARRANT_BADGE_SLUGS`, `censors-key`), the Depot keycard on the manifests
  and crates, the refinery's rooms.
- Things only a ring opens, where a held tag of the same slug does not count:
  the collar remote and Unlock Collar (`COLLAR.md`), the Black Market
  terminal in the Exactor's Office (`black-market-key`, `DEPOT.md` §0n), and
  the Merchant's Terminal at the Depot (`merchants-terminal-key`, the Merchant's
  ring only, `DEPOT.md` §0c — the Merchant's License held opens it too).
- `depot-keycard`, on the Merchant's and the Dockers' rings, opens the locked
  way between the Storefront and the Depot and the Cargo Bay (`DEPOT.md` §0b).
- `gatehouse-key`, on the Baron's, the Hand's, the Incarn's, the Censor's, the
  Cerberi's and the Squires' rings, opens the way from the Square into the Town
  Gatehouse, and — ring only — works Grant Passage in its Gate Controls.
  `portcullis-key`, on the same rings with the Meister's in place of the
  Incarn's, works the portcullis between the Residences and the Courtyard, ring
  only (`GATEHOUSE.md`, `MAP.md` §2a).

Putting a ring on or taking it off re-runs `syncCharacterRoomAccess` through the
ordinary equip tail, so the private threads follow.

Physical keys that other people can find or buy stay as they were: the Elevator
key and the Depot keycard are still loot and shop items, and also in the rings
of the seats that used to start with them. The Silver Chip was one of these
until the Black Market left the Depot for the Exactor's terminal; it is gone.

One door opened by this that no seat could open before: the Servant's
`servant-key` (the Keep's Storehouse, Kitchen and Workshop). The Bishop's ring
carries `order-key` beside `cathedral-key`, so the Bishop goes into the Order
Chambers by the same doors the Order does.

## 4. Seals

Only an office's own ring carries a `sealMark` and a `sealOffice`. It seals a
letter through the ordinary Seal verb, titled with the office — "Sealed Letter
(Baron)" (`paper.js#sealLabel` reads `sealOffice` first). The wax says what the
ring's face bears, worded the way its description puts it: the letter reads
"This one bears a seal: A raven clutching a banner, the seal of the Baron."

The fifteen wax stamps are gone from `docs/tags.yaml` and from every stash. The
sync now refuses a `sealMark` or `sealOffice` authored in the YAML: an
office's mark lives on its seat's `ring:`.

**Forged Wax Seal** (`forged-wax-seal`, Forgery, 1 turn, 2 ⬢) is the one way to
get an office's wax seal. The forger picks which ring in their hands to press
(`resolveForgeSource` in `actions/crafting.js`, the Death Mask's
`ingredientChoice` channel), and gets a minted stamp — "Wax Seal of the Baron" —
carrying that ring's mark and label (`ringMint.js#createForgedSeal`). A plain
ring has no mark and is refused.

## 5. Infoterminals

The ATMs are infoterminals now, in player text and in the code alike. Only the
ids live data already holds keep the old name: the `room:atm:` and `depotatm:`
Discord button ids, the `request_depot_atm` audit kind, and `DEPOT_ATM` as a
`RequestType` and an economy reason.

An infoterminal reads the ring on your finger (`depotCounter.js#terminalAccount`):

- No ring, or an unregistered one: no account ("Take it to the Meister.").
- A registered ring whose account the Meister closed: no account, and no way
  back — a ring connects once (§6). It says so without sending anyone to the
  Meister (`infoterminalClosed`).
- Your own ring, and you're not Concussed or Amnesiac: your account, no PIN.
- Somebody else's ring: that ring's account, **for its holder's PIN**.
- Your own ring while Concussed or Amnesiac (`memoryScramble.SCRAMBLING_TAG_SLUGS`):
  your PIN, typed.

The PIN is `Character.pin` from Memories (`MEMORIES.md`), finally checked. A
holder from before PINs existed is given one on the spot. The account is
withheld from the dialog until the PIN is right, and every money call —
withdraw, deposit, Send — checks it again. The web dialog keeps a typed PIN in
its own state only; Discord asks for it in each amount modal.

**Documents work too, when no ring is worn** (`GATEHOUSE.md`). A set of
Documents printed at the Town Gatehouse carries `Tag.documentsBankAccountId`,
and held in hand it opens that account on exactly the ring's PIN rule: your own
papers need no PIN, anybody else's need the holder's — which is written on the
papers, so stolen ones are as good as the PIN to whoever can read. A worn ring
always wins over papers in a pocket.

**No account is opened at a terminal any more.** A seat's account opens at
creation and its ring is linked to it; everyone else has a ring smithed and the
Meister opens one when he registers it, or is documented at the Town Gatehouse. (The drop box and the credit line,
which used the character's own account, went with the Depot Overhaul.)

## 6. Smithing a ring, and the Meister

**Ring** (`ring`, Smithing I, 0.25 turn, 2 ⬢, at a forge). The
smith picks who it is for: themselves, or anybody on their Friends list known by
a real person (`resolveRingTarget`). It is engraved with that person's initials
and comes out unregistered, opening nothing, sealing nothing.

**Registering** happens at the Meister's Terminal in the Meister's Study
(`MEISTERY.md` §5), on both faces — worked by the Meister's, the Hand's or the
Baron's ring. Meistery.docx: a ring is connected "as long as the ring has not
already been connected to an account", so the terminal offers only the rings
the worker is holding that were never registered
(`ringRegistry.js#connectableRingsHeld`: `ringRegisteredAt` and
`ringBankAccountId` both null). For each:

- tick any seats whose access it should grant (none is allowed: an
  account-only ring). A seat with `ring.authorised_by` is the office's own to
  hand out: registering a ring to **the Merchant's** access needs the
  **Merchant's License** in the registrar's hands, and **the Baron's** needs the
  **Baron's Scepter**. The panel greys those seats out for anybody not holding
  it, and the server refuses them regardless;
- link the engraved person's account — opened now if they have none — or any
  existing account.

**A ring connects to one account in its life** (Bascinet's call, 2026-09-28).
When the Meister closes that account the ring keeps its doors and reaches no
account, and the terminal never offers it again. `ringRegisteredAt` is the
mark: every ring ever connected carries it, a seat's own ring from birth (§7).
The one gap is a seat's ring whose account failed to open at creation — it is
registered with no account and can't be connected, so that is a GM fix, the
same as a ringless character.

A connection is compare-and-swapped on `ringBankAccountId` and
`ringRegisteredAt` both being null, so a ring can't be connected twice, and it
writes a `ring_registered` audit row. A ring registered
to an office seat's doors gets "It lacks the signet seal of the original." on
its description.

## 7. Spawning

`ringMint.js#mintSpawnRing` runs after the create transaction, beside the bank
account, for every seat with `ring.spawns`: mints the ring (an office's own for
the nine), puts it on, registers it to the seat, links it to the character's
account (opening one if the seat had none) and recomputes room access. Called
from `createActions.js`, `reincarnate.js` and `threatSpawn.js`. Best-effort, like
the account: a ringless character is a GM fix, not a failed creation.

## 8. Moving a running game over

`npm run db:ring-in` (`db/scripts/ops/ring-in.js`), dry run unless given
`-- --apply`, after `db:sync-tags` and `db:sync-roles`:

1. mints a ring for every living character whose seat spawns with one and who
   has none engraved for them;
2. strips the retired seat keys and the fifteen stamps from every hand and
   stash;
3. recomputes everybody touched's private threads (needs `DISCORD_TOKEN`).

Safe to run twice. `db:prune-tags -- --apply` removes the stamps' own tag rows
afterwards, if wanted.

## 9. Where the code lives

| What | Where |
|---|---|
| The rules (doors, seals, names) | `db/lib/rings.js` |
| Every word | `db/lib/ringText.js` |
| Minting, registering, forging | `db/lib/ringMint.js` |
| The Meister's registration | `db/lib/ringRegistry.js`, the Rings tab of the Meister's Terminal (`MEISTERY.md`) |
| The infoterminal | `db/lib/depotCounter.js#terminalAccount`, `web/app/(app)/chat/PlacePanel.js#InfoterminalDialog`, `bot/src/events/interactions/depotCounter.js` |
| Crafting | `web/app/(app)/character/actions/crafting.js`, the pickers built in `character/page.js` |
| The seat's ring | `ring:` in `docs/roles.yaml`, `db/lib/syncRoles.js` |
| Catch-up | `db/scripts/ops/ring-in.js` |
| Tests | `db/test/rings.test.js` |

## 10. What this does not do

- **Depot orders are paid from your own account**, not the ring's. Only the
  infoterminal's own buttons read the ring.
- **Missing fingers don't stop a ring going on.**
