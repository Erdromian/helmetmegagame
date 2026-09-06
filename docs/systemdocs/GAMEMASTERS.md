# Gamemasters and the zone code

How several GMs share one game: who sees which zone, how they choose it, and
the colour vocabulary that tells them at a glance whose row is whose.

---

## 1. The shape of it

Bascinet runs with **one master** — the superadmin (`web/lib/superadmin.js`) —
and a handful of GMs under them. GMs are **staff, not seated players**: nobody
assigns them a zone any more, and a GM who also has a character is a person who
happens to play, not a role the app models.

**Each GM chooses which zones they see, and the choice is real.** It is stored
in `GmZoneView`, one row per zone, keyed on `discordUserId` — and it decides
two things at once:

- **Discord.** A GM holds the `GM: <Zone>` role for each zone they picked, and
  that role is what opens the zone's category, its `#summary` and every one of
  its Location channels. The global Gamemaster role no longer opens any of
  them. See §6.
- **The desks.** `/gm/turns` and `/gm/players` show only rows whose faction sits
  in a chosen zone. Their own Zone dropdowns still narrow *within* that.

**The Discord half is the gate; the desk half is a view.** The desks still
fetch every row and filter in the client, so a direct link to a hidden Move
opens it. That is deliberate — an Opposed Move crosses zones by nature, and a
GM who cannot reach a row mid-turn is a worse failure than one who scrolled too
far. What the desk filter buys is a workable queue, not a secret.

One asymmetry worth knowing: the desks filter on a character's **faction** zone
(`GAMEMASTERS.md` §2b), while the Discord roles gate the **Location channel**.
A Town-faction player who walks into the Marshes stays on the Town GM's queue
while that GM cannot open the channel it happens in. Both answers are the right
one for their own question — the queue is about whose player it is, the channel
about where the scene is — but they will not always agree.

**No rows means every zone.** A GM who has never touched the control, or who
unticks the lot, sees the whole game. That is the only safe default: the
alternative hands a new GM an empty desk and no channels and lets them conclude
the app is broken, and it is what made the migration off the old seats safe —
the table landed empty and nobody lost anything.

Set it from the **Zones** control at the bottom of the inspector on either
desk, or with **`/zone`** in Discord (§6). Both write the same rows and both
call the same role sync, so it does not matter which you reach for.

### What this replaced

`GmAssignment` was a *seat*: it picked which zone a GM's tables **opened** on
and hid nothing — the only soft gate in the app. It is gone, along with
`/gm/gamemasters`, `web/lib/gmZone.js` and `ZoneScopeToggle.js`. The argument
for softness was that an Opposed Move crosses zones by nature and a GM who
cannot reach a row mid-turn is a worse failure than one who scrolled too far.
That argument is answered rather than ignored: the control is one click away on
the desk itself, and widening it is instant. What changed is the problem — with
56 Locations, a GM who can see everything sees nothing.

**A GM who is also a player needs no special case**, and that is the point of
using roles rather than per-member overwrites. Their character's Location
overwrite is written by the move pipeline; their GM zone roles are granted by
`db/lib/gmZoneRoles.js`. Discord unions permissions across every overwrite that
applies, so they get their character's view of the room *and* the GM-facing
grant on top, with no code aware of the overlap.

---

## 2. Which zone a row belongs to

### 2a. Presence zones vs seat zones

Since the Bascinet 2 map, **presence is seven zones and the seats are six.**
Characters stand in Town, Fortress, Forest, Black Hills, Marshes, Caves or
Depths; the GM seats are Town, Fortress, Forest, Black Hills, Marshes and
**Underground**, with both cave levels belonging to the Underground seat.
Underground is the only seat that is not itself a place — it is a `CAVE_GROUP`,
a category and a seat and nothing else.

That mapping is denormalized onto **`Zone.seatZoneId`** by `db:sync-zones`
(`parentZoneId ?? id`), and `db/lib/seatZone.js#seatZoneIdFor` is the single
reader every writer goes through. **Never stamp a seat-scoped row with
`zone.id`.** Every `Action`, `Note` and `StagedMessage`
`zoneId` is the *seat* zone — a character acting in the Depths who filed
against the Depths row would file work no Underground GM can see.

The zone pickers on the desks list `kind != "CAVE_LEVEL"` (`/gm/turns`),
which is the same six rows from the other direction. The channel doctor checks
the invariant from a third: no stamped `zoneId` may point at a `CAVE_LEVEL`
row, and it counts the offenders if any exist (`CHANNELS.md` §6).

### 2b. Seat by faction, not by feet

**The zone a character's *faction* is keyed to — `Faction.zoneId` — never where
they happen to be standing.** A Fortress character visiting Town is still a
Fortress row. That distinction is the whole feature and the one real bug it
invites.

