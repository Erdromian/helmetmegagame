# Stealing and pickpocketing

Two verbs for taking something that isn't yours without being seen doing it.
This doc owns `db/lib/steal.js`, `db/lib/pickpocket.js`, the `steal` mode on
the Move things dialog, `PickpocketDialog.js`, and the `PickpocketAttempt`
table. Related: [`CARRY.md`](CARRY.md) §6–§7 (stashes and Transfer),
[`SEARCH.md`](SEARCH.md) (the other verb that reaches a hood),
[`TAGS.md`](TAGS.md) §4a (what the two tags cost).

## 0. Why they exist

Before these, the game had one way to take something out of a room stash —
Transfer, **From: a room, To: you** — and it always posted a line to the room
thread saying you had done it (`CARRY.md` §7). It had no way at all to go
through an upright person's pockets: Loot refuses anybody who is not bound,
dying, paralyzed, catatonic or dead, because listing a standing person's
holdings would leak their hidden tags.

So theft was unplayable. A Brigand could rob a corpse, or tie somebody up and
then rob them, but could not palm a lantern off a shelf without the room being
told, and could not lift a purse at all. Meanwhile the `pickpocket` tag had
been in the catalog since launch, cost 3 points, sat behind the Brigand gate,
and did nothing whatsoever.

## 1. Steal

**It is Transfer's room → you path with the room line suppressed.** That is
the whole implementation and it is deliberately not more than that:
`web/app/(app)/character/actions/steal.js` hands the move itself to
`transferRequestImpl`, which already does reach, the tradeable filter, the
non-stackable clamp, the carry ceiling, the per-line `TRANSFER_TAG` rows a GM
undoes from `/gm/turns`, and the `afterInventoryChange` tail. Forking that
function to put a die in it is the thing the file exists to avoid.

- Anyone presses **Steal**, picks a stash at their Location they can get into,
  and ticks what they want.
- **It costs no Move, files no `Action`, and has no ration.** Steal all day.
- On the way out a **d6** is rolled. Nobody is ever shown it.

### 1a. The goods always move

This is the part a player will get wrong, so it is worth saying plainly: **a
failed steal is not a stopped steal, it is a noticed one.** The die decides one
thing only — whether the room thread hears a line. On a success nothing is
posted anywhere at all: no Discord message and no `/chat` scene row.

That is also the reason the verb is honest rather than strictly better than
Take. Transfer's line names what you took; Steal's says only that somebody
tried. Anyone who does not mind being seen still has Take sitting right there.

### 1b. The table

Success on a **4 or higher**, modified. The list lives in `db/lib/steal.js`,
and it is **closed**:

| | value |
|---|---|
| Stealth | +2 |
| Clumsy | −2 |
| Tipsy | −1 |
| Wasted | −2 |

So an average person is seen a third of the time, somebody Clumsy needs a 6,
and somebody with Stealth is only caught on a 1.

**Hunger and mood do not apply**, which is where this deliberately diverges
from `gambitModifier.js`. Steal costs no Move and has no ration, so folding the
Gambit penalties in would make a hungry character's every theft loud with
nothing they could do about it.

**Stealth and Clumsy cannot both land** — the catalog pins them
`conflictsWith` each other — so nothing has to arbitrate between those two.

**The drink rungs never sum: the worst one counts.** Tipsy escalates into
Wasted, so the pair never co-occurs on its own — but a GM granting both by hand
must not produce a silent −3 and a 6 that still fails, which is a worse
punishment than either tag claims to be. Same shape as a mood band, and for the
same reason. `db/test/steal.test.js` pins it.

**Subtle is not in the table, and its absence is the interesting one.** It used
to read *"the room never notices you doing it"*, which is this verb exactly. It
was rewritten on 2026-09-16 to be about whispers not carrying, so it is a sound
tag now rather than a sleight-of-hand one.

### 1c. Lucky applies

The die goes through `db/lib/advantage.js#rollWithAdvantage`, which is the
repo's rule for every d6 a character throws, so **Lucky quietly applies** — the
same admission [`SEARCH.md`](SEARCH.md) §3b makes about its own unseen die.

