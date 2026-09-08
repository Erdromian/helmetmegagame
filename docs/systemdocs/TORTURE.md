# Torture

The Torture button, the die behind it, what a broken person gives up, and the
Torturing Equipment kit. Read this before touching `db/lib/torture.js`, the
`torturer` tag, the `TORTURED` fear event, or anything that decides who breaks
under questioning.

Shipped 2026-09-06. Before it, the Order's role text promised "your torturer's
tools" and the Torturer tag promised better Gambits, and both were prose a GM
had to honour by hand.

## 1. The button

**Torture** sits in the "People here" section of the character sheet's action
grid (`web/app/components/actionRegistry.js`) and is **hidden, not greyed**,
unless the character holds `torturer` — an own-sheet fact, which the grid's
metagaming rule allows hiding on. `/play` does not mount the grid, and its
per-person menu (`HereList.js`) is unconditional with no pools access, so
Torture is deliberately not on it: a row there would tell every player that
torture exists whether or not they could do it.

The dialog is the Free picker with the same filter — everyone standing here
who is **Bound** — and the server re-checks all of it
(`tortureCharacterRequestImpl`, `web/app/(app)/character/requestActions.js`):
you hold `torturer`, the target is ALIVE, `isHere`, and holds `bound`.

It **spends your Move**. `requireFreeMove` refuses if you have acted, and the
Move is filed through `fileAutoRoutine` as a ROUTINE already PASSED, with the
whole story in its description — `Tortured Ada: Rolled a 5 +1 Cruel against 4
— they broke.` — because a GM never adjudicates it and that line on
`/gm/turns` is the record. It is a Routine and not a Gambit on purpose: the
torturer is told the result at once, and a GAMBIT row would have the turn-end
push announce the same die a second time (`stagedPush.js#gambitRollNotices`).

`torturer` itself is 2 points, purchasable by anyone at creation and from
`/store`. Every Order role except the Preacher starts with it
(`docs/roles.yaml`).

## 2. The roll

One d6, resolved in `db/lib/torture.js#resolveTorture`, Prisma-free and
tested in `db/test/torture.test.js`.

**The bar is set by the target:**

| Target holds | Needs |
|---|---|
| nothing special | 4 |
| `craven` | 2 |
| `brave` | 5 |
| `relentless` | 6 |

Hardest wins when several apply, which in practice means Relentless over Brave
(Brave and Craven already `conflictsWith` each other).

**The torturer adds to the die**, +1 each:

| Bonus | Read how |
|---|---|
| Torturing Equipment in reach | `hasEquipmentInReach` — held, in a Room stash you can get into here, or provided by a structure; the same three reaches as Surgical Equipment |
| Trench Knife | carried, any quantity; it need not be drawn |
| `cruel` | held |

Then the ordinary Gambit penalties — Hungry, Afraid, Panic from
`db/lib/gambitModifier.js` — count exactly as they would on any Gambit. Learn
and Confess already apply them; this is the third roll that does.

**A natural 1 always fails**, whatever the arithmetic says. Without that rule a
Cruel torturer with a knife in an equipped chamber would break anyone but a
Relentless target on every roll.

## 3. What a break gives up

On a success the torturer's DM is an embed (`buildTortureEmbed`, plain JSON —
no discord.js in `web/`), laid out like the bot's Examine card and carrying
the victim's **true** name and portrait. A hood or a disguise does not survive
being broken; `tortureReadout` in `db/lib/examine.js` reads `Character.name`
and the own avatar rather than `presentedIdentity`.

- **Their tags** — every row on the sheet **except** `Health` and `Status`
  (`REVEAL_EXCLUDED_CATEGORIES`). Wounds are not secrets, and the passing
  statuses (Bound, Hungry, the fear bands, the meal markers) would bury the
  ones that are. Everything else shows: items, personality, beliefs, skills,
  keys, and the secret-catalog tags — `thanati`, `demoness`, a body's mark —
  which is the point.
