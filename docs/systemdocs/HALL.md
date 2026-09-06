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

## 2. The record: every message is a row first

`ArchiveEntry` was already written for every proxied message
(`ARCHIVE.md`). Phase 0 added the columns that make it a live feed:

| Column | What it is |
|---|---|
| `seq` | `BIGSERIAL`, the cursor. Monotonic and assigned by Postgres, so the bot and the web never need to agree on a clock. A BigInt in Prisma: it crosses JSON as a **string** and is compared with `BigInt()`, never `Number()`. |
| `placeKey` | Where it was said: `loc:<id>`, `room:<id>`, `conv:<playerThreadId>`, `zone:<id>`. A snapshot string, no FK. `db/lib/placeKey.js` is the only thing that mints one; `placeKeyForChannel` resolves a Discord channel or thread id to one, memoised for a minute. |
| `source` | `DISCORD`, `WEB` or `SYSTEM`. The outbox (§4) only ever posts `WEB` rows on to Discord, which is what keeps a proxied message from being echoed back into the channel it came from. |
| `editedAt`, `deletedAt` | Soft delete, so a client holding the row can reconcile. `/archive` and `/play` filter on `deletedAt`. (Phase 0 still hard-deletes on ❌; phase 1 switches it.) |
| `discordSyncedAt` | The outbox watermark. Null on a `WEB` row means the bot has not posted it yet. |

`recordArchiveMessage` / `recordArchiveEvent` (`db/lib/archive.js`) write
`placeKey` and `source`, then run `SELECT pg_notify('bascinet_feed', …)` with
the row's seq and place key (`db/lib/feedNotify.js`). After the insert, never
inside it: a listener woken before the commit would look the row up and find
nothing. The payload is tiny on purpose; every reader loads the row and
re-checks who may see it.

## 3. Realtime: server-sent events from the web process

`web/lib/feedHub.js` keeps **one** `pg.Client` per web process (on
`globalThis`, the same trick as the Prisma singleton, so `next dev` does not
leak a listener per hot reload) with `LISTEN bascinet_feed`, and a map of
place key → open streams. `GET /api/feed?place=&since=` is one stream per
tab: it sends the catch-up rows (`seq > since`) first, then subscribes, drops
anything at or below the last seq it sent, and writes `: ping` every 25 s so
Railway's proxy keeps the connection. The browser's `EventSource` reconnects
on its own, and the client's cursor makes the reconnect repeat nothing.

**Why not a WebSocket service.** Sends are an ordinary `POST` either way, and
the optimistic append hides their latency, so bidirectional traffic buys
nothing. Railway runs `next start` as one long-lived Node server with one
replica. Revisit only if that ever becomes more than one.

## 4. The outbox: the bot owns Discord

`POST /api/feed/say` writes a `WEB` row and returns it. The web never holds a
Discord token for chat. `bot/src/lib/feedOutbox.js` listens on the same
channel, and for a `WEB` row with no `discordMessageId` posts it into the
Location's channel through the REST twin of the proxy
(`db/lib/discordRest.js#postAsCharacter`), loading the forced name and
concealment the way `messageCreate.js` does so a hood or a Beast posts under
the right name from the web too. It re-reads the claim right before posting
and claims with a guarded `updateMany`, so a row picked up twice posts once.
`drainFeedOutbox()` sweeps the last 24 h on `ready`, through the same
serialised queue, which is what makes a bot restart mid-send harmless.

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
  button appears, as in Discord's app.
- The gate is `web/lib/feedAccess.js#allowedPlaceKeys`, called by both routes,
  with the character resolved from the session and never from the request.
  Phase 0: only `loc:` of the Location you stand in.
- Slowmode is 30 s per character per place, enforced in the say route by the
  character's newest row there. Discord's channel slowmode is the same number
  so a player sees one rule. The speech gate (mute, gag) is the same
  `db/lib/incapacitation.js` table the proxy uses.

Not yet on the web send: the babble and autocorrect passes
`postAsCharacterTo` runs. They move into one write path with everything else.

## 6. What comes next, in order

1. **One write path**, `db/lib/say.js`: gates, identity, babble/autocorrect,
   slowmode, the row, the notify. `messageCreate` becomes "delete the
   original, then say". `/message`, Speak and the say route call it too.
   Reactions (✏️ ❌ 🔍 📸) look the row up by `discordMessageId` instead of the
   in-memory `recentProxies`, which a restart empties. Edit and delete get a
   **5-minute window on both faces** (Bascinet's call).
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