Worth knowing because Bascinet's own note for
this feature said "rolls a gambit" — it is Gambit-*shaped*, the way Torture and
Confession are, but it files no `Action` and spends no Move.

### 1d. Suppressing the room line safely

`transferRequestImpl` takes its `announceTake` switch as a **SECOND
parameter**, never a field on its input object, and it has to stay that way.
`requestActions.js` calls it as `guarded(() => transferRequestImpl(input))` and
hands the client's whole input object straight through, so anything read off
`input` is settable by whoever is typing in the browser. An `announceTake:
false` posted from a console would let any player empty every stash in the game
in silence. As a second argument it is unreachable, and `actions/steal.js` is
its only caller.

The dialog's own notice is **outcome-blind** for the same family of reasons —
the server returns no die and the sentence never varies, so nothing there can
be read backwards into whether the room saw you. The room's thread is what
tells you that.

### 1e. Caught means stuck

**A noticed steal pins the thief where they stand for 5 minutes.** The room
line is the victim's cue, and a cue is useless if the thief has already walked
out of the Location by the time anybody reads it. So beside the line, the
action writes `Character.heldUntil` — the same movement hold an intercept or
an Attack uses (`INTERCEPT.md` §3) — for `CAUGHT_HOLD_MS`, with
`heldReason: "caught"` (`HELD_REASON.CAUGHT`). Every picker and the mover's
gate already read that column, so nothing new had to learn about it: the ways
out draw shut with *"You were caught stealing. You can't leave for another
Ns."*, an escort cannot carry them off, and the Charon stone refuses them.

**Two theft holds share this reason.** A successful Steal holds nobody, and
taking from a room with Transfer holds nobody either. The other writer is a
**failed or noticed Pickpocket** (§2g), and it differs in two columns: the victim is
`heldById`, because a person can hold a thief the way a stash cannot, and it
runs an hour rather than five minutes (`PICKPOCKET_CAUGHT_HOLD_MS`). Either
way, a caught hand also stays out of pockets until the clock runs (§2g).

Four things follow from reusing the hold rather than inventing one:

- **It takes MOVEMENT only.** The thief can talk, hand the goods back, and
  fight. That is the point — the victim gets a window to answer, in words or
  with an Attack, and an Attack then holds both sides to the end of the turn
  the ordinary way, since a longer hold always beats a shorter one.
- **Nobody has hold of them.** `heldById` is null. The intercept Release
  button, the holder-walks-off clear and the holder-dies clear all key on
  `heldById`, so none of them can reach this one. It lapses on its own clock
  and nothing else ends it. A leader they were following reads *"X couldn't
  follow."*, not *"Somebody has hold of X."* (`INTERCEPT.md` §3).
- **It never lands on a running fight.** `holdWhereTheyStand` leaves a longer
  hold alone, and it leaves a fight alone even in the turn's last minutes,
  when the fight's hold is the shorter one — overwriting it would swap the
  reason out from under `attack.js#settleHold`.
- **The line says so, when it is true.** *"…tried to steal an item. They
  won't get far for the next 5 minutes."* Without the second sentence a victim
  reading the thread assumes the thief is gone and never comes back to the
  room. It is added only when the hold actually landed; a thief already held
  longer, or in a fight, gets the first sentence alone.

The goods have already moved by the time the hold is written, so a failed
write is logged rather than thrown — the room still hears the line.

**GMs see it on the Other lens** of `/gm/turns` (`ATTACK.md` §8), as a
*Caught stealing* row read off the `steal` audit row. That row carries
`held`, whether the hold actually landed, beside `unseen`.

The dialog itself is still outcome-blind (§1d). The thief learns they were
seen the same way everyone else does — the room line — and the first time
they try to leave.

## 2. Pickpocket

Going through a standing person's pockets. Needs the **Pickpocketing (Basic)**
tag (§3), costs no Move, and is rationed: **one reach per turn**, at one
person, spent by reaching in whether or not it works (§2d). A thief who
reached into one pocket this turn is refused every other one with *"You've
already picked a pocket this turn."*

