# Late joins

The seats a player may walk into after the game has started: what one is, how a
GM opens it, and what the Bastard's Call reinforcements button does to it.

The catalog is `db/lib/lateJoin.js`; the GM surface is `/gm/dev?s=latejoins`;
the player surface is the **Special** section at the top of the creation
picker.

Companion to [`THREATS.md`](THREATS.md) (the spawn, which this is deliberately
not) and [`CHARACTERS.md`](CHARACTERS.md) (the wizard this draws into).

A **late party** ([`LATE-PARTIES.md`](LATE-PARTIES.md)) is the bigger door.
While one is live, the Special section is not drawn, and every late-join seat is
locked along with every other fate the party does not name. No row here
changes, but a character the party made in a late-join fate counts against
that seat's chairs afterwards, like anybody else holding it.

## 1. What a late join is

A **spawn-only Role that a GM has opened to whoever wants it.**

That is the whole idea, and the one sentence worth keeping: a **spawn** picks
the person — a GM chooses somebody and DMs them an offer they accept or decline
(`THREATS.md` §4) — and a **late join** opens a door and lets the room fill it.
Sometimes the GM wants to hand the Tribunal to three people they have chosen.
Sometimes they want to open three chairs and walk away. Both are useful, so
both exist, and neither is the other's switch.

The two share the plumbing on purpose: the same `Role` row, the same
`starting_tags` kit, the same seat-count math. They differ in who decides.

## 2. The candidate list is code

`LATE_JOIN_ROLE_SLUGS` in `db/lib/lateJoin.js`. Same reasoning as
`db/lib/roleIds.js`: fixed values that can never differ per environment, and a
column would only add a way to drift from `docs/roles.yaml`.

Every candidate is also in `SPAWN_ONLY_FATE_SLUGS`
(`db/lib/fateCapacity.js`), which is what keeps it out of the ordinary picker,
out of the assignment roll and out of the lobby's hand-set dropdown. A late
join does **not** un-hide the seat there; it draws its own section instead.

Today: the Tribunal Ordinator, the Tribune, and the Bastard's six.

## 3. A row is the GM's answer, not the seat

`LateJoinRole` is keyed by `roleSlug`, with `enabled` and `slots`. There is no
`Role` relation — the candidate list is code, a row here is only the answer
about it, and a Role that has not been synced yet must not stop a GM opening
the seat ahead of the sync.

**`slots` is the cap, not what is left.** How many are spent is counted off the
`Character` rows holding the role, the way every other seat count in the game
is (`seatHolderStatuses`), so a dead late-joiner still holds the chair unless
the role is one of the two that reopen. A second column would be a second copy
of the truth and would be wrong the moment a GM deleted a character by hand.

**A seat that is switched off has no capacity, however many chairs are still
sitting in its row.** That is what makes the Dev Panel's checkbox a real closed
door rather than a label, and it is why `lateJoinCapacity()` exists rather than
callers reading `slots` themselves.

**The cap replaces `fateCapacity()`, it does not combine with it.** A bucket
seat scales with the roster; a late join is however many chairs a GM opened.
Both `createCharacter` and `reserveFate` ask `lateJoinOpeningFor` first and use
`fateCapacity` only when the answer is no — and both re-ask **under the row
lock**, so a GM closing the door mid-wizard wins.

## 4. The curse does not reach a late join

`db/lib/curse.js` stops a player with an unburied body making anybody at all.
A late-join seat is **exempt**, deliberately.

The argument: what the curse costs you is your place in Ravenheart, and a late
join is somebody arriving from **outside** it. So it takes nothing that was
ever yours.

Three places implement it, and all three must agree:

- `web/app/(app)/character/page.js` — a cursed player with a seat open gets the
  wizard rather than `CreationCursed`, carrying `cursedToSpecial: true`.
- `CreateCharacterWizard.js` — with that flag the social buckets are hidden
  **outright**, not greyed: every one of them is a seat the curse really does
  refuse. Only the Special section is drawn.
- `createActions.js` — `createCharacter` and `reserveFateAction` each re-check
  it. A server action is a public endpoint, and the narrowed wizard is a hint.

Close the last open seat and a cursed player is back to `CreationCursed` on the
next load, with nothing else changed.

## 5. The Special section

