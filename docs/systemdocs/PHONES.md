# Phones

The telephone network. A phone is a fixture on a Room's wall with a four-digit
number. You pick up the receiver, dial a number on the keypad, and the phone
with that number rings until somebody answers it.

**This doc follows Bascinet's design document, `Phones.docx`** (§1–§7 below are
its rules). Where the document is silent, the system keeps what it did before
the overhaul, and those places say so.

**Read this before touching `db/lib/phone.js`, `db/lib/phoneVoice.js`,
`db/lib/phoneNumbers.js`, `Room.phone` or any `Room.phone*` column.**

## 1. The shape of it

| | |
|---|---|
| Where a phone lives | `Room.phone`, a NAME, authored in `docs/zones.yaml` |
| Its number | `Room.phoneNumber`, four digits, rolled at every Start Game |
| How you call | a keypad: four digits, then Dial |
| Who can be rung | every phone, payphones included |
| Who holds a phone | one person at a time, `Room.phoneHolderId` — and a held phone with no call still rings |
| What a call costs | nothing at a named phone; 1 ¢ at a payphone to dial or to answer, which buys 10 minutes |
| How long it rings | until somebody answers — capped at the caller's 10 idle minutes |
| Who hears the ring | the phone's own Location loudly, the Locations next to it faintly |
| What crosses the line | a VOICE, never a name — clear to the far holder, half-garbled to everybody else |
| Where to find a number | on the phone itself, or in a Phonebook |

## 2. Numbers and the Phonebook

Every phone has a four-digit number, 1000–9999, **random and stored, never
authored.** `docs/zones.yaml` and this repository are public, so a number
written down anywhere, or worked out from anything a player can read, is one
somebody could look up before the game began.

`db/lib/phoneNumbers.js#rollPhoneNumbers` re-rolls every phone inside Start
Game's transaction (`db/lib/lobby.js#commitAssignment`), so last game's numbers
are worthless. A phone with no number — one a GM added at `/gm/dev/zones`, or
every phone in the game already running when the overhaul landed — is given one
the first time somebody picks it up (`ensurePhoneNumbers`). The column is unique
and the write is conditional, so two people picking up two new phones at once
cannot land on one number. A GM reads each phone's number, read-only, on its
room at `/gm/dev/zones`.

