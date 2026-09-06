# Ready lobby, role assignment, late join

## Context

Getting a role today is a rush: creation opens, everyone piles onto `/character`, and the unique seats go to whoever clicks first. Bascinet wants the SS13 shape instead. Before the game, players **ready up** with role priorities (Off / Low / Medium / High, one High) and antagonist opt-ins. A superadmin previews the roll and presses **Start Game**; everyone is assigned, DMed a link, and given a 24-hour locked window to build the sheet with the existing point-buy. Anyone else (never readied, Cursed re-rolls, respawns) uses **Late join**: today's wizard, picking from open seats. Turns don't tick until Start. The game also gets an explicit **Ended** phase with an SS13-style round-end reveal. Along the way the dev panel's config gets split into durable config (survives Restart Game) and per-game state, driven by one field registry.

Decisions taken with Bascinet in this session (17 questions):

| # | Decision |
|---|---|
| 1 | Lobby = priorities + Ready only. Sheet is built **after** assignment, same PointBuy, role locked for a window (`creationWindowHours`, default 24). Big DM with link and `<t:X:F>` + `<t:X:R>`. Expired → entry deleted, seat opens. |
| 2 | **No antagonist picking at Start.** Assign/Spawn stay the mid-game path; the lobby only collects consent. |
| 3 | "(WL only)" opt-ins use the **same Whitelist Discord role** as leader seats. |
| 4 | Real seats: Judge, Demoness, Tribunal Ordinator, Tribune, plus **two Thanati seats made real**. Opt-in list is exactly the twelve Bascinet named. |
| 5 | An opt-in has a **public name** that may differ from the seat: "Succubus" is the public face of Demoness (flags 18+), "Cultist Leader" / "Cultist" are the public faces of the two Thanati seats. |
| 6 | Late join = **direct pick from open seats**, today's wizard. |
| 7 | Start Game is **superadmin only, preview first** (hand-set rows, re-roll). |
| 8 | Player count for weighted seats = **readied count × 1.09, rounded up**, stamped at Start. |
| 9 | Phases **Closed → Lobby → Running → Ended**. Ended opens the archive and shows the reveal roster. `openToPlayers` is deleted. |
| 10 | Preferences **persist across wipes**, keyed by Discord user. |
| 11 | Lobby is **web only**; Discord gets DMs and announcements. |
| 12 | End reveal: antagonist seats revealed, dead included and marked, GM closing note on top, posted to Discord as **Game Ended** with fun facts. |
| 13 | Creation window: **Decline button** in the DM, window length is config, **reminder DM at 6h left**. No GM extend/revoke row. |
| 14 | Players see the **ready count only**. No seat or demand numbers in the lobby. |
| 15 | Turn 1 opens at Start; first advance is the next midnight. |
| 16 | Antagonist opt-ins **lock once the character exists**. |
| 17 | UI drafted as **ASCII in this plan**. Config split into **GameConfig + GameState with a field registry**. |

Also from the brief: the `thanati` tag becomes a Belief with Bascinet's exact wording (no ‡, dictated). GMs and superadmins get **Skip to character creation** during Lobby. Antagonist seats carry incompatible tags: refunded if positive cost, grandfathered if negative, when Assigned.

SS13 reference (tgstation `code/controllers/subsystem/job.dm`, `preferences.dm`): `divide_occupations` (shuffle → head-of-staff pass per level → HIGH/MEDIUM/LOW loop picking a random eligible open job → jobless fallback BEOVERFLOW / BERANDOMJOB / RETURNTOLOBBY), `set_job_preference_level` (setting High demotes the old High to Medium). Deliberate deviation: no "overflow first" pass. Commoner and Migrant are ordinary roles in the list; the "If nothing fits" dropdown is the overflow.

---

## 1. Data model

