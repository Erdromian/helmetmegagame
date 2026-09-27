# Sessions

How a game runs in sittings rather than continuously, and what "the game isn't
in session" actually shuts. The turn engine itself is `TURN-ENGINE.md`; this is
the thing that stops it.

## 1. The two game types

`GameConfig.gameMode`, a knob on `/gm/dev?s=config` under **Turn clock**:

| | |
|---|---|
| **Persistent** | The default, and what every game so far has been. The clock runs continuously; there is no such thing as being out of session. |
| **Sessions** | The clock runs only while a session is open. Between sittings the whole game freezes. |

A session is a **sitting**, not a game. It sits beside the lifecycle in
`LOBBY.md` and never touches `GameState.phase`, so one RUNNING game can hold
four sessions and still be ended by the ordinary End Game button. Four 48-hour
sessions inside one game is the shape this was built for.

Switching modes mid-game is safe and takes effect immediately: Persistent is
simply "always in session", so flipping to it opens the game and flipping away
from it shuts the game unless a session is already open.

## 2. What the state actually is

Four nullable columns on `GameState` — per-game, so Restart Game clears them
for free:

| Column | Means |
|---|---|
| `sessionOpenedAt` | **Non-null IS "in session right now."** One boolean's worth of truth, kept as a timestamp so the panel can say how long it has been running. |
| `sessionClosedAt` | When the last one ended. For the panel; nothing gates on it. |
| `sessionScheduledStartAt` | When the next one opens by itself. Cleared when it does. |
| `sessionScheduledEndAt` | When the open one closes by itself. Cleared when it does. |

**There is deliberately no Session table.** Only the next window is ever needed
— a GM schedules the next sitting, it fires, they schedule the one after. A
queue of them is a calendar nobody asked for, and a calendar has to be edited,
reordered and rendered.

## 3. Opening and closing

Both halves go through `db/lib/session.js#openSession` / `#closeSession`, and
there are exactly two callers of each: the bot's per-minute poll
(`bot/src/lib/sessionClock.js#tickSessionClock`, when a scheduled stamp comes
due) and a superadmin's **Start now** / **Close now** on `/gm/dev?s=turn`. One
way a session changes state, so the row cannot end up in two shapes.

Both claim with a conditional `updateMany`, so the poll and a GM pressing the
button in the same second cannot both open — and only one posts the line.

**Opening restamps the open turn's clock.** `startedAt` moves to now and
`endsAt` to the next Chicago grid boundary after it. A session that opens at
15:00 must not hand players the tail end of a turn that has been sitting frozen
since Tuesday, whose cutoff is already in the past. Snapping to the boundary
rather than running a full length is the same rule a manual advance follows
(`TURN-ENGINE.md` §6a).

**Closing leaves the turn exactly as it is.** Closing a session is not a turn
advance, and a sitting that resumes tomorrow resumes on the same turn; the
reopen is what restamps it.

Each change writes an `AuditLog` row (`session_opened` / `session_closed`, with
`scheduled` saying which caller it was) and posts one `-#` subtext line into
`#turns` through `db/lib/sessionNotice.js`. The line is a courtesy; the row is
the truth, so the post is best-effort and never inside the write.

## 4. What the freeze shuts, and the trap underneath it

Out of session, `db/lib/gameState.js#isClockRunning` is false. That one change
reaches every deadline in the game for free, because everything that derives
one already routes through it — `moveWindow`'s `hasLock`, the turn
announcement, `web/lib/turn.js#getMoveWindow`, `LockChip`.

**But a frozen clock does not shut the game, and this is the sharp edge.**
`moveWindow` sets `hasLock: false` when the clock is frozen, and `locked` is
`hasLock && …` — so a frozen clock reports **`locked: false`**. Freezing
removes the DEADLINE; it says nothing about whether anybody may act. Every one
of the fourteen call sites that used to read `.locked` directly would therefore
have read "not in session" as **wide open**, which is the exact opposite of
what it means.

So the session question is asked **first**, and separately, by the one gate:

```js
// db/lib/turnGate.js
async function movesOpen(db, { now, turn })      // -> { ok, reason, message, turn, window }
async function autoMovesOpen(db, { now, turn })  // the same, without the lock window
```

Order: no open turn, then **not in session**, then the lock window. Its
`gateMessage(reason)` is the only place the refusals are worded:

| reason | text |
|---|---|
| `NO_TURN` | No turn is open. |
| `NOT_IN_SESSION` | **The game isn't in session.** |
| `NOT_RUNNING` | The game isn't running. |
| `PAUSED` | The turn clock is paused. |
| `LOCKED` | Moves are locked for this turn. |

