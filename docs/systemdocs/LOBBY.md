# The lobby, the roll, and how a game ends

How a game goes from a wiped database to a roster of characters, and from a
last turn to a reveal. Read this before touching: the game phases
(`GameState.phase`), readying up, role priorities, the assignment roll, the
creation window, Start Game / End Game, the epilogue, or what Restart Game
keeps.

Design record: `docs/superpowers/specs/2026-09-06-lobby-design.md`.

## 1. Four phases

`GameState.phase` (`db/prisma/schema.prisma`): **CLOSED → LOBBY → RUNNING →
ENDED**, and back to CLOSED by the wipe. `db/lib/gameState.js` is the one
reader.

| Phase | Ready up | Character creation | Turns advance | Moved by |
|---|---|---|---|---|
| CLOSED | no | GM/superadmin/Playtest only (the Skip button) | no | the wipe lands here; **Open lobby** |
| LOBBY | yes (Player or Playtest role) | GM/superadmin/Playtest only | no | **Start Game** |
| RUNNING | no | yes (Player role, Cursed rules) | yes | **End Game**, or the bomb |
| ENDED | no | yes | no | **Resume** |

**Ended locks only the clock.** Late join stays open, Discord keeps talking,
every web action keeps working, until Restart Game. What Ended does is stop
`advanceTurn()` (`db/index.js` refuses with `refused: "NOT_RUNNING"`, from the
cron and from the Dev Panel's End turn alike), open the archive, and put the
reveal up.

Every reader of a turn deadline — `db/lib/turnClock.js#moveWindow` and the
callers that feed it — takes `clockFrozen`, which
`db/lib/gameState.js#clockFrozen` derives as *not RUNNING, or auto-advance
paused*. A frozen clock means no Move cutoff, the same way a paused cron does.

**Spectators watch only while the game is on.** The Spectator role's view
overwrite follows the phase (`db/lib/spectatorAccess.js`): allowed in RUNNING
and ENDED, denied in CLOSED and LOBBY, so pre-launch testing pings nobody who
only came to watch. Every transition sweeps it; the doctor's cheap scope
repairs drift (`CHANNELS.md`).

**CLOSED with readied players is a frozen lobby.** Close lobby, Preview, Start
is the sequence that stops somebody readying up between the preview and the
commit (`ROLL_PHASES` in `db/lib/lobby.js`).

## 2. Readying up

`/character` with no living character shows the lobby during LOBBY
(`web/app/(app)/character/lobby/Lobby.js`). It holds four things, all saved to
**`PlayerPreference`** as they change (`lobbyActions.js#savePreferences`,
debounced on the client):

- **Role priorities** — every pickable role in the seven buckets
  (`db/lib/roleGroups.js`) with Off / Low / Med / High. **One High at a
  time**: setting another demotes the old one to Med
  (`db/lib/playerPreferences.js#setPriority`, a port of tgstation's
  `set_job_preference_level`). Whitelisted seats are greyed for a player
  without the Whitelist role and dropped server-side if posted anyway.
- **If nothing fits** — Commoner (default), Migrant, or Return to lobby.
- **Antagonist opt-ins** — the twelve public boxes (`THREATS.md` §1), the
  whitelisted ones greyed the same way.
- **Ready** — a `LobbyEntry` row, `status: READY`. Unready deletes it.

`PlayerPreference` is keyed by Discord user and **survives Restart Game**: a
returning player only has to press Ready. Priorities are keyed by role slug, so
a role that leaves `docs/roles.yaml` drops out silently. Opt-ins copy onto
`Character.antagonistOptIns` at creation and lock there; the wizard's
Antagonists step opens prefilled from the preference row and writes back to
it.

Two columns: the roles down the left, and on the right (sticky) the Ready
card with the count, the fallback dropdown and the antagonist boxes. No
explainer text anywhere on it — the handbook carries that. Players see the
ready count and nothing else — no seat counts, no demand, and no starting
areas (a role row is its name, faction and pitch) — so nobody games the roll.

GMs, superadmins and holders of the **Playtest** role (`PLAYTEST_ROLE_ID`,
`db/lib/roleIds.js`) see a **Skip to character creation** button
(`/character?create=1`), which opens the ordinary wizard in any phase. The
server gate (`createActions.js#creationOpen`) is the same rule, and a
playtester also passes the roster check without the Player role — the seat
exists so a contributor can test creation and play without being seated as a
GM or a player.

A role handed out in Discord reaches these surfaces within a minute. The web
app caches a member's roles for five minutes
(`web/lib/discordGuild.js#getGuildMember`), which once meant a fresh Playtest
holder reloaded into a lobby with no Skip button; the character page's
no-character branch now accepts a cached member at most a minute old, and the
creation gates (`createActions.js`, `lobbyActions.js`) always refetch.

## 3. The roll

`db/lib/roleAssignment.js#assignRoles` is a pure function, a port of
tgstation's `SSjob.divide_occupations`:

1. shuffle the readied players with a seeded generator;
2. **leader pass** — for High, then Med, then Low, every unassigned player who
   wants a `leader: true` seat at that level gets one, at random among the
   open ones they may hold;
3. **main pass** — the same three levels over every seat;
4. **jobless** — whoever is left gets the overflow seat they named (Commoner
   or Migrant, both unlimited) or a walk back to the lobby (`roleSlug: null`).

Eligibility: not spawn-only (`SPAWN_ONLY_ROLE_SLUGS`, `db/lib/roleCapacity.js`),
whitelist honoured unless `leaderWhitelistEnabled` is off, and a seat with room
— capacity from `roleCapacity()` at the stamped player count minus what
`heldSeatsByRole` (`db/lib/seatCount.js`) already counts.

Two deliberate departures from SS13: no "overflow first" pass (Commoner and
Migrant are ordinary rows, the fallback dropdown is the overflow), and **no
forced head** — a leader seat nobody eligible wants stays empty and becomes a
warning.

**Player count** = `ceil(readied × 1.09)`, the 9% being headroom for late
joins, stamped on `GameState.playerCount` at Start. Before Start the
`GameConfig.playerCount` knob stands in (`effectivePlayerCount`).

Tests: `db/test/roleAssignment.test.js`, `npm test --workspace=db`.

### Preview, hand-set, Start

On `/gm/dev?s=game` (superadmin): **Preview** rolls and stores the result as
`GameState.assignmentDraft` — `{ seed, playerCount, generatedAt, rows,
warnings }`. A row can be **hand-set** to any pickable role (source `GM`, the
override that ignores the whitelist) or to Return to lobby; **Re-roll** takes a
fresh seed. **Start** commits exactly the stored draft
(`db/lib/lobby.js#commitAssignment`): under a `FOR UPDATE` on the GameState
row it re-validates (everyone still READY and nobody new, every seat still has
room, every slug still a role and not spawn-only) and refuses with "the lobby
changed" rather than committing a wrong table. Then every READY entry becomes
**ASSIGNED** with `expiresAt = now + creationWindowHours` or **UNASSIGNED**,
the phase goes RUNNING with `startedAt` and `playerCount`, Turn 1 is restamped
to now (created as `max + 1` if none is open), and one `game_started` audit row
carries the whole draft.

With nobody readied, Start just flips the phase — a GM test game.

## 4. The creation window

An ASSIGNED entry with a future `expiresAt` **holds its seat**: `heldSeats`
counts it beside living characters and wizard holds, so late join and a threat
spawn cannot take it. The player builds the character with the ordinary
wizard, which opens on the Tags step with the role fixed
(`CreateCharacterWizard.js`'s `lockedRole`); `createCharacter` forces the
entry's role whatever the form posted, skips the whitelist and Cursed gates
for it (the roll honoured them; a hand-set row is the superadmin's call), and
settles the entry to **CREATED**. `settleLobbyEntry` runs in *every*
character-creation path — a threat spawn too — so a seat is never held by a
player who already has a character.

The DMs, all built in `db/lib/lobby.js` and sent from `gameActions.js#startGame`
in `after()`, one at a time:

```
**You're in. You are the Sheriff.**
The Town. You start in Town.
Build your character here: https://ravenheart.quest/character
The seat is yours until <t:…:F> (<t:…:R>). After that it opens to anyone.
-# Can't make it? Press Decline and the seat goes to somebody else. ‡
[ Decline the seat ]
```

The Decline button (`LOBBY_DECLINE_PREFIX`, routed in
`bot/src/events/interactionCreate.js` to `db/lib/lobby.js#declineAssignment`)
sets DECLINED, which frees the seat by itself. A Return-to-lobby player gets a
one-line DM pointing at late join.

`db/lib/lobbySweep.js#runLobbySweep`, on the bot's fifteen-minute cron:

- an ASSIGNED entry five minutes old with `notifiedAt` null gets the
  assignment DM again (a Start that died mid-loop);
- six hours before `expiresAt`, one reminder, stamped on `reminderSentAt`;
- past `expiresAt`, the entry goes **EXPIRED** — which frees the seat — and
  the player is told late join is open.

`creationWindowHours` is a `GameConfig` knob (default 24).

## 5. Late join

Everyone else — never readied, Return to lobby, declined, expired, a Cursed
re-roll, a respawn — uses the wizard as it always was: pick from open seats,
build, spawn. Open during RUNNING and ENDED to anyone with the Player role.

## 6. The GM side

`/gm/dev?s=game`: the phase with its stamps and game number; Open lobby / Close
lobby / Start game / End game (with a closing-note box) / Resume; the Preview
table; and the lobby roster (`LobbyRoster.js`) — who readied, their High and
their Med/Low counts, opt-ins by public name, whitelist standing, fallback,
and after Start the seat, status and window. The roster is read-only; the roll
is the only writer.

## 7. Ending, the reveal, and games that outlive the wipe

**`db/lib/gameEnd.js#endGameInDb`** is the one way a game ends: the End Game
button, and the bomb from inside `advanceTurn` (the reveal is queued after
the fireball broadcast). It writes GameState to ENDED with `archiveVisible`
on, and onto the current **`Game`** row its end, closing note and
**epilogue** — `db/lib/epilogue.js#buildEpilogue`: the note, a facts line
(days, turns, characters, deaths, letters, archive rows), and who was who: every
character the game had, Discord handle as name and role, antagonist seats
named from the seat tag, the dead marked with their turn. `formatEpilogue` is
the `**Game Ended**` post to `#turns`; `/archive` renders the same object.
Resume undoes the phase and leaves the archive open.

`Game` is one row per game (`number`, dates, note, epilogue). `GameState.gameId`
points at the current one; every `ArchiveEntry` carries `gameId` as a snapshot,
stamped by `db/lib/archive.js` from a thirty-second memo. **Restart Game keeps
the transcript**: it snapshots an epilogue onto the old Game if it never got
one, creates Game N+1, and recreates GameState pointing at it. `/archive` picks
a game (`ARCHIVE.md`).

## 8. What Restart Game does and does not touch

Keeps: `GameConfig` (every knob), `PlayerPreference`, `Game`, `ArchiveEntry`.
Wipes: `LobbyEntry`, and recreates `GameState` (phase CLOSED, new `gameId`).
Everything else as before (`LAUNCH.md` §2, §4).

## 9. Where the code lives

| File | What |
|---|---|
| `db/lib/gameState.js` | `getGameState`, `readGameState`, `effectivePlayerCount`, `clockFrozen`, `GAME_STATE_CREATE` |
| `db/lib/gameConfigFields.js` | The registry every `GameConfig` knob is declared in; `npm run db:check-config` |
| `db/lib/playerPreferences.js` | One-High rule, normalisation |
| `db/lib/roleAssignment.js` | The roll, pure |
| `db/lib/lobby.js` | Draft build / validate / commit, DMs, Decline, `settleLobbyEntry` |
| `db/lib/lobbySweep.js` | Resend, reminder, expiry |
| `db/lib/seatCount.js` | `heldSeats`, `heldSeatsByRole` |
| `db/lib/gameEnd.js`, `db/lib/epilogue.js` | Ending and the reveal |
| `web/app/(app)/character/lobby/Lobby.js`, `lobbyActions.js` | The player lobby |
| `web/app/(app)/gm/dev/gameActions.js` | Phase transitions, Preview, hand-set, Start, End, Resume |
| `web/app/(desk)/gm/dev/{GameControls,AssignmentPreview,LobbyRoster}.js` | The Game section |
| `bot/src/lib/lobby.js` | The Decline click |