**The only places a number is matched to a phone** are the phone itself ("This
phone's number is 3365.") and the **Phonebook**.

### The Phonebook

A document tag, `phonebook` in `docs/tags.yaml`: a BOOK (`paperKind`), so it is
read by holding it and never through the catalog. Every copy is the same Tag
row, so one write reprints all of them: `writePhonebook` sets `Tag.paperText` to
every phone's name and number, named phones first and then the payphones, each
alphabetical. It runs after every roll, and after `ensurePhoneNumbers` numbers
anything. `gameWritesText: true` on the YAML entry keeps the tag sync from
printing the placeholder `bookText` back over the numbers on the next deploy
(`db/lib/syncTags.js`, the `gameWrittenSeal` precedent).

Copies start in locked rooms, one each unless noted (`docs/zones.yaml` `stash:`,
and migration `20261101000000_phone_overhaul` for rooms that already exist):

| Where | Room |
|---|---|
| Order Chambers | `town-4-3` Order Chambers |
| The Merchant's | `undertown-6-2` Merchant's Office |
| The Keep (3) | `fortress-4-1` Council Room, `fortress-4-6` Baron's Study, `fortress-4-7` Storehouse |
| The Den | `undertown-8-2` Dressing Room |
| The Lifeweb | `undertown-3-3` Mortus Shacks |
| The Inn | `town-7-6` Cellar |
| The Gatehouse | `town-1-2` Gate Controls |
| The Cerberon (3) | `fortress-1-2` Censor's Office, `fortress-1-3` Barracks, `fortress-1-5` Armory |

On a running game the migration only writes the seed; the copies arrive at the
next Start Game or wipe, which is when `db/lib/roomStashSeed.js` pours it.

## 3. Holding a phone

**Holding a phone is not being on a call.** Pressing a room's **Phone** button
picks the receiver up — `Room.phoneHolderId` is set with a conditional update,
so of two people reaching for it exactly one gets it — and from then on it is in
your hand until you let go of it:

| Button | What it does |
|---|---|
| **Dial** | rings the number on the keypad (only with no call on the line) |
| **Hang up** | ends the current call; **the phone stays in your hand** |
| **Walk away** | lets go of the phone **without** hanging up — the line is left as it is for whoever picks it up next |
| **Insert obol** | a payphone's next 10 minutes |

`phoneHolderId` is a unique index, so one person holds one phone: picking up a
second phone lets go of the first. Opening a phone somebody else holds says
"Someone else is using the phone." Opening a phone left hanging mid-call makes
you the holder on that call.

**Answering is opening the phone.** A named phone that is ringing is answered by
pressing Phone. A ringing payphone asks for its coin first ("Insert obol").

**A phone in your hand still rings.** Holding a phone at a dial tone is not
being on a call, so it is not busy: a call to it rings there, the dialog and the
handset bar (and the Discord keypad) grow an **Answer** button, and reopening the
phone answers it too. Hang up while it rings turns the caller away — to them it
is a call hanging up, dead line and all. If you walk away, or are ejected, while
it rings, the phone goes on ringing on the wall for whoever comes to it.

### The clocks

All derived from timestamps on the Room, never a timer (rule 3 in
`db/lib/phone.js`); the 15-second sweep applies them (`holderVerdict`):

- **A payphone** runs on `phonePaidUntil`. Dialling or answering with no time
  paid takes 1 ¢ and buys `PHONE_PAID_MS` (10 minutes). In the last
  `PHONE_OBOL_PROMPT_MS` (1 minute) the dialog shows "The phone wants another
  1 ¢." and an Insert obol button; the sweep says it once into the room too, for
  a Discord holder. At 0:00 the holder is ejected and any call hangs up. A coin
  in the last minute adds to it rather than throwing it away. Paid time belongs
  to the phone, not the person: walk away and whoever picks it up inherits it.
- **Any phone** drops its holder after `PHONE_HOLD_IDLE_MS` (10 minutes) with no
  call connected (`phoneIdleSince`). Dialling restarts the clock.
- **Leaving the Location** hangs up and lets go, as it did before the overhaul
  (`db/lib/locationMove.js`). The design document's Walk away is a button, not a
  side effect of walking. A holder who dies or vanishes is swept up the same way.

## 4. Dialling

`db/lib/phone.js#dialNumber`. The keypad sends four digits (`normalizeDigits`
refuses anything else — both faces send untrusted strings).

| The number | What happens |
|---|---|
| belongs to no phone | `phone_calling` for `PHONE_MISDIAL_MS` (3 s), then the error sound and "The number you are trying to call is no longer in service." into your room's chat |
| is busy — a call on its line (ringing, connected, or a dead line whose holder has not hung up), or this very phone | the same wait, then "The number you are trying to call is currently busy." |
| is free | a RINGING call; `phone_calling` at your ear until somebody picks up |

The wait is honest: the server action (and the Discord handler, after its ack)
sleeps for it, so both faces hear the same tone for the same time. The error
sound is the dialler's own — it is in their ear, not on the wall.

**Busy means a call is on the line**, never just a phone in somebody's hand
(§3). It is decided under a row lock: both Room rows are locked `FOR UPDATE` in
id order, then the far phone's dead line and every live call at either phone
are checked, and only then is the call written. The lock matters because the
two partial unique indexes on `PhoneCall`'s rooms (§7) only stop a room being
the FROM end twice or the TO end twice, not ringing out while it is being rung.

## 5. Ringing

A RINGING call rings its phone every `PHONE_RING_INTERVAL_MS` (15 s) **until
somebody answers**, with "The phone rings urgently." into the room each time.
The count is derived from `startedAt` (`ringsDueBy`), so a bot restart catches
up rather than stretching the ring. The design document does not say how long a
ring may last; it stops when the caller hangs up, walks off or is ejected, and
at the latest after `PHONE_RING_CAP_MS` — the same 10 minutes a caller standing
there with no call connected would be dropped after. Then the caller's room
reads "Nobody picked up."

**Only the first ring pings.** Ring one carries `@here` on Discord; the rest are
`-#` subtext. `@here` in a Room thread reaches exactly the people in that
Location, because Location visibility is a per-member overwrite
(`db/lib/locationMove.js`).

**The bell is a loop, not a line** (§8): the rows carry no sound.

## 6. What a phone carries

`db/lib/phoneVoice.js`, hooked off `recordSpeech` beside the gate echo
(`db/lib/say.js`). For a line said at phone A of a connected call to phone B:

| Said by | B's holder reads | Everybody else in B reads |
|---|---|---|
| A's holder | `You hear a voice saying "…"`, **clear** | the same, **half-garbled** |
| anybody else in A | `You hear a voice in the background saying "…"`, **half-garbled** | nothing |

With nobody holding B, B's room reads A's holder half-garbled and nothing else.
The garble is `db/lib/muffle.js` at `PHONE_BACKGROUND_MUFFLE` (0.4), rolled once
per line so every copy agrees. The near room is untouched.

**Two voices at one place are two rows.** `ArchiveEntry.onlyCharacterId` makes a
row one reader's alone; `exceptCharacterId` keeps a row from one reader. Both
are hidden on the shaped row (`db/lib/strangers.js#attachAudience`, a symbol
like the speaker's) and never put on the wire — an id on a room row would say
who is holding the phone. `db/lib/strangers.js#readsRow` decides per reader, and
every surface that hands feed rows to a browser already runs that lens: the
stream, history, search, the page load and `/memories`. A GM reads both.
`memoryHearing.logHeard` files each row only for its readers.

**On Discord** a thread shows every reader the same message, so the thread gets
the room's version. A holder who picked the phone up **on Discord**
(`Room.phoneHeldVia`) also gets their own line as a DM (`source: "phone"`,
a NOTICE). A web holder reads theirs in web chat.

**A phone carries a voice, never a name.** Every line is a `SYSTEM` row with no
character on it, so a concealed caller stays concealed. Mentions are flattened
first. Lines are written through `recordArchiveMessage`, never `recordSpeech`,
so a carried line can never carry again. **And a phone never records where a
call came from** — no log, no caller ID, and the audit row keeps the number
dialled, not the phone it reached.

## 7. Hanging up, and the dead line

Hang up plays `phone_pickup` at both ends (the design document's choice of
sound). If the far end has a holder, their phone goes **dead** in their hand
(`Room.phoneDeadSince`): "The call hung up." into their room, and `phone_busy`
on loop at their ear until they hang up too. A dead line is busy to callers. If
nobody holds the far end, the call simply ends — the document only describes a
busy tone for "the person who has yet to hang up".

A connected call with nobody holding either end is over; so is a dead line with
nobody at it (the sweep tidies both).

### One call per phone, one phone per person

- `PhoneCall_from_active_unique` and `PhoneCall_to_active_unique` — one live
  call out of and into each room, `WHERE status IN ('RINGING','CONNECTED')`.
  **Prisma cannot express a partial unique index**, and `migrate diff` does not
  mention them either way. **A hand-written "fix drift" migration must not drop
  them.**
- `Room_phoneHolderId_key` — one phone in one hand, a plain unique index.

The two per-person partial indexes the first version had
(`PhoneCall_caller_active_unique`, `PhoneCall_callee_active_unique`) were
dropped by `20261101000000_phone_overhaul`. They meant "one receiver per
person" only while a receiver could never change hands; now it can, and the
holder column says it directly.

## 8. The noises

Cues in `db/lib/sfx.js` and `web/app/components/sfx.js`:

| Cue | File | When |
|---|---|---|
| `coin-insert` | `coininsert` | a payphone takes your obol |
| `phone-calling` | `phone_calling` | **loop** at the caller's ear while it rings out, and during a misdial's wait |
| `phone-ring` | `phone_ring` | **loop** in the ringing phone's Location |
| `phone-ring-far` | `phone_ring` | **loop**, faint, in the Locations next to it |
| `phone-pickup` | `phone_pickup` | somebody answers; either end hangs up |
| `phone-busy` | `phone_busy` | **loop** at a dead line's holder's ear |
| `phone-error` | `console_error` | a number not in service, or busy |
| `phone-drop` | `click` | walking away from the phone |

**The loops are states, not events.** They cannot ride an `ArchiveEntry`, so the
web feed carries a `phones` frame instead (`db/lib/phoneFrame.js`, the
Performance frame's shape): a NOTIFY on the feed channel names the Locations
that could hear a change, and every stream standing in one of them re-reads its
own `{ ring: "near" | "far" | null, handset }`. `web/app/components/phoneStore.js`
turns it into `setPhoneTones`, which holds up to two tracks (the bell, and
whatever is at your own ear) on a map of their own: an ordinary cue does not
stop them, and they play through a hidden tab, as the ring always has. Discord
has no sound.

## 9. The two faces

**Web** (`web/app/(app)/chat/PlacePanel.js`): the Phone button opens a keypad
dialog — the phone's number, what the line is doing, a payphone's countdown, a
four-digit readout, the 3×4 pad (the number keys work too), Dial, Hang up, Walk
away and Insert obol. Closing the dialog **does not** put the phone down: the
holder has to be able to type into the room, which is how you talk down a
phone. The **handset bar** at the top of the right column shows the phone in
your hand, its state and its clock, with Keypad, Hang up and Walk away. Where
that column is folded into its 👥 drawer (under 900px, a phone), the bar sits
over the scene instead, in the fixture strip under the travel strip, beside
the room's own Phone button (`next/FixtureStrip.js`, `CHAT.md` §5). So a
phone ringing in your hand shows its Answer button whether the drawer is open
or not. The keypad and every other fixture dialog are drawn at chat's root
(`next/ChatNext.js`), so shutting the drawer never takes one with it.
Actions: `openPhone`, `answerPhone`, `dialPhone`, `insertPhoneObol`,
`hangUpPhone`, `walkAwayPhone` in `web/app/(app)/chat/actions.js`.

**Discord** (`bot/src/events/interactions/rooms.js`, `db/lib/phoneKeypad.js`): the
Phone button draws the same keypad as an ephemeral message of buttons — 1–9, ⌫ 0
Dial, then Hang up, Walk away and Insert obol. The digits typed so far ride in
each button's custom id (`room:phone:key:<roomId>:<digits>`), and every press
redraws the message in place, so nothing is stored between presses. The panel is
not fleeting. The payphone's clock is a `<t:…:R>` timestamp, which counts down
by itself. Every phone custom id starts `room:phone:`, so
`interactionCreate.js` routes the keypad's before the plain open.

## 10. Player-facing text

`db/lib/phoneText.js` holds every word. The design document's own sentences are
marked there; the rest are placeholders that have not had Bascinet's pass.
**Rewrite them there**, in one place — both faces and the room lines read it.

## 11. Files

| | |
|---|---|
| `db/lib/phone.js` | holding, dialling, answering, hanging up, the sweep |
| `db/lib/phoneNumbers.js` | the numbers, the Phonebook, the Start Game reset |
| `db/lib/phoneFrame.js` | the web's `phones` frame and its NOTIFY |
| `db/lib/phoneKeypad.js` | the Discord keypad's words and buttons |
| `db/lib/phoneText.js` | every number and every word. Zero requires |
| `db/lib/phoneVoice.js` | what a phone carries, hooked off `recordSpeech` |
| `db/lib/strangers.js` | `readsRow`: who reads a row meant for one person |
| `db/lib/placeAffordances.js` | the one Phone button |
| `bot/src/events/interactions/rooms.js` | the Discord keypad |
| `bot/src/events/ready.js` | the 15-second sweep |
| `web/app/(app)/chat/PlacePanel.js` | `PhoneDialog`, `PhoneHandsetBar` |
| `web/app/components/phoneStore.js` | the frame, and the held tones |
| `db/test/phone.test.js` | the numbers, the clocks, the keypad, the two voices |