- **Their last three fulfilled Desires**, newest first (`Desire.status =
  FULFILLED`, ordered by `endedTurnNumber`). Omitted when there are none.
- **The Thanati**, only when the victim holds `thanati-leader`: the names of
  every other ALIVE character holding `thanati` (`db/lib/threats.js`).

The DM carries `meta: { embed: true }`, so `/gm/messages` leaves it out of the
conversation view (`web/lib/dmThread.js`). What was revealed is in the audit
row instead (`request_torture_character`, `details.revealedTagNames`,
`details.desires`, `details.thanatiNames`).

On a hold the torturer gets one plain line with the roll: `Rolled a 3 −1
Hungry against 4. They held out.`

## 4. What it does to the victim

**Fear.** `+40`, kind `TORTURED`, success or failure, through `applyFear`
inside the action's transaction (FEAR.md §3). Two statuses zero it —
`pain-immunity` and `opium-high`, both ×0 in `MULTIPLIERS` — and a 0 beats
Brave's ×0.5. Both are two-turn statuses, so a torturer who waits a day gets
the full hit.

**Depressed**, on a success only. Granted with `source: EVENT` and no expiry,
the same door Bind's `bound` and Crucify's `crucified` walk through. Depressed
`conflictsWith` most of the Personality group, but those are purchase-time
checks; an EVENT grant lands beside Cruel or Nobility exactly as a GM grant
would. A Chaplain's Confession or a Bliss cures it (CONFESSION.md,
`db/lib/hiddenCures.js`). There is no Undo; a GM takes it off from `/gm/dev`.

**The DM**, unattributed like every `notifyCharacter` line:

- broke: *You were tortured and failed to conceal your secrets. The torturer
  now knows everything about you.*
- held: *You were tortured, but held out. It won't be long, now...*

Both are Bascinet's words verbatim and carry no ‡.

## 5. Torturing Equipment

The fourth standing kit beside Workshop, Surgical and Packaging Equipment
(`db/lib/equipmentReach.js`): `torturing-equipment`, 20 lb, tradeable,
`purchasable: false`, `pointCost: 0`. It carries no `group` on purpose, like
Surgical Equipment — the Recipes tab renders by group, and neither kit is a
recipe a player crafts off a shelf.

**Recipe:** 1 turn, 2 ⬢, `skills: [torturer]`, `items: [work-knife, hatchet,
cudgel]`, all three **spent**. The gate is the Torturer tag itself — a
recipe's `skills:` list is satisfied by holding the named tag, the same way
Bone Mask names `butcher` (CRAFTING.md §2) — so there is no smithing skill,
no forge, and no ladder tier. `craftFamily()` reads it as `torturer` work.

**One is seeded in the Order Chambers** (`docs/zones.yaml`,
`cathedral-order-chambers`, a stash floor). Anyone with an Order Key stands
within reach of it; anyone can carry it off.

## 6. Where the code lives

- `db/lib/torture.js` — thresholds, bonuses, `resolveTorture`, `revealedTags`,
  `formatTortureRoll`, `buildTortureEmbed`. Off the barrel; require by path.
- `db/lib/constants.js` — `TORTURER_SLUG`, `TORTURING_EQUIPMENT_SLUG`.
- `db/lib/examine.js#tortureReadout` — the unfiltered read.
- `db/lib/fear.js` — `EVENTS.TORTURED`, the two ×0 rows.
- `db/lib/discordRest.js` — `embeds` on `postMessage` / `postDmOnce` /
  `postDmBatched`, forwarded by both `sendDm`s and `notifyCharacter`. Added for
  this; the bot's own embeds go through discord.js and never touched it.
- `web/app/(app)/character/requestActions.js#tortureCharacterRequestImpl`.
- `web/app/components/actionRegistry.js`, `RequestActionsProvider.js` (mode
  `torture`, sharing the Bind/Free roster), `character/page.js` (`canTorture`).
- `web/app/components/icons.js#TortureIcon` — Lucide's flame.
- `db/test/torture.test.js`, and the TORTURED case in `db/test/fear.test.js`.
