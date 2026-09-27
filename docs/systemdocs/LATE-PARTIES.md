# Late parties

A GM-started event that changes what character creation offers: while it runs,
only its fates are open, and anybody who is dead can come straight back. From
Bascinet's design doc `E:\Bascinet\V3\Lateparty.docx`.

The code is `db/lib/lateParty.js`. The GM surface is `/gm/dev?s=lateparty`, and
the player sees it in the creation picker.

Companion to [`LATE-JOINS.md`](LATE-JOINS.md) (single seats a GM opens, which a
party locks while it runs) and [`CHARACTERS.md`](CHARACTERS.md) (the wizard and
the curse).

## 1. What a party does

The doc, in three sentences:

- It **locks every fate but its own.** The seven buckets, the late-join Special
  section and any lobby seat still in its window all go. The picker draws one
  section, **Late Party**, with the party's fates in it.
- It may open **any fate**: an ordinary one ("five more Guards") or one the
  picker never shows (`SPAWN_ONLY_FATE_SLUGS`, the Tribunal and the Bastard's
  party today).
- **Anyone without a living character may respawn at once**, whether or not
  their body was buried or their name engraved. Respawning already costs no
  points, so "free" means "past the curse".

Each fate has a number of **slots**, or none, which means **unlimited**. The
party ends by itself once every slot is filled. If any of its fates is
unlimited, it never fills and runs until a superadmin ends it.

## 2. Live is worked out, not stored

`LateParty` has `endedAt`, and that is the only switch on it. A party is
**live** while `endedAt` is null **and** at least one fate still has room
(`loadLiveParty`). There is no "filled" column to keep in step.

**A filled party is closed the first time it is seen full.** `loadLiveParty`
stamps `endedAt` with `endedBy` null, which means "it filled". Without the
stamp a filled party could come back to life: a GM deleting one of its
characters, or giving one another fate, drops the count below the slots, and
creation would lock again with nobody told.

**Room is counted off the characters the party made.** `Character.latePartyId`
is stamped at creation. A party fate's **seated** count is how many characters
carry this party's id and that role, dead ones included, the same way a dead
character still holds any other seat. That keeps "five more Guards" apart
from the Guards the game already had.

**A wizard hold counts toward `taken`, not toward full.** While a party is live,
every `RoleReservation` on one of its fates is a party hold (nothing else can
be reserved), so it greys the card for everybody else. But only seated
characters fill a party. An abandoned hold expires, the chair comes back, and
the party never ended in between.

**One open party at a time.** `startLateParty` closes any open one under the
`GameState` row lock before creating the next.

**The creation transactions take the party row `FOR SHARE`,** after the `Role`
lock. The Role lock already keeps each fate's count honest, so a share lock is
enough to make a superadmin's End wait for (and win against) a creation in
flight, without every party creation queueing behind every other.

**A whitelisted fate's empty chair keeps a party live.** Only a player with
the Leader Whitelist role can fill it, so a party of five Guards and one
whitelisted seat stays live after the fifth Guard until a vouched player takes
the seat or a superadmin ends it. The panel marks those fates.

## 3. The gates

Five places decide who may be made, and as what. All five ask
`loadLiveParty` / `latePartyGate`:

| Where | What it does while a party is live |
|---|---|
| `web/app/(app)/character/page.js` | `groups` empty, `specialGroup` = the party's fates with the party's own counts, never the `cursed` screen, no `lockedRole` |
| `CreateCharacterWizard.js` | One line under the heading, from the `lateParty` prop |
| `createActions.js#createCharacter` | Refuses any other fate. A party fate skips the spawn-only refusal and the curse. The cap is the party's, re-read in the transaction under a `LateParty` row lock taken after the `Role` lock, so ending the party mid-wizard wins. Stamps `latePartyId` |
| `createActions.js#reserveFateAction` + `fateReservation.js#reserveFate` | The same rules, for the wizard's hold |
| `db/lib/reincarnate.js` | Metempsychosis lands in a party fate with room. It still never lands in a whitelisted or dynasty seat. If none fits, it returns null, as it already could |

**A superadmin bypasses the lock**, as they do the other creation gates. They
see the party section with the buckets under it.

**The whitelist still applies to a party fate.** Opening a seat is not
vouching for who sits in it (`LATE-JOINS.md` §5).

## 4. The curse

`db/lib/curse.js` is untouched and stays pure. The exemption lives at the
gates, the same way the late-join one does. A party lifts **every** curse,
including one a GM forced on with `cursedOverride` (Bascinet's call,
2026-09-27): the doc says anyone dead may respawn. GM desks still label such a
player "Cursed", which is still true; the label just doesn't stop them while
the party runs. End the party and a cursed player is back to `CreationCursed`
on the next load.

## 5. The panel

`/gm/dev?s=lateparty`, **superadmin only** (`SECTION_TIER.lateparty`,
Bascinet's call). `LatePartyPanel.js` + `latePartyActions.js`.

- **A party live:** its fates with **Seated** (what fills it) and **Held**
  (wizard holds, which grey a card for everybody else but come back if
  abandoned) against the slots, and **End late party**.
- **None live:** the last party and whether it filled or was ended, then one
  form. Every fate in the catalog, bucketed, marked hidden (spawn-only) or
  whitelist. Each gets an include box and a Slots field, where blank means
  unlimited; typing a number counts as ticking the box, and 0 is refused.
  **Start late party** is behind a confirm.

Starting writes `late_party_start` to the audit log (the fates in `details`),
and ending writes `late_party_end`.

**Starting DMs everybody who has a character and none alive**
(`playersWithoutLivingCharacter`, so the asleep too), once, sequentially, in
`after()`, as a `NOTICE`. The text is `latePartyMessage`. Living players are
not told.

## 6. Restart Game

`wipeGameData` deletes every `LateParty` (its fates cascade), because a party
left open would narrow the next game's creation to its fates.
`Character.latePartyId` is `SET NULL` on delete either way.

## 7. What it does not touch

- **Late joins** keep their rows and slots, and the Bastard's Call
  reinforcements still adds chairs during a party. But a late join's chairs
  are counted against **everybody** holding that fate, so characters a party
  made in a late-join fate use up those chairs once it ends.
- **Ordinary seat caps** are the same: "five more Guards" leaves Guard over its
  usual cap afterwards, and the picker shows it full until they die. That is
  what reopening a fate means.
- **Metempsychosis** lands in a party fate while one is live, and that uses up
  one of the party's slots like any other character it makes.
- **Threat spawns** (`THREATS.md` §4) are a GM picking a person, not creation.
  A party does not stop them.
- **The bot.** Creation is web-only.