### GameConfig (durable, never wiped)
Keeps every balance knob and feature switch, plus infra pointers and the REST breaker. **Removed:** `openToPlayers`, `lifewebBlood`, `nextWeather`, `nextTurnNote`, `nukeArmedTurn`, `nukeDetonatedTurn`, `gatehouseTurretArmed`, `bellRungAt`, `archiveVisible` (move to GameState), and the four orphans `turnsAnnouncementChannelId`, `turnsAnnouncementMessageId`, `turnsBannerMessageId`, `mindlinkChannelId` (drop). **Added:** `creationWindowHours Int @default(24)`. `playerCount` stays as "Expected players (until Start)". `autoTurnAdvanceDisabled` stays durable (a GM pause is host config).

### GameState (per game, deleted + recreated by the wipe)
```prisma
enum GamePhase { CLOSED LOBBY RUNNING ENDED }
model GameState {
  id                   Int       @id @default(1)
  phase                GamePhase @default(CLOSED)
  lobbyOpenedAt        DateTime?
  startedAt            DateTime?
  endedAt              DateTime?
  playerCount          Int?      // ceil(ready * 1.09) at Start; null before
  closingNote          String?
  assignmentDraft      Json?     // the previewed plan Start commits (see §3)
  archiveVisible       Boolean   @default(false)
  lifewebBlood         Int       @default(100)
  nextWeather          Weather?
  nextTurnNote         String?
  nukeArmedTurn        Int?
  nukeDetonatedTurn    Int?
  gatehouseTurretArmed Boolean   @default(false)
  bellRungAt           DateTime?
}
```

### PlayerPreference (durable, keyed by Discord user)
```prisma
enum JoblessRole { COMMONER MIGRANT RETURN_TO_LOBBY }
model PlayerPreference {
  discordUserId    String      @id
  rolePriorities   Json        @default("{}")   // { [roleSlug]: "LOW"|"MEDIUM"|"HIGH" }, absent = Off
  antagonistOptIns String[]    @default([])     // threat slugs (real slugs, not public names)
  joblessRole      JoblessRole @default(COMMONER)
  updatedAt        DateTime    @updatedAt
}
```
Keyed by role **slug** so a role leaving `roles.yaml` silently drops out. Default jobless is Commoner, matching SS13's default of "be the overflow role".

### LobbyEntry (per game, wiped)
```prisma
enum LobbyStatus { READY ASSIGNED CREATED DECLINED EXPIRED UNASSIGNED }
model LobbyEntry {
  id             String      @id @default(cuid())
  discordUserId  String      @unique
  status         LobbyStatus @default(READY)
  readyAt        DateTime    @default(now())
  assignedRoleId String?
  assignedRole   Role?       @relation(fields: [assignedRoleId], references: [id], onDelete: SetNull)
  assignedAt     DateTime?
  expiresAt      DateTime?
  reminderSentAt DateTime?
  characterId    String?     // set when CREATED
  source         String?     // "HIGH" | "MEDIUM" | "LOW" | "FALLBACK" | "GM"
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
}
```
Unready deletes the row. An **ASSIGNED entry with `expiresAt > now` holds a seat** for capacity purposes, exactly like a `RoleReservation` does today. `RoleReservation` stays for the late-join wizard's 30-minute hold.

### Migration
One migration, authored so `migrate deploy` applies it: create the three tables/enums, copy the moved GameConfig columns into GameState row 1 in SQL (`INSERT ... SELECT` from GameConfig id 1), then drop the moved and orphan columns. Folder name must sort after the newest folder already in `db/prisma/migrations/` (repo names run ahead of the calendar).

---

## 2. Shared accessors and the field registry

