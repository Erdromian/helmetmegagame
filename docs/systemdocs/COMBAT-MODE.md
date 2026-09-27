# Combat mode

Being on guard. A player turns it on to be ready for a fight, and it costs them
sleep.

The authored design is `E:\Bascinet\V3\Combat\Combat Mode.docx`. This doc says
how the code does what that doc asks, and where it had to choose.

**Not built yet** (a separate PR): the defensive response Gambit an alert
character may write when attacked even with their Move spent, and the prompt an
alert caver gets on a failed Caving roll. Nothing in this doc writes either.

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

**On the web** it is `web/app/components/CombatModeButton.js`: a square button
with crossed swords and On/Off, **to the right of the Move… button** — in the
**Turn** block on `/chat` (`chat/next/ChatAside.js`, and the old aside behind
`?old=1`) and in the sheet's **This turn** box (`components/SheetTurn.js`).

**It is as large as it can be without making the box any taller** (Bascinet,
2026-09-27). It wraps the turn card and measures it (`fitSquare`): the largest
square whose foot is on the card's foot, just right of the card's last button,
that touches no line of text — so it rises beside a short last line of the turn
line, and on the sheet it fills the height the band row already gives the box.
It is positioned absolutely, so it can never push anything down, and it is
re-measured whenever the card changes size or its words change. What is inside
scales with the square (`container-type: size`): "Combat mode" only shows once
the square is 64px tall, and below that it is the swords and On/Off. Around
42–46px on a desktop and 35px on a phone, as the seed scenes stand. Under 32px
there is no square worth pressing, so it drops under the card and the card makes
room — the one case where it does grow the box.

Its state rides `chat/actions.js#myMove`, the poll the turn card already runs,
so the push switching it off reaches both surfaces on the next minute without a
second poll.

It **glows red** while on: `.btn-combat[aria-pressed="true"]` in `globals.css`,
a `--danger` tint and glow. It is a pressed button rather than the `Switch`
every other boolean uses, on purpose. A Switch says "flip it back whenever you
like", and this one can't come off on the turn it went on — so turning it on
asks first, through `useConfirm()`. Off comes off at once.

Nothing is printed beside it, since there is no room. Pressing it while it
cannot change — locked on, or Exhausted — prints why under the card, never in a
tooltip (`SHEET.md` §3); the confirm for turning it on says what it is for.

**On Discord** it is `/combat`, and **Combat mode** in the Actions menu's
Yourself section (`db/lib/actionCatalog.js`, `bot/src/lib/verbs/self.js`). Off
answers at once. On asks with a red confirm button first.

## 3. What needs it

**Attack.** `db/lib/combatGate.js#attackBlock` is the old spent-Move check
(`ATTACK.md` §5a) followed by combat mode. **The spent Move is named first**:
it can't be fixed this turn, and naming combat mode first would have a player
turn it on — which can't be undone until tomorrow and makes them Tired — only
to be refused anyway. Read by the Attack dialog's greyed Confirm, the server
action, and the Discord verb (which also asks before the picker, so nobody
picks a target to be told they couldn't attack anyone).

The involuntary attacks stay ungated: a Vampire's compulsion
(`vampireCompulsion.js`) is nobody's choice, and an Ambush firing is governed by
the watch rule below.

**Intercept.** Setting a watch needs combat mode
(`combatGate.js#interceptBlock`, inside `db/lib/verbs/watch.js#setWatch`, so both
faces get it). Stopping one never does.

**A standing watch whose owner is out of combat mode is dormant.** It is kept
and does not fire (`intercept.js#fireWatches`, the `live` filter). The moment
its owner is alert again, it works again. This is the same standing-preference
rule a watch already follows when its owner is bound. The Intercept dialog says
so above the form: "Your watch is dormant. It won't catch anyone until you're in
combat mode again."

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
- The Caving lens folds a caver's 1s in one zone on one turn into **one
  result**. The GM adjudicates it once, off the snapshot from the **most recent**
  failed roll.

The prompt an alert caver gets is the part not built yet.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/combatMode.js` | State, timing rule, sentences. Import-free |
| `db/lib/verbs/combatMode.js` | `setCombatMode`, both faces |
| `db/lib/combatGate.js` | `attackBlock`, `interceptBlock` |
| `db/lib/combatModePass.js` | The push: Tired, then Exhausted and off |
| `db/lib/intercept.js` | Dormant watches in `fireWatches` |
| `db/lib/examineSnapshot.js`, `db/lib/examine.js` | `m` on the line, `alert` on the readout |
| `web/app/components/CombatModeButton.js` | The button |
| `web/app/(app)/chat/actions.js` | `setCombatMode`, and `myMove`'s `combatMode` |
| `bot/src/lib/verbs/self.js` | `/combat` |
| `db/test/combatMode.test.js`, `combatModePass.test.js`, `interceptCombatMode.test.js` | The rules above |
