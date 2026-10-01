# Attack — a fight

You press Attack on one or more people standing with you, and you can ask
others there to fight beside you. Everybody in the fight is held where they
stand until it is over. Each of them writes what they do, each rolls a die
nobody is shown, and a GM rules on the whole fight as one result.

The authored design is `E:\Bascinet\V3\Combat\Combat Overhaul.docx`. This doc
says how the code does what that doc asks, and where it had to choose. It
replaces the old one-on-one Attack, which pinned two people for the day and
left the fight to each side's Gambit (§12 says what is left of it).

**Nothing here resolves a fight in code.** The rolls are thrown and kept so a
GM can read them. What happened is the GM's ruling, staged and pushed like a
Gambit's (§8).

## 1. Starting one

The Attack dialog (`web/app/components/actions/AttackDialog.js`) and the
Discord `/attack` verb (`bot/src/lib/verbs/people.js`) both run
`db/lib/verbs/combat.js#startFight`:

- **Targets:** one or more people standing here.
- **With you:** anybody else here you want on your side. They are *asked*;
  they choose (§4).
- **Confirm.** The fight starts, everybody picked is held (§3), and the room
  is told — "Att attacks Bo and Cy!" — **in the names each reader knows**
  (Bascinet, 2026-09-27; `db/lib/combatAnnounce.js`). A friend is named, a
  stranger's face is what it looks like ("a young man"), a hood is its alias to
  everybody. So the line is not one text:
  - **On the web** the place gets ONE row. Its `content` has every bare face as
    its alias, for anything that reads a row with no reader in mind (the Oracle,
    search, the day's heard lines), and it carries the fighters on
    `ArchiveEntry.subjects` — a template (`{0} attacks {1} and {2}!`) and each
    person's name, alias and whether they are masked. The feed lens renders it
    per reader (`strangers.js#lensRow`, through `db/lib/peopleLine.js`), on
    every surface that already lenses rows: the stream, `/chat`'s first paint,
    history, `/memories`. The template rides a hidden symbol, like the speaker,
    and never reaches a browser. A GM, and a reader with no character, read
    every face by name.
  - **On Discord** a channel post is one text for everybody, so nothing is
    posted to the channel. The line is relayed as a DM to each Discord player
    (`discordMirrored`) standing there, rendered for them, with the place under
    it. The fighters are left out: they already have their own DMs.

  This takes the fight's line out of the STRANGERS.md §7 list of place lines
  that name a bare face.

The picker lists everybody here, both halves of the room: a hood by its token,
never its id (`db/lib/targetKey.js`). Anybody already in a fight is greyed
"In a fight" on the web and left off the Discord select, since it cannot grey.

**A fight costs nothing.** No Move, no ⬢, no Action row (Bascinet,
2026-09-27). What somebody does in a fight is their attack description (§4),
not their Gambit, so a spent Move no longer refuses the button, and taking a
Gambit back no longer asks whether you are fighting.

**There is no strength gate any more** (Bascinet, 2026-09-27). Anybody may
attack anybody; a GM rules on a hopeless fight like any other.

### What refuses it

`db/lib/combatGate.js#combatBlock`, in this order, one sentence each
(`db/lib/combatMode.js` holds the words, import-free so the dialog greys with
the server's own sentence):

1. **The turn is locked** — the Move cutoff (§10).
2. **Not in combat mode** — required to attack (Combat Mode.docx).
3. **Already in a fight** — one at a time.
4. **Withdrawing** — you called a fight off in the last 30 minutes (§7).

Declining an invitation is **not** one of these gates. The doc barred a
decliner from attacking anywhere at that Location until next turn; Bascinet
narrowed it (2026-09-27) to one thing, joining the **attackers of the fight
they turned down** (§4, §6). New attacks, other fights, and that same fight's
defenders all stay open.

Plus ACT: a bound or paralysed character is told why.

## 2. What is snapshotted

At the moment a fight starts, two things are frozen onto it:

- **Everybody in it** (`CombatParticipant.snapshot`): the examineSnapshot.js
  payload — every tag held and whether it is worn, the ⬢, combat mode — plus
  mood. A GM's desk rehydrates it against the live catalog
  (`actions.js#getCombatSnapshots`), the Caving desk's rule: the kit as it was,
  today's rules on what it adds up to. So health, equipment and fighting band
  are all read off it.
- **How far everybody in the world is** (`Combat.distances`): every living,
  placed character, in Locations, counting only the ways each of them could
  walk. `locationGraph.js#distancesFrom` runs the mover's own `crossingCheck`
  on every edge, so a locked door counts only for whoever holds its key (or
  wears the ring that opens it), and a hidden way, a shut gate or a squeeze a
  Giant cannot fit through costs what it costs on foot. One BFS per *access
  signature* — the subset of door slugs and `giant` somebody holds — so a
  hundred characters is a handful of searches. Capped at 4, which means "4 or
  more, or no way at all".

Somebody who joins later is snapshotted when they join (§6), and an ambush's
later arrivals when they walk in (§9).

## 3. The hold, and one fight at a time

**The hold is Intercept's hold.** `Character.heldUntil / heldById /
heldReason`, owned by `db/lib/intercept.js`, so every surface that already
shut a held person's ways out keeps working. `combat.js#settleHold` writes it,
always re-derived from the participant rows and never by hand:

| Who | `heldReason` | Reads |
|---|---|---|
| A defender | `attack` | Somebody attacked you. You can't move until the fight is over. |
| An attacker | `attacking` | You're in a fight. You can't move until it's over. |
| An invitee who has not answered | `invited` | You've been asked to join a fight. You must answer before you can leave. |
| An attacker after a call-off | `withdrawing` | You called off the attack. You can't leave for another N min. |

The first three are `FIGHT_REASONS`, which nothing that clears "whoever X was
holding" may touch. `withdrawing` is held by nobody, so only its clock ends it.
`heldById` names an opponent still in the fight, preferring whoever started
it, and moves when somebody leaves — the reason `settleHold` re-points rather
than clears.

The hold runs to the turn's end (floored at a Safe stop's two minutes, the
`fireWatches` reasoning), and the push closes every fight left (§7).

**One fight at a time** is `CombatParticipant.activeTurnId` and its unique
`(characterId, activeTurnId)`: the open turn's id while somebody is in a fight,
null once they are out. The insert is the claim — `createMany` with
`skipDuplicates`, never a caught P2002, which poisons a Postgres transaction —
so two fights racing to pull one person in cannot both win; the loser rolls
back whole. Every write that changes who is in a fight takes the fight's row
`FOR UPDATE` first (`lockCombat`), so a join, a decline, a call-off and
somebody leaving never interleave.

## 4. Joining, declining, writing

**An invitation** (a collaborator, or somebody an ambush's owner asked along)
is answered Join or Decline — in the fight's DM, on Discord or the web
thread, or in the Attack dialog. Until then the invitee is held (Bascinet,
2026-09-27). Decline, and they may go, and may not join that fight's attackers
later (`DECLINED_ATTACKERS`, asked in `combat.js#intervene`). They may still
join its defenders, start a new attack, or join any other fight, invitations to
other fights included (Bascinet, 2026-09-27). An invitation still unanswered at the push counts as declined.
The invitation names who asked — the fight's initiator, or the ambush's owner,
by the name the invitee knows them by — in the DM, the fight panel, the Discord
readout and the line under the turn card ("A young man has asked you to join
the attack.", `combatMode.js#invitedLine`, off `combatViewFor`'s `inviter`).

**Writing.** Everybody in the fight who was in combat mode when it reached
them is asked to write what they do: the DM says so and carries **Write your
attack** (a modal on Discord; on the web it opens the Attack dialog, where the
fight lives), and `/chat` and the sheet show a line under the turn card —
"You're in a fight at Garrison. Write what you do." — until they have
(`components/FightLine.js`, off `chat/actions.js#myMove`'s minute poll). It
can be rewritten until Moves lock, and is capped at 2000 characters.

**Caught by surprise.** Somebody who was out of combat mode when the fight
reached them is told they were caught by surprise and cannot write — the doc's
"will not be able to customise their combat action" — and rolls at −3.
`CombatParticipant.alert` freezes which they were. Turning combat mode on
afterwards counts only for fights that start later, and the Combat button says
so when it is pressed mid-fight (`ALERT_TOO_LATE`).

**A collaborator is snapshotted and rolled the moment they are asked**, not
when they answer (Bascinet, 2026-09-27) — at the Attack press, or when an
ambush springs. So they fare exactly like a target: one out of combat mode is
caught by surprise, −3 and no attack to write, and turning combat mode on
before answering changes nothing about this fight. The invitation says so up
front ("You aren't on guard, so if you join you'll be caught by surprise…"),
and so does the Attack panel. Answering never re-snapshots or re-rolls. Joining
does not need combat mode.

## 5. The roll — GM only

`db/lib/combatRoll.js`, "the same rules as gambit rolls":

- a d6, with Lucky and Misfortune pulling it exactly as they pull a Gambit's
  (`gambitDie.js#GAMBIT_BETTER`/`GAMBIT_WORSE`)
- `gambitModifiers` — Starving, the mood bands, a Trinket's `gambitBonus`
- **Surprised −3** if not in combat mode
- **Arrived late −1/−2/−3** for an intervener (§6)

The total never goes below 1 (`rollDie.js#rollTotal`), so a surprised fighter
who rolls a 1 totals 1, the same as anyone else at the bottom.

Read at the snapshot, not at the Move cutoff: a GM adjudicates the fight off
the moment it started, so the roll answers for the same moment.

**Never shown to a player** (Bascinet, 2026-09-27). Not in a DM, not on the
sheet, not in the dialog, not at the push. `PUBLIC_PARTICIPANT_SELECT` and
`combatViewFor` carry no roll field, and `db/test/combat.test.js` fails if one
creeps in. The GM's desk prints it as one line: `⚀ 4 −3 Surprised → 1`.

## 6. Intervening

Somebody not in the fight who presses Attack where a fight is going on is
offered **Join the attackers**, **Join the defenders**, or **Start a separate
attack** on people not already fighting (`combat.js#intervene`). Joining is an
Attack, so it takes the same gates (§1) — which makes an intervener always
alert. A fight the viewer turned down (§4) has its Join the attackers button
greyed with the reason (`combatsHere`'s `declined`). Joining its defenders is
allowed, and since there is one row per person per fight (the unique on
`combatId` + `characterId`), their declined row becomes their place on the
defending side rather than a second row. Each fight is listed as two labelled lines, **Attacking:** and
**Defending:**, and the confirm names who they would fight beside and against
("You'll fight alongside Bo against Ada and a young man.",
`combatMode.js#joinSideLine`), so nobody has to guess which half of a list is
which. On Discord, with more than one fight here, each is numbered and so are
its buttons.

How far they were **when the fight started** (§2) decides it:

| Distance then | Their roll |
|---|---|
| 0 (already here) | nothing |
| 1 / 2 / 3 Locations | −1 / −2 / −3 |
| 4 or more, or no way | "You arrived too late to intervene." |

Their snapshot is taken when they join, and the desk shows where they came
from (`fromLocationName`). Everybody already in the fight is told who joined,
and on which side, by the name they know them by.

## 6a. Escorts step in

**Escort** is a verb of its own (the Escort dialog on the web, `/escort guard`
and `/escort stop` on Discord, `db/lib/verbs/guard.js` for both). You pick one
person standing with you, and you guard them: you follow them when they travel
(`MAP.md` §3d), and **if they are attacked you join the fight on their side**.
`Character.guardingId` is the state, one charge at a time, and `db/lib/guard.js`
owns the rule and the words.

- **It needs combat mode** to set (Bascinet, 2026-09-30), and it **ends when
  combat mode goes off** — pressed off (`verbs/combatMode.js`, the escort reads
  it in the reply) or switched off at the push (`combatModePass.js`, a notice).
  The charge is told either way.
- **The charge is told, and has no say** (Bascinet, 2026-09-30): a DM names the
  escort the way the charge knows them. They can shake an escort off by going
  where the escort can't follow.
- Setting one asks for an open turn and a game in session, not the Move lock: it
  acts on nobody until somebody moves or is attacked, and the lock already shuts
  both. Stopping is never gated. A new charge replaces the old, who is told.
- Leaving play clears both halves (`characterDeath.js#releaseEntanglements`).

**Stepping in is an intervention** (§6), through `combat.js#intervene` and every
gate it asks: combat mode, the lock, ACT, one fight at a time, the distance rule.
So an escort who could not have pressed Join the defenders is left out, silently.
They join as an `INTERVENER` on the `DEFENDER` side, and read "You step in to
defend X." instead of "You join the fight." Two ways in:

- **`escortsStepIn`** — the fight's own. When a fight starts (`startCombat`, so
  an Attack, an ambush's first catch and a Vampire's compulsion alike) or an
  ambush adds a target, everybody escorting one of its defenders who is standing
  there steps in. Distance 0, no penalty.
- **`escortsArrive`** — the escort's. An escort who has just arrived (following,
  or on their own feet) and finds their charge defending in a live fight here
  joins it, from `performLocationMove`. Distance comes off the fight's snapshot,
  so a late escort pays the usual −1/−2/−3, and one 4 or more away when it
  started is too late.

**Only a charge who is attacked** pulls an escort in. A charge who attacks, or
who is asked along as a collaborator, is not being attacked.

## 7. How a fight ends

- **Call off.** Only the attacking side may, and only once **every** attacker
  still fighting has pressed it — interveners on that side included, my
  reading of "all members of the attacking party". Until the last does, nobody
  leaves; the others are told who wants out. Then the fight ends
  (`CALLED_OFF`), the defenders go free, the attackers are held 30 more minutes
  "in case the defenders wish to counterattack" and may not start another
  attack meanwhile (Bascinet, 2026-09-27), and everybody is DMed. A defender
  may counterattack them; that is a new fight. Refused once Moves lock.
- **A side empties.** Somebody relocated (a GM's teleport, a Bulk Move, a
  staged Relocate to, a rite — walking never, since they are held, and Bat
  Form never, since it reads the same hold and the fight row: `VAMPIRE.md` §6) or dead
  leaves the fight (`leaveCombatsFor`, off `locationMove.js` and
  `characterDeath.js`). If that leaves either side with nobody fighting, the
  fight ends (`SIDE_EMPTY`) and everybody else goes free and is told
  (Bascinet, 2026-09-27).
- **A GM ends it** — End fight on the desk (§8). Everybody free at once, no
  30 minutes, everybody told (`GM`).
- **The push** closes every fight still open (`TURN_ENDED`), in the
  `combatClose` pass after the staged push. Nobody is told; the holds lapse on
  the turn's own clock.

**An ambush ends with its fight**, however the fight ends (Bascinet,
2026-09-27): `endCombatTx` and `closeCombatsAtPush` delete the owner's Ambush
watch (`combat.js#cancelAmbushes`), and the owner is told "Your ambush is over.
Set it again if you still want to lie in wait." — on the end-of-fight DM, or,
at the push, as a notice of its own.

A fight that ends stays on the desk, because the GM still rules on it.

## 8. The GM's Combat lens

A tab on `/gm/turns` beside Moves and Caving, keyboard **f**. One row per
fight on the open turn — its attackers against its defenders, where, how many
are involved — unsolved first, live before finished. Search matches anybody in
it, and GmZoneView narrows it on the fight's own zone. The rows are
store-backed (`deskStore.js`, `deskRows.js#deskPatchFor`), and two triggers
keep a second GM's desk live: `Combat_notify`, and `CombatParticipant_notify`,
which announces its parent fight (the `Delivery_notify` shape).

**The desk** (`web/app/(desk)/gm/turns/CombatDesk.js`) groups everybody the
way the doc asks: Attackers, Defenders, and apart from them whoever joined
either side, with where they came from. Each card carries their role and
answer, their roll line, what they wrote (or that they were surprised), a
**Snapshot** (`SnapshotBody.js`, shared with the Caving desk: combat mode, the
fighting band, what they wore, their wounds), and **Message them**, which
stages a private message to that one person — the doc's "a message on attack
actions which are only forwarded to a specific character".

Then one result for the whole fight, the Caving desk's shape:

- the **Result box** — canon, GM-facing, never sent by itself
- **Stage as message to everyone in it**, prefilled with every participant
- the staging strip — Effect, Room, Death, Message, Public — every row
  anchored by `combatId` (`StagedEffect` / `StagedMessage`), which the push
  applies like any other staged row
- **Save / Solve / Reopen**, and **End fight** while it is live

Every composer opened here offers the fight's people one tap each, and "All of
them" (`QuickPicks.js`), so nobody is searched for by name.

The Other lens keeps Safe intercepts, caught thieves and portraits. Legacy
`Attack` rows still draw there on the turn this deploys (§12).

## 9. Ambush

An Intercept watch in Ambush mode is a fight laid in advance
(`combat.js#springAmbush`, from `intercept.js#fireWatches`):

- The first catch of the turn opens a fight: the watch's owner is its
  initiator, the arrival its target, and the collaborators the watch named who
  are still standing there are invited (§4). The watch's message rides the
  target's DM. No room line — the road does not know it was watched.
- Every later catch is added to **that same fight** as a target, snapshotted as
  they walk in. Ambush-added targets have no distance rule; anybody else joins
  the ordinary way (§6).
- **Only the targets it sprang with** are added (Bascinet, 2026-09-27). While
  that fight runs, the owner can't set or change any watch
  (`combatGate.js#interceptBlock`: "Your ambush has already sprung. You can't
  change it until the fight is over."), so re-setting it to "Anyone"
  mid-fight can't pull in people it was never set for. Stopping it is still
  allowed, since that only narrows it.
- The fight ending ends the ambush (§7): nothing springs again until the owner
  sets a new one, which takes the ordinary gates.
- An arrival already in a fight, or an owner busy in some other fight, is
  skipped before the ration is claimed.

Setting a watch, the recognition rule, and the new "Anyone I can't identify"
target are `INTERCEPT.md`.

## 10. The turn lock

At the Move cutoff (`turnClock.js#moveWindow`), and until the push:

- no fight can be started or joined, no invitation answered
- nothing written can be changed
- no fight can be called off
- no watch can be set (`combatGate.js#interceptBlock`)
- **nobody walks into, out of or about the caves** (`CAVING.md` §2f,
  `turnGate.js#travelLockReason`, checked by
  `locationTravel.js#performLocationMove` and drawn on every way by
  `resolveNeighbors` and `routesWithinZone`). The Combat Overhaul shut every
  walk in the lock; Bascinet opened the surface again on 2026-10-01, so anywhere
  else people may walk right up to the push. A first placement is not a walk.
  A GM's relocation never comes this way.

Two exceptions, neither a player's choice: a Vampire's compulsion, which opens
its fight at turn open (`vampireCompulsion.js`), and an ambush springing, which
cannot happen once nobody can arrive.

## 11. Discord

- **`/attack`** answers with the fight you are in (and its buttons), the fights
  going on here (join a side, or start another), or the picker: a multi-select
  of targets, then one of who to ask along with a "Nobody — just me" button,
  then a confirm. The first select's picks wait in memory under a short nonce
  (15 minutes), because a custom id holds 100 characters and a hood key alone
  is ~40; a bot restart loses them and the player is told to start again.
- **The fight's DM buttons** (`bot/src/lib/combatButtons.js`, prefixes on
  `db/lib/combat.js`): `cbt:join:` / `cbt:decline:` / `cbt:calloff:` go through
  `dmAnswer.js#answerDmAction`, the same function the web thread calls;
  `cbt:write:` opens a modal with what they wrote so far, after one DB read
  raced against 800 ms (the Move modal's shape) — if it loses, the box opens
  empty with a note, and the field is required so an empty submit cannot wipe
  it. `cbt:desc:` is the modal submit.

Every button names the clicker's own participant row, never a character id: a
custom id is readable by whoever holds the message, and the old
`atk:cancel:<characterId>` was a small unmasking.

## 12. Legacy

The `Attack` table stays, unread and unwritten, so the fights live on the turn
this deploys still settle: `db/lib/attack.js` is a shim that answers an old
**Cancel attack** button and ends an old row on a relocation or a death, and
never touches a hold a new fight owns. Deploy right after a push and there are
none (the Vampire compulsion files at turn open, so check first). Delete the
shim, its callers' lines and `DM_ACTION.ATTACK_HOLD` once a turn has pushed.

## 13. The audit

| Type | Written by | `turnId` |
|---|---|---|
| `request_attack_filed` | starting a fight — the targets and helpers by the face the attacker saw | yes |
| `request_attack_intervened` | joining a side | yes |
| `request_attack_answered` | Join / Decline | yes |
| `request_attack_cancelled` | pressing Call off | yes |
| `combat_saved` / `combat_solved` / `combat_unsolved` | the desk | — |
| `gm_combat_ended` | End fight | yes |

Writing an attack writes no row: the words are on the participant row the GM
reads.

## 14. Where the code lives

| File | Role |
|---|---|
| `db/lib/combat.js` | The mechanism: starting, joining, writing, call-off, leaving, the push close, ambush, holds, DMs, the player's view |
| `db/lib/verbs/combat.js` | The rule half both faces share: keys, gates, audit |
| `db/lib/combatGate.js` | `combatBlock`, `interceptBlock` |
| `db/lib/combatMode.js` | The sentences, import-free |
| `db/lib/combatRoll.js` | The roll and its modifiers |
| `db/lib/combatAnnounce.js`, `db/lib/peopleLine.js` | The announcement: one lensed row on the web, a DM relay on Discord, and the per-reader renderer |
| `db/lib/locationGraph.js` | `distancesFrom` |
| `db/lib/intercept.js` | The hold and its sentences; ambushes fire here |
| `db/lib/guard.js`, `db/lib/verbs/guard.js` | Escort: the rule, the words, set and stop (§6a); `combat.js#escortsStepIn` / `escortsArrive` put an escort in the fight |
| `db/lib/turnGate.js` | `travelLockReason` |
| `db/lib/attack.js` | Legacy shim (§12) |
| `web/app/(app)/character/attackActions.js` | The web's server actions |
| `web/app/components/actions/AttackDialog.js`, `FightPanel.js`, `FightLine.js` | The player's surfaces |
| `web/app/components/actions/EscortDialog.js`, `web/app/(app)/character/guardActions.js` | The Escort dialog and its server actions (§6a) |
| `web/app/(desk)/gm/turns/CombatDesk.js`, `QuickPicks.js`, `SnapshotBody.js` | The GM's desk |
| `web/lib/moveRows.js#combatRow` | The lens row |
| `bot/src/lib/verbs/people.js`, `bot/src/lib/combatButtons.js` | Discord |
| `db/test/combat.test.js` | The roll, the distances, recognition, the holds, the privacy line |