- Both sides at the same Location, both alive, neither blocked from `ACT`.
- **Neither side in a running fight**, and the thief not under a caught hold
  (§2g). Both are re-checked at the take as well as at the roll.
- **A hood refuses nothing**, either end — `allowConcealed: true`, the Search
  posture (`SEARCH.md` §2a). A hood hides who you are, not what is in your
  pockets. Every line either side reads names people by the face the room saw.
- Nothing is ever posted to a room, on any outcome.

### 2a. Three bands, not two

Read off the die **plus** Skilled's +1, **minus** the mark's defense (§2i):

| total | what happens |
|---|---|
| 4+ | **clean.** They are told nothing at all. |
| 2–3 | **noticed.** You get the goods, they are DM'd that you picked them, and **you are stuck there for an hour, held by them** — both at the take (§2e, §2g). |
| 1 or less | **failed.** Nothing moves, they are DM'd that you tried and failed, and **you are stuck there for an hour, held by them** (§2g). |

The middle band is the whole texture, and collapsing it into a plain pass/fail
is the easy accident — a verb that only ever succeeded silently or failed
harmlessly would be a free action with no reason not to press it at everybody
in the room.

**Pickpocketing (Skilled)'s +1 lifts a natural 1 clear of the failure band**,
so against an undefended mark a master is never caught empty-handed. They can
still be felt, and held, with the goods on them. That is what "almost always
succeeds" means — and one point of defense (§2i) puts the natural 1 back where
it was.

### 2b. The weight budget, and the hole it plugs

**15 lb**, or **30 lb** with Skilled. Weighed with `db/lib/tagWeight.js#rowWeight`.

