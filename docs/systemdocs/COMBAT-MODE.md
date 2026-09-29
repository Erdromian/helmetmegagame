# Combat mode

Being on guard. A player turns it on to be ready for a fight, and it costs them
sleep.

The authored design is `E:\Bascinet\V3\Combat\Combat Mode.docx`. This doc says
how the code does what that doc asks, and where it had to choose.

**The defensive response is built now**, as the Combat Overhaul's attack
description (`ATTACK.md` §4): anybody alert when a fight reaches them — attacker,
defender, collaborator — writes what they do, Move spent or not; anybody who was
not is caught by surprise, cannot write, and rolls at −3. **Still not built:** the
prompt an alert caver gets on a failed Caving roll.

## 1. The state

`Character.combatModeSinceTurn`. Null is off. Otherwise it is the `Turn.number`
it was turned on. Not a foreign key, the `extractTurnKey` reasoning.

`db/lib/combatMode.js` owns the rule and the sentences, and it has **no
requires**, so the web's client button reads the same words the server refuses
with:

| | |
|---|---|
| `inCombatMode(row)` | on or off |
| `lockedOn(row, openTurn)` | turned on this turn, so it can't come off yet |
| `combatModeState(row, openTurn, tags)` | `{ on, locked, onBlock }`, what the button draws |

**The timing rule** (the design doc): it can be turned on at any time of the
turn, but it can't be turned off on the turn it went on — only on a later one.
`lockedOn` compares with `===`, not `>=`. Restart Game mints Turn 1 again, and a
number stamped on the old game's Turn 57 must not lock anybody in for good.

**Any time of the turn** means the Move lock does not apply. The verb goes
through `autoMovesOpen` (`db/lib/turnGate.js`), so it still needs an open turn
and a game in session.

**Exhausted refuses turning it on.** So does anything that takes ACT (bound,
paralysed…). Turning it off is never gated — it is the way down, the same rule
Break off and Stop watching follow.

## 2. The button

`db/lib/verbs/combatMode.js#setCombatMode` is the one write, shared by both
faces. It takes the state the player **wants**, not a flip: turning it on can't
be undone this turn, so a stale tab that thought it was pressing "off" must never
turn it on. Both writes are conditional `updateMany`s, so two presses racing
stamp once. Each change writes a `character_combat_mode_set` audit row.

**On the web** it is `web/app/components/CombatModeButton.js`: a button that
reads **Combat**, in the same row as the **Move…** button and to its right — in
the **Turn** block on `/chat` (`chat/next/ChatAside.js`, and the old aside
behind `?old=1`) and in the sheet's **This turn** box (`components/SheetTurn.js`).

**It is the same height and width as Move…** (Bascinet, 2026-09-27).
`.btn-combat` is the `.btn` box — its borders, padding, font size and line
height — so the two are the same height, and `.chat-buttons--even` makes the row
two equal columns so they are the same width. Move… grows to match "Combat",
which is the wider word. The turn card draws it through TurnCard's `extra` slot,
so it sits in whichever button row the card has — beside Move…, or beside
Change… once a Gambit is filed — and in a row of its own when the card has no
button at all. "Combat" is the whole label: on or off is the red glow and
`aria-pressed`, and a screen reader hears "Combat mode: on".

Its state rides `chat/actions.js#myMove`, the poll the turn card already runs,
so the push switching it off reaches both surfaces on the next minute without a
second poll.

It **glows red** while on: `.btn-combat[aria-pressed="true"]` in `globals.css`,
a `--danger` tint and glow. It is a pressed button rather than the `Switch`
every other boolean uses, on purpose. A Switch says "flip it back whenever you
like", and this one can't come off on the turn it went on — so turning it on
asks first, through `useConfirm()`. Off comes off at once.

Nothing is printed beside it. Pressing it while it
cannot change — locked on, or Exhausted — prints why under the card, never in a
tooltip (`SHEET.md` §3); the confirm for turning it on says what it is for.

**On Discord** it is `/combat`, and **Combat mode** in the Actions menu's
Yourself section (`db/lib/actionCatalog.js`, `bot/src/lib/verbs/self.js`). Off
answers at once. On asks with a red confirm button first.

## 3. What needs it

**Attack.** `db/lib/combatGate.js#combatBlock` (`ATTACK.md` §1): the turn lock
first — nothing a player can fix today — then combat mode, then the fight rules.
The old spent-Move check is gone; a fight never costs the Move now. Read by the
Attack dialog's greyed Confirm, the server action, and the Discord verb, which
asks before the picker so nobody picks a target to be told they couldn't attack
anyone. Joining a fight already going on is an Attack too, so it needs combat
mode; answering a collaborator's invitation does not (`ATTACK.md` §4).