**This gate is new, and its absence was the real bug.** Fourteen sites each
loaded the turn, called `clockFrozen()`, called `moveWindow()`, read `.locked`
and hardcoded their own copy of the refusal — in four different wordings. They
all go through `movesOpen` now: `db/lib/moves.js` (`fileMove`,
`moveIsEditable`), `db/lib/lessons.js` and `db/lib/confession.js` (whose two
near-identical private helpers collapsed into it), the four
`character/actions/*` files, `trinketActions.js`, `web/lib/moveSpend.js`, and
`bot/src/events/interactions/actions.js#moveLockNotice`.

**The lock window is for Moves a GM has to rule on, and only those.** It exists
to give the desk a quiet stretch to adjudicate what players wrote. So
`movesOpen` — the whole gate — guards the written Move alone: `db/lib/moves.js`
(`fileMove`, `moveIsEditable`) and the bot's `moveLockNotice`. Every verb that
settles itself asks `autoMovesOpen`, which runs the same checks in the same
order but never returns `LOCKED`: `resolveCraftMove` (every craft, Bury,
Engrave, Administer) and the in-transaction re-checks in `crafting.js`,
`medical.js` and `misc.js`; `requireFreeMove` (Mine, Refine, Farm, build sites,
Thanati, arelitz break-in, heals, Break Restraints, Torture); the forge's
Trinket; and the lesson and confession handshakes. None of those needs a GM —
they are PASSED receipts or rows a turn-end pass settles — so a player can keep
working right up to the push. Being out of session still refuses all of them.

`moveIsEditable` stays pure and takes `inSession` as an option, checked before
everything else for the same reason.

`advanceTurn` has its own refusal, `refused: "NOT_IN_SESSION"`, beside
`NOT_RUNNING` — so no turn ever ticks between sittings, from the poll or from a
GM who forgot the game was shut.

## 5. What a player sees

- The header chip on every page reads **`NOT IN SESSION`** instead of the lock
  countdown (`web/app/components/LockChip.js`).
- The Move button on `/chat` and `/character` is disabled, and the dialog says
  *The game isn't in session.*
- `/move` and the `#turns` buttons refuse with the same sentence.
- The `#turns` announcement replaces its countdown clause with it — out of
  session there is no deadline, and saying so is more use than a time nobody is
  counting down to.

**Between sittings a player may talk, and nothing else.** That is the whole
policy, and it is not the same as the Move cutoff (`TURN-ENGINE.md` §6a), which
only shuts the queue a GM has to adjudicate. A session boundary shuts the
*game*: travel, transfers, theft, crafting, mining, farming, healing, searching,
kissing, torture, collars, Bird letters, writing on paper, claiming a Desire —
all of it waits for the next sitting.

It used to be otherwise. This doc said *"Only the Move economy is shut"*, and
everything free — Travel, Transfer, Steal, Kiss, Search, Loot, Bind, Brand,
Godflesh — reached the database between sessions with no GM in the room. It
does not any more.

Four things stay open, and they have one thing in common: none of them changes
the world.

- **Reading.** The sheet, the map, Examine, Who's here?, a notice on a board,
  a room's Storage (the button and `/storage`), the roster. On Discord that
  also means the Actions menu itself and the verbs that only read — `/look`,
  `/mymove`, `/item pointer`, `/warrant list`, `/paper read` — which
  `db/lib/actionCatalog.js` marks `open` (`COMMANDS.md` §2g). Reading is never
  an act.
- **Equipping and unequipping.** It costs no Move even in session, and what is
  on your own body is nobody else's afternoon.
- **The lobby and character creation.** They sit outside the game, so a
  boundary inside the game is not theirs to answer to. The lobby console's
  Ready / Not ready and `/lobby` are the Discord side of it, and Feedback
  (button and `/feedback`) is open for the same reason. A late-join seat offer
  and a threat-spawn offer are the same shape.
- **Everything a GM does.** They run the sitting; they work whenever they like.

A player's private journal (`/notes`) and their theme are open for the same
reason: neither is in the world. Everything else a player can press — the
Depot counter and its cash machine, the mid-game tag store, the Leader's sell
tax, donating blood to the Tower — is shut.

### 5a. The roleplay knob

**"Allow roleplaying in between sessions"** — `GameConfig.roleplayBetweenSessions`,
**on by default**, on `/gm/dev?s=turn` beside Game type.

It decides the one thing left: the talking. On, a player may speak in a room —
on the web feed and in Discord alike — while everything else is shut. Off, the
freeze is total and speech is refused with the same sentence.

