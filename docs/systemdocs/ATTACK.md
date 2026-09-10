# Attack — pinning a fight in place

You press it on somebody standing with you and neither of you goes anywhere.
Both of you are held where you are until the turn ends and a GM reads what you
both filed.

**Nothing here resolves a fight.** A fight is a Gambit and a GM's ruling, the
same as it always was (`COMBAT.md`). What this buys is that the other person
cannot walk out of the scene and carry on with their day before the ruling
lands.

## 1. It is Intercept's hold

`db/lib/intercept.js` owns `Character.heldUntil`, `heldReasonFor`, and every
gate that reads them — the mover's own gate in `performLocationMove`, the
refusal `resolveNeighbors` draws on every shut way, the `/chat` and `/map`
banners, the Stepstone, the bot's picker, the escort that refuses to carry a
held follower. **None of that changed.** `db/lib/attack.js` writes the same two
columns and inherits the lot.

The hold runs to `turnClock.js#turnEndsAt(openTurn)`, so the turn advance frees
everybody for free: no cron, no pass, no rows to sweep. Floored at
`now + SAFE_HOLD_MS`, the `fireWatches` reasoning — a turn the cron has not
closed on time would otherwise put the deadline in the past and hold nobody.

**Both sides are held, each named as holding the other.** You do not start a
fight and stroll off. `Character.heldReason` says which of the two things has
hold of somebody, so `heldReasonFor` can name the right one while staying pure
— a query inside that predicate would have to be awaited at eight call sites.

## 2. The row is the rule

`Attack`, one row per attacker per target per turn, and the
`@@unique([attackerId, targetCharacterId, turnId])` **is** "attacking is
permanent for the turn". The `InterceptHit` shape exactly: the insert claims
the act, so nothing is ever counted.

Breaking off **stamps `cancelledAt` and never deletes**. A deleted row would
hand the unique back and let somebody attack the same person all afternoon.
It is also what a GM reads afterwards — a fight somebody started and called off
is still something that happened.

Only the attacker may call it off. `cancelAttack`'s `WHERE` is the ownership
check; there is no second lookup to disagree with it.

`clearHoldIfFree` runs for **both** sides and clears nothing while any other
live Attack this turn names that person, so one man backing out of a three-way
brawl does not unpick the whole thing.

**Three other things end a fight**, and each ends the ROW rather than the hold,
because the hold is derived from it:

1. The attacker presses **Break off** — on the sheet, or on the button in their
   own DM. Both go through `db/lib/dmAnswer.js#answerAttackHold`, so the faces
   cannot drift.
2. Either of them is **relocated** — a GM's teleport, a Bulk Move, a staged
   Relocate to, a rite. `closeFightsOnMove` hangs off
   `applyLocationMoveSideEffects`, the writer every relocation runs. Walking off
   never reaches it, because a held character cannot walk.
3. The attacker **dies** (`db/lib/characterDeath.js`), beside the escort and
   hold releases. The row is stamped so the GM's lens does not sit there reading
   "Holding" over a corpse.

*One known gap, and it is small:* a two-minute Safe intercept hold that an
attack overwrote is not restored when the attack is called off. A second column
for two minutes of a stranger's afternoon is the worse trade.

## 3. The strength gate

> This opponent is too strong to attack.

Refused when the target's band is **more than two bands** above yours.
`MAX_BAND_GAP` in `db/lib/attack.js` is the one tunable.

**Bands, not points, and that is load-bearing.** `floor:`/`cap:` tags move the
band index *after* the points are summed (`fightingSkill.js`), so a bound Expert
still scores 55 and only their band knows they are Pitiful. A score-based gate
would let a tied-up champion refuse to be attacked, which is exactly backwards.
Bands are also the unit the game already speaks, and they are ten points wide
with every rung dead centre — so two bands is two tiers either way.

**The better half of each tree answers.** A marksman is measured on their
ranged band, not on the melee they never trained; otherwise a good shot is a
free target for anybody with a knife.

Only the gap **upward** is checked. Attacking somebody far below you is a bad
thing to do, not an impossible one, and the GM reads it either way.

How it falls out against the catalog as written:

```
a peasant           Weak       may attack up to Capable
a guard             Mediocre   may attack up to Seasoned
a soldier           Capable    may attack the Dangerous swordsman
```

So a peasant may take on a guard or a soldier and is refused a trained
swordsman or an Expert; a guard may take on the soldier and is refused the
swordsman. That is the line the gate is drawn at: a fight you will probably
lose is yours to pick, a fight you cannot be in is not.

**Why it exists:** without it anybody at all freezes anybody at all for a whole
day, and a bum stops the Tribunal Ordinator by walking up to them. It is meant
to stop a hopeless fight, not a hard one.

