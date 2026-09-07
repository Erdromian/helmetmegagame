# The Hall: the web face of a scene (`/play`)

The web page where a character reads and speaks in the place they stand,
mirroring the Location's Discord channel. Phase 0 shipped 2026-09-06; the rest
of this document is the design it is growing into, so a later phase does not
re-decide it.

## 1. Why it exists

Two reasons, and both are Bascinet's.

- **Anonymity.** A Discord channel's member sidebar lists every account that
  can see it, and a Location channel is opened with a per-member overwrite
  (`CHANNELS.md` §3). Standing in the Keep tells everyone else in the Keep
  which Discord account you are. Nothing short of not being there fixes that,
  which is what the "web only" switch (§6) will do.
- **A face that feels instant.** Earlier web UIs felt slow because a send went
  through a server action, a `revalidatePath`, and a re-render of the whole
  server-component tree. Chat cannot use that path. This page does not.

## 2. One write path, and the record it writes

Everything a character says goes through **`db/lib/say.js`**, on both faces.
Before phase 1 there were three copies of the decision — the proxy ran the
speech gate, the babble pass and the autocorrect pass inside the webhook
poster, the Speak modal ran a second copy of the gate, and the web's say route
ran neither — so `{tag:stupid}` garbled a Discord message and left a web one
perfectly articulate.

It splits into deciding and writing, because the two faces need the same
decision in a different order:

- `prepareSpeech` — where you are (a web send only; Discord's own channel
  permissions are the gate for a Discord one), the speech block, length, the
  slowmode (web only, none in a Room or Conversation, 300 s in a zone summary), then the babble and
  autocorrect transforms and the presented identity.
- `recordSpeech` — the `ArchiveEntry` row, with the place key, the source and
  the alias.
- `sayInPlace` — both, for the web. **Discord** goes prepare → post the webhook
  → record with the message id; **the web** goes prepare → record, and the
  outbox posts it after.

`editSpeech` and `deleteSpeech` sit beside them with the **five-minute window**
(`EDIT_WINDOW_MS`, Bascinet's call) and the ownership check, and a GM passes
`{ gm: true }` to skip both. An edit re-runs the transforms; a delete is soft.
Neither touches Discord — §4 does.

### The record: every message is a row first

`ArchiveEntry` was already written for every proxied message
(`ARCHIVE.md`). Phase 0 added the columns that make it a live feed:

| Column | What it is |
|---|---|
| `seq` | `BIGSERIAL`, the cursor. Monotonic and assigned by Postgres, so the bot and the web never need to agree on a clock. A BigInt in Prisma: it crosses JSON as a **string** and is compared with `BigInt()`, never `Number()`. |
| `placeKey` | Where it was said: `loc:<id>`, `room:<id>`, `conv:<playerThreadId>`, `zone:<id>`. A snapshot string, no FK. `db/lib/placeKey.js` is the only thing that mints one; `placeKeyForChannel` resolves a Discord channel or thread id to one, memoised for a minute. |
| `source` | `DISCORD`, `WEB` or `SYSTEM`. The outbox (§4) only ever posts `WEB` rows on to Discord, which is what keeps a proxied message from being echoed back into the channel it came from. |
| `editedAt`, `deletedAt` | Soft delete everywhere since phase 1, so a client holding the row can reconcile and the outbox has something to read when it goes to remove the Discord message. `/archive` and `/play` filter on `deletedAt`. |
| `discordSyncedAt` | The outbox watermark. Null on a `WEB` row means the bot has not posted it yet. |

`recordArchiveMessage` / `recordArchiveEvent` (`db/lib/archive.js`) write
`placeKey` and `source`, then run `SELECT pg_notify('bascinet_feed', …)` with
the row's seq, place key and `op` — `new`, `edit` or `delete`
(`db/lib/feedNotify.js`). After the insert, never inside it: a listener woken before the commit would look the row up and find
nothing. The payload is tiny on purpose; every reader loads the row and
re-checks who may see it.

### What the world says is a row too

Since phase 4, an ambient line writes an `ArchiveEntry` beside the Discord
post it already made — `source: "SYSTEM"`, no character, `channelKind:
"scene"`, and the plain sentence with **no `-#`** in it. The prefix is
Discord's way of rendering subtext; the web renders a SYSTEM row as
`.hall-subtext` itself, so storing it would put literal `-#` on the page.
`db/lib/scene.js#sceneLine` / `#sceneLineAt` is the one writer, best-effort
like every other archive write.

Beside, never instead: the poster still posts. And never through the outbox,
which handles `WEB` rows only — a SYSTEM row can no more be re-posted into the
channel it came from than a proxied one can.

| Poster | Where the row lands |
|---|---|
| `worldBroadcast.js#ambientEverywhere` | every Location |
| `worldBroadcast.js#broadcastToZones` | every zone |
| `soundBroadcast.js#broadcastSound` (so the Cathedral bell too) | one row per Location in earshot — the same words at every distance, since a bell never muffles and all the distance decided was the `-#` |
| `locationMove.js#announceGateCrossing` | the destination zone |
| `intercom.js#broadcastIntercom` | one row per zone in range, the `@here` left off — a notification is not part of what was said |
| `turretBurst.js#announceTurretBurst` | the gun's Location and its neighbours |
| `deathSmell.js#runDeathSmell` | each Location that stinks |
| the noticeboard's pin and tear, on **both** faces | the Location |
| `roomAnnounce.js#announceInRoom` | the Room |
| `whisperPoll.js` | the Room, one line per fifteen minutes |
| `advanceTurn`'s staged public declarations | the declaration's zone |
| the turn opening | one `TURN_START` per zone, `placeKey: zone:<id>`, so every zone feed carries the day line |

The intercom used to write a single row from the Speak handler with no place
key at all. It read correctly in `/archive` and was invisible in the Hall,
because a zone feed can only show a row filed against its own place key — so
it is one row per zone now.

`/archive`'s **Speech** view hides them (`source: { not: "SYSTEM" }` beside the
`MESSAGE` filter, with `TURN_START` kept for the day divider). The events those
lines narrate already fold into the muted `<details>` under **Everything**, and
printing both would show every arrival twice.

