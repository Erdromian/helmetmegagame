# Late parties

A GM-started event that changes what character creation offers: while it runs,
only its fates are open, and anybody who is dead can come straight back. From
Bascinet's design doc `E:\Bascinet\V3\Lateparty.docx`.

The code is `db/lib/lateParty.js`, with the muster's draw in
`db/lib/latePartyRaffle.js`. The GM surface is `/gm/dev?s=lateparty`. The
player sees an open party in the creation picker, and a muster as a page of its
own.

Companion to [`LATE-JOINS.md`](LATE-JOINS.md) (single seats a GM opens, which a
party locks while it runs), [`LOBBY.md`](LOBBY.md) (the roll and the seats a
muster reuses) and [`CHARACTERS.md`](CHARACTERS.md) (the wizard and the curse).

## 1. What a party does

The doc, in three sentences:

- It **locks every fate but its own.** The seven buckets, the late-join Special
  section and any lobby seat from the roll all go.
- It may open **any fate**: an ordinary one ("five more Guards") or one the
  picker never shows (`SPAWN_ONLY_FATE_SLUGS`, the Tribunal and the Bastard's
  party today).
- **Anyone without a living character may come back**, whether or not their
  body was buried or their name engraved. Respawning already costs no points,
  so "free" means "past the curse".

Each fate has a number of **slots**, or none, which means **unlimited**. The
party ends by itself once every slot is filled. If any of its fates is
unlimited, it never fills and runs until a superadmin ends it.

A party runs in one of two **modes**, picked when it starts (`LateParty.mode`):

- **Open** — the picker shows the party's fates, and a player picks one and
  spawns at once (§3).
- **Muster** — nobody picks. Players put their names down with priorities, the
  way they ready up in the lobby, and the fates are drawn at the end of each
  turn (§4).

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

**What is spoken for but not sat in is `held`, not full.** Two things are held:
a wizard hold (`RoleReservation`) on a party fate, and a seat a muster drew
that nobody has built yet. Both grey a card for everybody else, but only
seated characters fill a party. An abandoned hold, or a drawn seat declined or
left to expire, hands its chair back, and the party never ended in between.

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

## 3. An open party

The picker draws one section, **Late Party**, with the party's fates in it,
hidden ones included, each card counting against the party's own slots. The
player picks, builds and spawns at once, as with any seat. That is the
"instant" respawn: no burial, no wait, no draw.

## 4. A muster

`/character` draws `LatePartyMuster.js` instead of the wizard: the party's
fates down the left with the lobby's Off / Low / Med / High (one High, the
lobby's own rule), how many chairs each has left, and a card on the right to
**put your name down** or take it out. Everything a player may take starts at
Med, so one click enters them for anything. A `LatePartyEntry` row is a name in
the hat; `musterActions.js` writes it, re-checking every gate.

**The draw is a turn pass** (`"lateParty"`, dead last in `TURN_PASSES`,
`TURN-ENGINE.md`). `runLatePartyRaffle` rolls the names into the party's fates
with the lobby's roll (`fateAssignment.js#assignFates`, handed the party's
fates and slots instead of the lobby's): shuffled, whitelisted fates first,
then High, Med, Low. Each fate's chairs are its slots less what the party has
seated or holds. `whitelisted` is read off Discord when a player enters, since
the turn advance has no member roles to ask.

**A winner gets an ordinary lobby seat**: an ASSIGNED `LobbyEntry` carrying the
party's id, open for `GameConfig.creationWindowHours`. So everything a rolled
seat already does comes with it:

- the wizard opens on Tags with the fate fixed;
- the lobby sweep sends the "You're in" DM (the draw sends nothing itself), the
  six-hours-left reminder, and the expiry;
- **Decline** frees the chair, and the next draw can hand it on;
- the GMs' **Seats out** table lists it.

**Nobody the draw passes over is told anything.** Their name stays in for the
next turn's draw. A name is taken out when its player is drawn, comes back
some other way (a spawn, Metempsychosis), or takes it out themselves.

**A drawn seat is honoured always.** It was handed out, so it stands even if
the superadmin ends the party before it is built, and it keeps the party's
exemptions: no curse, and no spawn-only refusal. While the party is still
open, building it is checked against the party's slots like any other.

