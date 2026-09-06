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

## 3. Realtime: server-sent events from the web process

`web/lib/feedHub.js` keeps **one** `pg.Client` per web process (on
`globalThis`, the same trick as the Prisma singleton, so `next dev` does not
leak a listener per hot reload) with `LISTEN bascinet_feed`, and a map of
place key → open streams. `GET /api/feed?place=&since=` is one stream per
tab: it sends the catch-up rows (`seq > since`) first, then subscribes, drops
anything at or below the last seq it sent, and writes `: ping` every 25 s so
Railway's proxy keeps the connection. Two event names: `message` carries a
whole row (a new one, or an edited one the client replaces by seq), `delete`
carries a seq and nothing else — the words somebody took back never come back
down the wire. Only a new row moves the high-water mark, since an edit and a
delete both name a seq the stream has already sent. The browser's `EventSource` reconnects
on its own, and the client's cursor makes the reconnect repeat nothing.

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
(`web/lib/navItems.js`). Phase 0 is the centre column only: the Location's
name and description, the last 100 rows, a composer.

- `feedStore.js` is a module-level store read through `useSyncExternalStore`,
  modelled on the GM inbox's `liveInbox.js`. Confirmed rows are keyed by seq,
  pending rows by a client id. A confirmed row carrying the same client id
  evicts its pending twin, **whichever of the stream or the POST answer arrives
  first** (the stream usually wins).
- `PlayFeed.js`: Enter appends the pending row in the same frame and clears
  the box; the POST swaps the real row in behind it. A failed send stays on
  screen as "Not sent. Retry". Runs group one speaker's messages within seven
  minutes, the same rule as `DmThread.js`. The list scrolls itself, never the
  document, and only while the reader is already at the bottom; otherwise a
  "New messages" pill. On a coarse pointer, Enter is a newline and a Send
  button appears, as in Discord's app. Your own rows carry ✎ and ✕ — on hover
  with a mouse, always on a touch screen — and an edited row says "(edited)"
  after the time. ✕ goes through the shared `useConfirm()` dialog.
- The gate is `db/lib/feedAccess.js#allowedPlaceKeys`, with the character
  resolved from the session and never from the request. Phase 1: only `loc:` of
  the Location you stand in.
- `POST /api/feed/edit` and `POST /api/feed/delete` take a `seq` and nothing
  else that matters — the character is the session's. Both answer `{ error }`
  with a status rather than throwing, and both leave Discord to the outbox.
- Slowmode is 30 s per character per place (300 s for a zone summary), enforced
  in `prepareSpeech` by the character's newest row there. Discord's channel
  slowmode is the same number so a player sees one rule. The speech gate (mute,
  gag) is the same `db/lib/incapacitation.js` table the proxy uses.

The whole send — the gate, the transforms, the slowmode, the identity — is
`db/lib/say.js` (§2), so a web message and a Discord one are decided by the
same code. `web/lib/feedAccess.js` is the character load and re-exports the
rules, which live in `db/lib/feedAccess.js` where `say.js` can read them too.

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

The desktop and mobile wireframes Bascinet chose (a three-column Hall, a
single-column Scene under 720px) are in the 2026-09-06 chat transcript and the
plan file it came from; copy them here when phase 2 lays the columns out.