## 2a. Conversation membership is a row now

`PlayerThreadMember (playerThreadId, characterId, createdAt)` — primary key on
the pair, cascading with its `PlayerThread`, indexed on `characterId`.

Until phase 2 the answer to "who is in this conversation" lived **only in
Discord**, as a thread member list. Two things were wrong with that. The web
feed could not read it without a REST call per conversation per render, and a
player whose Discord account is out of the channels entirely — the phase 5
"web only" switch — could not be in one at all.

So the row is the truth and **Discord's thread membership is its projection**.
Every writer records the row first and then adds the account:

| Writer | Where |
|---|---|
| Converse | `handleConverseCreate`, the creator |
| `/add` on a conversation | `bot/src/events/interactionCreate.js` |
| A mention into a conversation | `bot/src/events/messageCreate.js` |
| The invite replay on arrival | `db/lib/threadInvites.js#applyPendingInvites` |
| `/remove` | deletes the row |

All four go through `db/lib/conversations.js` —
`addConversationMember` / `removeConversationMember` / `conversationsFor` —
which is also what fires the presence notify (§3), so a `/add` on Discord makes
the conversation appear on the target's web page with no reload.
`PlayerThreadInvite` stays beside it and keeps its old job: it is what replays
the **Discord** add when the target finally walks into the Location.

The dawn wipe needs no new step — `deletePlayerThread` cascades.

## 3. Realtime: server-sent events from the web process

`web/lib/feedHub.js` keeps **one** `pg.Client` per web process (on
`globalThis`, the same trick as the Prisma singleton, so `next dev` does not
leak a listener per hot reload). It holds **two** LISTENs on that one client —
`bascinet_feed` for messages and `bascinet_presence` for place changes — with
one reconnect and one backoff between them, and a map of place key → open
streams beside a map of character id → open streams.

`GET /api/feed?since=` is **one stream per tab, for every place the viewer may
read**. Phase 0 opened a stream per place, which was fine when there was one;
a Hall has a Location, its Rooms, the conversations you are in and the zone
summary, and a browser allows six connections per origin — two tabs would have
starved the rest of the site.

The stream's order is: send the place list, catch up (`seq > since` across
every allowed place), then subscribe. Doing the read before the subscribe would
leave a gap a row written in between could fall into. It drops anything at or
below the last seq it sent, and writes `: ping` every 25 s so Railway's proxy
keeps the connection.

Three event names now. `message` carries a whole row (a new one, or an edited
one the client replaces by seq); `delete` carries a seq and its place and
nothing else — the words somebody took back never come back down the wire; and
`places` carries the whole place list. Only a new row moves the high-water
mark, since an edit and a delete both name a seq the stream has already sent.
The browser's `EventSource` reconnects on its own, and the client's cursor
makes the reconnect repeat nothing.

**Presence.** `db/lib/presenceNotify.js#notifyPresence(prisma, characterId)`
carries a character id and nothing else, because "which places may they see
now" is a query the listener has to run again anyway — and running it on the
reader's side is what keeps a notification from being an authorisation. Three
things fire it: the feet (`applyLocationMoveSideEffects`), a key
(`syncCharacterRoomAccess`, only when the entitled set actually changes), and
being let into or out of a conversation (`db/lib/conversations.js`). The
stream recomputes its place list, moves its subscriptions, sends `places`, and
catches the newly visible places up from its own high-water mark rather than
from zero — so walking into a room does not replay a day of it. The page asks
for that with `GET /api/feed/history?place=` when the reader actually opens it.

`GET /api/feed/places` answers the same list on its own, for a client that has
reason to think it moved and no stream open to be told.

**`?place=`** narrows a stream to one place. The GM desk's Scene tab (§8) is
what asks: a GM's place list is every place in every zone they may see, and
subscribing to hundreds of them to watch one room is silly. It narrows the
subscription and nothing else — the place still has to be in `placesFor`.

**Typing.** A third channel, `bascinet_typing`
(`db/lib/typingNotify.js#notifyTyping`), carrying `{ placeKey, characterId }`
and no name. Two things raise it: `bot/src/events/typingStart.js` (the
`GuildMessageTyping` intent, not a privileged one; never in a DM and never for
a web-only character) and `POST /api/feed/typing { place }` from the composer,
gated by `mayWritePlace` and throttled to one notify per character per place
per 4 s in the route. The hub holds the LISTEN on the same single pg client as
the other two, resolves the **presented** name itself
(`loadForcedName`/`loadConcealment` + `presentedIdentity`, memoised 30 s per
character) and fans `event: typing` `{ placeKey, characterId, name }` — never
to the viewer's own character.

