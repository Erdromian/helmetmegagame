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
  slowmode (web only, 30 s a place, 300 s a zone summary), then the babble and
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

Desktop, three columns — `15rem minmax(0,1fr) 17rem`:

```
┌──────────────────┬──────────────────────────────────────┬────────────────────┐
│ TOWN · Dusk 12   │  The Keep                        ⋯   │ (phase 3: people   │
│──────────────────│  A vaulted hall, damp and echoing…   │  and the place)    │
│ HERE             │──────────────────────────────────────│                    │
│ ▸ The Keep       │  -# Somebody has entered from the    │                    │
│ ROOMS            │     Square.                          │                    │
│   Throne Room  ● │  ⊙ Cersei · Baroness          12:04  │                    │
│   Cellar         │    "Shut the door behind you."       │                    │
│   ▪ Baron's Off. │                                      │                    │
│ CONVERSATIONS    │  ⊙ a young man                12:05  │                    │
│   With Old Tom ● │    *pulls his cloak tighter*         │                    │
│ SUMMARY          │                                      │                    │
│   Town           │  ▢ Say something in the Throne Room…⌤│                    │
└──────────────────┴──────────────────────────────────────┴────────────────────┘
```

Under 720px, one column — the places column becomes a `.tab-bar` of
`.tab-item`s with unread dots, and the right column is deferred to phase 3
(its ⚡ button is drawn, disabled, so the composer's shape does not move under
a player when it arrives):

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
  app. Your own rows carry ✎ and ✕ — on hover with a mouse, always on a touch
  screen — and an edited row says "(edited)" after the time. ✕ goes through the
  shared `useConfirm()` dialog.
- **A `SYSTEM` row renders as `.hall-subtext`**: muted, small, no face. That is
  the web half of the `-#` those lines go out as on Discord
  (`db/lib/ambientLine.js`). Phase 4 is what actually writes them.
- **The composer is hidden where `canSpeak` is false** — every place for a GM,
  and the Location for everybody (§5a). In its place, one line saying so.
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

Slowmode is 30 s per character per place, 300 s for a zone summary, enforced in
`prepareSpeech` by the character's newest row there. Discord's channel slowmode
is the same number so a player sees one rule; the Room threads carry it as a
per-thread `rate_limit_per_user`, re-asserted by `db:sync-zones` on every pass
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
3. **The right column**: the people standing here (presented names, the same
   people dialogs the sheet has), the place panel with the buttons the anchor
   carries on Discord (Travel with drag-along, Examine, Storage, Noticeboard,
   Converse, Bell, Intercom, Turret, gates, keyed doors), rendered from one
   registry both faces read. Then the console affordances (Move, Speak, the
   turn line) and a "Report to the GMs" entry that writes a DirectMessage.
4. **Ambient lines write rows.** None of them archive today, so a web player
   never sees a gate crossing, a smell, a turret burst or a noticeboard pin.
5. **The "web only" switch** in Bio: `Character.webOnly`, a two-hour
   cooldown on the travel-cooldown pattern. ON strips **every** Discord
   channel — the Location overwrite, the zone role, every Room and Conversation
   thread, `#turns` and the report channel. DMs survive. Every
   re-materialiser must learn the flag or the doctor undoes it overnight:
   `channelDoctor.js`, `roomAccess.js`, `threadInvites.js`,
   `locationMove.js`, `accessSweep.js`. The fiction is untouched: the
   character still stands there, still appears in Who's here.
6. Typing ("The young man is typing…", presented names only), Discord-style
   markdown with quoted speech tinted, the dawn wipe as a seq watermark, Web
   Push for mentions, and the GM desk embedding the feed for a live
   per-location view.

The desktop and mobile wireframes Bascinet chose are in §5.