- **`db/lib/gameState.js`** (new, in the barrel): `getGameConfig(db)`, `getGameState(db)` (both upsert-by-id-1), `effectivePlayerCount(config, state)` = `state.playerCount ?? config.playerCount`, `isClockRunning(config, state)` = `state.phase === "RUNNING" && !config.autoTurnAdvanceDisabled`. Every one of the ~40 inline `prisma.gameConfig.findUnique({ where: { id: 1 } })` calls that touches a moved field switches to these. Web wraps them in React `cache()` in `web/lib/gameState.js` so a page fetches once.
- **`db/lib/gameConfigFields.js`** (new): the registry. One array of `{ key, type: "int"|"float"|"bool", label, help, group, min, max, default }` covering every editable GameConfig column (moves `CONFIG_HELP` text out of `web/app/(app)/gm/dev/devHelp.js`). Groups: Creation, Economy, Carry, Desires, Turn clock, Catatonic, Paperwork, Features, Discord. Includes `noticeExpiryTurns` (currently unreachable from the UI) and `creationWindowHours`.
- **Consumers:** the Configuration section renders by looping the registry; `updateGameConfig` parses by looping it (clamp with min/max, bool = `=== "on"`); `DEFAULT_GAME_CONFIG` is deleted, since the wipe no longer touches GameConfig.
- **`db/scripts/ops/check-config-registry.js`** + `npm run db:check-config`: diffs registry keys against Prisma's DMMF for `GameConfig` (minus id and the infra/breaker pointers listed as `internal`) and exits 1 on drift. Wire into `scripts/push.sh` next to the untracked-migration check.

---

## 3. The assignment algorithm — `db/lib/roleAssignment.js`

Pure function, no DB, header comment citing tgstation's `job.dm`.

```
assignRoles({ players, roles, taken, playerCount, leaderWhitelistEnabled, seed })
  players: [{ discordUserId, priorities: {slug: level}, joblessRole, whitelisted }]
  roles:   [{ slug, isUnique, unlimited, weight, requiresWhitelist, grantsLeader, spawnOnly }]
  taken:   Map<slug, count>   // ALIVE holders + DEAD on permanent seats + live ASSIGNED holds
  → { rows: [{ discordUserId, roleSlug|null, source }], warnings: [...] }
```

1. `open(slug)` = `roleCapacity(role, playerCount) - taken - assignedSoFar > 0`.
2. `eligible(player, role)`: not spawn-only; `!role.requiresWhitelist || !leaderWhitelistEnabled || player.whitelisted`; open.
3. Shuffle players with a seeded PRNG (mulberry32 over `seed`) so Preview and Start agree.
4. **Leader pass:** for level in HIGH, MEDIUM, LOW: for each unassigned player, candidates = `grantsLeader` roles at this level they're eligible for; pick one at random; assign. No forced head.
5. **Main loop:** same three levels: candidates = every role at that level they're eligible for; random pick.
6. **Jobless:** COMMONER → `commoner`, MIGRANT → `migrant` (both unlimited, always open), RETURN_TO_LOBBY → `roleSlug: null`.
7. Warnings: leader seats with zero takers at any level; players returning to the lobby; players whose priorities are all Off.

Preference-side rule in `db/lib/playerPreferences.js#setPriority(priorities, slug, level)`: setting HIGH demotes the previous HIGH to MEDIUM; OFF deletes the key.

A `node --test` file at `db/test/roleAssignment.test.js` covers: one High wins over Medium, unique seat goes to exactly one, whitelist gate, leader pass beats main loop, weighted cap at a given player count, jobless fallbacks, determinism by seed. First test in the repo; `npm test --workspace=db` runs it.

Seat counting is unified in **`db/lib/seatCount.js#heldSeats(tx, role, { excludeDiscordUserId })`** = ALIVE (+DEAD on permanent seats) + live `RoleReservation` by others + live ASSIGNED `LobbyEntry` by others. Replaces the duplicated two-count blocks in `createActions.js`, `roleReservation.js#reserveRole`, `threatSpawn.js#acceptThreatSpawn`, and feeds `takenCounts`.

---

## 4. Phases and gates

| Phase | Ready up | Late join | Turn cron / Force advance | Who moves it |
|---|---|---|---|---|
| CLOSED | no | GM/superadmin skip only | refused | Wipe lands here; superadmin **Open lobby** |
| LOBBY | yes (Player role) | GM/superadmin skip only | refused | superadmin **Start Game** (needs a fresh preview) |
| RUNNING | no | yes (Player role, Cursed rules) | runs | superadmin **End Game** |
| ENDED | no | no | refused | superadmin **Resume** (back to RUNNING) |