The name is resolved on the READER's side for the same reason the presence
payload carries nothing: a notify that shipped a name would let a typing event
out a name the reader is not owed. A concealed character types under their
alias, exactly as they speak under it.

The client holds each person for 6 s after their last event
(`play/typingStore.js`) and draws one line above the composer: *"X is typing…
‡"*, *"X and Y are typing… ‡"*, *"Several people are typing… ‡"*. Three is
where naming people stops helping. A Discord-side echo of a WEB typist is
**not** built — Discord has no API for a bot to type as somebody else.

**Why not a WebSocket service.** Sends are an ordinary `POST` either way, and
the optimistic append hides their latency, so bidirectional traffic buys
nothing. Railway runs `next start` as one long-lived Node server with one
replica. Revisit only if that ever becomes more than one.

## 4. The outbox: the bot owns Discord

`bot/src/lib/feedOutbox.js` is the **only** thing that posts, edits or deletes
a webhook message — since phase 1, on either face. The web never holds a
Discord token for chat, and neither does the reaction handler: a ✏️ or a ❌ in
Discord writes the row and lets the outbox do the rest.

Three verbs, chosen off the **row** rather than off the notification's `op`
(the op is a hint; the drain has no op at all):

| Row looks like | The outbox |
|---|---|
| `source = WEB`, no `discordMessageId` | Posts it through `db/lib/discordRest.js#postAsCharacter`, loading the forced name and concealment the way `messageCreate.js` does, and stores the id. |
| `editedAt` newer than `discordSyncedAt` | `editWebhookMessage`. |
| `deletedAt` newer than `discordSyncedAt` | `deleteWebhookMessage`. The row and its `discordMessageId` stay, so nothing ever reposts what somebody took back. |

Everything runs through one serialised queue — two posters against one channel
webhook would interleave a scene — and every verb **re-reads the row right
before acting** and stamps `discordSyncedAt` after, so a row picked up twice
acts once. `drainFeedOutbox()` sweeps the last 24 h on `ready` through that
same queue, which is what makes a bot restart mid-send, mid-edit or
mid-delete harmless.

Every place kind is wired: `db/lib/placeKey.js#discordTargetForPlaceKey` gives
back `{ channelId, threadId }`, because a Room or a Conversation is a thread
and Discord will not hang a webhook off one — the webhook belongs to the parent
channel and the call carries `?thread_id=`.

Discord-origin messages take the old path: proxy, webhook, then the row, now
stamped with `placeKey` and `discordSyncedAt`. The web hears about them from
the same NOTIFY.

## 5. The page

`web/app/(app)/play/`. Rail item **Play**, right under Character
(`web/lib/navItems.js`). Since phase 2 it has **left PageShell**: the Hall owns
its whole screen the way the `(desk)` workspaces do, as the `.hall-*` family in
`globals.css` — a `100dvh` column whose regions scroll inside it, because a
chat that scrolled the document would drag the header off the top every time
somebody spoke. Tokens only; `npm run audit:contrast --workspace=web` gates it
like everything else.

### The wireframes Bascinet chose

Desktop, three columns — `15rem minmax(0,1fr) 20rem`. The right column grew
from 17rem in the second pass: it is the game suite now, not a button strip.

```
┌───────────────┬────────────────────────────────────────────┬──────────────────────┐
│ PLACES        │ Council Room                     ◔ Dusk 4  │ THE KEEP             │
│               │────────────────────────────────────────────│ Fortress             │
│ ▤ Summary   ● │                                            │ [Place] [Zone]       │
│               │ ◉ Alexandra Hristov  13:58                 │ A high hall of black │
│ ▸ The Keep    │   Nobody saw it leave.                     │ stone; the winch for │
│   Council     │                                            │ the gate is in the   │
│   Kitchens  ● │ ──────────────── NEW ─────────────────────│ tower.               │
│   ▪ Vault     │                                            │ [Noticeboard]        │
│               │ ◉ Knife Hristov  14:02             ✎  ✕   │──────────────────────│
│ » Alexandra   │   "Where did the tithe go?"                │ HERE · 3             │
│               │                                            │ ◉ Knife Hristov  you │
│               │ ◉ Alexandra Hristov  14:03        🔍  📷   │ ◉ Alexandra      🔍  │
│               │   Ask the Censor.                          │ ◉ a hooded figure 🔍 │
│               │                                            │──────────────────────│
│               │ · Alexandra is typing…                     │ THIS ROOM            │
│               │────────────────────────────────────────────│ Storage · 2 loaves,  │
│ 🔔  web-only  │ [ Say something in Council Room…         ] │ a key   [Move things]│
│               │                                  4 s       │ [Intercom]           │
│               │                                            │──────────────────────│
│               │                                            │ TRAVEL · 1 free      │
│               │                                            │ ┌────────┐┌────────┐ │
│               │                                            │ │Gatehse ││Road    │ │
│               │                                            │ │FORTRESS││FOREST  │ │
│               │                                            │ │free    ││the turn│ │
│               │                                            │ └────────┘└────────┘ │
│               │                                            │ ┌────────┐           │
│               │                                            │ │Barracks│           │
│               │                                            │ │FORTRESS│           │
│               │                                            │ │shut    │           │
│               │                                            │ └────────┘           │
│               │                                            │──────────────────────│
│               │                                            │ YOU                  │
│               │                                            │ [Move…] [Sheet ›]    │
│               │                                            │ Waiting on you · 1   │
│               │                                            │ Report to the GMs    │
└───────────────┴────────────────────────────────────────────┴──────────────────────┘
```