Two zone fields exist on a character and they mean different things:

| Field | Meaning | Used by |
|---|---|---|
| `Character.faction.zoneId` | The zone seat. Which GM this person is *for*. | Every Zone column and filter; the seat default |
| `Character.zoneId` | Where they are physically standing — a presence zone, possibly a cave level | Travel, the map, `/gm/players`' **Standing in** column |

Every GM page flattens the first onto its rows as a plain string,
**`factionZoneName`** (`""` when the character has no faction at all), because
these all cross a server→client boundary.

All 13 factions in `docs/roles.yaml` are nested under a zone — `unaligned`
included, which sits in Caves. So the neutral chip only ever appears for a
character with **no faction row at all**, or for a DM from someone who never
made a character.

---

## 3. The colour code

Four colours, colour-picked from the game's own Plate map
(`web/public/assets/Map_Basic.png`, a 34-colour pixel plate) so the code is the
map's palette rather than an invented one:

| Zone | Where it comes from | Hex |
|---|---|---|
| Fortress | the castle's red roofs | `#9c4132` terracotta ruby |
| Town | the timber cluster's thatch | `#998d6b` brown linen |
| Forest | the olive scrub of the woodland | `#7f8c64` desaturated lime |
| Black Hills | the blue-grey of its region on the drawing | `#79899b` slate (`--zone-hills`, after the slug) |
| Marshes | the drab grey-green of the wet ground | `#8d9384` reed |
| Caves | mountain rock | `#939d9e` stone grey |
| Depths | the mauve band along the map's edge and floor | `#8f7f9c` bruise |

They are `--zone-fortress` / `--zone-town` / `--zone-forest` /
`--zone-hills` / `--zone-marshes` / `--zone-caves` / `--zone-depths`,
declared **inside each `[data-theme]` block** in `globals.css` (not on `:root`)
so `audit-contrast.js` picks them up with no parser change. There is no
`--zone-underground`: that zone is a category and a seat, never a place, so
nothing ever renders a chip for it.

A few of the values deviate from the map, and the comments in
`globals.css` say why: Fortress's terracotta measures **2.00** on dusk's
surface and **2.12** on dawn's, so it is lifted in lightness with hue and
saturation held; Caves' stone grey measures **2.66** on limestone, so it
darkens there. The other nine ship the map hex untouched. Do not "fix" the
three back.

**These are fills only — the rule down the side of a chip, never a text
colour.** They are gated at **3.0** against `--surface` (the large-graphic
floor), not AA 4.5; none of them would ever clear 4.5, and gating them there
would only force them off the palette. Spending one as `color:` ships a 2.x
contrast.

`Zone` **does** have a slug now (`db:sync-zones` matches on it), but the colour
code does not read it: `web/lib/zones.js#zoneKey()` still slugifies the *name*
and checks it against the known four-key set, because the chip covers seats,
not presence zones, and the set is closed and known at build time. A renamed or
fifth zone returns `null` and renders the neutral chip rather than throwing. A
cave level's name never reaches a chip — its rows are stamped with the Caves
seat (§2a).

`ZoneChip.js` puts the colour on a `data-zone` attribute reading a token, not
an inline style. `ChipLabel.js` is the tempting precedent but it goes inline
only because a `TagGroup` colour is a freeform hex out of the DB with no token
to name; the zone set is closed and known at build time, which is also the only
reason `audit-contrast.js` can see it.

---

## 4. Where the chip and filter appear

| Surface | Column | Filter | Hidden outside your zones |
|---|---|---|---|
| `/gm/turns` Moves | ✓ | ✓ | ✓ |
| `/gm/turns` Requests | ✓ | ✓ | ✓ |
| `/gm/turns` Caving | ✓ | ✓ | ✓ |
| `/gm/players` | ✓ | ✓ | ✓ |
| `/gm/dev/factions` | ✓ | — | — |
| `/faction` (player-facing) | ✓ | — | — |

Two surfaces need a note.

**`/gm/players` already owned the key `zone`**, and it meant the *physical*
zone. It now means the seat, matching every other surface; the physical one is
still there, renamed to **Standing in** rather than dropped, because it answers
a real and different question.

**The player desk has no character FK** — `DirectMessage` keys on
`discordUserId`. The zone comes through a character lookup over the
conversation's user IDs, resolved in the *same* loop as the display name under
one ALIVE-wins rule. Splitting them into two loops is how a dead character's
faction ends up deciding a live player's zone.

`/gm/dev/factions` shows the chip read-only: a faction's zone is owned by
`docs/roles.yaml` and written by `db:sync-roles`, so editing it there would be
overwritten on the next sync.

