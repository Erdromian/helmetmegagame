# The bomb

The nuclear bomb under Ravenheart: a fixture in one public room, worked only from
its eight-digit keypad. This follows Bascinet's own design document,
`Nuclear bomb.docx` (in `E:\Bascinet\V3\`, outside the repo). Where this doc and
that one disagree, that one wins.

What happens when it goes off is not here. That is the turn engine's nuke
explosion pass (`TURN-ENGINE.md` §2 4c), which reads `GameState.nukeArmedTurn`
at turn close, kills everybody who is not in the caves, and ends the game.

| File | What it does |
|---|---|
| `db/lib/nuke.js` | The rules: the room pool, the roll, the keypad gate, a try at the code, the button |
| `db/lib/nukeText.js` | Every word the keypad says, plus its two numbers. Zero requires, so the Chat dialog can import it |
| `db/lib/nukeKeypad.js` | The Discord keypad as plain data: the rows, and the custom-id round trip |
| `db/lib/nukeBriefing.js` | Who starts the game knowing about the bomb, and the redraw of its room's Discord post |
| `web/app/(app)/chat/PlacePanel.js#NukeDialog` | The web keypad |
| `bot/src/events/interactions/rooms.js` (`handleNuke*`) | The Discord keypad |

## 1. It is a fixture, not an item

There used to be two items: the Nuclear Device (100 lb, in the Vault) and the
Nuclear Datacard (the Tribunal Ordinator's). Holding both let you Arm or Disarm,
and the card's Use Pointer told you which way the device was. **All of that is
gone**, with its buttons, its `/nuke` commands and its two tags. The design
document asks for this: "Remove character actions relating to pinpointing the
bomb, arming it and disarming it. Only the keypad UI is necessary for using the
bomb."

The bomb now sits on the wall of one room, like a phone. Anybody who can stand
in that room sees a red **Bomb** button among the room's fixtures (web) or on
the room's post (Discord). The button is the affordance `nuke` in
`db/lib/placeAffordances.js`.

**The room carries no column for it.** `GameState.nukeRoomId` does, so every
caller that builds a room's buttons marks the room first with
`db/lib/nuke.js#markNukeRoom`: `affordancesFor` (the web's place panel),
`syncZones/roomThreads.js#roomComponents` (the Discord post, and its hash), and
the GM aside in `chat/actions.js#gmPlaceView`. A room nobody marked has no bomb.

## 2. Rolled every game

Three things live on `GameState` and are rolled again for every game:

- `nukeRoomId`: which room it is in.
- `nukeCode`: the eight-digit sequence, kept as a string so a leading zero
  survives.
- `nukeArmedTurn`: the turn it goes off on, or null while it is safe.

`rollNuke` runs inside Start Game's transaction (`db/lib/lobby.js#commitAssignment`),
beside the phone numbers, using crypto's random. Restart Game recreates the
`GameState` row, so a new game can never inherit last game's bomb.

**The room pool** (`nukeRooms`): every `PUBLIC` room with no `questId`, in a
live Location of the `town` or `fortress` zone. The design document says "any
public locations within the town or the keep". Bascinet settled "the keep" as
the whole Fortress zone, less:

- the Undercroft (`undertown-*` Locations, which sit in the Fortress zone);
- the Charon (`offMap`);
- the Tower, whose rooms are all private anyway.

**A game already running** when this landed has no bomb yet. `ensureNuke` rolls
one for its first reader (the place panel, the GM panel, a new character's
briefing). The write is guarded on `nukeRoomId` still being null, so two first
readers cannot both roll. The one that lands also briefs every living leader
and Tribunal member (§4) and queues the room's Discord post for a redraw.

## 3. The keypad

A 3×4 pad (1–9, C, 0, ⌫), a readout of eight wells, and one physical button
underneath. **Nothing to type into.** The design document says the sequence
"must be inputted through this and cannot be typed out", so the web dialog
listens to no keyboard at all, unlike the phone's.

1. The player presses out eight digits.
2. The eighth digit goes straight to the server (`nukeCheck`).
   - **Wrong:** a strike. The readout shakes and clears, and says how many
     tries are left.
   - **Right:** the button under the pad turns green. The run of wrong
     sequences goes back to 0.
3. Pressing the green button (`nukePress`) **arms** the bomb if it is safe, or
   **disarms** it if it is armed. The server checks the sequence again, since
   the colour is only a hint. A wrong sequence arriving here is a strike too.

Arming stamps `nukeArmedTurn = openTurn + NUKE_FUSE_TURNS - 1`: armed while turn
T is open, it goes off as turn T+1 closes. Arming needs an open turn. Every press
takes a lock on `GameState`, so two people at the keypad (or one person on two
faces) cannot arm and disarm past each other. Each press writes an audit row,
`nuke_armed` or `nuke_disarmed`, with the room.

The gate on every read and press is `keypadActor`, the same stack as the
phone's: alive, not incapacitated, standing in the bomb's Location, able to get
into its room, and not locked out.

**Not in a fight** (Bascinet, 2026-09-27): somebody who attacked or was attacked
this turn gets "You're in a fight." instead of the keypad — the running fight
hold Pickpocket already reads (`db/lib/intercept.js#inFight`, `ATTACK.md`).
Only a fight counts. Being on guard in combat mode (`COMBAT-MODE.md`) does not
stop anybody, and neither does a thief's caught hold. A refusal here is not a
strike.

### What it sounds like

Every sound is one Bascinet's sound document already describes (`SOUND.md` §7):

| Moment | Cue | File | The document's words |
|---|---|---|---|
| Each key | `nuke-key` | `keyhit_02`–`06`, one at random | "A button being pressed" |
| The right sequence | `nuke-ping` | `beep5` | "A brief set of digital tones registering some interaction with a futuristic piece of technology" |
| A wrong sequence | `console-refuse` | `console_error` | "A warbled error sound" |
| Arm | `nuke-arm` | `countdown` | "A beeping quickly increasing in speed" |
| Disarm | `nuke-disarm` | `nuke_activator` | "The sound of something mechanical unsealing" |

The key press is played by the web dialog itself, since the server is not asked
anything until the eighth digit. It sits outside `sfx.js`'s burst limit, or
eight quick presses would crowd out the answer to the last one. Discord plays no
sound. Gains are measured the way `sfx.js`'s `GAIN` header says.

**On Discord** the Bomb button on the room's post opens the same keypad as an
ephemeral message that redraws in place. The digits pressed so far ride in each
button's custom id (`room:nuke:key:<roomId>:<digits>`), the phone keypad's
trick, so nothing is stored between presses. The fifth row is the one button,
Discord's green (Success) once the server has said the sequence is right.

### Three strikes

"Wrongly inputting the sequence three times in a row locks a character from
attempting it again." `NukeLockout` holds one row per character who has ever got
it wrong: `streak` and `lockedAt`. A try is counted under a row lock
(`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`), so two tabs
cannot both take a third try. A right sequence sets `streak` back to 0. Nothing
ever clears `lockedAt`: the lockout lasts the whole game. The row cascades with
the character, so the next game starts everybody clean.

## 4. Who knows where it is

"All faction leaders within the fortress start with an entry in their memorised
Notes saying 'The bomb is in {location}'. Tribunals also start with this entry,
and their leader starts with a physical note on which is written the 8 number
arming sequence for that round."

- **Factions are gone from the code**, so "faction leader" is Bascinet's call:
  the Leader Whitelist seats (`whitelist: true` in `docs/roles.yaml`) less the
  Bastard, who is an outsider. That is the Baron, Bishop, Inquisitor, Censor,
  Esculap, Merchant and Exactor.
- **The Tribunal** is the `tribunal-ordinator` and `tribune` roles, or either
  seat tag (`ordinator-insignia`, `tribunal-helmet`), because a GM's Assign
  hands the seat to an existing character without changing their role.
- **The note** is a pinned `JournalEntry` in `/memories` → Notes: "The bomb is
  in {Location name}." It names the Location only, not the room (Bascinet's
  call), so the reader still has to find which room. It carries
  `characterId` (§5) and the label `bomb`.
- **The paper** is a runtime paper tag (`db/lib/paperMint.js#mintPaperRow`),
  titled "A folded note", with the eight digits on it and no author. It is
  minted in its own transaction, the `slaveContract.js` pattern.

`seedNukeBriefing` runs best-effort beside `seedAcquaintances` everywhere a
character comes into being: `createCharacter`, `reincarnate`, the threat spawn,
and a GM's Assign. It never hands the note or the paper over twice.

## 5. Notes that belong to a character

`JournalEntry` was the player's own writing and belonged to the account. The
bomb's note is different: it is the **character's** memory. So
`JournalEntry.characterId` (nullable, cascading) marks a note the game wrote.
`/memories` shows the account's own notes plus the ones for the character being
played now, so a dead character's note does not carry over to the player's next
one. Concussed and Amnesiac scrambling applies to it like any other note. A
player may edit or delete it like any other note.

## 6. What a GM sees

`/gm/dev?s=reports` has a **The bomb** block, always on screen: the room and its
Location, the code, whether it is armed and when it goes off (or when it went
off), and who is locked out of the keypad. **Defuse** stops a countdown without
anybody walking to the bomb or knowing the code. It is GM-gated now, like the
section it sits in (it used to refuse everybody but a superadmin).

## 7. Discord posts

The room's post is hashed with its buttons, so moving the bomb means redrawing
two posts: the old room's and the new one's. `queueBombPosts` puts both on the
mirror queue (`MIRROR.md`) at Start Game, at Restart Game (the old room only)
and at a lazy roll. The mirror redraws them on its next drain.

## 8. Still open

- The words on the keypad (`db/lib/nukeText.js`) are stand-ins. The design
  document gives the rules but not the lines.
- The Tribunal's role briefing in `docs/roles.yaml` was rewritten for the
  keypad and needs Bascinet's pass.
- A GM cannot re-roll the bomb mid-game or clear a lockout except by hand in
  the database.
