# Memories

`/memories` is what a character remembers. It replaced the old `/notes` page,
which now forwards here. It is built from Bascinet's own design document,
`E:\Bascinet\V3\Memories.docx`. §1 is that document. Everything after it is
how the game does it.

## 1. The design, as written

> All characters have a new page accessible through the top bar hyperlinks
> called "Memories". Within this page are several tabs that can be expanded to
> reveal the information within. The memories page will replace and build upon
> the previous Notes page.
>
> **Tab 1: "Friends".** When a character is generated they start with entries
> of other characters and their roles that they realistically should already
> know. For example, residents of Ravenheart can identify one another and what
> their individual jobs are. However, characters who they have never met
> before, for example migrants and late party characters would not be
> recognisable. In turn, migrants and other characters arriving at the fortress
> would not have any friends or be able to recognise anyone, thus their friend
> tab will be empty.
>
> The friends tab features a search bar and is categorized by which faction
> each character is a part of.
>
> New friends are added to this list when a character hears an unfamiliar
> character's name (first or last) spoken while both this character and the
> unfamiliar character are in the same room.
>
> The role of characters whose role is unknown is added to these entries if
> either the unknown character says their role or someone uses the name of
> their role and the character's name (first or last) in the same sentence
> (once again only for this character who is learning the role of someone and
> in the room to hear it).
>
> Entries can be created with both name and role information if the sentence
> which created the friend entry also contains the name of the role.
>
> Entries can also be manually created by players, and all of a player's
> entries can have their contents freely edited by the player, allowing
> additional notes to be added, or name/role information to be changed.
>
> New entries with roles are automatically added when a new character is
> generated that would have otherwise been present here if they had existed
> previously. Example: if someone spawns as a serpent after the game has been
> going for a while, the other members of the town's memories update to
> include an entry for them.
>
> Antagonist roles are NEVER included on entries in this tab, only standard
> starting roles. Only if a player manually edits an entry to contain that info
> will it end up here.
>
> **Tab 2: "Who am I?"** Contains a randomly generated sequence of 4 numbers,
> the PIN code that grants access to a character's treasury account through
> ATMs (aka infoterminals). Contains preset information stating the
> character's role/fate as well as how old they are.
>
> **Tab 3: "Memories of the day".** Contains a log of all messages in rooms
> which this character was in when the original message was posted. Messages
> posted in rooms this character did not have access to, or ones posted before
> the character showed up or after the character left are not recorded here.
> Messages here can be starred but not inspected. Wipes at the end of each in
> game day.
>
> **Tab 4: "Notes".** A list of notes to which new entries can be added by the
> player. Imported from the current journal tab in Notes.
>
> **Tab 5: "Highlights".** All starred messages are kept here. Imported from
> the current starred tab in Notes.
>
> **Additional mechanics.** Characters who possess the Concussed trait, or
> Amnesiac trait will have large sections of the information stored here
> temporarily scrambled. This scrambling occurs when the tag is first applied
> and then every few days, each time causing roughly 75% of the info to become
> nonsense, while the remainder is legible. The actual information is retained
> when scrambled, but the player is shown a scrambled version. The information
> will be restored when the tags causing them to be scrambled are removed.
>
> When a character inspects another character, their role description, as well
> as any other personal information not visually apparent are drawn from the
> friends tab of the memories page. If the info drawn is scrambled on the
> memories page, it will also be scrambled when inspecting a character.
> Inspecting a concealed character draws zero information from the memories
> tab.

## 2. Friends

One `Acquaintance` row is one entry: an owner, the person it is about
(`subjectId`, null for a hand-made entry), a name, a role, notes, and how it
came to exist (`SEED`, `HEARD`, `MANUAL`). Entries belong to the
**character**, not the player. A new character starts with only what their
seat knows.

Every field is the owner's to rewrite, true or not. The game only ever
**fills an empty role**; it never overwrites anything a player typed.

"Faction" in the doc is the role group now, since factions were removed. An
entry is filed under the group of the role its owner **knows**, never the
subject's real one, and under Unknown when the role is unknown, hand-typed, or
scrambled. The page never says whether a subject is alive.

### 2a. Who you know from the start — `knows:`

Each seat in `docs/roles.yaml` may carry a `knows:` list of role slugs and
group slugs. It syncs to `Role.knowsRoleSlugs` (expanded to role slugs) through
`npm run db:sync-roles`. Knowing is one-way. The table Bascinet set:

