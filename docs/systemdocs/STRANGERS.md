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

A public forced name ("Beast") is neither. It is a name the whole room reads.
A Disguise Kit's name is the exception: it is a new face with a name on it,
which only some viewers can put to it (§10). You always know yourself.

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
- **What they plainly are shows.** A tag in `concealedIdentity.js#LOOK_WORDS`
  puts its word between the age and the sex: a Skinless is a "Young Skinless
  Man" (`SKINLESS.md` §5).

There is no stranger rule when there is nobody to recognise with: a GM, the
Discord bot's own readouts, a ghost, somebody in the lobby. Those see what they
saw before. Nor is there one when a GM has switched it off (§9).

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
  quotation marks by the same rule the browser tints speech with
  (`web/app/components/speechRuns.js` calls it): any double quote mark opens
  and any closes, straight or curly, whichever way it faces (a phone types “
  after a dash); opening onto a word, over line breaks and blank lines, any
  length, and no other character inside can stop it. "*nods*" gives nothing.
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

- **Over a counter** (`MAP.md` §2d): the people on the far side of a room that
  opens onto several Locations are listed in Who's here under the room, by the
  same `presentRows` rows, so a stranger there is a stranger and a hood a hood.
  They get the eye and no menu. A hidden row carries a `lookRef`, never a
  token: `whosHere.js#resolveCrossRoomRef` answers it for `/look` and a
  stranger's face, and nothing a verb resolves through ever calls it.

- **Looking** (`db/lib/examineRow.js`): a look at a bare-faced stranger's line
  reads their alias as the name and their face by line. A photograph does too.
  A GM and a ghost read the name.
- **The Look dialog's list** (`examineActions.js#peopleToExamine`) names
  strangers by alias. It keys every row by the line heard, never by character
  id.
- **DMs:** `db/lib/intercept.js#seenBy(db, viewerId, row)` is `seenAs` for one
  reader, a stranger reading as "a young man". Every `seenAs` site whose words
  go to one character now uses it: Attack and its list, Search, Pickpocket,
  Intercept, Kiss, a declined or expired offer, the Break-off button, the
  sheet's and `/chat`'s waiting-on-you lists.
- **One function decides it.** `seenBy`, and `seenByMany(db, viewerId, rows)`
  for a list, are the only place a line to one reader decides what to call
  somebody. `seenBy` is `seenByMany` of one, so the two cannot disagree, and a
  list costs one Friends lookup rather than one a row. `seenById` and
  `seenByIdMany` are the same for a caller holding ids. So when what a reader
  knows people by changes, it changes there and nowhere else.
- **Every verb done to somebody else** names them through it too, in the
  refusal, the line handed back to the actor, and the DM to the other side:
  Bind, Free, Crucify, Shackle, Brand, Harm, Torture (until a break tells the
  name), Mutilate, Loot, using an item on somebody, Heal and its Gambit's
  result, Perform Miracle, Apply and Unlock Collar, Escort, Lessons,
  Confession, Transfer's "handed you", a person paying for a cure or a craft,
  letting somebody go from an Intercept, the lines about who came along
  on a move, and the Lifeweb's Donate Blood and Feed Person (whose picker is
  the ordinary same-place roster, and prices only the blood of people the
  Mortus can name — a price is a rank). Most callers hold only an id or a narrow row, so they use
  `seenById(db, viewerId, id)`, which loads what `seenBy` needs. The web's
  `web/lib/hereTarget.js#seenName` is the same, capitalised to open a
  sentence.
- **The last of them** went through it in a second sweep: who "couldn't
  follow" or is being held back on a Discord move, a lesson or confession a GM
  calls off, a bloodcrazed vampire's Move ("feeds on a young man"), Enthral and
  Nourish's refusals, "already has that" when handing something over, a GM
  moving ⬢ between two players, and who is at the vending machine. A payer
  running out of ⬢ halfway through a cure or a craft names nobody at all.
