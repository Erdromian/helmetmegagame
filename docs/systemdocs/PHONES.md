# Phones

The telephone network. A phone is a fixture on a Room's wall: you lift the
receiver, pick another phone off a list, and it rings there.

Before this, Ravenheart had exactly one way for two people in different places
to talk — the Council Room's intercom, which is a loudspeaker: one voice,
everybody, one direction, no reply. A phone is the opposite of that in every
respect, and the interesting part is what it costs you to use one.

**Read this before touching `db/lib/phone.js`, `db/lib/phoneVoice.js` or
`Room.phone`.**

## 1. The shape of it

| | |
|---|---|
| Where a phone lives | `Room.phone`, a NAME, authored in `docs/zones.yaml` |
| Who can be rung | every named phone; **never** a payphone |
| What a call costs | nothing at a named phone, 1 ¢ at a payphone |
| How long it rings | 4 rings over 60 seconds, then it gives up |
| Who hears the ring | everybody standing in that Location, and nobody else |
| What crosses the line | a VOICE, never a name |
| How many receivers | one per phone, one per person |

## 2. Room.phone is a name, not a flag

`Room.phone` holds what the phone is CALLED — `"Baron's Phone"`, `"Sanctuary"`,
`"Exactor"` — because that is what a dial list prints and what a player asks
for. The room's own name is not it: nobody rings "Baron's Study", and two rooms
in the game are both called "Bar".

`Room.payphone` is the flag beside it, and it does two things at once: the
phone takes an obol, and it comes OFF every dial list. Those are one fact, not
two — a payphone calls out and never rings, because there is nobody standing
next to it whose job is to answer. A `payphone: true` with no `phone:` name is
a sync problem, caught in `db/lib/syncZones/parse.js`.

Nothing anywhere holds a list of phones. `db/lib/phone.js#dialablePhones`
resolves the network off the column, the same posture `Room.stable` takes for
the Stable (`ARELITZ.md`).

**The YAML only reaches a room that does not exist yet.** `db:import-zones`
skips a room that is already there, so a `phone:` added to an existing room
reaches a fresh `npm run dev:setup` and never the running game. On a live
database a phone goes in at `/gm/dev/zones`, by typing a name into the room —
or by a migration, for more than a GM should type by hand. Clearing the field
takes one out.

The thirteen below were authored on rooms that already existed, and for a
while the live game had no phone on any wall a GM had not filled in by hand.
`20261031000000_backfill_phones` writes them in, only where the name was still
blank.

### The thirteen

Nine named, four payphones:

| Phone | Room |
|---|---|
| Sanctuary | `town-9-1` Ward |
| Esculap | `town-9-2` Esculap's Office |
| Censor | `fortress-1-2` Censor's Office |
| Hand | `fortress-5-3` Hand's Study |
| Baron's Phone | `fortress-4-6` Baron's Study |
| Meister | `fortress-5-2` Meister's Study |
| Exactor | `undertown-9-3` Exactor's Office |
| Bishop | `town-4-6` Vestry |
| Banneret | `factory-overseer-box` Overseer Box |
| **Depot** (pay) | `undertown-5-1` Railway |
| **Residences** (pay) | `town-8-2` Street |
| **Inn** (pay) | `town-7-2` Bar, the Old Cock Inn |
| **Den** (pay) | `undertown-8-1` Bar, the Undertown Den |

The Merchant has no phone yet, though he has walls to hang one on now —
`undertown-6` got its Storefront, Office and Cargo Bay when the Depot was split
in two. The payphone above is on the Depot's platform next door, which is a
different place from his counter. Giving him a line of his own is a `phone:`
key and nothing else.

## 3. One button, four meanings

There is one **Phone** button, on the room's starter post and in Chat's place
panel, from one entry in `db/lib/placeAffordances.js`. What it does is decided
when it is pressed, by `phoneView`, and never by the client:

| It says | Because |
|---|---|
| a dropdown of every phone | the phone is free |
| **Answer** | this phone is ringing |
| **Hang up** | you are holding this phone |
| "Someone else is holding the phone." | somebody else is |

Pressing it while you are on a call hangs up. That is the whole of hanging up —
there is no second control.

**The dropdown has no help text and no tooltips.** The list of phones is the
explanation. The one thing that IS said is the payphone's price, because you
are about to be charged and that has to be said before it happens.

## 4. Ringing, and why it is a row