- `db/index.js#advanceTurn()` refuses unless `phase === RUNNING` (returns `{ advanced: false, reason }`). Bot cron logs the skip; `forceAdvanceTurn` returns an error and the button is hidden.
- The 14 readers of `autoTurnAdvanceDisabled` that feed `moveWindow(...)` (turnClock, weather, lessons, confession, turnsConsole, character page, requestActions, interactionCreate) pass `!isClockRunning(config, state)` instead, so a frozen phase reads as "no deadline" everywhere the same way a paused cron does.
- Creation gate (`createCharacter`, `reserveRoleAction`, and the page): allowed when `RUNNING && approved`, or `LOBBY && (isGm || superadmin)` (skip), or the caller holds an ASSIGNED entry (locked role, any phase but ENDED). ENDED refuses with "The game has ended."
- Lobby actions gate: `LOBBY && isApprovedPlayer(member)`; superadmin bypasses the Player role check as today.

---

## 5. Lobby (player) — `/character` in LOBBY with no character

Files: `web/app/(app)/character/lobby/Lobby.js` (client), `lobbyActions.js` (server: `savePreferences`, `setReady`, `setUnready`), `web/lib/lobbyData.js` (loader). Preferences save on every change (debounced 400ms, `useTransition`), Ready is its own button.

```
┌─ /character ───────────────────────────────────────────────────────────┐
│  Ravenheart is gathering                                    37 ready   │
│  The game has not started. Set what you'd like to play, then Ready.    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  ○ NOT READY                                   [ Ready up ]      │  │
│  │  -# You can change everything below until the game starts. ‡     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ROLES                                     one High at a time          │
│  ─ Court ─────────────────────────────────────────────────────────     │
│  Baron         The Court  · Fortress  ▸intro   [Off][Low][Med][HIGH]   │
│  Baroness      The Court  · Fortress  ▸        [Off][Low][Med][High]   │
│  ░░ Hand       The Court  · Fortress  ▸        ░░░░ Whitelist only ░░░ │
│  Courtier      The Court  · Fortress  ▸        [Off][LOW][Med][High]   │
│  ─ Clergy ────────────────────────────────────────────────────────     │
│  ░░ Bishop     The Church · Town      ▸        ░░░░ Whitelist only ░░░ │
│  Chaplain      The Church · Town      ▸        [OFF][Low][Med][High]   │
│  … Cerberon · Saviors · Business · Soil · Outsiders …                  │
│                                                                        │
│  IF NOTHING FITS                                                       │
│  [ Join as Commoner ▾ ]   Join as Migrant / Return to lobby            │
│  -# Return to lobby means you late-join by hand after the start. ‡    │
│                                                                        │
│  ANTAGONISTS (optional)                                                │
│  ☐ Archon        ☐ Bastard ░WL░   ☐ Cultist        ☐ Cultist Leader ░WL░│
│  ☐ Judge         ☐ Obsessed       ☐ Schemer        ☐ Skinless          │
│  ☐ Succubus ░WL░ ☐ Tribune        ☐ Tribunal Ordinator ░WL░ ☐ Windlander│
│  -# Ticking one says you're open to it. It doesn't promise it. ‡      │
└────────────────────────────────────────────────────────────────────────┘
```