- **Nothing goes to a browser that the page does not print.** A server
  action's answer reaches the browser whole, drawn or not. So a conversion
  pick answers with its sentence alone; who was picked stays on the rite's row
  for the GMs.
- **Highlights** (`web/lib/starNote.js`) are filed under the name their keeper
  saw on the line (`strangers.js#keptSpeaker`): a stranger's line is kept as
  "Young Man", with no face, never under the real name the row holds. A star
  from Discord keeps the name the webhook posted under, which is all a Discord
  reader saw.
- **The conversion rite's pick list** goes out as one DM per chanter, so each
  list is worded for its reader, and an option is a code made for that
  chanter rather than a character id (`THANATI.md` §4a).
- **A refusal at Accept** goes to two people, so each handshake words it
  twice: "You're already bound." to whoever pressed Accept, and "A young man
  is already bound." to the asker. Bind, Collar, Lessons and Confession all
  do this now, as Kiss does.
- **A line the whole place reads** can't be worded per reader (§7), but it
  never names a hood: `intercept.js#seenByPlace` is the face the room saw.
  The cross ("X hangs on the cross."), a collar going off, praying at Xom's
  shrine, Xom moving somebody and the conversation it opens, and Judgement's
  "X explodes into mist!" use it.

## 7. What this does not reach yet

Every line written for ONE reader now names people through `seenBy` — the
DMs, the notices, the refusals, the lines handed back, the Move descriptions.
That gap is closed. What is left is either a line many people read, or a name
the game is meant to say.

- **Discord.** A webhook carries one name for everybody in a channel, so
  Discord keeps the old behaviour: a hood is an alias, a bare face is a name.
  Discord's Who's here readout does follow the rule, since it is built per
  viewer. A `{char:…}` chip only goes to Discord as the person's role when it
  was frozen under their own name (`characterMentions.js#tokensToRoles`): a role
  prints the real name to the whole channel, so a chip frozen as a hood's
  "Young Woman" or a forced "Beast" goes out as that text instead. The relay push
  to the person named still goes.
- **Baked scenery lines.** Lines that bake a name into their text can't be
  relabelled per reader without storing who each line is about:
  - arrival and departure lines (`db/lib/roomAnnounce.js`)
  - shouts
  - phone carries
  - "X was let in."
- **Place lines about a bare face** — the cross, a collar going off, a prayer
  — name them, the same as arrivals. Only a hood is kept out of them. A fight's
  announcement is the exception, and the way to close the rest: it stores a
  template and its people on `ArchiveEntry.subjects`, which the lens renders
  per reader (`db/lib/peopleLine.js`), and on Discord it is relayed as a DM to
  each player there instead of posted (`ATTACK.md` §1).
- **Names a place is called by.** A party is "Ada's Party" and a conversation
  Xom opens is "Ada & Bo", on the Discord thread and on the web alike. A hood
  is its alias in both; a bare face is named.
- **Bodies.** A corpse is an item named after the dead ("Ada's Corpse"), so
  Bury, Engrave and Mutilate on a body name them. That is how bodies work
  (`CORPSES.md`), not a leak this rule closes. Death notices and the
  transcript's own records name the dead too.
- **Names the game is meant to say.** These tell a reader a real name on
  purpose, and stay that way:
  - anything that finds a person BY name, which only matches the real one: an
    arrest warrant, Excommunicate and Engrave (typed), and the Bird's list of
    who to write to (every character, by name — `BIRD.md` §2)
  - a torture break, and the Rite of Omniscience ("Their name is …"), which
    exist to tell it
  - the Thanati knowing one another (Recall Comrades)
  - the treasury's ring register, and the Depot's list of bank accounts
  - the @-mention directory (`PROXYING.md` §5)
  - every GM surface
