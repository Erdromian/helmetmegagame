# Strangers

Somebody you cannot put a name to is shown as what they look like: "a young
man", "an old woman". This is built from Bascinet's own design document,
`E:\Bascinet\V3\Memories\Strangers.docx`. §1 is that document. Everything after
it is how the game does it.

It builds on two older systems. The hood (`PROXYING.md` §5) already showed a
covered face as an alias. The Friends list (`MEMORIES.md` §2) already recorded
who a character knows. This doc joins them: a face with no Friends entry is
treated much like a hood.

## 1. The design, as written

> When a character sees another character whose face they are unable to either
> see or recognise due to them never having met before (and them not being in
> your list of friends), or being concealed will appear as a young/old
> man/woman. If there are multiple concealed individuals with the same
> concealed name, a list of random labels is attached to each for the duration
> of the interaction.
>
> Randomly selected labels: On the left, On the right, At the back, In front,
> Behind, Head bowed, Fidgeting, Hunched, Scratching their chin, Looking away,
> Motionless.
>
> These labels are applied randomly when an individual conceals themselves or
> moves to a different location. The intention is that two similar concealed
> individuals can be distinguished in a single encounter but not recognised
> beyond that point. Labels are not local, so that different observers can
> coordinate which concealed individual they are concerned with. These labels
> are also applied when targeting a character for an action.
>
> When a concealed individual speaks, every observer there applies a local
> label number to their name for the messages they send in chat (this label is
> only applied to the concealed individual's name in chat, not in the who's
> here or any other place). The number selected corresponds to how many other
> concealed individuals an observer has seen.
>
> Example: two observers hear a concealed individual speak. The first observer
> has heard 3 other concealed individuals speak prior to this point, so the
> local label applied is (4), for the other observer it is the first concealed
> individual they have heard talking, so the label (1) is applied.
>
> Each number label corresponds to a unique character, if an observer hears a
> concealed character who they have heard speak while concealed before, they
> will have the same number label again. These numbers are designed to not be
> universal between observers, as they seek to replicate the recognition of
> someone by their voice.
>
> The number label is removed locally from a concealed individual's name for an
> observer when the concealed individual moves location, it is reapplied when
> they next speak.
>
> Emotes not contained within quotation marks do NOT constitute speech, and no
> number label or voice recognition is gleaned from them.
>
> All these mechanics are applied to characters not recognised by a character,
> even if their face is not concealed.

Bascinet settled three open points on 2026-09-25:

- Name learning (`MEMORIES.md` §2b) uses the same test for speech. A name or a
  role is learned only from words inside quotation marks.
- Somebody you do recognise is shown under their real name, not under whatever
  your Friends entry calls them.
- "Moves to a different location" means a change of Location. Stepping between
  Rooms or into a conversation inside one Location is not a move.

The Memories design also asked that an unhooded stranger keep their estate
colour, since the colour is on their clothes, not in anyone's memory.

## 2. Who is a stranger

To a character, somebody is **hidden** if either of these is true:

- **Hooded:** their face is covered (`PROXYING.md` §5; nothing about hoods
  changed).
- **A stranger:** their face shows, but the viewer has no Friends entry for them
  (`Acquaintance` with that `subjectId`).

A forced name ("Beast", a Disguise Kit) is neither. It is a name the whole room
reads. You always know yourself.

The decision is made once, in `db/lib/whosHere.js#presentRows`, which now marks
a row `stranger` as well as `hidden`. Everything that already read that answer
now treats a stranger the way it treats a hood:

- Who's here and the Discord readout
- Every people picker (`web/lib/peopleHere.js`, `peoplePools.js`)
- The escort rack (`db/lib/escort.js`)
- Token resolution (`resolveHoodToken`, `db/lib/targetKey.js`)
- The plain-id guard (`hiddenFrom`)

So a stranger is offered under a token, and a plain id posted by hand for one is
refused like a hood's. A conversation's or private room's member strip
(`db/lib/presentedMembers.js`) applies the same rule on its own.

Two things set a stranger apart from a hood:

- **The face shows.** Nothing covers it. The face is served by token
  (`/api/avatar/here/<token>`) or by chat line (`/api/avatar/line/<seq>`), never
  by id. With no uploaded portrait it is the blank plaque: the usual default is
  the first letter of the first name, which a stranger must not give away. The
  @-mention directory (`web/lib/mentionDirectory.js`) lists everybody by name,
  so for a stranger it wears the plaque of that name rather than their portrait,
  or the page could match the face to the name.
- **The estate colour shows**, as it does for anyone.

There is no stranger rule when there is nobody to recognise with: a GM, the
Discord bot's own readouts, a ghost, somebody in the lobby. Those see what they
saw before.

Learning a name (`MEMORIES.md` §2b) turns a stranger into somebody you know, at
once and everywhere. That includes their older lines, which are drawn through
the lens again on the next read. Forgetting somebody on `/memories` makes them a
stranger again.

## 3. Labels

`Character.presenceLabel` holds one of Bascinet's eleven labels, written
lower-case to sit mid-sentence: "a young man, hunched". It is **the same for
every observer**, so two players can agree which young man they mean.

A label is shown only where it is needed. Who's here, a member strip and every
picker attach it when **two or more** of the people they list share an alias.
Somebody alone under their alias carries none. A label never appears on a chat
line, whose names carry voice numbers instead (§4).

**When it is rolled:**

- **Moving.** `locationMove.js#applyArrivalFacts` clears the label, because
  every relocation runs through it: walking, a GM teleport, Charon, a rite, a
  staged Relocate, a spawn, reincarnation.
- **Covering or uncovering the face.** `presenceHidden` records whether the
  person was hidden from everyone when the label was rolled. When that no longer
  matches, the label is stale. This covers every path at once: the conceal
  switch, equipping, a stolen hood, a sack that forces concealment.
- **Rolled lazily.** A stale or cleared label is rolled by
  `db/lib/strangers.js#settlePresence` the next time anybody looks at the
  Location. It picks a label nobody else there holds. A room with more than
  eleven people has to repeat one.
- **Races.** The write is conditional on the nonce it replaces, so two readers
  rolling at once agree on one label.

**The token changes with the label.** `Character.presenceNonce` is rolled with
it, and the hood token a list offers is now an HMAC of the id and that nonce
(`db/lib/hoodToken.js`). It used to be an HMAC of the id alone, which was the
same forever: a fingerprint that followed somebody from scene to scene
(PR #191). Now a token dies with the encounter. One minted before a move or a
change of hood resolves to nobody, which is the safe way to fail.

## 4. Voice numbers

`VoiceMemory` holds one row per (observer, speaker): the observer's own number
for that voice, and whether it is `live`.

**Hearing a voice.** `db/lib/memoryHearing.js#hearVoice` runs for every line
before it is written (`db/lib/say.js#recordSpeech`, both faces). The line
reaches each hearer already wearing their number.

- **Who hears:** everyone ALIVE and standing in the place, awake, not the
  speaker. The places are a Location, a Room, a conversation or a party, never a
  zone summary. This is the same audience as name learning.
- **Who counts the voice:** a hood is an alias to everyone, and a bare face is
  an alias to anybody without a Friends entry for the speaker. A forced name
  gives no voice.
- **Only speech counts.** `db/lib/speech.js#spokenText` finds the words inside
  quotation marks by the same rules the browser uses to tint speech
  (`web/app/components/remarkChat.js`): straight or curly marks, opening onto a
  word, no line break, at most 400 characters. "*nods*" gives nothing.
- **Numbering:** a new voice gets the hearer's next number. A voice heard before
  keeps its number and goes live again. Numbers are per observer and never
  change.
- **Moving goes dark.** The speaker moving to another Location sets every
  hearer's number for them to not live, in `applyArrivalFacts`.
- **Not heard:** a ghost's line, a line recovered late and an edit.

**Showing it.** A chat line from somebody the reader sees under an alias reads
"Young Man (3)" while that number is live for them. It shows on every one of the
speaker's lines, emotes included, the way the doc says the number goes on their
name for the messages they send. The number is read when the line is drawn, not
frozen onto the line. So when the speaker moves on, their older lines lose it
too on the next read, and speaking again brings it back to all of them.

## 5. The chat lens

A feed row is built once and sent to everyone reading the place
(`web/lib/feedHub.js`). So what each reader sees is decided per reader, on the
way out, by `db/lib/strangers.js#lensRow`.

`archive.js#feedRowShape` carries the real speaker on a hidden, non-enumerable
symbol. JSON and a spread copy both drop it. The symbol comes from the global
registry (`Symbol.for`), because the web app can load `db/lib` more than once
and each copy must see the same one.

The lens does this to a row:

| Row | This reader sees |
|---|---|
| Their own | Unchanged, including the stable key their page compares against (`self.speakerKey`) |
| A GM's view | Unchanged; `web/lib/gmSpeakers.js` still reads the stable key |
| Known face | Unchanged |
| Stranger's face | Alias name plus live number; no `characterId`; face by line; estate colour kept |
| Hood | Alias name plus live number |
| Forced name | The forced name |

For both a stranger and a hood, the stable `speakerKey` is replaced by
`sceneSpeakerKey(id, placeKey, turn)`, which groups one scene's run of lines and
nothing beyond it. So does a forced name.

Every surface that hands rows to a browser goes through one:

- the stream (`api/feed/route.js`, in order, through one queue, including the
  catch-up)
- `/chat`'s first paint
- history and search
- the day's lines on `/memories`

Typing notices go through `lensTyping`: a stranger or a hood types as their
alias, under a key that is not their id. The name-learning lessons do not look
at the lens at all; they match real names server-side.

`/archive` is unchanged. It opens only after the game and prints "alias (Real
Name)".