**Three things count as talking without going through `say.js`**, and they are
easy to miss: `/shout`, `/roll` and `/play`. A shout carries across the
Location graph and a die or a lute lands in the room as scenery, so they follow
this knob rather than the act gate — and because `prepareSpeech` never sees
them, they say so at their own call sites (`speech: true` on `chat/actions.js`'s
`actor`, `SPEECH_COMMANDS` in the bot's router).

`/ooc` is not on that list. It is out of character by definition, like writing
to a GM or changing what is over your face, so a boundary inside the game does
not reach it.

The knob is meaningless in Persistent, where there is no "between" to ask
about.

### 5b. Where the gate lives

`db/lib/betweenSessions.js#sessionGate(db, { acting })`, one predicate for both
faces. `acting: true` is the default and the strict answer, so a caller that
forgets the option gets the safe one; `acting: false` is the speech case, and
the only one the knob reaches.

It is deliberately **not** `movesOpen`. That gate needs an open turn and folds
`NO_TURN` and `LOCKED` into the same answer, so a caller asking it about Travel
would refuse between turns as well.

Four hooks carry the policy, and three more sit under them as a floor:

| Where | What it covers |
|---|---|
| `web/lib/actionResult.js#acting()` | Every verb on `/character`, `/store`, `/treasury` and `/lifeweb`, and Chat's money fixtures (`chat/counterActions.js`). It is `guarded()` plus the gate, so a verb is `acting(…)` and a read stays `guarded(…)`. **A new player surface written as `guarded(…)` is not gated** — that is the one thing to remember when adding one. |
| `web/app/(app)/chat/actions.js#actor(select, { acting })` | The chat surface. Per action rather than in the hub, because the talking lives in that file too. |
| `db/lib/say.js#prepareSpeech` | Speech, both faces — the web composer, the Discord proxy, and the catch-up pass. The one place the knob is read. |
| `bot/src/events/interactionCreate.js` | Every Discord command, button, select and modal, as an **allowlist**. A new surface is shut by default, so a new read-only or speech button must be added to `OPEN_PREFIXES` or it will refuse out of session. |
| `db/lib/locationTravel.js#performLocationMove` | The floor under travel — every crossing in the game funnels through it. |
| `web/lib/moveSpend.js#fileAutoRoutine` | The floor under the Move economy: no `Action` row is written between sittings. |
| `db/lib/moves.js` and the rest of `movesOpen`'s callers | Unchanged — filing a Move was already shut. |

The bot's check is raced at 800ms and **fails open**, the same bargain
`handleMoveOpen` already strikes: it runs before the three-second
acknowledgement on every interaction, including the ones that open a modal and
so cannot be deferred first. A slow pool must cost a refusal, never the click —
and what slips through meets the floor anyway.

## 6. The GM surface

`/gm/dev?s=turn`, under Current Turn. Superadmin-only like the rest of that
page (`web/app/(desk)/gm/dev/SessionPanel.js`, actions in
`web/app/(app)/gm/dev/gameActions.js` beside the phase transitions).

- A status line: in session since …, or not in session and when the next one
  opens.
- Two `datetime-local` boxes for the next window, **read as Chicago time** —
  parsing a GM's typed time as the *server's* local time would put a session
  an hour or six out depending on where the container happened to run.
- **Start now** and **Close now**. Closing confirms first, since it shuts the
  game for everybody.
- **Allow roleplaying in between sessions**, in the Turn clock knobs just
  above — §5a.

Both boxes may be cleared. A GM taking the schedule off is how a session
becomes hand-driven, so an empty box is an instruction rather than a slip.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/session.js` | `openSession`, `closeSession`, `sessionDue`, `sessionSnapshot` |
| `db/lib/gameState.js` | `inSession`, `isClockRunning`, `frozenReason`, `clockStatus` |
| `db/lib/turnGate.js` | `movesOpen`, `gateMessage` — the Move chokepoint |
| `db/lib/betweenSessions.js` | `sessionGate`, `gateFor` — the freeze, §5b |
| `db/lib/sessionNotice.js` | The `#turns` line, REST, shared by both faces |
| `bot/src/lib/sessionClock.js` | The per-minute turn and session polls |
| `web/app/(desk)/gm/dev/SessionPanel.js` | The GM panel |
| `web/app/(app)/gm/dev/gameActions.js` | `scheduleSession`, `startSessionNow`, `closeSessionNow` |
| `db/test/session.test.js` | The predicates, the scheduler, and the trap in §4 |