- **An open question: the Bird.** A letter arrives saying who it is from, by
  real name, and so does its reply (`db/lib/bird.js`). Whether a letter from
  somebody you have never met should say so is a design call, not a leak this
  sweep closed, so it is left as it was.
- **Somebody you know** is still shown under their real name, not under what
  your Friends entry calls them (§1). That is Bascinet's rule from
  2026-09-25, and changing it is a change to `seenBy`.

## 8. Where the code lives

| Concern | File |
|---|---|
| Recognition, labels, the lens, typing, the GM's switch | `db/lib/strangers.js` |
| What counts as speech (pure) | `db/lib/speech.js` |
| Hearing a voice | `db/lib/memoryHearing.js#hearVoice` |
| Who is hidden, labels on lists | `db/lib/whosHere.js`, `db/lib/presentedMembers.js` |
| Tokens and scene keys | `db/lib/hoodToken.js` |
| Clearing on a move | `db/lib/locationMove.js#applyArrivalFacts` |
| DM wording per reader | `db/lib/intercept.js#seenBy`, `seenByMany`, `seenById`, `seenByIdMany`, `seenByPlace`; `web/lib/hereTarget.js#seenName` |
| What a Highlight is filed under | `db/lib/strangers.js#keptSpeaker`, `web/lib/starNote.js` |
| A chip on its way to Discord | `db/lib/characterMentions.js#tokensToRoles` |
| Looking | `db/lib/examineRow.js`, `db/lib/examine.js` |
| Faces without ids | `web/app/api/avatar/here/`, `web/app/api/avatar/line/`, `web/lib/avatarResponse.js` |
| The lens on the web | `web/lib/strangerLens.js`, `web/app/api/feed/route.js` |
| Who a disguise fools (§10) | `db/lib/disguises.js` |
| Schema | `Character.presenceLabel` / `presenceNonce` / `presenceHidden`, `VoiceMemory`, `Acquaintance.disguiseKey`, `ArchiveEntry.disguised` / `disguiseGroup`, `Tag.disguiseJob` / `disguiseJobSlug` |
| Tests | `db/test/strangers.test.js`, `presentedMembers.test.js`, `roomGuests.test.js`, `verbFaces.test.js`, `seenByMany.test.js`, `disguises.test.js`, and `strangerNameCanary.test.js` — every builder that names somebody to one reader, run against a stranger called Zzyzx Quorble, who must never be named |

## 9. Switching it off

A GM can turn the stranger rule off on `/gm/dev`, under Configuration →
Features → **Unknown faces go unnamed** (`GameConfig.anonymizeStrangers`). It
is on by default.

**Off**, everybody can name every face that is not covered, whether or not
they have met. Only a hood hides anyone:

- Who's here, the member strips, the pickers, chat, history, search, looks and
  DMs all show a bare face under its real name and portrait.
- A bare face gives nobody a voice number. Numbers already heard for bare faces
  just stop showing.
- Hoods, forced names, the labels that tell identical hoods apart, and hooded
  voice numbers work exactly as before.
- Name and role learning (`MEMORIES.md` §2b) keeps filling the Friends list, so
  switching the rule back on picks up from what each character has learned.

It is read in one place, `db/lib/strangers.js#anonymizingStrangers`. When it is
off, `knownSubjects` returns `null`, which every caller already reads as "no
stranger rule". The lens (`createLens`), `hearVoice` and a look's
`examineRow.js#looksKnown` do their own Friends lookups, so each of them checks
the switch too.

## 10. Disguises

A Disguise Kit (`db/lib/disguiseMint.js`) mints a tag whose `Tag.forcedName`
is the name its wearer goes by for three turns. It used to be a public name
like Apex Form's "Beast", which the whole room read. Now it is a new face with
a name on it, and each viewer makes of it what they can. This is Bascinet's
note "Allow friends system to wrongly identify disguised individuals and
register new disguises as friends", with three calls made on 2026-09-28: the
fooled see the real person's portrait, a disguise must give somebody's full
name to fool anyone (a title is its own choice and never decides it), and a
Friends entry for a made-up name comes from hearing it, as any name does.
Two more followed the same day: the Kit may claim a job, and a disguise
changes the name and job but never the body under it, so its age and gender
are always the wearer's. Then a third: a hood goes over a disguise.