A call is a `PhoneCall` row from the moment somebody lifts a receiver. The row
holds `ringsSent` and `startedAt`, and **nothing holds a timer**.

A 15-second sweep in `bot/src/events/ready.js` rings what is due. It is a
`setInterval` rather than a cron entry, because cron has no sub-minute
schedule, and it is the only sweep in the bot that runs faster than a minute.

The ring count is DERIVED from `startedAt` (`ringsDueBy`), never incremented
off a clock. That is what makes a bot restart mid-ring ordinary: a phone that
rang at 0s and then not again until the process came back at 45s is on its
fourth ring, not its second. It catches up rather than stretching the call.

**Only the first ring pings.** Ring one carries `@here`; the other three are
`-#` subtext. Four `@here` in sixty seconds is a fire drill, not a phone.

### Who the ping reaches, on both faces

This comes out right for free on Discord, and needs saying because it looks
like it should not. A Room is a thread under its Location's channel, and
Location visibility is a **per-member permission overwrite** written by
`db/lib/locationMove.js`. So `@here` in a Room thread reaches exactly the
people standing in that Location — not anybody who merely knows the place
exists, and not anybody seeing it through some other system.

On the web, `@here` notifies nobody and never has: `DiscordPing`
(`web/app/components/DiscordMarkupNodes.js`) draws the words inert on purpose.
The web's attention-getter is the **sound**. `phone-ring` rides
`ArchiveEntry.sfx`, and a row only reaches a browser whose feed carries that
place — so it plays for the people in the Location and for nobody else, which
is the same set. `phone-ring` is one of only two cues that reach a hidden tab
(`THROUGH_A_HIDDEN_TAB` in `web/app/components/sfx.js`); the other is being
named. A phone that stayed quiet because the tab was behind something else has
cost somebody the call.

**The intercom is not broken and needs no fix.** It pings correctly on Discord
(`parse: ["everyone"]`, `db/lib/intercom.js`) and deliberately not on the web,
where the token is stripped before the row is even written.

## 5. What a phone carries

`db/lib/phoneVoice.js`, hooked off `recordSpeech` beside the gate echo
(`db/lib/say.js`). Two voices, and the difference is the whole social design:

- **Whoever is holding the receiver** comes through clear:
  `You hear a voice saying "…"`
- **Everybody else in their room** comes through half-heard:
  `You hear a voice in the background saying "…"`, garbled through
  `db/lib/muffle.js` at `0.4` — the same fraction a shout loses one Location
  out (`db/lib/shout.js`).

So the Baron taking a call in his study is audible to the Ward, and so is
whoever is standing behind him, badly. **You cannot take a private call in a
crowded room, and you cannot be sure what the crowd behind the other person
just said.** That is the feature.

The caller's own room is untouched — everyone around them hears them normally.
Only the far room gets the handset version.

**A phone carries a voice, never a name.** Every line written into the far room
is a `SYSTEM` row with no character on it, so `db/lib/presentedIdentity.js`
never comes into it and a concealed caller stays concealed for free. A mention
token is flattened to a bare name first, so the outbox cannot relay a second
mention DM into a room the named person is not standing in.

Written through `recordArchiveMessage`, **never** `recordSpeech`, so a carried
line can never carry again — `gateEcho.js`'s rule, for the same reason.

A `SYSTEM` row is not posted to Discord by `feedOutbox.js` (it drains `WEB`
rows only), so `carryOverPhone` posts the Discord half itself, as `ambientLine`
subtext. A voice out of a handset is scenery in the room it lands in.

## 6. One receiver per phone, one per person

"The line is busy." is true rather than hopeful, and it is **four partial
unique indexes** that make it so, not a read-then-write:

```
PhoneCall_from_active_unique     one live call out of a room
PhoneCall_to_active_unique       one live call into a room
PhoneCall_caller_active_unique   one receiver per person, calling
PhoneCall_callee_active_unique   one receiver per person, answering
```

`placeCall` checks first for a good refusal message, then treats the `P2002`
those indexes raise as the busy signal — which is the only way to answer "is
this line free" without a race. Two offices dialling the Ward in the same tick
is ordinary; exactly one gets through.

The caller/callee pair is not implied by the room pair: without them, the same
character could be caller on one line and callee on another, in two different
rooms, which a person with two hands and one location cannot be.