Under 720px, one column — the places column becomes a `.tab-bar` of
`.tab-item`s with unread dots, **HERE** is an avatar strip under the place
header, and the rest of the right column comes up as a bottom sheet from the
⚡ button beside the composer:

```
┌────────────────────────────────────┐
│ ‹ Town · The Keep                  │
│ A vaulted hall, damp and… more     │
│────────────────────────────────────│
│ Keep● | Throne | Cellar● | Old Tom●│
│────────────────────────────────────│
│ -# Somebody has entered from the   │
│    Square.                         │
│ ⊙ Cersei · Baroness         12:04  │
│   "Shut the door behind you."      │
│                                    │
│ ⊙ a young man               12:05  │
│   *pulls his cloak tighter*        │
│────────────────────────────────────│
│ ▢ Say something…            ⌤   ⚡ │
└────────────────────────────────────┘
```

…and ⋯ opens the sheet, which is the same five sections in the same order the
column draws them, minus HERE (the phone has the avatar strip under the place
header instead).

### The parts

- **`Hall.js`** holds the one `EventSource`, the place list, and which place is
  open. The open place lives in the **URL hash**, so a reload keeps it and Back
  leaves the room the way it came; it is read through `useSyncExternalStore`
  over `hashchange`, never an effect. A hash naming somewhere you have left
  falls back to the first place.
- **`PlacesColumn.js`** draws **Here** (the Location), **Rooms** (public, then
  the private ones a key or a guest row opens, marked `▪`), **Conversations**,
  **Summary**, and exports `PlacesTabs` — the same list as the phone's
  `.tab-bar`. Only one of the two is ever drawn.
- **The unread dot** is one comparison: the newest seq said in a place against
  the newest seq this browser has seen there. The first half comes down with
  the place list (`newestSeq`, a string — the column is a bigint) and from
  whatever the tab has heard live; the second is `hall:seen:<placeKey>` in
  `localStorage`, read through `useSyncExternalStore` in `seenStore.js` and
  written when the reader scrolls to the bottom, never merely on selection.
  It only ever moves forward.