**Three readers.** `db/lib/disguises.js#readDisguises` decides, for one
viewer and a list of names:

| The viewer | Sees the wearer as |
|---|---|
| **Fooled:** has a Friends entry for the real character the name belongs to | That person, by name. Their portrait too, when the wearer looks like them (below); otherwise the name's letter plaque |
| **Recognises it:** learned this disguise's name (an entry with `disguiseKey`) | The name, on its letter plaque |
| Anybody else | A stranger: "a young man", with labels and voice numbers, on the blank plaque |

The name is matched on its bare "First Last" (`disguiseKey`): "Sir Aldric
Vask", "Lord Aldric Vask" and "Keeper of the Sluice Aldric Vask" are the same
disguise, and fool the same people, whatever title (if any) Aldric has himself.
"Aldric" alone fools nobody.

**Any title.** The Kit's title is any text, up to 24 characters
(`disguiseMint.js#DISGUISE_TITLE_MAX`); the web dialog suggests the game's
own. A title can be several words and a name can have spaces in it, so the
Kit joins the title to the name with a no-break space
(`disguises.js#DISGUISE_TITLE_JOIN`), and `disguiseParts` splits the stored
name there. It reads as an ordinary space on every surface, lines freeze it
in `concealedAlias` as they freeze the rest of the name, and nothing a player
types can put one in, since every typed part has its whitespace collapsed. A
name without one (older, or typed as a single string) still takes a leading
title word of the game's own, as before. A viewer is never fooled by their own name: they
read it, on the plaque. People who really know the wearer do not see through
it; the face is not theirs. A GM, a ghost and a reader with nobody to
recognise with read the name. With the rule off (§9), everybody does, as
before.

**The wearer's own body.** A disguise never changes age or gender. A
stranger's alias, labels and voice are the wearer's ("a young woman" under
"Sir Aldric Vask"). One of the game's own titles is worn in the form the
wearer's gender takes: the Kit suggests each in that form, and a typed "Sir"
on a woman becomes "Dame" (`disguiseMint.js#normalizeDisguiseName`,
`titles.js#titleFormFor`). A made-up title is worn as typed.
The title never decides who is fooled, so "Dame Aldric Vask" still fools
Aldric's friends. And the fooled see the real person's portrait only when the
wearer looks like them: the same gender and the same age band, the one a
stranger's alias uses (young, grown, old; `disguises.js#looksAlike`). Anyone
else they take for that person shows them the name's letter plaque instead.
Every face route decides that for the viewer asking.