---

## 5. Filtering within what you can see

There is no Mine/All toggle any more: "mine" is now the whole desk, so a lens
over it would be a lens over one thing. What remains on both desks is the plain
**Zone** dropdown, and it narrows *within* the zones you chose — it cannot
reach past them.

The gate itself is applied in the client, once, before anything else: `inView`
in `PlayerRail.js`, `RosterTable.js` and `QueueRail.js`. Three rules worth
knowing, all of them deliberate:

- **A search does not lift it.** The Zone dropdown pauses under a query, on the
  argument that a filter should not hide a hit you went looking for. The zone
  *view* is not a filter, so it does not pause.
- **A row with no faction zone stays visible to everyone.** Better seen twice
  than by nobody.
- **Mark-all-read only clears what you can see**, or one click would silently
  handle another zone's mail.

`/gm/turns` also carries a count of what is still waiting. A Move under a live
lock reads as *In Progress* and drops out on its own, which is correct — it is
being dealt with. A Request has no lock, so `reviewedAt` is the only signal
there is; `RequestStatus` has no "unreviewed" value.

**The count is over the loaded 500, not a true total** — right while the game is
live, wrong after a long backlog. If that ever matters, replace it with
`prisma.action.count` / `request.count` filtered on `character.faction.zoneId`.

---

## 6. Choosing your zones

Two faces, one write. The **Zones** control at the bottom of the inspector on
`/gm/turns` and `/gm/players` (`web/app/components/GmZoneRail.js` → the
`footer` slot on the shared `InspectorColumn.js`), and **`/zone`** in Discord,
which opens an ephemeral select menu with your current zones pre-selected.
Both go through `setVisibleZones` and then `syncGmZoneRoles`.

The control sits **outside** the inspector's nothing-inspected branch on
purpose: the column is empty until a row is clicked, and a zone control that
disappears when nothing is selected is one nobody finds.

### Why a role per zone

Discord has no way to subtract a role grant from one member, so "everyone sees
Town" and "this GM does not" cannot both be one overwrite. The overwrite is
therefore unconditional on the channel and the **role** is what varies per
person — `db/lib/gmZoneRoles.js` grants and revokes `Zone.gmRoleId` to match
the table.

The obvious alternative, a per-member overwrite on each channel, is a
**non-starter**: the channel doctor deletes any member overwrite on a zone or
Location channel as a stray, on every bot start and after every turn, because
it derives their legitimacy purely from who is standing there (`CHANNELS.md`
§3). Teaching it a GM exception would have meant teaching `managedOverwriteIds`
about member targets, and its own comment says why that is how you evict every
player from the map.

Three places had to learn about the new roles, and missing any one of them
breaks quietly:

- `syncZones.js#managedOverwriteIds` — or the reconciler deletes the overwrite
  it wrote one pass earlier, every run.
- `channelDoctor.js` — as a protected role family, but **not** in the set that
  seeds `#turns`: every GM already holds a global GM role, which `#turns`
  grants outright.
- `prune-orphan-roles.js` — a `GM: <Zone>` role is held by GMs, not characters,
  so without protection it looks exactly like an orphan.

`syncGmZoneRoles` also runs for every GM-role holder on **bot start**. That is
what seats a brand-new GM without them finding the control first, repairs a
grant that failed mid-rate-limit, and re-seats anyone who left and rejoined
(Discord strips every role with the membership).

`setVisibleZonesAction` never takes a target id. A server action is a public
endpoint, and the only person anyone may re-scope is themselves.

The GM **roster** — who holds which seat, with the Gamemaster / Trial GM /
Master chips — moved to `/gm/dev?s=gamemasters`, read-only. It is the only
surface in the app that renders a Discord identity rather than an in-game one,
and so the only user of `DiscordAvatar.js` — a plain `<img>`, because
`next.config.mjs` declares no `images.remotePatterns` and `next/image` against
`cdn.discordapp.com` would throw at render.

---

## 6b. The trial seat

There are **two** GM Discord roles, and they grant exactly the same thing:
Gamemaster (`DISCORD_GM_ROLE_ID`) and **Trial Gamemaster**
(`TRIAL_GM_ROLE_ID`, hardcoded in `db/lib/roleIds.js`). A trial GM opens every
`/gm` page, holds the same standing overwrites on every zone, Location,
`#turns`, narrowcast and report channel, and runs `/gm` and `/dm` in Discord.
Nothing is withheld.

`db/lib/roleIds.js#gmRoleIds()` is the **only** list of the two, and nothing
reads `DISCORD_GM_ROLE_ID` directly any more. That matters more than it looks:
two roles meaning the same thing is the shape that drifts, and a site still
checking one of them would be a GM who can open the web panel but not see the
channels — or the reverse, which is worse, because it looks like it works.