- The four-level control is a `.chip-row` segmented group (the pattern from the zone picker fix), keyboard-reachable, the active level filled with `var(--accent)`. High is visually heavier than the others.
- A whitelisted role or opt-in for a non-whitelisted player is rendered with a translucent grey overlay (`var(--surface)` at 0.7 alpha over the row, `pointer-events: none`, `aria-disabled`) and the label "Whitelist only". Nothing is hidden; the row stays readable.
- Readied state flips the card: `● READY since 14:02   [ Unready ]` in `var(--positive)`. Preferences stay editable while ready.
- Ready with all Off and Return to lobby shows a `var(--warn)` line under the button: "You've picked nothing, so you'll be sent back to the lobby at the start. ‡" Ready is still allowed.
- Roles listed per bucket from `groupRoles` (`db/lib/roleGroups.js`), spawn-only seats withheld as today, no seat counts, no demand.
- GM or superadmin sees one extra line at the top: `[ Skip to character creation ]` → `/character?create=1` renders today's wizard (gate re-checked server-side).

Other `/character` states with no character:
- CLOSED: `CreationClosed` with "Ravenheart isn't open yet. ‡"
- RUNNING, ASSIGNED entry: wizard with the role step **replaced** by a locked banner (below).
- RUNNING, no entry / UNASSIGNED / EXPIRED / DECLINED: today's wizard (late join). Cursed rules unchanged.
- ENDED: "The game has ended." with a link to `/epilogue`.

Locked-role wizard header:
```
┌──────────────────────────────────────────────────────────────────────┐
│  You are the Sheriff.                    The Town · Soil · Town      │
│  This seat is yours until Sat 12 Sep, 14:02 (in 23 hours). ‡          │
│  Tags ▸ Identity ▸ Antagonists ▸ Confirm                              │
└──────────────────────────────────────────────────────────────────────┘
```
`createCharacter` reads the entry, forces `roleId` from it, ignores a posted role, and marks the entry CREATED in the same transaction. The Antagonists step stays in the wizard for everyone, **prefilled from PlayerPreference**, written to both `Character.antagonistOptIns` (the locked snapshot) and back to the preference row.

---

## 6. The assignment DM, Decline, reminder, expiry

Sent from the Start action via `web/lib/discordGuild.js#sendDm` (it logs and prefixes `»`), one per player, sequential.

```
» **You're in. You are the Sheriff.**
» The Town · Soil. You start in Town.
» Build your character here: https://ravenheart.quest/character
» The seat is yours until <t:1757700120:F> (<t:1757700120:R>). After that it opens to anyone.
» -# Can't make it? Press Decline and the seat goes to somebody else. ‡
   [ Decline the seat ]
```
Return to lobby: "» No seat matched what you asked for. The game has started and late join is open at …/character. ‡"

- Button `custom_id` prefix `LOBBY_DECLINE_PREFIX = "lobby-decline:"` exported from `db/lib/lobby.js`, routed in `bot/src/events/interactionCreate.js` next to the threat-spawn buttons, handler `bot/src/lib/lobby.js#handleLobbyDecline` → `db/lib/lobby.js#declineAssignment(prisma, entryId, discordUserId)` (status DECLINED, seat released by virtue of status). Reply edits the message: "You turned the seat down. Late join is open. ‡"
- **`db/lib/lobbySweep.js#runLobbySweep(prisma)`**, bot cron every 15 minutes beside the whisper poll: ASSIGNED entries with `expiresAt - now ≤ 6h` and no `reminderSentAt` get one reminder DM with the same `<t:>`; ASSIGNED entries past `expiresAt` flip to EXPIRED and get "Your seat as Sheriff has been released. Late join is open. ‡". Uses `db/lib/dm.js#sendDm(prisma, …)`. Idempotent; safe if the bot missed a tick.

---

## 7. GM side — `/gm/dev?s=game`