## 6. Looking, and what DMs call people

- **Looking** (`db/lib/examineRow.js`): a look at a bare-faced stranger's line
  reads their alias as the name and their face by line. A photograph does too.
  A GM and a ghost read the name.
- **The Look dialog's list** (`examineActions.js#peopleToExamine`) names
  strangers by alias. It keys every row by the line heard, never by character
  id.
- **DMs:** `db/lib/intercept.js#seenBy(db, viewerId, row)` is `seenAs` for one
  reader, a stranger reading as "a young man". Every `seenAs` site whose words
  go to one character now uses it: Attack and its list, Search, Pickpocket,
  Intercept, a declined or expired offer, the Break-off button, the sheet's and
  `/chat`'s waiting-on-you lists.

## 7. What this does not reach yet

- **Discord.** A webhook carries one name for everybody in a channel, so
  Discord keeps the old behaviour: a hood is an alias, a bare face is a name.
  Discord's Who's here readout does follow the rule, since it is built per
  viewer.
- **Baked scenery lines.** Lines that bake a name into their text can't be
  relabelled per reader without storing who each line is about:
  - arrival and departure lines (`db/lib/roomAnnounce.js`)
  - shouts
  - phone carries
  - "X was let in."
- **Verbs that write `.name` straight into a DM**, never through `seenAs`, still
  name a stranger outright. These include Kiss, Bind, Collar, Heal and the other
  medical verbs, lesson offers, and corpse and blood abilities. Each needs
  `seenBy` at its own call site; about 180 lines across ~20 files.
- **The conversion rite's pick list** goes to the whole circle at once, so it
  can't be worded per reader.

## 8. Where the code lives

| Concern | File |
|---|---|
| Recognition, labels, the lens, typing | `db/lib/strangers.js` |
| What counts as speech (pure) | `db/lib/speech.js` |
| Hearing a voice | `db/lib/memoryHearing.js#hearVoice` |
| Who is hidden, labels on lists | `db/lib/whosHere.js`, `db/lib/presentedMembers.js` |
| Tokens and scene keys | `db/lib/hoodToken.js` |
| Clearing on a move | `db/lib/locationMove.js#applyArrivalFacts` |
| DM wording per reader | `db/lib/intercept.js#seenBy` |
| Looking | `db/lib/examineRow.js`, `db/lib/examine.js` |
| Faces without ids | `web/app/api/avatar/here/`, `web/app/api/avatar/line/`, `web/lib/avatarResponse.js` |
| The lens on the web | `web/lib/strangerLens.js`, `web/app/api/feed/route.js` |
| Schema | `Character.presenceLabel` / `presenceNonce` / `presenceHidden`, `VoiceMemory` |
| Tests | `db/test/strangers.test.js`, `presentedMembers.test.js`, `roomGuests.test.js` |