**It is the one thing a player ever learns about somebody else's band**, and
`COMBAT.md` §5 names it as the deliberate exception it is. It is one bit — "3 or
more above me" — rather than a number, and it costs a press to learn.

## 4. An Ambush IS an attack

An Intercept watch in **Ambush** mode files a real `Attack` row when it fires
(`fromAmbush: true`), and that row is what holds both sides. Same hold, same
cancel, same queue. **Safe** is untouched: a two-minute stop, no Attack row.

Two consequences worth stating plainly:

- **No strength gate on an ambush.** You set a watch blind and do not get to
  pick who walks into it.
- **The ambusher is held too.** Springing the trap puts you in the fight. That
  is a real change to Intercept and it follows from §1.

The Release button on the ambusher's DM became **Cancel attack**
(`DM_ACTION.ATTACK_HOLD`), because breaking off has to unpick *both* holds
rather than one. `INTERCEPT_HOLD` and its prefix stay so a button already
sitting in somebody's DMs when this shipped still does something; nothing
builds a new one.

`releaseHeldBy` refuses to touch an attack hold at all — its `WHERE` carries
`heldReason: { not: "attack" }`. Letting the intercept Release near one would
free the victim, leave the row live, and leave the attacker standing there held
by a fight that no longer holds anybody.

## 5. What it costs

Nothing. No Move, no ⬢, no `Action` row, no per-turn ration. The Gambit you
file afterwards is what costs your Move.

`needs: ACT` applies — a bound man is told why rather than left pressing a
button that cannot work.

## 6. The surface

`/character`'s verb strip, in the **Others** section, on `ActionDialog`.

**No `gate` and no `show`.** Whether anybody standing near you is out of your
league is a fact about the *room*, and greying on it would be free scouting
every time the page loaded — the metagaming rule at the top of
`actionRegistry.js`. The picker lists everybody here, **including the people the
button will refuse**, for the same reason: filtering them out would answer "who
is out of my league?" to anyone who opened the dialog, which is the one thing
§3's exception is kept narrow to avoid.

Nothing in the dialog is a tooltip (`SHEET.md` §3). What an attack does prints
on the page, and the fights you are already in sit under it with a **Break off**
button each.

Every name a player is shown goes through `seenAs()` — the face the room saw,
never the row. Attacking a hooded stranger does not unmask them, and neither
does the audit row, which stores `presented`.

## 7. The GM's Other lens

A fourth tab on `/gm/turns`, beside Moves / Caving / History, keyboard **o**.
It lists everything holding somebody in place this turn — attacks, ambushes and
Safe intercepts — because to a GM reading the queue those are one question: who
cannot leave, and who is standing over them.

Named for the shape rather than the contents. It is where the next thing that is
neither a Move nor a die goes.

A row has no desk. Clicking one, or ⏎ on it, opens the **inspector** on the
person being held — their sheet, their band, and what they filed is what a GM
wants next. Rows carry **real** names on both sides: this is the desk that
already prints a fighting band (`COMBAT.md` §5), and the presented-face rule is
about players.

`GmZoneView` narrows it the way it narrows every other lens, off the fight's
own Location rather than the attacker's seat — the `cavingRollRow` reasoning.

## 8. The audit

| Type | Written by | `turnId` |
|---|---|---|
| `request_attack_filed` | the button | yes |
| `request_attack_cancelled` | Break off, and the DM's Cancel attack | yes |

An ambush writes its existing `request_intercept_fired` row and no second one.
`request_attack_filed` is on the Oracle's allowlist (`db/lib/oracleAudit.js`) —
somebody starting a fight is a story fact; calling it off is not.

Nothing here is destructive, so no `restore` snapshot is owed
(`REQUESTS.md` §2).

## 9. Where the code lives

| File | Role |
|---|---|
| `db/lib/attack.js` | The whole mechanism — the band gate, the row, both holds, the lines |
| `db/lib/locationMove.js` | `closeFightsOnMove` — a relocation ends the fight |
| `db/lib/characterDeath.js` | A dead man is in no fight |
| `db/lib/fightingSkill.js` | `bandRank`, and nothing else changed |
| `db/lib/intercept.js` | The hold and every gate on it; an Ambush files an Attack |
| `db/lib/dmAnswer.js` | `answerAttackHold` — Cancel attack, shared by both faces |
| `bot/src/events/interactionCreate.js` | `handleHoldEnd`, one route per prefix |
| `web/app/(app)/character/attackActions.js` | Load, attack, break off |
| `web/app/components/actions/AttackDialog.js` | The dialog |
| `web/lib/moveRows.js` | `attackRow` / `interceptHitRow` — the Other lens's row shape |
| `web/app/(desk)/gm/turns/QueueRail.js` | The Other lens |
| `db/test/attack.test.js` | The band gate, boundary by boundary |