New section, superadmin like the rest of the page. `OpsNav` gains it at the top of the Game group. Server-component page + one client component `GameControls.js` for the buttons (form actions, `useConfirm` on Start / End / Restart, the letters pattern, not the threats' per-gesture commit).

```
┌─ Game ────────────────────────────────────────────────────────────────┐
│  Phase   ● LOBBY   opened Thu 10 Sep 21:14        37 ready · 2 chars   │
│  [ Close lobby ]   [ Preview assignment ]   [ Start game ] (disabled   │
│                                                until a preview exists) │
│                                                                        │
│  PREVIEW  seed 8f3a21 · 41 players · player count 45 (37 × 1.09)       │
│  ⚠ Bishop, Inquisitor: nobody wants these at any level                │
│  ⚠ 2 players return to the lobby                                       │
│  Player          Role             Source     Hand-set                  │
│  alice#…         Baron            High       [ ▾ ]                     │
│  bob             Courtier         Medium     [ ▾ ]                     │
│  carol           Commoner         Fallback   [ ▾ ]                     │
│  dave            — (lobby)        —          [ ▾ ]                     │
│  [ Re-roll ]                                                           │
│                                                                        │
│  ROSTER                                                   filter ▾     │
│  Player   Ready     High        Med/Low  Opt-ins            WL   Jobless│
│  alice    21:15     Baron       3 / 1    Succubus, Judge    ✓    Commoner│
│  …                                                                     │
└────────────────────────────────────────────────────────────────────────┘
```
After Start the roster gains Assigned / Status / Expires columns. In RUNNING the card shows `[ End game ]` with a closing-note textarea; in ENDED it shows the note, the reveal, and `[ Resume ]`.

Actions in `web/app/(app)/gm/dev/gameActions.js`: `openLobby`, `closeLobby`, `previewAssignment` (writes `GameState.assignmentDraft`), `setDraftRow` (hand-set), `startGame`, `endGame`, `resumeGame`. `startGame` re-validates the draft (every player still READY, every seat still open, roles exist); on a mismatch it returns "The lobby changed since the preview. Preview again. ‡" and commits nothing. Commit is one transaction: entries → ASSIGNED/UNASSIGNED with `expiresAt = now + creationWindowHours`, GameState → RUNNING with `startedAt`, `playerCount`, Turn 1 `gameDate = now` (created if missing), audit `game_started`. DMs and a `#turns` line ("The game has begun. ‡") go in `after()`.

Nav becomes: **Game** → Game, Turn, Configuration, The Depot · **Operations** unchanged · **Threats** → Assignments, Antagonists · **Danger** → Restart game. The `danger` section stays where it is; the wipe now deletes `LobbyEntry`, deletes + recreates `GameState` (phase CLOSED), and leaves `GameConfig` and `PlayerPreference` alone. `DEFAULT_GAME_CONFIG` is deleted. `openLobby` is the new last step in LAUNCH.md's runbook where "Tick Open to players last" was.

---

## 8. End game and the reveal

`endGame(closingNote)`: GameState → ENDED, `endedAt`, `closingNote`, `archiveVisible: true`. `after()`: post to `#turns` in chunks ≤ 2000, then the audit row.

```
**Game Ended**
» <closing note>

It lasted 26 days, 52 turns. 61 characters lived in Ravenheart, 14 died. 340 letters flew. 2,118 things went into the archive.

**Who was who**
alice as Ada Voss, Baron
bob as Corben Ashe, Courtier — the Judge
carol as Maeris, Commoner ✝ turn 31
…
```
Data from `db/lib/epilogue.js#buildEpilogue(prisma)`: every `Character` row any status, Discord display name from `listGuildMembers()` (falls back to the id), role title, seat via `threatBySeatTag` over held tags, death turn from the `DEATH` archive row. Fun facts are cheap counts: days from `startedAt`→`endedAt`, max `Turn.number`, characters, deaths, `BirdMessage` count, `ArchiveEntry` count. The web page `web/app/(app)/epilogue/page.js` renders the same object (gated on ENDED for players, always for GMs), and `navItems.js` links it while ENDED. The archive gate in `archive/page.js` and `navItems.js` reads `GameState.archiveVisible`.

---

## 9. Threat catalog and tags

`db/lib/threats.js`:
- `optIn` becomes `true` **or** `{ name, whitelist }`. Helpers `optInName(t)`, `optInWhitelisted(t)`. `OPT_IN_THREATS` sorted by public name.
- Delete the six decoy-only entries not in Bascinet's list: aberrant-emissary, false-chaplain, neomorph, phrygian-count, tribunal-operations, warlock.
- Keep decoys: archon, obsessed, schemer. Add decoys: `bastard` (WL), `windlander`, `skinless`.
- `demoness.optIn = { name: "Succubus", whitelist: true }`. `tribunal-ordinator.optIn = { whitelist: true }`, `tribune.optIn = true`. `judge.optIn = true`.
- New real seats: `thanati-leader` (name "Thanati Leader", optIn `{ name: "Cultist Leader", whitelist: true }`, seat tag `thanati-leader`, assign `{ tagPoints: 10, tagSlugs: ["thanati", "thanati-leader"] }`, spawn like Judge's shape) and `thanati` (name "Thanati", optIn `{ name: "Cultist" }`, seat tag `thanati`, assign `{ tagPoints: 5, tagSlugs: ["thanati"] }`). Points and kits are drafts for Bascinet to tune; blurbs carry ‡.
- `normalizeAntagonistSlugs` / `antagonistNames` unchanged in shape; `antagonistNames` returns public names.

`docs/tags.yaml`:
- New `thanati` in `general-beliefs`: `description: "This reality is cursed. Everyone must die before Tzchernobog can reset it."` (verbatim, no ‡), `pointCost: 0`, `purchasable: false`, `removable: false`, `exclusive: true`, `conflictsWith: [pacifist, charitable, saint, pilgrim]`. Exclusivity already rules out every other belief.
- New `thanati-leader` seat tag, 0-cost, `purchasable: false`.
- `judge` and `demoness` seat tags get `conflictsWith: [pacifist, charitable, saint]` (check `cruel`'s existing edges first; the sync symmetrizes).

**Incompatible tags are expressed as `conflictsWith` on the seat tag**, so the store and Add Tag already refuse them for a seat holder. The only new logic is at Assign: `db/lib/seatConflicts.js#resolveSeatConflicts(tx, characterId, seatTags)` walks held tags, removes any that conflict (pairwise edge, or same exclusive group), refunds `pointCost` to `tagPoints` when positive, keeps the tag when the cost is zero-or-negative **unless** it's an exclusive-group clash (a second belief always goes, refunding `max(cost, 0)`). Returns `{ refunded, removed, kept }`; `assignThreat` calls it after the seat-tag upserts and the DM lists what was refunded. `THREATS.md` §3 documents the rule.

`ThreatAssignmentsTable.js`: chips show public names; whitelist chip per player; rows come from `PlayerPreference` left-joined to `Character` so lobby-only opt-ins show before Start. The Assign dropdown lists the six real seats.

---

## 10. Files touched (representative)

**Schema / db**
- `db/prisma/schema.prisma`, one migration.
- New: `db/lib/gameState.js`, `gameConfigFields.js`, `playerPreferences.js`, `roleAssignment.js`, `seatCount.js`, `lobby.js`, `lobbySweep.js`, `seatConflicts.js`, `epilogue.js`, `db/test/roleAssignment.test.js`, `db/scripts/ops/check-config-registry.js`.
- Edit: `db/index.js` (advanceTurn phase gate, lifeweb fields → GameState, barrel exports), `db/lib/roleReservation.js`, `threatSpawn.js`, `threats.js`, `turnClock.js`, `lifeweb.js`, `laborAccess.js`, `autoLaborPass.js`, `nuke.js`, `nukeExplosionPass.js`, `gatehouseTurret.js`, `bell.js`, `turnAnnouncement.js`, `lessons.js`, `confession.js`, `db/weather.js`, `roleIds.js` (comment).

**Bot**
- `bot/src/lib/turnEngine.js` (phase), `turnsConsole.js`, `events/ready.js` (lobby sweep cron), `events/interactionCreate.js` (decline route, moved fields), new `bot/src/lib/lobby.js`.

**Web**
- `web/lib/gameState.js` (cached accessors), `lobbyData.js`, `navItems.js`, `superadmin.js` untouched.
- `web/app/(app)/character/page.js` (phase branching), `createActions.js` (gate, locked role, `heldSeats`, entry → CREATED), `CreateCharacterWizard.js` (locked header, prefilled opt-ins), `CreationClosed.js`, new `lobby/Lobby.js`, `lobbyActions.js`, `nukeActions.js`.
- `web/app/(app)/gm/dev/actions.js` (registry parser, wipe), new `gameActions.js`, `devHelp.js` (folded into registry), `threatActions.js` (conflict resolution), `threats/ThreatAssignmentsTable.js`.
- `web/app/(desk)/gm/dev/page.js` (Game section, registry-driven config form, moved fields), `OpsNav.js`, new `GameControls.js`, `ConfigForm.js`.
- `web/app/(app)/archive/page.js`, `lifeweb/page.js`, new `epilogue/page.js`.

**Docs**
- New `docs/systemdocs/LOBBY.md` (phases, preferences, algorithm with the SS13 citation, the window, the reveal). Update `CHARACTERS.md` §1/§4b, `LAUNCH.md` (runbook: Open lobby last; wipe table), `DEV-PANEL.md` §11, `THREATS.md` (public names, conflict rule, two Thanati seats), `TURN-ENGINE.md` (phase gate), `ARCHITECTURE.md` (GameState), `CLAUDE.md` (table row, permission table note on Whitelist, "Game state" section's `openToPlayers` mentions), `docs/handbook.md` (one paragraph on readying and the 24-hour window, with ‡).

---

## 11. Delivery order (each stage is one push, in this order)

1. **Spec + registry + split.** Commit this design as `docs/superpowers/specs/2026-09-06-lobby-design.md`. Schema migration, `gameState.js`, registry, config form rework, wipe changes, phase gate in the turn engine and clock readers. Game reaches CLOSED/LOBBY/RUNNING by hand from the new Game section (no lobby yet). `db:check-config` green.
2. **Threats.** Catalog reshape, `thanati` belief + seat tags, `seatConflicts.js` in Assign, assignments table on public names. `db:sync-tags`, `db:prune-tags -- --apply`.
3. **Lobby.** `PlayerPreference`, `LobbyEntry`, the player lobby, ready/unready, GM roster.
4. **Assignment.** `roleAssignment.js` + tests, preview/hand-set/re-roll, `startGame`, DMs, Decline button, sweep cron, `heldSeats`, locked-role wizard, late-join gating, GM skip.
5. **End game.** `endGame`/`resumeGame`, epilogue builder, `/epilogue`, Discord post, archive gate move.
6. **Docs + handbook.**

Every push via `npm run push -- "Subject" "note" …` with GM-facing notes. Migration ships with stage 1 through the deploy's Pre-Deploy Command; `npm run deploy` for stage 1 since it's destructive (backup first).

---

## 12. Verification

- `npm run db:generate`, restart `dev:web`, `npm run lint --workspace=web`, `npm run build --workspace=web`, `npm test --workspace=db`, `npm run db:check-config`, `npm run audit:contrast --workspace=web`.
- `npm run dev:check` after each stage; add routes `/character` (as a player in each phase), `/gm/dev?s=game`, `/epilogue`, with the negative cases (player bounced from `/gm/dev`, `/epilogue` closed before ENDED).
- Manual walk on dev with `npm run dev:session`: CLOSED → Open lobby → ready as two personas with different priorities → preview → hand-set one row → Start → check the two DMs in `/gm/players`, the `<t:>` renders, Decline on one, sheet on the other → seat count on late join reflects the hold → End game → `#turns` post and `/epilogue`.
- Restart Game, then confirm `GameConfig` is unchanged, `PlayerPreference` rows survive, `GameState` is fresh at CLOSED, and `LobbyEntry` is empty.
- Then a **verify** pass in the CLAUDE.md sense (two Opus reviewers: REVIEW and SIMPLIFY) on stages 3–4 before stage 5.