**A hood over it.** Concealment beats a disguise. A disguised character may
conceal themselves like anybody else (`conceal.js`, and the switch on
`/character`), and while the hood is up the disguise is not showing at all:
they are a hooded stranger under their own concealed alias, label and voice
number ("a young man, in front"), to everybody, the people the name would fool
included. Nothing about the name, its job or its colour shows, and nothing
they say teaches it. When the hood comes down the disguise shows again. The
rule lives in `disguises.js#hoodUpOverDisguise`, which `forcedNameFrom`,
`disguiseNameFrom` and `disguiseJobFrom` all ask when given the character:
a hood is up when a piece forces it, or when one is equipped and the character
has chosen to wear it up (`Character.concealed`). A public forced name (Apex
Form's Beast) still refuses concealment and is never hidden.

**A job.** The Kit may claim any job title, real or made up, typed
(`disguiseMint.js#resolveDisguiseJob`). The web dialog suggests the game's own
seats, by estate (`disguiseJobChoices`). A title that names a seat (its
name in any case, a leading "the" or "a" dropped, or its slug) is that seat,
spelled the seat's way. Anything else is kept as typed, first letter raised.
The minted tag stores the title as `Tag.disguiseJob`, and the seat as
`Tag.disguiseJobSlug` when it names one. A job claims its name, and a real
seat's estate colour, and nothing else: no seat's powers, rooms, rings or
wages. The estate is the colour every viewer sees the disguise in, fooled,
recognising or a stranger, the way any face's estate is public. A made-up job
has no estate, so it wears no colour, and neither does a disguise with no
job, even to the people it fools. Claiming the right job is part of a good
disguise. `ArchiveEntry.disguiseGroup` freezes the job's estate on
each line, and `archive.js#feedRowShape` paints the row in it. The job is
heard like any role (below), and a Look reads it off the viewer's entry for
the disguise, never off the tag.

A disguise is told from a public forced name by its tag's slug
(`custom-disguise-*`, `disguises.js#disguiseNameFrom`). `presentedIdentity`
carries it as `disguised: true` beside `forced: true`, and every `forced`
exemption in the code is now "a forced name that is not a disguise".

**Always under a token.** In `whosHere.js#presentRows` a disguised row is
hidden for every viewer but its wearer, so it is offered under a token in
Who's here, the member strips and every picker, and resolves through
`resolveHoodToken` like a hood's. The page never holds the wearer's id beside
somebody else's face. A plain id posted by hand is refused. Putting a disguise
on or taking it off rolls a new label and nonce, so no token links the two
faces. A fooled viewer's portrait is served by that token
(`web/app/api/avatar/here/`) and a chat line's by its seq
(`web/app/api/avatar/line/`), each deciding for the viewer asking.

**Every verb reaches it.** Anything that resolves a target through
`targetKey.js` or `resolveHoodToken` takes a disguise by token, as it takes a
stranger. Intercept catches one by the name it goes by, for a watcher who can
name it, and as "Anyone I can't identify" for anybody else (`INTERCEPT.md`
§2). DMs name it through `seenBy`, which answers by the same three readers.

**A line keeps its disguise.** `ArchiveEntry.disguised` is frozen when the line
is written, so the lens can tell "Bob" from "Beast", and an old line still
reads as the disguise after it wears off. It rides the feed row on a hidden
symbol (`strangers.js#DISGUISED`) and never reaches a browser, where it would
say the name is false. A sighting of a disguised line keeps only its seq in
Who's here: its frozen name is not one every viewer read.

**Voices.** A disguise gives a voice number to every hearer who cannot name
it. It is the same voice as the wearer's own, so it keeps the number they
already have (`memoryHearing.js#hearVoice`).

**Learning the name** (`MEMORIES.md` §2b). A disguised person is a candidate
under the disguise's name and never their real one. A name said in quotes
teaches it by the usual rules: said by the wearer, or by somebody who can
already name it. The lesson writes an entry tied to nobody: `subjectId` null,
`disguiseKey` set, `source: HEARD`. Somebody who can already name it, the
fooled included, gets nothing. A disguise's role is the job it claims, heard by the
usual rule (said beside its name, or by the wearer on their own), and fills
the entry's empty role like any other; the wearer's real seat is never taught.
A made-up job is heard by its own words, with no `roleSlug`, and somebody
passes it on only when their entry's role is those words
(`memoryLessons.js#knowsRoleOf`). With no job, it teaches no role. The entry's name
and notes are the owner's to rewrite like any other; recognition keys on
`disguiseKey`, so renaming it changes nothing. Anybody who later wears the same
name is recognised by it, as a costume would be.

**What it does not reach.** Discord posts a line under one name for the whole
channel (§7), so on Discord a disguise still shows its name to everybody.
Discord's per-viewer readouts (Who's here, the Look list, a fight's
announcement) follow the rule. Place lines about somebody (`seenByPlace`) name
the disguise, as they name a bare face.