**Prisma cannot express a partial unique index**, so these live only in the
migration's raw SQL. Measured: `prisma migrate diff` does not mention them in
either direction — it neither proposes dropping them nor notices they exist,
exactly as it treats `ThreatSpawn_pending_unique`. So there is no drop to
decline here; the danger is the other one. **A hand-written "fix drift"
migration must not remove them**, the same warning the `DirectMessage_notify`
trigger carries in CLAUDE.md. Without them the busy signal is a read-then-write
and races.

## 7. Hanging up

| How | Far end hears | Your end hears |
|---|---|---|
| you press Hang up | "The person hung up." + `phone-busy` | `phone-drop` |
| you leave the room | "The person hung up." + `phone-busy` | nothing |
| nobody answered | "Nobody picked up." + `phone-drop` | the same |

Being hung up on and running into a dead line are the same experience from the
receiving end, so both get the busy tone.

Walking out is silent on the side you left, because you are not there to hear
it and the room did not make a noise. `db/lib/locationMove.js` does it, which
is the writer **every** relocation runs — a teleport, a staged Relocate and a
rite hang up as surely as walking does — and it is behind `fromLocationId`, so
a GM Resync, a revive and a first placement are not moves and do not kill a
live call.

**A dead or vanished holder is swept up, not hooked.** `clearStaleCalls` runs
on every pass and ends any connected call whose holder is no longer ALIVE or no
longer standing by the phone. It is a sweep rather than another hook because
the hook list is never finished, and a stuck receiver wedges that phone for the
rest of the game. It heals within fifteen seconds whatever caused it.

## 8. The money

A payphone takes 1 ¢ in **real coin** out of the hand and into the Keep's
Vault, which is what "the treasury" means here — `takeFromVault` calls it that
in so many words. **No bank account is credited:** the Keep owns a payphone's
take, and there is no seat whose claim should swell.

The ledger reason is `PAYPHONE`, flow `TRANSFER` — not a SINK, for the same
reason `SLOTS` is not: the obol is still there, in a room, and somebody could
in principle come and take it.

**The charge is for lifting the receiver, not for a number.** A real payphone
gives your obol back when nobody answers; the nearest thing to that which needs
no coin return is simply letting you dial again. So a call that ends
`noanswer` or `busy` leaves the coin in the slot for `PHONE_PAID_GRACE_MS`
(2 minutes), and the modal reopens on the dial list. The alternative was
charging somebody four times to reach one person who happened to be walking
between rooms.

Named phones are free. The Baron is not renting his own wall.

## 9. The noises

Six cues, in `db/lib/sfx.js` and `web/app/components/sfx.js`. Five are the
OpenSourceWeb library's own phone sounds; `phone-drop` is the UI click, because
that library never recorded a cradle — the shortest, driest thing in the
folder, which is what a receiver going down sounds like.

| Cue | When |
|---|---|
| `coin-insert` | a payphone takes your obol |
| `phone-calling` | you dial a free phone |
| `phone-ring` | the far room, four times |
| `phone-pickup` | somebody answers |
| `phone-busy` | the line is busy, or you were hung up on |
| `phone-drop` | a receiver goes down |

`phone-ring` is the only one heard by a ROOM rather than by one person, which
is why it rides an `ArchiveEntry` and the other five ride an action result.
It is also the only one mixed up with the alarms rather than the furniture: it
has to carry across a room nobody is looking at.

## 10. Player-facing text is a placeholder

Every string in `db/lib/phoneText.js` is a stand-in. None of it has had
Bascinet's pass over it. **Rewrite them there**, in one place — the Discord
handler, the Chat dialog and the room lines all read the same object.

## 11. Files

| | |
|---|---|
| `db/lib/phone.js` | the network: dial, answer, hang up, the sweep |
| `db/lib/phoneText.js` | every number and every word. Zero requires |
| `db/lib/phoneVoice.js` | what a phone carries, hooked off `recordSpeech` |
| `db/lib/placeAffordances.js` | the one Phone button |
| `bot/src/events/interactions/rooms.js` | the Discord select and buttons |
| `bot/src/events/ready.js` | the 15-second sweep |
| `web/app/(app)/chat/PlacePanel.js` | `PhoneDialog` |
| `web/app/(app)/chat/actions.js` | `openPhone` / `dialPhone` / `answerPhone` / `hangUpPhone` |
| `db/test/phone.test.js` | the cadence and the two voices |