The one place they differ is the roster on `/gm/dev?s=gamemasters`, which chips each
row **Gamemaster** or **Trial GM**, plus **Master** for a superadmin. That
chip is the whole difference. Everything else — a `GmZoneView` row included,
since it is keyed on `discordUserId` and knows nothing about which GM role you
hold — treats the two identically.

Adding a third seat later means one line in `gmRoleIds()` and one branch in
that roster's `standing()`.

## 7. The audit log is everyone's

`/gm/audit` used to be superadmin-only, on the argument that with five GMs the
log stops being a shared work surface and becomes a record **of** them. That
was true and beside the point: it left four of the five people who run the game
unable to answer "who changed this, and why", which is the only question the
log exists for. Peer visibility is now the feature. **Every GM reads the whole
log**, and the Actor filter's `GMs` toggle makes reviewing each other a
first-class view rather than something you squint for.

The Dev panel (`/gm/dev`), the GM roster included, stays superadmin — those are
host access, not game permission.

The page is a **desk** (`web/app/(desk)/gm/audit/`), not a table: filter rail,
feed, inspector, the same frame as `/gm/turns`. Three things about it are worth
knowing before changing it.

**It filters server-side, alone among the app's lists.** `DataTable.js`'s whole
model is "ship the rows, filter in the browser", and `AuditLog` is the app's
biggest table and append-only — it can never be shipped whole. So the filter
state lives in the URL and the WHERE is built in Postgres
(`web/lib/auditQuery.js#buildAuditWhere`). That also makes any view a link, and
a filtered log a GM can paste at another GM.

**Selection does not re-fetch.** The page already shipped every row on screen,
so picking one is a lookup plus a `history.replaceState` — the same trick
`/gm/turns`'s `Workspace` uses. Only a permalink naming a row *outside* the
current page costs a query.

**`actionType` is a free string, so the renderer must never require knowing
it.** `web/lib/auditNarrative.js` maps ~90 known types to sentences, and
anything else falls back to the prettified string plus a family derived from
its prefix. Adding an action type at a call site is a one-line change in some
server action, and nobody is going to remember this file — so an unregistered
type has to render, not blank and not throw. Same for `details`: every accessor
in there survives a null, a missing key, and a payload shape from two reworks
ago.

`AuditLog` carries no `turnId` and no `zoneId`. Both are **derived** — the turn
by bucketing `createdAt` against `Turn.startedAt`, the zone through the target
character's faction. Stamping them would only cover rows written from that day
onward, and the log's value is its history.

Adjudicator identity moved the other way, from private to visible. Both
`Action` and `Request` have carried `reviewedByDiscordUserId`/`reviewedAt` all
along; the Request pair was written by `resolveRequestImpl` and **never shown
anywhere**. Both now appear as a column in the table, not just in the panel,
because with four people scanning one queue asynchronously "has someone already
picked this up" is a question the table has to answer. Moves say *Solved by*
and Requests say *Reviewed by* — Review is the Request verb everywhere in that
UI, and Solved is Move vocabulary bound to a `MoveReviewStatus` value.

---

## 8. Where the code lives

| Path | What |
|---|---|
| `web/lib/zones.js` | `zoneKey()`, `ZONE_KEYS`, `sortZones()` |
| `web/lib/gmZoneView.js` | `getVisibleZones()` / `getVisibleZoneNames()` (cached, null = all), `listSelectableZones()` |
| `db/lib/gmZoneView.js` | `visibleZoneIds()`, `setVisibleZones()` — the shared reader/writer |
| `db/lib/gmZoneRoles.js` | `syncGmZoneRoles()`, `syncAllGmZoneRoles()` — the choice, as Discord roles |
| `web/app/components/GmZoneRail.js` | The multiselect |
| `web/app/(desk)/gm/zoneViewActions.js` | `setVisibleZonesAction` |
| `web/app/components/ZoneChip.js` | The chip |
| `web/app/components/DiscordAvatar.js` | The one remote image |
| `web/app/(desk)/gm/dev/page.js` | The GM roster, `?s=gamemasters` |
| `bot/src/events/interactionCreate.js` | `/zone` and its picker |
| `web/app/(desk)/gm/audit/` | The audit desk — filters, feed, inspector, export |
| `web/lib/auditNarrative.js` | actionType + details → a sentence |
| `web/lib/auditQuery.js` | The audit filter parser and WHERE builder |
| `db/prisma/schema.prisma` | `GmZoneView`, `Zone.gmRoleId` |
| `web/app/globals.css` | `--zone-*` per theme, `.zone-chip` |
| `web/scripts/audit-contrast.js` | The 3.0 gate |
