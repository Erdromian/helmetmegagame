# The Hall, phase by phase

The per-phase build specs for `/play` (design in [HALL.md](HALL.md)). Phases 0–2 shipped 2026-09-06; a phase is deleted from here once HALL.md describes it. Internal reference, not game text.

## Phases 1–6: the rest (approved 2026-09-06, "just finish the rest")

Sequential Opus workers, one at a time in the main tree (another session holds
uncommitted edits in `db/lib/roomAccess.js`, `channelDoctor.js`, `locationMove.js`
and `bot/src/events/interactionCreate.js`; workers touch those only where a phase
says so, and the orchestrator stages by hunk). Every phase ends with lint, build,
`node --check` on bot/db files, a report, then the orchestrator's review, a
production check, commit, push. Migrations are hand-written SQL; folder names follow
`20260911070000_…` upward. `docs/systemdocs/HALL.md` is updated by the phase that
changes what it describes. Every player-visible string ends in ‡.

### Phase 1: one write path, edits and deletes

**db/**
- `db/lib/say.js` (new). Two halves so the Discord order (post, then record) and
  the web order (record, then the outbox posts) share everything but the sequencing:
  - `prepareSpeech(prisma, { character, placeKey, content, source })` → `{ ok,
    content, identity, refusal }`. Gates in order: `placeAccess` (phase 1: the
    `loc:` you stand in, the `zone:` of your zone, and any `room:`/`conv:` that
    `db/lib/feedAccess.js` (new, moved from `web/lib/feedAccess.js`) allows —
    phase 2 fills those in), the speech block (`slugsBlocking(SPEAK)` +
    `STUPID_SLUG`, the query `bot/src/lib/proxy.js#loadVoiceState` runs today, moved
    here and exported), length ≤ 2000, then the transforms `postAsCharacterTo`
    applies: `babble` (`db/lib/babble.js`) when Stupid, and
    `capitalizeSentences`/`fixContractions` when `GameConfig.tupperAutocorrectEnabled`
    — move `bot/src/lib/textCorrection.js` to `db/lib/textCorrection.js` and leave a
    one-line re-export behind. Slowmode is enforced for `source: WEB` only (30 s per
    character per place; 300 s for `zone:`), read from the character's newest row
    there; Discord enforces its own for Discord-origin sends. Identity via
    `loadForcedName`/`loadConcealment` + `presentedIdentity`.
  - `recordSpeech(prisma, prepared, { discordMessageId, discordChannelId, zoneId,
    zoneName, channelKind, threadName })` → `recordArchiveMessage` with the
    prepared content and alias, `placeKey`, `source`. Returns the row.
  - `sayInPlace(prisma, args)` = prepare + record, for the web.
  - `EDIT_WINDOW_MS = 5 * 60_000`. `editSpeech(prisma, { characterId, seq, content })`
    and `deleteSpeech(prisma, { characterId, seq })`: the row must be `kind
    MESSAGE`, `characterId` the caller's, `deletedAt` null, `sentAt` within the
    window; edit re-runs the transforms and length check, sets `content`,
    `editedAt`; delete sets `deletedAt`. Both `notifyFeed` with `op: "edit" |
    "delete"`. GM-forced deletes (phase 3's desk) pass `{ gm: true }` to skip the
    owner and window checks.
- `db/lib/feedNotify.js`: payload gains `op` (`"new"` default).
- `db/lib/archive.js`: `updateArchiveMessage` / `deleteArchiveMessage` become thin
  wrappers over `editSpeech`/`deleteSpeech` keyed by `discordMessageId` (look the
  row up, then call). Delete is soft everywhere now.
- `db/lib/discordRest.js`: `editWebhookMessage(webhook, messageId, content,
  threadId)` and `deleteWebhookMessage(webhook, messageId, threadId)` beside
  `executeWebhook`, and `postAsCharacter` gains `{ threadId }` (the `?thread_id=`
  query on execute). `ensureChannelWebhook` is keyed on the PARENT channel for a
  thread; add `discordTargetForPlaceKey(prisma, placeKey)` → `{ channelId,
  threadId }` in `db/lib/placeKey.js` (`loc:` → channel; `room:`/`conv:` → parent
  channel + thread id; `zone:` → summary channel).

**bot/**
- `bot/src/events/messageCreate.js`: after the tupper-channel check, resolve the
  place key, `prepareSpeech(source: "DISCORD")`; on refusal delete the original and
  `handBack` with the refusal text; otherwise post the webhook with the prepared
  content and identity (the existing `postAsCharacterTo` minus its own gates and
  transforms, which move to `prepareSpeech`), `recordSpeech` with the message id,
  then delete the original. The mask rule stays: the original is deleted on every
  path. `/message` and the Speak modal in `interactionCreate.js` follow the same
  three calls (that file's edit is the one archive call site, nothing else).
- `bot/src/events/messageReactionAdd.js`: ✏️ ❌ 🔍 📸 look the row up by
  `discordMessageId` (select `characterId`, `seq`, `placeKey`, `sentAt`,
  `concealedAlias`, `deletedAt`) instead of `recentProxies`; the reactor must be
  the row's character's player (`Character.discordUserId`). ✏️ keeps the DM modal
  but the submit calls `editSpeech`; ❌ calls `deleteSpeech`. Both then leave the
  Discord edit/delete to the outbox. Past the window, DM "That was said more than
  five minutes ago and stands. ‡". 🔍 and 📸 take `characterId` and the alias from
  the row. `recentProxies`, `trackProxy` and `MAX_RECENT` are deleted.
- `bot/src/lib/feedOutbox.js`: handles `op`. `new` as today (now for every place
  kind via `discordTargetForPlaceKey`); `edit` → `editWebhookMessage` when the row
  has a `discordMessageId` and `editedAt > discordSyncedAt`; `delete` →
  `deleteWebhookMessage`. The drain also sweeps rows whose `editedAt` or
  `deletedAt` is newer than `discordSyncedAt`. Since the row is the source of
  truth, a Discord-origin ✏️ also flows through here, so the bot's own
  `webhookClientFor` edit/delete path in `messageReactionAdd.js` goes away.

**web/**
- `web/app/api/feed/say/route.js` → `sayInPlace`. New `web/app/api/feed/edit/route.js`
  and `web/app/api/feed/delete/route.js` (`POST { seq, content? }`) → `editSpeech` /
  `deleteSpeech`, returning the wire row (delete returns `{ seq, deletedAt }`).
- `web/lib/feedHub.js`: on `op: "delete"` fan out `{ op: "delete", seq, placeKey }`
  as `event: delete`; edits fan out as `event: message` with the full row (the
  client replaces by seq). The SSE route forwards both; the high-water rule applies
  to `new` only.
- `web/app/(app)/play/feedStore.js`: `applyRow` replaces an existing seq when
  `editedAt` differs; `removeRow(place, seq)`.
- `web/app/(app)/play/PlayFeed.js`: own rows within the window show ✎ ✕ on hover
  (always on coarse pointers, as a small overflow "⋯" menu). ✎ turns the row into
  an inline textarea (Enter saves, Escape cancels); ✕ goes through `useConfirm()`
  ("Take that back? ‡"). An edited row shows a muted "(edited) ‡" after the time.
- `web/app/(app)/archive/page.js`: `deletedAt: null` in the where.

Verification: edit and delete from the web reach Discord within a second; ✏️ and ❌
on Discord update the web within 200 ms; a reaction after five minutes is refused
on both faces; restart the bot and ✏️ still works on a message posted before the
restart (the point of dropping `recentProxies`).

### Phase 2: every place, and the Hall layout

**Discord side of Decision 5 (system-only Location channels).**
- `db/lib/zoneChannelSpec.js`: `LOCATION_MEMBER_ALLOW` drops `PERM_SEND_MESSAGES`
  (keeps view, send-in-threads, reactions). The 30 s slowmode moves to the Room
  threads' parent? No — thread slowmode is per thread and Discord sets it at
  creation: `startPublicThread`/`startPrivateThread` in `syncZones.js` pass
  `rate_limit_per_user: 30` and the sync re-asserts it on existing threads
  (`PATCH /channels/{thread}`), same as it does `archived: false`.
- `bot/src/lib/channels.js#isDesignatedTupperChannel`: a top-level Location channel
  is no longer a tupper channel; Room threads, Conversations and `#summary` are.
  A top-level message a GM types in a Location channel is left alone.
- `db/lib/channelDoctor.js` `location-occupancy`: when it repairs a member
  overwrite it writes the current `LOCATION_MEMBER_ALLOW` bits, so one
  `npm run db:doctor -- --apply` corrects every existing occupant (add an
  `allow` comparison to the check if it only compares presence today). This
  file has another session's uncommitted edits: touch only the occupancy check.
- CHANNELS.md §2 and §3 reworded: the Location channel is the street's scenery,
  not its speech.

**Conversation membership in the DB.**
- Migration: `PlayerThreadMember (playerThreadId → PlayerThread cascade,
  characterId, createdAt)`, PK on the pair, index on `characterId`.
- Writers: `handleConverseCreate` (creator), `/add` on a Conversation
  (`interactionCreate.js:366-390` area: write the member row at once, keep the
  `PlayerThreadInvite` for the Discord add), the mention-invite in
  `messageCreate.js:254`, and `db/lib/threadInvites.js#applyPendingInvites` (member
  row if missing). `/remove` deletes it. `dawnWipe.js`'s `deletePlayerThread`
  cascades. `db/lib/conversations.js` (new) holds `addConversationMember` /
  `removeConversationMember` / `conversationsFor(prisma, characterId)` so the four
  call sites share one function.

**Access and places.**
- `db/lib/feedAccess.js`: `placesFor(prisma, character)` → ordered list of
  `{ placeKey, kind: "loc" | "room" | "conv" | "zone", name, description, roomKind,
  canSpeak, slowmodeSeconds }`: the Location (`canSpeak: false` now), its public
  Rooms, private Rooms from `accessibleRooms(rooms, ...roomAccessKeys())`, the
  Conversations from `conversationsFor`, then the zone Summary (`zone:`, 300 s).
  `mayReadPlace(prisma, character, placeKey)` derives from it. A GM (`isGm`) may
  read any place inside `visibleZoneIds(prisma, discordUserId)` (null = all) and
  speak nowhere. `db/lib/presenceNotify.js`: `notifyPresence(prisma, characterId)`
  on `bascinet_presence`, called at the end of `applyLocationMoveSideEffects`
  (`locationMove.js`: one added line — another session is editing this file),
  from `syncCharacterRoomAccess` when the entitled set changes, and from the
  Conversation writers.
- `web/lib/feedHub.js` also LISTENs on `bascinet_presence` and calls the
  `onPresence(characterId)` of every stream owned by that character.
- `GET /api/feed` becomes one stream per tab for **all** of the viewer's places:
  `?since=<seq>` only; catch-up sends rows for every allowed place above `since`,
  ordered by seq; the subscription set is the place list; on a presence event the
  route recomputes the list, resubscribes, sends `event: places` with the new list,
  and catches up on any newly visible place from the stream's high-water mark.
- `GET /api/feed/places` returns the list for the page's first render and the
  client's refresh. `POST /api/feed/say` checks `canSpeak` and the place's
  slowmode.

**The Hall.**
- `/play` moves to its own full-viewport layout: `web/app/(app)/play/layout.js`
  renders `.hall-shell` (the `.desk-shell` idea: `100dvh` column, no PageShell) and
  `page.js` renders `.hall-body`, a grid `15rem minmax(0,1fr) 17rem` on desktop.
  Under 720px: one column, the place list becomes a horizontal `.tab-bar` of
  `.tab-item`s with unread dots above the feed, and the right column becomes a
  bottom sheet opened by a ⚡ `IconButton` beside the composer (phase 3 fills it).
  New CSS lives in `globals.css` as the `.hall-*` family, tokens only; run
  `npm run audit:contrast --workspace=web`.
- `PlacesColumn.js`: sections **Here** (the Location, read-only, with a scene
  glyph), **Rooms** (public, then private with a key glyph), **Conversations**,
  **Summary**. Unread dot = the place's newest seq is above the last seq the
  viewer saw there, kept in `localStorage` per place (`hall:seen:<placeKey>`,
  read through `useSyncExternalStore`, written on scroll-to-bottom and on
  selection). The selected place is in the URL hash so a reload keeps it.
- `Feed.js` (PlayFeed generalised): takes the place; the composer is hidden when
  `canSpeak` is false; SYSTEM rows render as `.hall-subtext` (muted, small, no
  avatar); the header shows the place's name, a one-line description with
  "more ‡", and for a Room its `Storage` line (phase 3).
- `feedStore.js`: rows keyed by place already; add the place list, unread, and
  `selected`.
- Wireframes A and B from the 2026-09-06 chat go into HALL.md §5 as ASCII.

Verification: two characters in one Location, one in a private Room the other
cannot enter: the outsider never receives that Room's rows on the stream (assert
by reading the SSE with curl); a Conversation `/add` on Discord makes the feed
appear on the web without a reload; moving Location swaps the place list live; a
GM sees every place of their visible zones and no composer.

### Phase 3: the right column and every button

- `db/lib/whosHere.js` (new): `whosHere(prisma, character)` → `{ named: [{
  characterId, name, roleTitle, avatarPath }], concealed: [{ alias, sprite }] }`,
  the rule `handleWhosHere` applies today, and `handleWhosHere` calls it.
- `HereColumn.js`: **Here** — the named as avatar rows (`CharacterAvatar` 24px +
  presented name + muted role), the concealed as their alias with the hood sprite;
  a row click opens a `.menu` of the people actions the sheet has (Look at, Heal,
  Transfer, Loot, Bind, Free, Harm, Move Player, Bury/Butcher/Engrave for a
  corpse) by mounting `RequestActionsProvider` on the Play page with the people
  pools. Extract those pools from `web/app/(app)/character/page.js` into
  `web/lib/peoplePools.js#loadPeoplePools(character)` and have the character page
  call it too, so the two never drift. The rest of the sheet's pools stay on the
  sheet; `ActionGrid` is not mounted here.
- **The place panel** below it, from `db/lib/placeAffordances.js#affordancesFor(prisma,
  character)` → `[{ id, label, kind, roomId?, linkId? }]`, the same predicates the
  Discord anchor and Room starter rows use (`hasNoticeboard`, `INTERCOM_ROOM_SLUG`,
  `BELL_ROOM_SLUG`, `CENSOR_OFFICE_ROOM_SLUG`, `linksFor` + `gateOperable` +
  `canToggleGate`, `shouldPromptKeyed`, Storage per accessible Room).
  `locationAnchorRows()` and `roomStarterRow.js` read this list too, so a new
  affordance is one entry. Web dialogs, each a `RequestDialog` body and a server
  action in `web/app/(app)/play/actions.js` (all `{ ok, error }`, all resolving the
  character from the session, all through `useActionRunner`):
  - **Travel**: `travelOptions` → pick → `dragCandidates` multi-select → cost line
    (`freeMovesLeft`, `freeZoneMovesReason`) → `performLocationMove`; **Turn
    back** when `travelToLocationId` is set (the plain update `handleTravelTurnBack`
    does, moved into `locationTravel.js#turnBack`).
  - **Examine** (the Location): `describeLocation` readout in a dialog.
  - **Storage** (per Room): `formatStashLine(room)`, with a "Move things ‡" link
    that opens the existing Transfer dialog on that Room.
  - **Noticeboard**: read / tear / pin over `db/lib/noticeboard.js` and the
    paper helpers `noticeboardPanel.js` uses.
  - **Converse**: room pick + name → `startPrivateThread` (REST, from
    `discordRest.js`), `PlayerThread` row, creator's member row; the Discord add
    is skipped for a web-only creator (phase 5).
  - **Bell / Intercom / Turret**: the word field (the match helpers move from
    `bot/src/lib/bellModal.js` / `turretModal.js` into `db/lib/bell.js` /
    `gatehouseTurret.js`), then `broadcastBell` / `broadcastIntercom` / the armed
    flip.
  - **Gate** toggle and **Keyed door**: the transactional flip and the `openUntil`
    update move from `interactionCreate.js` into `db/lib/gates.js`, and the bot
    handlers call it (the anchor redraw stays a bot-side follow-up).
- **You** strip: **Move** (a dialog with the kind radio and body; the `Action`
  row creation moves from `handleMoveSubmit` into `db/lib/moves.js#fileMove` and
  the bot calls it), the turn line (`TurnChip`), **Sheet ›**, and **Report to
  the GMs ‡** (a text dialog that writes an INBOUND `DirectMessage` row with a
  `[Play]` prefix so it lands in `/gm/players`).
- **Waiting on you ‡**: a small panel listing pending offers (`db/lib/offerRow.js`),
  threat spawns, bird letters awaiting reply, and a lobby assignment, each with
  Accept/Decline calling the same db/lib functions the DM buttons call.
- Mobile: the ⚡ sheet holds the place panel and the You strip; **Here** is an
  avatar strip under the place header that opens the same menu.

Verification: `npm run dev:check` for `/play` as player, GM, anon; every dialog
exercised once against the live DB with the dev session; a gate toggled on the
web redraws the Discord anchor.

### Phase 4: the world writes rows

- `db/lib/scene.js#sceneLine(prisma, { placeKey | locationId | roomId | zoneId,
  text, lines })` records a `MESSAGE` row with `source: SYSTEM`, no character,
  `content` = the plain text (no `-#`), and notifies. The Discord poster keeps
  using `ambientLine()` for its `-#` rendering; the web renders SYSTEM rows as
  subtext itself.
- Every poster in the table gets the row beside its Discord post: `ambientEverywhere`,
  `broadcastSound` (one row per Location that hears it, with the distance
  wording), `announceGateCrossing` (zone), `broadcastIntercom` (one row per zone),
  `broadcastBell` (via sound), `announceTurretBurst`, `runDeathSmell`,
  `noticeboardPanel` pin/tear, `announceInRoom`, the whisper poll's line, the
  staged public summaries in `advanceTurn` (one row per zone, `SYSTEM`), and the
  turn announcement (a `TURN_START` row per zone with `placeKey: zone:`).
- `/archive` hides `source: SYSTEM` rows behind the existing "speech" toggle so the
  transcript does not double up on lines it already folds.

### Phase 5: the "web only" switch

- Migration: `Character.webOnly Boolean @default(false)`,
  `Character.webOnlyChangedAt DateTime?`, `GameConfig.webOnlyCooldownSeconds Int
  @default(7200)`.
- `db/lib/webOnly.js#setWebOnly(prisma, character, on)`: the atomic
  `updateMany` cooldown guard from `locationTravel.js`; returns `{ ok, readyAt }`.
  **ON**: `revokeAllCharacterAccess(prisma, character, { keepGuests: true })` (new
  option: RoomGuest rows are game state, not Discord state), clear
  `Character.roomThreadRoomIds`, `removeThreadMember` for every
  `PlayerThreadMember`, delete the turn-ping role? No — keep it, it is a DM.
  **OFF**: `materializeDiscordPresence(prisma, character)` (new in
  `locationMove.js`, the Discord half of `applyLocationMoveSideEffects` for the
  current location: overwrite, zone role, narrowcast, `syncCharacterRoomAccess`,
  Conversation thread adds from `PlayerThreadMember`, `applyPendingInvites`).
- The flag gates every re-materialiser: `locationMove.js` (skip the Discord half),
  `channelDoctor.js` (`location-occupancy`, zone `role-membership`,
  `room-membership`, `narrowcast` should-have sets exclude `webOnly`),
  `roomAccess.js#syncCharacterRoomAccess` (entitled = ∅ when webOnly, feed access
  unaffected because `placesFor` reads `accessibleRooms` directly),
  `threadInvites.js#applyPendingInvites` (skip, keep the invite), the Conversation
  writers (member row yes, thread add no), nickname sync (skip), the
  `character_created` placement. A Haiku sweep of every `putChannelOverwrite`,
  `addThreadMember`, `addRoleToMember` caller is the acceptance check.
- Bio: a `Switch name="webOnly"` after the turn-ping switch in `AvatarField.js`,
  label **Play from the web ‡**, help *Your Discord account leaves every room
  channel, so nobody can see who you are. You play from the Play page instead.
  Switching cools for two hours. ‡*; `updateCharacterProfile` calls `setWebOnly`
  when the value changed and surfaces `readyAt` as the error.
- `/play` shows a quiet `.chip` "Playing from the web ‡" in the places column when
  on. CHANNELS.md §3 and CHARACTERS.md get a paragraph each.

Verification: flip ON as a test character: the account vanishes from the Location
sidebar, the zone role, every thread, `#turns`; `npm run db:doctor` (dry) proposes
nothing for them; the web feed still shows every place. Flip OFF: everything
returns and no "added to the thread" notice survives. A second flip inside two
hours is refused with the time left.

### Phase 6: typing, markdown, the wipe, mentions, the GM view

- **Typing.** `GuildMessageTyping` intent in `bot/src/index.js`; a `typingStart`
  handler maps user → ALIVE character → place key and `NOTIFY bascinet_typing`
  `{ placeKey, characterId }`. `POST /api/feed/typing { place }` does the same from
  the web, at most every 4 s per tab. The hub fans `event: typing` to that place's
  streams with the **presented** name resolved server-side. The client shows "X is
  typing… ‡", "X and Y are typing… ‡", "Several people are typing… ‡" for 6 s after
  the last event, never for the viewer's own character.
- **Markdown.** `web/app/components/ChatMarkdown.js`: `react-markdown` +
  `remark-gfm` + `remarkTokens` + a small remark plugin for `||spoiler||` (click
  to reveal), `-#` subtext lines, and quoted speech: any `"…"` span becomes
  `<span class="speech">` coloured by a new `--speech` token declared in every
  theme block (a warm lift of `--text`; gate it at AA with the audit). Parsed once
  per row on arrival (store the tree, not the string). `MarkdownContent` stays for
  DMs.
- **Mentions.** Composer `@` autocomplete over `whosHere().named`; inserts
  `{char:<id>}`; `CharacterMentionsProvider` mounted on the Play page with that
  roster so the chip renders; the outbox rewrites `{char:<id>}` to `<@&roleId>`
  for Discord (renders as a chip, notifies nobody, per PROXYING §6) and calls the
  relay DM path (`bot/src/lib/mentions.js#notifyMentioned`) for web-origin rows;
  Discord-origin `<@&roleId>` is rewritten to `{char:<id>}` in `prepareSpeech`.
  A mention chime on the web via `chime.js`, muted by its own `hall-chime-muted`
  key.
- **The dawn wipe.** `GameConfig.feedWipeSeq BigInt @default(0)`; `runDawnWipe`
  sets it to the current max seq; `placesFor` feeds and the catch-up read `seq >
  feedWipeSeq` when `messageWipeEnabled`; the `#summary` and `wipe: clear`
  channels follow the same watermark since their rows share it.
- **GM view.** The player desk's inspector gains a **Scene ‡** tab: the `Feed`
  component read-only on the character's current Location and Rooms, through the
  same stream (the GM gate from phase 2).
- **Deferred, on purpose:** Web Push (needs VAPID keys, a service worker, and iOS
  install guidance — its own change), attachments, a Discord-side "Bascinet is
  typing" echo.