## 5. The gates

These places decide who may be made, and as what:

| Where | What it does while a party is live |
|---|---|
| `web/app/(app)/character/page.js` | Open: `groups` empty and `specialGroup` = the party's fates. Muster: the muster page instead of the wizard, unless the player holds a drawn seat. Never the `cursed` screen. A roll seat is not locked in; a drawn seat is, and brings its own card when its fate is on none |
| `CreateCharacterWizard.js` | One line under the heading, from the `lateParty` prop (open parties) |
| `createActions.js#createCharacter` | Refuses any other fate, and refuses every pick during a muster. A drawn seat is the one way into a muster, and is honoured with or without a party. A party fate or drawn seat skips the spawn-only refusal and the curse; the cap is the party's, re-read under the row locks. Stamps `latePartyId` |
| `createActions.js#reserveFateAction` + `fateReservation.js#reserveFate` | The same rules, for the wizard's hold |
| `db/lib/reincarnate.js` | Metempsychosis lands in a party fate with room, open or muster (it is automatic, like a draw). Still never a whitelisted or dynasty seat. If none fits, it returns null, as it already could |

**A superadmin bypasses the lock**, as they do the other creation gates. They
get the wizard even during a muster, with the party section above the
buckets.

**The whitelist still applies to a party fate.** Opening a seat is not
vouching for who sits in it (`LATE-JOINS.md` §5), and the draw honours it too.

## 6. The curse

`db/lib/curse.js` is untouched and stays pure. The exemption lives at the
gates, the same way the late-join one does. A party lifts **every** curse,
including one a GM forced on with `cursedOverride` (Bascinet's call,
2026-09-27): the doc says anyone dead may respawn. GM desks still label such a
player "Cursed", which is still true; the label just doesn't stop them while
the party runs. End the party and a cursed player is back to `CreationCursed`
on the next load, unless they hold a drawn seat.

## 7. The panel

`/gm/dev?s=lateparty`, **superadmin only** (`SECTION_TIER.lateparty`,
Bascinet's call). `LatePartyPanel.js` + `latePartyActions.js`.

- **A party live:** its mode, and for a muster how many names are in the draw;
  its fates with **Seated** (what fills it) and **Held** (wizard holds and
  drawn seats not yet built) against the slots; and **End late party**.
- **None live:** the last party and whether it filled or was ended, then one
  form. **Open** or **Muster**, then every fate in the catalog, bucketed,
  marked hidden (spawn-only) or whitelist. Each gets an include box and a
  Slots field, where blank means unlimited; typing a number counts as ticking
  the box, and 0 is refused. **Start late party** is behind a confirm.

Starting writes `late_party_start` to the audit log (the mode and fates in
`details`), ending writes `late_party_end`, and each draw writes
`late_party_draw` (its seed, how many were in, and who got what).

**Starting DMs everybody who has a character and none alive**
(`playersWithoutLivingCharacter`, so the asleep too), once, sequentially, in
`after()`, as a `NOTICE`. The text is `latePartyMessage`, one line for each
mode. Living players are not told.

## 8. Restart Game

`wipeGameData` deletes every `LateParty` (its fates and names cascade), because
a party left open would narrow the next game's creation to its fates. The
lobby's seats go with `LobbyEntry`, and `Character.latePartyId` is `SET NULL` on
delete either way.

## 9. What it does not touch

- **Late joins** keep their rows and slots, and the Bastard's Call
  reinforcements still adds chairs during a party. But a late join's chairs
  are counted against **everybody** holding that fate, so characters a party
  made in a late-join fate use up those chairs once it ends.
- **Ordinary seat caps** are the same: "five more Guards" leaves Guard over its
  usual cap afterwards, and the picker shows it full until they die. That is
  what reopening a fate means.
- **Metempsychosis** uses up one of the party's slots like any other character
  the party makes.
- **Threat spawns** (`THREATS.md` §4) are a GM picking a person, not creation.
  A party does not stop them.
- **The bot.** Creation is web-only. The Decline button on a drawn seat's DM is
  the lobby's own, and works on both faces.