**One kind of thing per reach.** The thief picks a single tag and takes as
many of it as fit in the budget — five 3 lb daggers out of ten, not two
daggers and a lantern. The take refuses more than one line (*"Take one kind of
thing."*), so this is a rule and not just the dialog's layout. In the dialog,
picking a second row replaces the first, and each row's **All** stops at
`pickpocketFitCount` — as many as fit, not as many as they hold.

Three filters decide what a hand can reach, and the third is a hole rather than
a nicety:

- **`tradeable`** — the Loot filter. Skills, injuries, beliefs and statuses
  were never cargo.
- **not `equipped`** — lifting a worn breastplate off a standing man is a
  fight, not a theft. This makes the verb strictly narrower than Search's Hide
  picker, which *does* treat a WORN dagger as palmable, and the difference is
  deliberate: Search asks what you could hide on yourself, this asks what
  somebody else's fingers could reach. Do not "harmonise" the two.
- **not an Asset** — and this one is load-bearing. **An Asset weighs 0 on
  purpose** (a horse carries itself, `CARRY.md` §1), so a weight budget cannot
  bound it. Without this clause 15 lb buys every horse, deed and house a person
  has on them, unlimited, because none of it counts. The budget is the only
  brake this verb has, so anything the budget cannot measure is off the table
  entirely.

### 2c. What the thief is shown

A plain name and a weight, and **no `TagChip`** — the only stack list in the
app drawn that way apart from a helpless person's pockets, and for that exact
reason (`REQUESTS.md` §5b). The filter behind the rows is `tradeable` rather
than `catalogVisibility`, so a secret tag is *already* named there; putting its
description, recipe and cost on a hover as well would be a second leak on top
of the one the verb is for.

This is a real new exposure. Loot refuses an upright person precisely to avoid
it, and this verb exists to open it. Matching Loot's filter and its no-chip
rule is what keeps the exposure to what the verb is actually for.

**A clean roll and a noticed roll return the IDENTICAL payload.** If the thief
could tell a 5 from a 2 by what came back, the die would be readable off the
dialog and a noticed theft would just be one you re-plan around.

### 2d. One row, doing two jobs

`PickpocketAttempt`, `@@unique([thiefId, targetCharacterId, turnId])`.

It is the **ration** — one row per thief per turn, at whoever they reached
into. The unique key is still per target, because the take looks its row up by
target. So the per-thief rule is a read-then-insert **under a lock on the
thief's own `Character` row** (`lockCharacter`): two tabs reaching at two
people at once queue on the lock, and the second reads the first one's row and
is refused. `db/lib/pickpocket.js#pickpocketRation` is the pure verdict —
`roll`, `reopen` or `spent` — and `db/test/pickpocket.test.js` covers it. The
claim has to survive a failed roll or failing would be a free retry.

It was once per *target* per turn until 2026-09-25, which let a thief try
everyone at their Location every turn. Rows from that time can leave a thief
with two for one turn; the reopen prefers the row at the target in hand.

And it is the **authorization** for the second half. Pickpocket is two acts —
roll, then choose — and the take re-reads this row for whether it may happen at
all and what the budget is. The die and the budget are columns rather than
something handed to the browser, because an authorization that travelled
through a client is not one.

**One take per reach.** The take sets `spentLbs` to the **whole budget**,
whatever it actually weighed, by a conditional `updateMany` on `spentLbs = 0`
— so two tabs cannot both take, and a second take is refused. It has to be the
whole budget rather than the pounds taken: obols weigh nothing, so a
pounds-taken claim would leave `spentLbs` at 0 after lifting a purse and let
the same hand go straight back in for something else. The real pounds are on
the `pickpocket_took` audit row.

**It is deliberately not an `Offer`.** Every Offer in the game is a consent
handshake: it DMs buttons, `offerExpiryPass.js` expires it, `characterDeath.js`
voids it, and it shows up in the responder's waiting-on-you list in `/chat`. A
pickpocket target is never asked anything and on a good roll is never told — so
the one surface an Offer would light up is exactly the one that has to stay
dark.

Two consequences fall out of it for free:

- **A turn boundary invalidates the authorization with no sweep**, because the
  take looks the row up by the *currently* open turn.
- **Nothing has to cancel it when somebody walks away.** The take re-runs
  `pickpocketAuthority` from scratch, so co-location is re-checked at use.
  That is why this verb needs no hook in `locationMove.js` the way a pending
  Search offer does.

`turnId` is not a foreign key — the `InterceptHit` reasoning: it is a claim
token, and deleting a turn must never cascade into somebody's spent ration.

**A reopened dialog does not cost the attempt, does not reroll, and does not
re-scan.** An untouched row at the same target is handed back with the
*same* die, as long as nothing has been taken against it yet. Only a roll
that actually happened sends the target's DM or pins the thief.

The list comes back frozen too, out of `PickpocketAttempt.revealed`, written at
the roll. That column exists because the reopen used to re-read the target's
pockets live: one spent attempt bought not a peek but a feed, and a thief who
reached in and cancelled could sit on the dialog for the rest of the turn and
watch things arrive in and leave somebody's pockets. **One attempt is one
look.** The snapshot is display only — the take re-reads the real rows under a
lock, so a line they have handed away since is refused there with the ordinary
stale-picker message.

### 2e. The DM fires at the take, not at the roll

A 2–3 where the thief opens the picker and then takes nothing says nothing at
all, which is the honest reading: you notice a hand in your pocket because
something left it. The consequence is that a thief who looks and cancels
escapes notice — the spent ration is the brake on doing that all afternoon.

**The noticed hold lands at the take too** (§2g), for the same reason and one
more: pinning the thief at the roll would tell them their band before they took
anything, which is exactly the tell §2c keeps out of the payload. A noticed
thief learns they were felt from their own DM, sent at the take beside the
victim's (§2g).

### 2f. No mood hit, no notice

Loot applies `ROBBED` and tells the target their body was searched. Neither
happens here, and `ROBBED` especially must not: a mood hit on a clean roll
would be a tell, and would give away a theft the die had just bought silence
for. If a mood hit is ever wanted, it belongs on the **noticed** band alone.

### 2g. A felt pickpocket is held by its victim, and a caught hand stays out of pockets

Both bands the victim feels write the hold a noticed Steal does (§1e), but
for **an hour** (`PICKPOCKET_CAUGHT_HOLD_MS`) rather than five minutes — the failed band at the roll, the noticed band at the take (§2e) —
`Character.heldUntil`, `heldReason: "caught"`, through `holdWhereTheyStand` —
with one difference that changes who is in charge of it: **`heldById` is the
target.** A stash has no owner, so a caught Steal is held by nobody; a
pickpocket's victim is a person, so they hold the thief the way an interceptor
holds a catch.

That buys the victim the whole intercept toolkit for free (`INTERCEPT.md` §3):

- **Let them go** — the thief shows up in the victim's Intercept dialog
  holding list with the ordinary Release button.
- **Walking off frees them**, and so does the victim dying. You cannot keep a
  hand on a shoulder from the next Location.
- **An Attack from the victim** replaces it with the fight's own hold, which
  the fight writes over any other. When the fight ends, so does the hold — the
  caught hour does not come back.

`holdWhereTheyStand`'s two rules apply unchanged: a hold already running
longer is left alone, and a running fight is never overwritten. The DM says
so only when the hold actually landed: *"…pickpocketed you! They won't get
far for the next hour — you have hold of them. To let them go sooner,
open Intercept and press Let them go."*, or the same tail after *"…tried to
pickpocket you, but failed!"* The DM names the button because the holding list
lives in the Intercept dialog, where a robbed person would never think to
look. There is no button in the DM itself: the old `INTERCEPT_HOLD` DM button
still answers, but its reply names the freed person by their real name, which
would unmask a hooded thief. A thief already held
longer gets the first sentence alone. Only a **fresh** roll writes the failed
hold; a reopened dialog rolled nothing and must not extend it. The noticed
hold cannot repeat, since the take can only happen once.

**Both sides are pinged.** Whenever the hold lands, the thief is DM'd too:
*"X felt your hand in their pocket. You can't leave for the next hour unless
they let you go."* — X being the victim as the thief knows them. An hour is
long enough that a thief who stepped away would come back to a scene that
happened without them, and five minutes never was. It gives away the noticed
band, which the dialog still keeps quiet (§2c), but by the time it is sent the
victim has been told, so there is nothing left to protect.

The countdown on the shut ways and the greyed button reads in minutes past
five (*"another 59 min"*) and seconds under it, through
`pickpocket.js#caughtWait`, so a Steal's hold still counts down in seconds.

**While caught, the thief may not pick another pocket.** The hold takes
movement everywhere else in the game (`INTERCEPT.md` §3); this is the one
verb it takes besides. The once-a-turn ration (§2d) already stops a thief
going on to a second pocket in the same turn, so this gate is what covers the
rest: a hold that runs over a turn boundary, and a Steal the room saw.
`pickpocketAuthority` reads
`intercept.js#caughtSecondsLeft` — pure, the same strict clock as
`heldReasonFor` — and refuses with *"You were caught stealing. You can't pick
a pocket for another Ns."* It keys on the `caught` reason, not on who holds
it, so a Steal the room saw (§1e) shuts the hand the same way. An intercept
or ambush hold does not: those take your feet, not your fingers.

**Nobody picks a pocket in the middle of a fight, on either side of it.** The
same gate reads `intercept.js#inFight` for both parties — a running hold
carrying `attack` or `attacking` — and refuses with *"You're in a fight."* or
*"Lord Greeblus is in a fight."* A lapsed fight that still carries its reason
(the turn advance clears nothing) is no fight. `PICKPOCKET_SELECT` has to
carry `heldUntil` and `heldReason` for this; drop them and every target reads
as never fighting.

Both refusals run at the **take** as well as at the roll, since the take
re-runs `pickpocketAuthority` from scratch (§2d). So an Attack that lands
between the roll and the take shuts the picker that was already open, and a
thief caught at a stash cannot come back to finish a clean reach they had left
open.

Only the clean band (4+) holds nobody. Nobody felt anything, so nobody has
hold of anybody.

### 2h. The button greys on the thief's own sheet

The Pickpocket button greys, with the refusal's own sentence as its tooltip,
when the thief is **caught**, **in a fight**, or has **spent this turn's
reach**. All three are facts about the thief's own sheet, which is all the
metagaming rule at the top of `actionRegistry.js` allows. Whether the *target*
is fighting never greys anything; only the server answers that, after a
target is picked.

`db/lib/pickpocket.js#pickpocketSelfBlock` builds the sentence for both the
button (`web/lib/peoplePools.js`, as `pickpocketBlocked`) and
`pickpocketAuthority`, so the two cannot drift. The reach counts as spent only
once no attempt this turn still has a hand in a pocket
(`pickpocketSpent`): a clean or noticed reach with nothing taken yet keeps the
button lit, or a thief who closed the picker could never come back to take.

A hold lapses on the clock with nothing written, so `/api/character-version`
fingerprints whether your own hold is running. The sheet re-renders within
one poll (10 s) of a hold landing or lapsing. `/chat` has no poller for its
pools, so there the button reflects page load, the same as Miracle, the Bird
and Extract.

### 2i. The mark's defense

**Four tags on the TARGET's sheet each take one off the thief's total**, and
they are the only four (`DEFENSE_SLUGS` in `db/lib/pickpocket.js`):

| on the mark | defense |
|---|---|
| Keen Hearing | +1 |
| Eagle Eyes | +1 |
| Pickpocketing I | +1 |
| Pickpocketing II | +1 |

The two senses are the ones that would catch a hand; the two rungs are there
because a thief knows where a hand goes. They are **counted, not looked up** —
a tag is on the sheet or it isn't — so the ceiling is 4, and nothing else on
either sheet moves it: Stealth, Clumsy and the drink are Steal's table (§1b),
not this one, and Lucky is the thief's die (§1c).

The band is `die + bonus − defense` (never below 1, which is already the
failed band), so each point of defense shifts the whole
table up one face. What that does to the odds, in faces out of 6:

| defense | plain thief: clean / noticed / failed | master (+1): clean / noticed / failed |
|---|---|---|
| 0 | 3 / 2 / 1 | 4 / 2 / 0 |
| 1 | 2 / 2 / 2 | 3 / 2 / 1 |
| 2 | 1 / 2 / 3 | 2 / 2 / 2 |
| 3 | 0 / 2 / 4 | 1 / 2 / 3 |
| 4 | 0 / 1 / 5 | 0 / 2 / 4 |

Three things fall out of that, and each is deliberate:

- **A defended mark is never immune.** The noticed band never closes: even at
  4, a plain thief on a 6 or a master on a 5–6 still gets the goods and gets
  felt. What defense buys is that the theft is *known*, not that it fails —
  and since a felt reach holds the thief (§2g), known means an hour with
  them pinned in front of you.
- **A clean take against 3 needs Skilled, and against 4 nobody gets one.**
  Somebody carrying all four has spent 13 points on it, and "you cannot be
  robbed without knowing" is what they bought.
- **Skilled's "never fails outright" (§2a) holds only against an undefended
  mark.** One point of defense puts a master's natural 1 back in the failure
  band, and a failed reach is a held thief.

**The thief is told nothing about it**, and the payload rule in §2c is what
makes that true: clean and noticed already look identical from the dialog, and
a failed reach against a wary mark reads exactly like a failed reach against
anyone. Nothing on the target's sheet is named in any refusal or notice — one
bad roll says nothing, and a thief who wants to know whether somebody is hard
to rob has to spend the turn's one reach (§2d) to find out, and stand there
held when it fails. The mark is told nothing either; their DM on a noticed or
failed reach is the same sentence it always was.

**It is written down, though.** `defense` is a column on the
`PickpocketAttempt` row and a field on the `pickpocket` audit row, beside the
die and the bonus, so a row reproduces its own outcome for a GM reading it
back — a `die: 5, outcome: failed` with no defense beside it would read as a
bug. Rows rolled before the column existed carry 0, which is what they rolled
against.

## 3. The two tags

| | slug | cost | who |
|---|---|---|---|
| Pickpocketing I | `pickpocket` | 5 | anyone |
| Pickpocketing II | `pickpocketing-skilled` | 4 | anyone |

**Neither slug changed, on purpose.** `db:sync-tags` is upsert-only, so
renaming in place keeps everybody who already bought either rung. Both carry
`keepSlug: true` to tell the syncer the drift is deliberate.

**What opened them to everyone was the GROUP, not the tags.** Both moved out
of `general-brigand` — which carried `requiredTag: brigand` — into
`general-traits`, which carries no gate: the basic rung on 2026-09-16, the
second on 2026-09-20 when the Brigand group was deleted outright. The member
tags of a gated group deliberately never repeat the gate themselves
(`TAGS.md`), so moving the tag was the whole of the change.

**Skilled uses `requiredTag`, not `parentTag`.** A prerequisite that does *not*
replace, so a master holds both rungs and pays 9 in total. `parentTag` would
delete Basic on purchase and leave every gate having to accept either tag to
mean the same thing.

**Both rungs also count on the other side of the table.** A Pickpocketing tag
on the *mark's* sheet is one point of defense apiece (§2i) — the same two
slugs read off the other character, so there is no third tag to buy and
nothing to keep in step. Keen Hearing and Eagle Eyes are the other two, and
that is the whole list.

## 4. Where the code lives

| Piece | File |
|---|---|
| Steal's table and threshold | `db/lib/steal.js` |
| Pickpocket's bands, budget and holdings filter | `db/lib/pickpocket.js` |
| Steal's server action | `web/app/(app)/character/actions/steal.js` |
| Pickpocket's two phases | `web/app/(app)/character/actions/pickpocket.js` |
| The `announceTake` switch | `web/app/(app)/character/actions/transfer.js` |
| Steal's dialog (a mode on the shared one) | `web/app/components/actions/MoveThingsDialog.js` |
| Pickpocket's dialog | `web/app/components/actions/PickpocketDialog.js` |
| The buttons | `web/app/components/actionRegistry.js`, `web/app/(app)/chat/RoomPanel.js` |
| The gate | `canPickpocket` in `web/lib/itemPools.js` (the tag) and `pickpocketBlocked` in `web/lib/peoplePools.js` (caught, fighting, spent) |
| The ration + authorization row | `PickpocketAttempt` in `db/prisma/schema.prisma` |
| The pure halves | `db/test/steal.test.js`, `db/test/pickpocket.test.js` |
| The tags | `docs/tags.yaml` (`pickpocket`, `pickpocketing-skilled`) |

## 5. Known warts

- **A failed Steal still moves the goods**, and a player reading the room line
  as "the theft was stopped" will be wrong. It is the settled rule, but it is
  the thing a GM will be asked about first. What a failed Steal does cost is
  5 minutes standing there (§1e).
- **A caught thief's hold overwrites a shorter Safe intercept hold on them**,
  and takes its `heldById` with it, so the interceptor's Release button no
  longer finds them. Same shape as the Attack-over-Safe gap in
  `attack.js#settleHold`, and the same small cost.
- **On `/chat` the Pickpocket button can be stale** (§2h). It greys at page
  load, so a hold that lapses, or a turn that turns over, leaves it grey until
  the page reloads or the player does something that re-renders it. The sheet
  is fine: its poller watches the hold and the turn.
- **The audit log is the only complete record of a stash now.** Anyone reading
  a Room thread has until now been able to treat "no line" as "nothing left
  here". After Steal, a missing item with no line is ordinary. Any tool
  reconciling `RoomTag` deltas against scene lines will disagree.
- **Search's per-target claim and Pickpocket's same-target refusal** live in
  separate tables with separate refusals, so `SEARCH.md` §7's known wart
  reproduces here: a hood coming off makes *"You already went through X's
  pockets"* name somebody you were never told about. Same harmless direction.
- **A pickpocket near their own carry ceiling is refused outright** rather than
  landing and shedding. That is not tidiness: past 1.5× the cap `settleCarry`
  sheds newest-first into a public room *with a line in it* (`CARRY.md` §5),
  which would announce a silent theft one second after it succeeded.
- **Obols weigh nothing, so the budget cannot bound them.** The `obol` tag is
  `weight: 0` and `category: items`, not an Asset, so §2b's Asset clause does
  not catch it, and "as many as fit" is the whole purse. One kind of thing per
  reach means a thief who goes for the coin takes nothing else, but the coin is
  still all of it. Left as it is. Changing it is a balance call.