| Seats | Know |
|---|---|
| The town: every Court, Clergy, Cerberon, Saviors, Business and Soil seat, and the Mercenary (40) | each other — all 40, their own seat included (the `&townsfolk` anchor) |
| Migrant | nobody, and nobody knows them |
| Tribunal Ordinator, Tribune | each other |
| The Bastard's six seats | each other (`&bastards`) |
| The Bastard | also the Baron, Baroness, Heir, Successor and Hand |

`db/lib/acquaintances.js#seedAcquaintances` runs beside the map seeding at all
three places a character is made: `createCharacter`, `reincarnate` and
`applySpawnSideEffects`. It works both ways. The new character gets an entry
for every ALIVE or ASLEEP holder of a seat they know, and everyone whose seat
knows theirs gets one for them. That second half is the doc's late Serpent.

**Every seat can be seeded and learned**, the Tribunal's and the Bastard's
included: they are open invaders, and a town can learn to recognise them.
`examine_visible: false` on those seats now only keeps them off `#info`'s
public roles list. The secret antagonists are the exception, §2d.

The table is edited in an artifact, "Who Knows Whom", and copied into the YAML
by hand. There is no in-game editor.

`npm run db:seed-acquaintances` (dry run unless `-- --apply`) seeds everyone
already alive. It is the catch-up for a running game, and it also mints
missing PINs. Run `db:sync-roles` first.

### 2b. Learning in the room

`db/lib/memoryHearing.js#learnFromSpeech` checks every line a character says.
The pure half is `db/lib/memoryLessons.js`.

- **Where.** Only a `room:`, `conv:` or `party:` place counts, because those
  are rooms. The zone summary is the whole zone's noticeboard, not a room.
- **Only what was said.** Just the words inside quotation marks count
  (`db/lib/speech.js#spokenText`, the same rule the chat tints speech with).
  "*waves at Marrow*" is narration and teaches nothing. Bascinet decided this
  on 2026-09-25, alongside `STRANGERS.md`, which uses the same test for a voice.
- **Who hears.** Everyone ALIVE and physically present (`presentWhere`), minus
  the speaker, minus anybody holding `unconscious` or `asleep`. Present means
  standing there. Someone reading the room from outside (a walked-out street,
  the Scrying Eye) is not in it.