**In a fight, combat mode is frozen.** Whether somebody was on guard is read
once, when the fight reaches them (`CombatParticipant.alert`). Turning it on
afterwards counts only for fights that start later, and the button says so:
"You're alert now, but it only counts for fights that start from here on — not
the one you're already in."

The involuntary attacks stay ungated: a Vampire's compulsion
(`vampireCompulsion.js`) is nobody's choice, and an Ambush firing is governed by
the watch rule below.

**Escort** (`ATTACK.md` §6a). Setting one needs combat mode, and combat mode
going off ends it — pressed off, or switched off at the push. The escort is told
(in the reply, or with the push notice), and so is the person they were
escorting.

**Intercept — an Ambush only.** Setting an Ambush needs combat mode
(`combatGate.js#interceptBlock`, inside `db/lib/verbs/watch.js#setWatch`, so both
faces get it). A Safe watch never does (Combat Overhaul.docx). Stopping one never
does.

**A standing Ambush whose owner is out of combat mode is dormant.** It is kept
and does not fire (`intercept.js#fireWatches`, the `live` filter). The moment
its owner is alert again, it works again. This is the same standing-preference
rule a watch already follows when its owner is bound. The Intercept dialog says
so above the form: "Your guard is down, you can't catch anyone unless you are in
combat mode."

On the day this shipped, nobody was in combat mode, so **every existing watch
went dormant** until its owner turned it on.

## 4. The push

`db/lib/combatModePass.js`, the `combatModeFatigue` pass. Everybody still in
combat mode when a turn pushes climbs the Tired → Exhausted ladder
(`db/lib/fatigue.js`):

| Holding | Gets | Combat mode |
|---|---|---|
| neither | Tired | stays on |
| Tired | Exhausted (the Tired is consumed) | **turned off** |
| Exhausted already | nothing | **turned off** |

The last row is a reading, not the doc's words: the doc says it can't be *turned
on* while Exhausted, so the two should never stand together.

The fatigue is granted at N+1, the mining clock, so it lasts the whole next turn.
Each person gets a DM saying what happened.

**It runs BEFORE `tagExpiry`, and that is load-bearing.** The Tired granted last
push expires at this push's sweep. A pass after the sweep would never see it, so
nobody would ever step up to Exhausted. It runs after the staged push, so a
Tired a GM staged, or a day's mining, already counts.

In practice, a character can stay on guard for two pushes in a row. Then it
switches off and they are Exhausted for a turn, which then wears off into Tired.

## 5. "They look alert."

The design doc's words, verbatim. A look at somebody in combat mode prints it
under their appearance — on the web (`ExamineDialog.js#Readout`) and on Discord
(`bot/src/lib/examineEmbed.js`).

**It is frozen onto the line, like everything else a look reads**
(`PROXYING.md` §5a). `examineSnapshot.js` writes `m: 1` into the line's
`presentedState` only while they are on, so everybody else's payload is
unchanged, and a line older than combat mode reads as not alert. So somebody who
turns it on and never speaks does not read as alert until their next line. A
look with no line behind it reads the live column.

**A hood hides WHO is alert, never THAT they are** — the concealed readout
carries it too.

## 6. Failed cave rolls

The design doc's cave half (`CAVING.md` §5):

- Every `TROUBLE` row now stores the caver as they stood at that 1:
  `CavingRoll.presentedState`, the same snapshot shape a chat line keeps,
  including combat mode.
- The Caving lens folds a caver's 1s on one turn into **one result**, whose
  severity is how many there were (Caving.docx). The GM adjudicates it once, off
  the snapshot from the **most recent** failed roll.

The prompt an alert caver gets is the part not built yet.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/combatMode.js` | State, timing rule, sentences. Import-free |
| `db/lib/verbs/combatMode.js` | `setCombatMode`, both faces |
| `db/lib/combatGate.js` | `combatBlock`, `interceptBlock` |
| `db/lib/combatModePass.js` | The push: Tired, then Exhausted and off, which ends an escort |
| `db/lib/intercept.js` | Dormant watches in `fireWatches` |
| `db/lib/examineSnapshot.js`, `db/lib/examine.js` | `m` on the line, `alert` on the readout |
| `web/app/components/CombatModeButton.js` | The button |
| `web/app/(app)/chat/actions.js` | `setCombatMode`, and `myMove`'s `combatMode` |
| `bot/src/lib/verbs/self.js` | `/combat` |
| `db/test/combatMode.test.js`, `combatModePass.test.js`, `interceptCombatMode.test.js` | The rules above |