- **`Feed.js`** (phase 0's `PlayFeed.js`, generalised) draws one place: its
  name, a one-line description with **more ‡**, the runs, and the composer.
  Enter appends the pending row in the same frame and clears the box; the POST
  swaps the real row in behind it. A failed send stays on screen as "Not sent.
  Retry". Runs group one speaker's messages within seven minutes, the same rule
  as `DmThread.js`. The list scrolls itself, never the document, and only while
  the reader is already at the bottom; otherwise a "New messages" pill. On a
  coarse pointer, Enter is a newline and a Send button appears, as in Discord's
  app. An edited row says "(edited)" after the time.
- **The row action bar** (`.hall-row-actions`) floats at a row's top-right the
  way Discord's does — absolute, over the corner, so appearing on hover never
  reflows the sentence under it. Shown on hover with a mouse and always on a
  touch screen, and never on a row that has not confirmed yet. What it holds
  depends on whose line it is:

  | Row | Buttons |
  |---|---|
  | Yours | ✎ **Change** · ✕ **Take back**. The five-minute window is checked when the button is pressed, not while the page sits open, and again by `deleteSpeech`. Take back goes through the shared `useConfirm()`. |
  | Somebody else's | 🔍 **Look at** — the SHEET's own Examine dialog, opened with the speaker already chosen; and 📷 **Photograph**, only while the sheet holds an `instant-camera`. |
  | Any row, viewer is a GM with no character | ✕ **Remove**, confirmed, through the same `/api/feed/delete` route with `{ gm: true }`. |

  **The eye is offered only on a row that carries the speaker's own name.** A
  row written under an alias — a hood, or a forced name — has `alias` set
  (`db/lib/archive.js#feedRowShape`), and opening a dialog on its character id
  would be looking a hood up BY ID, which is the whole thing the token in
  `whosHere.js` exists to prevent. The eye on that person is in HERE instead,
  where it goes through `examineHooded`.

  **The camera has no such problem**, and is offered on a hood's line too: it
  is pressed against a **seq**, the server resolves the speaker itself, and
  what it prints is the impoverished concealed readout — the hood the ROOM SAW
  at the time, not the one they are wearing now (`examineReadout`'s
  `wasConcealedAs`). `photographRow(seq)` in `play/actions.js` is the web twin
  of the 📸 reaction and mirrors it exactly: blind refuses, no camera refuses,
  the viewer's own sight is stripped (`viewerTags: []`, an empty `satisfied`)
  so a surgeon's photograph carries no diagnosis, and `mintPhoto` files the
  print as an ephemeral Tag row. **One shot per line per photographer**,
  because nothing is spent and a second press would otherwise mint a second
  permanent catalog row: the bot keeps that bound in memory, which a restart
  empties and a web process cannot share, so this face keeps it as an
  `AuditLog` row — `photo_taken`, with the seq in `details`. No `turnId`: that
  column is for the per-turn rations, and this ration is per line.

  **GM remove** is the same route the player's Take back uses. It pays for the
  `isGm` REST check only when there is no living character to be, writes a
  `gm_feed_remove` audit row after the removal, and a GM who DOES have a living
  character takes the player path — the rule `loadFeedViewer` already applies.
- **The words themselves go through `ChatMarkdown.js`**, not
  `MarkdownContent.js` — that one stays exactly as it is for DMs. It is
  `react-markdown` + `remark-gfm` + `remarkTokens` + **`remarkChat.js`**, which
  adds the three things a chat line does that a document never does:
  `||spoilers||` (a `.chat-spoiler` button, click to reveal, stays revealed),
  `-#` subtext lines, and **quoted speech** — a `"…"` span becomes
  `<span class="speech">`, tinted with the `--speech` token declared in every
  theme block and gated at AA by `npm run audit:contrast`. The tint is there
  because a Hall row is narration and dialogue mixed, and the words somebody
  actually said are what a reader scans for. Plugin order is load-bearing:
  `remarkChat` runs **before** `remarkTokens`, or a mention in the middle of a
  quote splits the text node and the quote stops matching itself.
- **Mentions are `{char:<id>}` in the row, on both faces.** The composer's `@`
  autocomplete (`MentionMenu.js`) runs over `whosHere().named` — the people
  standing here, concealed ones deliberately absent — and inserts the token;
  `CharacterMentionsProvider` is mounted on the page with the same roster, so
  the chip renders back. What crosses to Discord is `<@&roleId>`, rewritten by
  the outbox; what comes back from Discord is rewritten to the token in
  `prepareSpeech`. See PROXYING.md §6 and `db/lib/characterMentions.js`.
  Being named rings the shared `chime.js`, muted per browser by
  `hall-chime-muted` (`useHallChimeMuted.js`) with the toggle at the foot of
  the places column.
- **A `SYSTEM` row renders as `.hall-subtext`**: muted, small, no face. That is
  the web half of the `-#` those lines go out as on Discord
  (`db/lib/ambientLine.js`). Phase 4 is what actually writes them.
- **The composer is hidden where `canSpeak` is false** — every place for a GM,
  and the Location for everybody (§5a). In its place, one line saying so.
- **`HallAside.js`** is the right column — and, under 720px, everything
  inside the ⋯ sheet. One component either way, because the phone's version
  is the same sections in the same order; only the box around them changes,
  and the sheet is a `Modal` wearing `.hall-sheet` rather than a drawer of its
  own, so it keeps Escape, the focus trap and the backdrop `Modal` already
  owns. It composes five sections, top to bottom, and owns the affordance list
  they share through `usePlaceActions`:
  1. **`PlaceCard.js`** — the Location's name, its zone muted under it, a
     `Place` / `Zone` chip pair and the chosen text, always on the page inside
     a scrolling `max-height`. **Place** is `Location.description` plus the
     `examineLines` (`db/lib/examineLocation.js`) the page renders server-side;
     **Zone** is `Zone.description`, which nothing on the web drew before.
     Under the text, the Location's own fixtures — the noticeboard, a gate a
     watchtower opens to this character, a keyed door they hold the key to —
     and **Converse**, which is otherwise only reachable from a person's row
     in HERE and so left somebody standing alone with no way to open one.
     The old **Examine** dialog is gone: this is what it said.
  2. **`HereList.js`** — everyone standing here, hooded or not, off
     `db/lib/whosHere.js#whosHere`. A row is a 24px avatar, the presented name
     (their Role for a fellow member of a real faction, `you` on your own) and
     an eye at the row's right edge that opens **Look at** in one click. The
     name opens a `.hall-menu` of the SHEET's own people dialogs — Look at,
     Heal, Transfer, Loot, Bind, Free, Harm, Move Player, **Converse** — by
     mounting `RequestActionsProvider` on the page with the people pools and
     calling `open(mode, null, { targetId })`. Nothing is forked: same
     dialogs, same server actions. A hood gets the same row and the same eye;
     its menu is Converse alone. Looking at a hood goes through
     `examineHooded(token)`, where the token is an HMAC of the character id
     keyed with `AUTH_SECRET` (`whosHere` mints it, `resolveHoodToken`
     resolves it over the people actually standing here) — so the browser is
     handed a handle it can send back and never a name. The metagaming rule
     (`actionRegistry.js`) still holds: no row is greyed for a fact about the
     person it names.
  3. **`RoomPanel.js`** — drawn only when the OPEN place is a Room, and it is
     the fix for the Intercom-in-every-Keep-room complaint. `affordancesFor`
     answers what this character can do where they stand, which at a Location
     with six rooms is six rooms' buttons at once; the panel groups by
     `roomId` and shows the open one. Its storage line comes from
     `readStash`, with **Move things** opening the sheet's Transfer preset to
     `room:<id>`, and then that room's own fixtures — Intercom in the Council
     Room, the Bell in the tower, the red Turret in the Censor's office.
  4. **`TravelNodes.js`** — the ways out as a grid of square nodes, two to a
     row, off `loadTravel`. Each node carries the destination, its zone in
     small caps and one foot line: `free` for a local hop or a crossing with a
     free move left, `the turn` for a crossing that spends the Move and lands
     next turn (MAP.md §3), and `shut` / `locked` / the refusal for one that
     will not open — dimmed, still drawn, because knowing the way is there and
     shut is what sends you to find the winch. A zone crossing is tinted. The
     header is `Travel · N free` with `freeReason` as its title. Clicking a
     node opens an inline confirm strip under the grid — the sentence, the
     drag-along chips, `Go` and `Cancel` — not a modal. While
     `travelToLocationId` is set the grid is replaced by "Leaving for X at the
     turn" and **Turn back**.
  5. **`YouPanel.js`** — below.
- **`PlacePanel.js`** is no longer a panel. It is `usePlaceActions()` plus the
  dialogs the sections open: Noticeboard, Converse, Bell, Turret, Intercom.
  The hook owns the affordance list and the refresh rule — anything that
  changes a label a button wears re-reads the whole list rather than patching
  a row, which is what keeps this column and the Discord anchor saying the
  same thing. The web filters the ids `travel`, `whosHere`, `secretRooms` and
  `examine` out of that list; they stay in
  `db/lib/placeAffordances.js` for the anchor, which has no column beside it.
- **`YouPanel.js`** draws **YOU**: the Move dialog (`db/lib/moves.js#fileMove`,
  the same call the `#turns` console's modal makes), a link to the sheet,
  **Report to the GMs** and **Waiting on you**. Report writes an INBOUND
  `DirectMessage` prefixed `[Play] ` and sends nothing to Discord, so it
  lands in `/gm/players` beside everything else that player has said and the
  answer comes back down the ordinary DM path. Waiting on you lists the
  pending offers, threat spawns, unanswered bird letters and a lobby
  assignment; Accept and Decline call the **same** `db/lib` functions the DM
  buttons call (`lessons.js`, `bind.js`, `confession.js`, `threatSpawn.js`,
  `lobby.js`), so an answer given here and one given in Discord are one
  answer, and the second surface finds nothing left to answer.
- **`web/lib/peoplePools.js#loadPeoplePools`** is the one build of every
  people pool — the roster standing here, the medical gate, the Loot / Move /
  Bind / Harm lists. It came out of `character/page.js`, which calls it too:
  a second copy of "who is helpless" would have been a second answer.
- **The right column refreshes on a MOVE, not on a timer.** Everything in it
  — the place card, the Examine lines, who is here, the rooms a Transfer can
  reach — is a server prop off `page.js`, so `TravelNodes`' Go and Turn back
  and the stream's own `places` event all call `router.refresh()`. That event
  fires only when the viewer's own presence changed, and the feed store is
  client state, so a refresh costs nothing that was on screen. ‡
- **One aside is ever mounted.** The right column and the phone's ⋯ sheet are
  the same `HallAside`, and CSS hiding the column under 720px still left both
  live — two travel loads, two stash reads, two affordance states. `useNarrow()`
  picks one; the CSS rule stays as belt and braces. ‡
- **`feedStore.js`** is a module-level store read through
  `useSyncExternalStore`, modelled on the GM inbox's `liveInbox.js`. Confirmed
  rows are keyed by seq, pending rows by a client id, both per place. A
  confirmed row carrying the same client id evicts its pending twin,
  **whichever of the stream or the POST answer arrives first** (the stream
  usually wins). It also holds the place list and which places have had their
  history fetched.

### 5a. Who may read and speak where

`db/lib/feedAccess.js#placesFor(prisma, character, { gm, discordUserId })` is
the **one** answer, and `mayReadPlace` / `mayWritePlace` derive from it rather
than the other way round — a rule that only exists in the list could never
disagree with the rule that guards a send. The web routes and `db/lib/say.js`
both call these; no route re-implements them.

Each entry is:

```
{ placeKey, kind: "loc" | "room" | "conv" | "zone", name, description,
  roomKind, canSpeak, slowmodeSeconds, newestSeq }
```

in the order the column draws them: the Location, its public Rooms, the private
Rooms `accessibleRooms` opens (keys **and** guest rows, the same door every
other reader of that function sees), the conversations `conversationsFor` says
you are in **at this Location**, then the zone Summary. `newestSeq` is added by
`web/lib/feedAccess.js`, not by the rules — the dot is a page concern.

Two things are read-only:

- **A Location is scenery, not speech** (§5b). `canSpeak: false`, no composer.
- **A GM speaks nowhere.** A GM with no living character gets a read-only Hall
  over every place inside `visibleZoneIds(prisma, discordUserId)`
  (`db/lib/gmZoneView.js`; no rows means every zone). Watching is not standing
  there — a GM who wants to say something says it as a GM.

Slowmode is 300 s per character in a zone summary and nothing anywhere else,
enforced in `prepareSpeech` by the character's newest row there. Discord's
channel slowmode is the same: five minutes on `#summary`, none on a Room
thread, which `db:sync-zones` asserts as `rate_limit_per_user: 0` on every pass
(§5b).

### 5b. Decision 5: the Location channel is scenery

Bascinet, 2026-09-06 evening. A Location channel is the open street. What lands
there is arrivals, smells, the turret, the noticeboard, the turn line — and
talk belongs in a Room thread, a Conversation or the zone summary, all of which
are a scene somebody chose to be in. Four changes carry it:

- `LOCATION_MEMBER_ALLOW` in `db/lib/zoneChannelSpec.js` **drops Send**
  (view, send-in-threads and reactions stay). The doctor's `location-occupancy`
  check compares the **allow bits**, not just whether a target is present, so
  one `npm run db:doctor -- --apply` rewrites every existing occupant.
- Room threads get `rate_limit_per_user: 30` at creation, re-asserted the way
  `archived: false` is (`db/lib/syncZones.js`).
- `bot/src/lib/channels.js#isDesignatedTupperChannel` no longer treats a
  **top-level** Location channel as a tupper channel. Threads and `#summary`
  still are. What is left at top level is a GM typing, and a GM's own words are
  theirs.
- On the web the Location place is `canSpeak: false` and draws no composer.

### 5c. One affordance catalog, two faces

`db/lib/placeAffordances.js` is the list of every place-bound button, and it
is the reason the Discord anchor and the Hall's place panel cannot drift. Each
entry carries an id, the **label a player reads**, a Discord custom-id prefix
and a **tone** — `go`, `plain`, `danger`. A tone says what the affordance
MEANS, never a colour: Discord maps it to a button style and the web maps it
to a `.btn` variant, so neither face can reach for a look the other cannot
express.

Two halves, and they cannot be one function. `locationAffordances(location)`
and `roomAffordances(room)` are what a **place** offers — that is all an
anchor can carry, because it is one message for everybody standing in the
street. `db/lib/locationAnchorRow.js` and `db/lib/roomStarterRow.js` are now
only Discord's shape around those two: rows, styles and the five-per-row cap.

`affordancesFor(prisma, character)` is what a **person** can do where they are
standing, and it is what `/play` renders: the place's own, plus a Storage
button per Room this character can actually get into, plus a gate for every
modular way they can work from a watchtower they can reach, plus a keyed door
they hold the key to. On Discord those last two are answered by a refusal
instead, because an anchor cannot know who is reading it.

Adding an affordance is one entry in the catalog, one dialog in
the Hall's right column and one server action. It is not two lists to keep in step.

## 6. What comes next, in order

1. ~~**One write path**~~ — done (§2, §4). `db/lib/say.js` decides for both
   faces, `messageCreate` is "prepare, post, record, delete the original", and
   `/message` and Speak call the same three. The reactions (✏️ ❌ 🔍 📸) look
   their message up as an `ArchiveEntry` row by `discordMessageId` instead of
   the in-memory `recentProxies`, which a restart emptied — so an hour-old
   message is no longer inert. Edit and delete have a **5-minute window on both
   faces** (Bascinet's call), `/play` draws ✎ and ✕ on your own rows, and
   delete is soft everywhere.
2. **The other places.** Public Rooms, private Rooms you can reach
   (`accessibleRooms`), Conversations you are in, the zone Summary. The place
   list becomes the left column; on a phone, tabs. Conversation membership
   moves into a `PlayerThreadMember` table, because today it lives only in
   Discord and a web-only player cannot be in a thread.
3. ~~**The right column**~~ — done (§5). The people standing here come from
   `db/lib/whosHere.js` and open the sheet's own people dialogs; the place
   panel is rendered from `db/lib/placeAffordances.js`, the one registry both
   faces read (§5c); Travel with drag-along and Turn back, Examine, Storage,
   Noticeboard, Converse, Bell, Intercom, Turret, gates and keyed doors are
   all dialogs now. The console affordances came with it — Move
   (`db/lib/moves.js#fileMove`), the turn line, the Sheet link, "Report to
   the GMs", and a **Waiting on you** panel answering offers, threat spawns
   and a lobby seat through the same functions the DM buttons call. What is
   still Discord-only is **Speak** (the Hall's composer is the same thing)
   and the anchor redraw after a web gate flip.
4. **Ambient lines write rows.** None of them archive today, so a web player
   never sees a gate crossing, a smell, a turret burst or a noticeboard pin.
5. ~~**The "web only" switch**~~ — done, and described below.
6. ~~**Typing, markdown, mentions, the wipe, the GM view**~~ — done (§3, §5,
   §7, §8). What was deliberately left out: **Web Push** (VAPID keys, a service
   worker and iOS install guidance — its own change), **attachments**, and a
   Discord-side "is typing" echo for a web typist, which Discord's API cannot
   express.

The desktop and mobile wireframes Bascinet chose are in §5.

### 6a. The "web only" switch

**Play from the web ‡**, a `Switch` under the picture on the Bio card, right
after the turn ping. It is the answer to §1's first reason: a Discord channel
lists every account that can see it, so standing in the Keep tells everybody
else in the Keep which Discord account you are, and the only fix is not being
there.

`Character.webOnly`, `Character.webOnlyChangedAt`, and
`GameConfig.webOnlyCooldownSeconds` (7200 — **two hours**). One function flips
it: `db/lib/webOnly.js#setWebOnly(prisma, character, on)`, returning
`{ ok: true }` or `{ ok: false, error, minutes, readyAt }`.

**ON** takes the account out of Discord: `revokeAllCharacterAccess(prisma,
character, { keepGuests: true })` strips the zone role and every per-member
overwrite (the Location channel, the zone channels, the narrowcast channels),
then the Room threads named in `Character.roomThreadRoomIds` and every
Conversation in `PlayerThreadMember` are left, and the column is cleared. The
new `keepGuests` option is the whole difference from a death sweep: a
`RoomGuest` row is **game state, not Discord state** — somebody let them into
that room and they are still standing in it. `PlayerThreadMember` rows survive
for the same reason, which is what §2a was built for.

**OFF** puts it all back: `db/lib/locationMove.js#materializeDiscordPresence`
— the Location overwrite, the zone role, narrowcast,
`syncCharacterRoomAccess`, the Conversation thread adds for where they stand,
and `applyPendingInvites`. It is built on the same four helpers a move uses
rather than a second copy of them; the only difference is that there is no
origin to swap away from, so every call is a pure grant.

**The order is the load-bearing part.** The database flip lands FIRST, inside
the cooldown guard, and every Discord call after it is best-effort and
individually logged. A failed REST call must never un-flip the switch: the flag
is what every re-materialiser reads, so a half-applied ON that stays ON is
repaired by the doctor's next pass, while one that rolled back would leave a
player believing they were hidden when they were not.

**The cooldown** is the travel pattern (`db/lib/locationTravel.js`): one
`updateMany` whose WHERE carries `webOnly: !want` and `OR [{ null }, { lte
cutoff }]`, so two clicks in one tick cannot both pass and re-saving the Bio
card in the state you are already in spends nothing. A refusal reads *"You
switched N minutes ago. You can switch again at HH:MM. ‡"* and **leaves the
rest of the save standing** — the appearance somebody just typed is not thrown
away because a cooldown had two minutes left on it.

**What survives either way:** DMs, the turn-ping role (it is a DM, not a
channel), the OOC report channel (opened by the Player role, not per
character), guest rows, conversation membership, and the fiction — they still
stand there and still appear in Who's here?. The places column shows one quiet
`.chip`, **Playing from the web ‡**.

Which re-materialisers had to learn the flag is in `CHANNELS.md` §3, and it is
the list to check against when adding another.

## 7. The wipe: a watermark, not a delete

The Dawn wipe (`CHANNELS.md` §8) empties every Discord channel. The Hall
cannot do the same thing and should not want to: `ArchiveEntry` **is** the
transcript `/archive` reads, so deleting a row to tidy a screen would burn the
record.

So the web reads past the wipe instead. `GameConfig.feedWipeSeq` is a
watermark, and every feed query asks for `seq > feedWipeSeq` while
`messageWipeEnabled` is on. `db/lib/feedWipe.js` is the whole of it —
`markFeedWiped(prisma)` sets it, `feedWipeFloor(prisma)` reads it back as a
BigInt (zero when the wipe is off, so a game running without it behaves
exactly as it did before this existed), and `seqFilterAbove` folds it into a
Prisma `seq` filter.

Four readers, and they have to agree or the page and the stream disagree about
where the day starts: the stream's catch-up (`/api/feed`), the history route
(`/api/feed/history`), the page's first render (`play/page.js`), and the
`newestSeq` watermark `web/lib/feedAccess.js` decorates the place list with.

**It is set as the pass BEGINS**, from `db/index.js#advanceTurn`'s side-effect
thunk, immediately before `runDawnWipe`. That is the same instant `cutoffMs`
names on the Discord side, and the reason is the same: a message posted while
the wipe is still walking the map survives on Discord, so it has to survive
here too. Taking the watermark afterwards would have made where you were
standing decide whether what you said still exists.

One thing falls out for free. **The unread dots reset with the wipe**, because
a dot is "the newest seq here against the newest seq this browser saw here" and
after a wipe there is no newest seq here until somebody speaks. No second pass,
no `localStorage` to clear.

## 8. The GM's Scene tab

The player desk's inspector (`PLAYER-DESK.md` §6) gains a **Scene ‡** tab: what
is being said where the inspected character is standing, live.

It renders the Hall's own `Feed`, not a GM-flavoured copy of it —
`(desk)/gm/players/SceneTab.js` is a place picker, a stream and that component.
The runs, the faces, the subtext, the tinted speech and the typing line all
come out identically, which is the point: a GM reading a scene should be
reading the player's page, not a transcript of it.

Read-only twice over. `Feed`'s `readOnly` drops the composer, and the GM place
list carries `canSpeak: false` on every entry anyway (§5a).

`getCharacterScene({ characterId })` builds the list by asking
`placesFor(prisma, null, { gm: true, discordUserId })` for the GM's **own**
list and keeping the entries belonging to that character's Location — its
Rooms and Conversations included. So a zone a GM's `GmZoneView` does not open
has no scene in it, and the gate is the same one every request re-applies.

It is the first thing to use `InspectorColumn`'s `extraTabs` — a whole tab
rather than a `tabPreludes` section, because a prelude sits above a base tab's
own body and this has no base tab to sit above, and because it is a live stream
that must not take a slot in the shared per-(character, tab) fetch cache.