- **Who is named.** Candidates are the people present whose own face is
  showing. A hood or a forced name is never matched by the real name. A
  Disguise Kit's name is matched instead, and teaches a Friends entry tied to
  nobody (`subjectId` null, `disguiseKey` set), which recognises the disguise
  from then on; its role is the job the disguise claims, if any, real or
  made up, never the wearer's seat (`STRANGERS.md` §10). The first name counts,
  and the last name counts only when nobody else present shares it (the
  Baron's house shares one). Matching is case-sensitive and must be
  capitalised, so "will" is not Will. A name that is also a common opening
  word only counts mid-sentence, so "Will you come?" teaches nothing. A
  `{char:…|Name}` chip counts as its frozen name.
- **The speaker must know.** This is Bascinet's addition to the doc. The line
  teaches only if the speaker is the subject, or the speaker's own entry holds
  that name (and, for a role, that seat). A guess teaches nothing, even a
  right one, so saying "Is Marrow the Sheriff?" cannot be used to test a
  guess.
- **Roles.** The seat's name or the character's own title, capitalised, in the
  same sentence as the name. A role word that opens a sentence only counts
  right beside the name ("Sheriff Marrow, a word"), so "Hand me the knife,
  Marrow" teaches nothing about the Hand. Saying your own role teaches it
  without your name. A role-only lesson fills in existing entries; it never
  makes a new one.

It runs after the line is really out. The web and the Speak modal call it
from `recordSpeech`. The Discord proxy calls it once the webhook post has
landed, because the proxy writes its row first and takes it back if the post
fails. A ghost's line, a line recovered late (`sentAt`) and an edit teach
nothing.

Learning runs whether or not the GM has the stranger rule switched on
(`STRANGERS.md` §9). With it off, names show anyway, but the Friends list
still fills, so switching it back on picks up from what was learned.

### 2d. The secret antagonists are exempt

The Thanati, the Thanati leader, the Vampire, the Demoness and the Judge
(`db/lib/threats.js#SECRET_THREATS`: every seat worn as a hidden tag under a
cover role, with no Role of its own) are **completely outside** the memory
system. Nothing is seeded, learned or remembered about being one:

- Seeding and learning only ever deal in the seat somebody **holds**, and a
  secret antagonist holds their cover seat. That cover seat is learned the same
  way anybody's is, so being one changes nothing a room can find out.
- None of their words is ever a role word (`SECRET_SEAT_WORDS`: the names, and
  the public names they opt in under, such as "Cultist"). Saying "Marrow is a
  Thanati" teaches nothing, true or not.
- A title naming one — a GM typing "Vampire" into somebody's title box — is
  never taught or seeded; the cover seat's own name goes on the entry instead
  (`memoryLessons.js#teachableRoleText`).

Bascinet narrowed the design doc's "Antagonist roles are NEVER included" to exactly these
on 2026-09-25: the Tribunal and the Bastard's host are learnable, the secret
seats are not.

The Thanati still recognise each other through their own sight (`THANATI.md`),
which writes no memory. A player may still type anything into their own
entries by hand.

### 2e. A Mulligan Potion is a new face

Drinking a Mulligan Potion (`CHARACTERS.md`, "A name is immutable") makes the
drinker a stranger to everybody:

- **Every entry anybody else held for them is unlinked**, in the same
  transaction as the rename (`changeNameRequestImpl`). Each entry stays on its
  owner's page with the old name, role and notes as they were, but it is tied
  to nobody now (`subjectId` null, `MANUAL`), the shape of an entry made by
  hand. So it recognises nobody, and the drinker reads as "a young man" until
  somebody learns the new name again. The drinker's own entries about other
  people are untouched, and so is any entry for a disguise.
- **Their seat can never be learned again.** `Character.roleUnteachable` is set,
  and from then on the drinker is treated like a secret seat (§2d), but for
  the whole character: none of their words is a role word
  (`memoryLessons.js#roleWordsFor`), nothing teaches their role
  (`teachableRoleText`), and nobody is seeded an entry for them, either at a
  new arrival's creation or by a re-run of `db/scripts/ops/seed-acquaintances.js`
  (`acquaintances.js#seedRows`). The new name is still learned the ordinary
  way (§2b), with no role on the entry. A disguise's claimed job is still
  learned as usual, since that is the disguise's, not the seat's.
- **Voices are kept.** A `VoiceMemory` number survives the potion
  (`STRANGERS.md` §4), so a listener who once heard the drinker under an alias
  may still know the voice.

A player or GM can still type any role into an entry by hand. A GM can also
link an entry back to the drinker from the Dev Panel (§8).

Migration `20261222000000_mulligan_unlinks_friends` did this to the one
character on the running game who had already drunk a potion (Discord user
`436238225401446401`), and writes one `mulligan_friends_unlinked` audit row.

### 2c. By hand

"+ Add someone" makes an unlinked entry (`MANUAL`). It is never linked to a
character, because a picker to link one would list everybody alive. A typed
role that exactly matches a seat's name files the entry under that seat's
group. Edit and Forget work on every entry.

## 3. Who am I?

The character's name, seat, age, the seat's intro and charter lines, and the
**Infoterminal PIN**: `Character.pin`, 4 digits, minted at creation
(`acquaintances.js#ensurePin`), by the backfill, or on first visit. An
infoterminal asks for it when the ring on somebody's finger isn't theirs, or
when they are Concussed or Amnesiac (`RINGS.md` §5). The fate documents
stay on `/documents`, which links from here.

## 4. Memories of the day

`HeardLine` is one row per (character, archived line) for everyone physically
present when the row was written. `db/lib/archive.js#recordArchiveMessage`
files it (`memoryHearing.js#logHeard`, unawaited), because every feed row
passes through there: speech, shouts, scenes, gate echoes and GM posts. It
also covers the zone summary of the zone you stand in, and loose scenery at
your Location. The archive looks up who is standing there anyway, for the
row's witnesses (`ARCHIVE.md`, "Witnesses"), and hands that list to
`logHeard` so it does not ask twice. The two rules differ in one place:
somebody Asleep or Unconscious still gets the heard line, but is not a
witness.

The page reads today's rows only (`dayNumber`), leaves out deleted lines, and
draws a line with no speaker as scenery. A line can be starred into Highlights
(`dayActions.js#starMemory`, gated on your own `HeardLine`, not on whether you
can still read the place), and it has no eye. `turnWrapup.js`'s `memoryWipe`
step deletes older days whenever the day number changes, outside the
Discord-side `messageWipeEnabled` switch.

## 5. Notes, Highlights, and the old /notes page

Notes is the old Journal (`JournalEntry`) and Highlights the old Starred list
(`Note`), moved over whole. Both still belong to the account, and
`PROXYING.md` §7 keeps their history. A star from `/chat`, from the day's
memories or from Discord writes one `Note` (`web/lib/starNote.js`). A
Highlight keeps the name you saw on the line: a stranger's is kept as "Young
Man", with no face, never under their real name (`STRANGERS.md` §6).

**One kind of note belongs to a character instead.** A note the game writes
into a character's memory — "The bomb is in …", which the leaders and the
Tribunal start with (`NUKE.md` §4) — carries `JournalEntry.characterId` and
cascades with that character. Notes shows the account's own notes plus the ones
for the character being played now, so it never follows the player to their
next character. The player can still edit or delete it.

## 6. Scrambling

`db/lib/memoryScramble.js` is pure, and **nothing is stored**. A character
holding `concussed` or `amnesiac` gets a seed built from their id, when the
earliest of those tags arrived, and which 3-day stretch of the game it is.
**Every word rolls on its own**, in every item (an entry's name, role and
notes, a journal entry, a highlight, a day's line, a line of "Who am I?"): 3 in
4 come out as letters of the same shape, so about a quarter of the words stay
legible, scattered through each memory. A word is a run of letters and digits
("they'll" is one). The **PIN rolls digit by digit**, so a concussion
usually leaves one digit of the four. The tag coming off restores everything on
the next read, and none of the ~130 places that grant tags needs to know.

The page scrambles on the **server**, so the real words never reach the
browser. An item that lost **any** word is a scrambled item: it cannot be
edited or starred, and loses its face and its group colour, which would
otherwise give it away. An item that kept every word looks exactly as it
would without the tag. The edit and ★ guards garble the same real words the
page did (`web/lib/memories.js#scrambleJournal`, `#scrambleLine`), so what they
refuse is exactly what the page drew with nonsense in it.

### 6a. The map is a memory too

Map.docx: "knowledge of the map layout is stored as information in the
memories page, but this information is not visible to the player." It is kept
in `LocationVisit` (`db/lib/locationVisits.js`), the fog behind `/map`, and it
is deliberately **not** drawn on this page, nor put in its payload. That
payload is snapshotted into the browser (`SnapshotFresh`), so anything in it
is shipped to the player whether it is drawn or not.

What makes it a memory is that the same scramble reaches it. `/map`'s loader
asks `scrambleState` for the character, then:

- **A place** rolls word by word on `place:<locationId>`, across its name and
  description. The board draws the name of a place that lost any word in a
  faint italic, and the card, Ways out and a walk's stops all read the garbled
  one. The real name is never sent.
- **A way** has no words, so it rolls once on `way:<linkId>`, 3 in 4. A
  scrambled way comes off the board,
  **unless one end is where the character stands**, because what is next door
  is in front of them rather than remembered. Only the drawing changes: Ways
  out, walking and every travel check are untouched.

What a character starts knowing is `MAP.md` §6a.

## 7. Inspecting

A look reads the role, and anything else you cannot see, from **the looker's
own entry** for the subject (`examineRow.js#memoryForLook`), scrambled the
same way the Friends section scrambles it. A stranger reads no role. A friend
reads what they remember, true or not, plus the name they know them by and
their notes. A hood, a forced name and a camera draw nothing from memory.

A stranger's look also reads no NAME: the header is their alias, "Young Man",
and the face is fetched by the line rather than by id (`STRANGERS.md` §6).

The role is no longer frozen onto each line (`examineSnapshot.js`); old lines
still carry `rt` and `rg`, and both are ignored. The GM dossier (⚜️) is
unchanged.

### 7a. Hovering a name

In `/chat`, hovering a speaker's name in the feed or a name in the Here list
opens a small card. It has two halves: what you remember of them and what you
can see on them. A tap pins it on a touch screen. It is **the look itself,
cut down**. The card calls the same `lookAtRow(seq)` the eye does and draws
only the role, the name you know them by, your notes, the ailments, gear and
tags on show, and "They look alert." for somebody in combat mode (the same
line the look gives, and a hood still shows it). So every rule above holds
without being written twice. A
stranger's card says you don't know them, and a hood's card draws nothing
from memory. Like the eye, it shows somebody as they were when that line was
said. The Here list's card uses the last line you heard from them.

No card appears on your own lines or on system lines. It waits a
quarter-second before asking, so a pointer crossing the feed costs nothing,
and it keeps each answer for a minute (`web/app/components/NameCard.js`).

**A GM gets their own card** (`web/app/(app)/chat/GmNameCard.js`), on every
spoken line in the GM seat and on the names in their Here, guest and
conversation lists. A GM remembers nobody, so its first half is the truth:
the real name, the real role in its estate colour, and "Showing as …" when
the room had another name for them (a hood, a forced name, a disguise). The
second half is "What the room could see". On a feed line that is a camera's
look frozen at the line (`db/lib/examineRow.js#examineRowForGm`: no medical
sight, no memories, the hood honoured). On a list name it is what anybody
standing there could see now. Clicking still opens the character panel.

## 8. The GM's view: the Dev Panel's Memories tab

A GM reads and changes every part of a character's memories from the
character Dev Panel (`/gm/dev/characters/[id]`, and the same panel as a modal
over `/gm/turns` and `/gm/players`), under the **Memories** tab between Goals
and Record. It works for any character, dead, gibbed or asleep included, so a
dead character's Friends list is still there to read until the character row
is deleted.

**What the GM sees is the truth.** The five sections are the player's own
components (`FriendsSection`, `DaySection`, `JournalList`, `StarredList`, and
the two composers), with the GM's verbs plugged in. Nothing is scrambled.
Where Concussed or Amnesiac garbles an item for the character today, the item
says "garbled for them today" instead, and the GM can still edit it. A Friends
entry tied to somebody says who it really is when the name written on it is
different ("Really Ada Marrow"), and a disguise entry says so. A line of the
day shows the name the character heard it under, with the real speaker beside
it when those differ.

**What the GM can change:**

| Section | Verbs |
|---|---|
| Friends | Add, edit, forget. A new entry may be **linked** to a living character: that makes it a recognition, not just a name, so from then on the owner sees that person's real name instead of a stranger's alias (`STRANGERS.md`). A player can never make a linked entry. A linked GM entry is filed as `SEED`, as if they had always known them; an unlinked one is `MANUAL`. A second entry for the same person is refused. |
| Who am I? | The infoterminal PIN, exactly 4 digits. Name, role and age stay on the Identity tab. |
| Memories of the day | Forget one line. Only this character's `HeardLine` goes; the line stays in the archive, and everybody else who was there still heard it. |
| Notes | Add, edit, pin, delete. A new note is the player's account's by default (it follows them to their next character). Ticking "Only this character remembers it" files it on the character instead (`JournalEntry.characterId`, like the bomb's note in `NUKE.md`). The tab shows only the account's notes and this character's, never a note filed on the player's other characters. |
| Highlights | Rewrite what one says, or remove it. |

Notes and Highlights belong to the player's account, so a character with no
player behind it has none, and the tab says so.

**Every change is silent and audited.** Nothing tells the player: no DM, no
notice. A GM planting or wiping a memory is meant to be part of the fiction.
Each write leaves one `AuditLog` row in the same transaction, `gm_memory_*`
(`web/lib/auditNarrative.js` gives each its sentence), so the Record tab and
`/gm/audit` show who changed what, with the old and new words in the details.

The tab loads on its first click, like Record (`DEV-PANEL.md` §10), and
reloads in place after every change.

## 9. Where the code lives

| Concern | File |
|---|---|
| Seeding, PIN | `db/lib/acquaintances.js`, `db/scripts/ops/seed-acquaintances.js` |
| `knows:` sync | `db/lib/syncRoles.js#resolveKnows` |
| Who is present, the day log, learning | `db/lib/memoryHearing.js` |
| What a line teaches (pure) | `db/lib/memoryLessons.js` |
| Scrambling (pure) | `db/lib/memoryScramble.js` |
| The map as a memory (§6a) | `db/lib/mapMemory.js`, `web/app/(app)/map/actions.js` |
| Inspect | `db/lib/examineRow.js`, `db/lib/examine.js` |
| The hover card on a name (§7a) | `web/app/components/NameCard.js` |
| Page and actions | `web/app/(app)/memories/`, `web/lib/memories.js` |
| What a memory may hold (both writers) | `web/lib/memoryEdits.js` |
| A Mulligan Potion unlinking entries (§2e) | `web/app/(app)/character/actions/misc.js#changeNameRequestImpl` |
| The GM's tab (§8) | `web/lib/devPanelData.js#loadDevPanelMemories`, `web/app/(app)/gm/dev/characters/[characterId]/MemoriesTab.js` and `memoryActions.js` |
| Tests | `db/test/memoryLessons.test.js`, `memoryScramble.test.js`, `roleKnows.test.js`, `examineRoleTitle.test.js` |