The picker's own heading, **above** the seven social buckets rather than among
them (`db/lib/roleGroups.js`). It is not a bucket: a bucket is a place in
Ravenheart's order, and every seat here is somebody who holds none.

It draws only what `openLateJoinRows` returns — enabled, with a Role behind it,
and a chair left. An empty section draws nothing at all, which is the normal
case. The cards are the ordinary `RoleCard`, built by the same `roleCard()`
helper the buckets use, so the two can never disagree about what a seat looks
like; `taken`/`cap` read `1/3` the way every other card does.

A whitelisted late join (the Bastard) still greys for a player without the
Leader Whitelist role. Opening a seat is not the same as vouching for who sits
in it.

## 6. Call reinforcements

The Bastard's button, on the sheet's verb strip (`CallReinforcementsButton.js`,
`bastardActions.js`). It is on the sheet of anybody holding the `bastard` tag —
the seat tag, not a role check, so a GM's hand grant works, exactly as
`THREATS.md` §2 derives every other seat.

**It summons nobody.** What it buys is a chair: `openLateJoinSlots` adds to
`slots` and switches the seat on, and a real player then takes it from the
Special section. That is why it is not a spawn — there is no person on the
other end of it yet.

Prices are in `REINFORCEMENTS`, in ¢, paid in ¢ **or** ⬢ at par — one obol is
one ⬢ (`DEPOT.md` §0). Obols first, then ⬢. The money is priced and drawn
**inside** the transaction off a read taken there, which is
`thanatiActions.js#purchaseGearImpl`'s reasoning: a purse planned outside it can
shrink in between, and the refusal then names the wrong pocket. The obol leg is
a conditional decrement, so two clicks racing cannot spend the same coin.

Infantry is the floor and the rifleman the ceiling, which is the pricing
argument: a man with a spear is cheap, and a man with a working firearm,
underground, is not.

`openLateJoinSlots` **adds**; the Dev Panel **sets**. A GM saying "three of
these" means three, not three more.

## 7. The Deep Beast Horn

Not a late-join mechanism at all — it is the Bastard's other button, and it
lives beside this one because it arrived with the party. `db/lib/deepBeastHorn.js`.

Where a trumpet carries a few hops across the Location graph
(`db/lib/trumpet.js`), the horn is one line in **every surface Location in the
game at once**. It has no origin, like the nuke, so it is `worldBroadcast.js`
rather than `soundBroadcast.js`.

**It does not reach the caves.** `zoneKinds: ["SURFACE"]` is the whole rule, and
it is asymmetric on purpose: a horn sounded in a cave still only reaches the
surface. The line is `You hear a deep, booming horn.` — nothing in it says who
blew it or from where, which is the point of a horn nobody can place.

It shares the bell's cooldown, and claims the clock **before** the fan-out, not
after: forty-odd REST calls is long enough for a second click to slip past a
cooldown stamped at the end.

## 8. Where the code lives

| File | What |
|---|---|
| `db/lib/lateJoin.js` | The catalog, the reinforcement prices, the readers and the two writers. Zero requires — reachable from a client component |
| `db/lib/deepBeastHorn.js` | The horn's reach and its line |
| `db/lib/fateCapacity.js` | `SPAWN_ONLY_FATE_SLUGS`, which hides every candidate from the ordinary picker |
| `db/lib/fateReservation.js` | The wizard's hold, which honours the late-join cap |
| `web/lib/lateJoin.js` | Client-safe re-export shim |
| `web/app/(app)/gm/dev/lateJoinActions.js` | `updateLateJoinRole` |
| `web/app/(app)/gm/dev/threats/LateJoinsPanel.js` | The GM table |
| `web/app/(app)/character/bastardActions.js` | `callReinforcements`, `soundDeepBeastHorn` |
| `web/app/components/CallReinforcementsButton.js` | The Bastard's dialog |
| `web/app/components/SoundHornButton.js` | The horn |
| `web/app/(app)/character/page.js` | The Special group and the curse branch |

## 9. Adding a late-join role

1. Write the seat in `docs/roles.yaml` and run `npm run db:sync-roles`.
2. Add its slug to `LATE_JOIN_ROLE_SLUGS` **and** `SPAWN_ONLY_FATE_SLUGS`.
3. If the Bastard should be able to buy it, add it to `REINFORCEMENTS` with a
   price.

That is all — the Dev Panel table, the picker section and both gates read the
catalog.
