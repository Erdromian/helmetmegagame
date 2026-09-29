# Intercept — laying in wait

You stand somewhere and say who you are watching for. When one of them walks
in, they are stopped and handed a line you wrote. **Safe** holds them two
minutes; **Ambush** starts a real fight (`ATTACK.md` §9), which holds everybody
in it until it is over — and anybody else it catches that turn joins the same
fight.

It is the first mechanic in the game that takes **movement alone**. Everything
else that stops a person — Bound, Paralyzed, Dying, Catatonic — takes ACT with
it (`db/lib/incapacitation.js`), and a held character is meant to be able to
talk, fight back, and file a Gambit of their own. An ambush is a standoff, not
a paralysis.

## 1. The watch

`InterceptWatch`, one row per character — the `@unique` on `characterId` **is**
the "you have one watch" rule, the same way `Character.escortedById` is the
whole of "you can only follow one person". Editing is an upsert; there is no
history to keep, so the `AuditLog` row written on each save is the only record
of what a watch said at the time.

It carries a Location, a mode, a message, a list of typed names, three
dragnet flags, an Ambush's collaborators (§5a), one filter on where an arrival came from (§2a), and one box that
is not about who it catches at all (§5b).

**Setting or editing one is free**, whether or not your Move for the turn is
already spent. **An Ambush needs combat mode**, though (`COMBAT-MODE.md` §3):
`setWatch` refuses one with "You need to be in combat mode to lie in wait."
(`db/lib/combatGate.js#interceptBlock`), on both faces. **A Safe watch needs
none** (Combat Overhaul.docx) — it is a word on the road, not a fight. And **no
watch can be set once Moves lock** ("Moves are locked for this turn, so you
can't lie in wait."), the turn lock that shuts fighting and travel too
(`ATTACK.md` §10). **Nor while your own ambush's fight is running** ("Your
ambush has already sprung. You can't change it until the fight is over."), so
only the targets it sprang with join that fight (`ATTACK.md` §9). On Discord the watch
opens as a modal first, inside Discord's three seconds, so the refusal comes
after the modal is sent. **Stopping** a watch and **Release** are never gated,
and `stopInterceptImpl` and `releaseHeldImpl` carry no such check.

**It is anchored.** `locationId` is stamped from where its owner stood when
they saved it, and the watch works there and nowhere else. **Any move at all
cancels it** — walking, being carried along by an escort, a GM's teleport, a
Bulk Move, a staged Relocate to, a rite — and the owner is told:

> You left, so your interception was canceled.

It is sent **first** of the move's DMs and ahead of the channel work, because
the swaps below that are unguarded and every caller swallows this function's
throw: one Discord 5xx and the owner would lose the watch without ever being
told.

Laying in wait is a fact about a **place**. It used to be read live off
wherever the interceptor happened to be standing, which made it a property of
the person instead: a watch set at the gatehouse on Tuesday followed its owner
around Ravenheart and was still stopping strangers in the Underquarter on
Friday.

Both halves of that are load-bearing, and they are different hooks on purpose:

- **The delete** is `db/lib/intercept.js#cancelWatchOnMove`, called from
  `db/lib/locationMove.js#applyLocationMoveSideEffects` — the writer every
  relocation runs, which is why a teleport and a rite end a watch just as
  surely as legs do. It sits **above** that function's `DISCORD_TOKEN` guard,
  the `recordArrival` reasoning: losing the watch is a database fact and must
  not depend on there being a token to talk to Discord with. Only the letter
  waits for one. It fires only when `fromLocationId` is set, because a revive
  and a first placement both pass `null` for something that is not a move —
  without that check, reviving somebody would silently end their ambush. The
  dev panel's **Re-push Discord** button was the third of these and is gone
  (`DEV-PANEL.md` §2).
- **The anchor** is the same rule written twice, on purpose: `anchorHolds()`
  for the dialog, and a `where` clause for `fireWatches` (§5). A row is inert
  anywhere but its own Location, so a relocation that skipped the delete leaves
  a dud rather than a roaming radar — and it **can** be skipped, because every
  caller of `applyLocationMoveSideEffects` swallows its throw. The delete is
  what a player sees; the anchor is what makes it safe.

One relocation runs no side effects at all and so cancels by hand: a GM
teleporting somebody to **nowhere** (`web/app/(app)/gm/dev/characters/[characterId]/actions.js`).
Without that call the watch would sit inert while they stood nowhere and come
back to life the moment anything put them back.

Note the deliberate asymmetry with §5: a watch **fires** only from the road,
but it **dies** however you left.

**Setting one costs nothing** — no Move, no ⬢, no `Action`, no per-turn ration
— and nothing gates it. There is no `gate` or `show` key on the button: laying
in wait is a fact about nobody until somebody walks in, so the metagaming rule
in `actionRegistry.js` has nothing to bite on. `needs: ACT` applies at save
time, though, so a bound man is told why rather than left with a watch that
silently never fires.

The watch **survives** death, binding and catatonia — none of those moves
anybody. It is a standing preference, like an escort consent; a stale one is
inert, and it works again the moment its owner can act. It does not survive a
move of any kind.

## 2. A hood beats a name

`db/lib/intercept.js#matchesArrival` is the whole rule, and it is pure:

| The watch says | A face you know | A stranger's face | A hood | A forced name (`Beast`) | A disguise you can name | A disguise you can't |
|---|---|---|---|---|---|---|
| Any person | caught | caught | caught | caught | caught | caught |
| Anyone I can't identify | — | caught | caught | caught | — | caught |
| Any concealed person | — | — | caught | — | — | — |
| A typed name | caught if it matches | **never** | **never** | **never** | caught if it matches **the disguise's name** | **never** |

**A disguise is caught by the name it goes by** (`STRANGERS.md` §10). A Disguise
Kit's name is one the watcher can name when they learned it, or when it is the
full name of somebody they know, which fools them. Then a typed name matching
it catches the wearer: a watch for "Aldric Vask" stops an impostor dressed as
him, whoever is underneath. The wearer's real name never does. To anybody else
a disguise is a stranger's face. `fireWatches` asks
`disguises.js#readDisguises` per watcher, and `matchesArrival` takes the answer
as `disguiseKnown`.

**A name only catches somebody you know** (Combat Overhaul.docx: "only intercept
people recognized as targets, concealed or unfamiliar characters will not be
stopped"). "Know" is a Friends entry (`strangers.js#knownSubjects`, one lookup
per watcher for the whole arriving party); with the stranger rule switched off
everybody is known. It is worked out **before** the ration is claimed, so a
stranger a name did not reach never spends the turn's one catch. "Anyone I can't
identify" (`InterceptWatch.anyUnidentified`) is how a watch reaches the rest —
my reading counts a forced name among them, since nobody can name a Beast.
`anyPerson` subsumes both narrower dragnets, and `anyUnidentified` subsumes
`anyConcealed`, so `setWatch` stores only the widest.

A typed name is matched against the identity the room would **see**
(`db/lib/presentedIdentity.js`), never against the row. So a hooded Greeblus
reads as "a young man" and no watch naming him reaches him.

**This is load-bearing.** Without it Intercept would be a hood-defeating radar:
a watch costing nothing would tell you Greeblus is here *and* that he is hiding
it, which is precisely what the hood is bought to prevent. "Any concealed
person" is the option that exists instead — you can watch for somebody hooded,
you just cannot know it is him.

The rule runs both ways in the DMs. **Every line names both sides by the face
the room saw**, through `seenAs()`. The victim's DM says "a young man" if the
interceptor is hooded; the interceptor's confirmation says "a young man" if the
arrival is. Otherwise the confirmation would be the unmasking tool the matching
rule just closed — and so would the audit row, which stores `presented` for the
same reason.

**Names are typed, and matched at FIRE time, not at save.** Typing is the
Engrave / Arrest Warrant reasoning (`web/app/(app)/character/cerberonActions.js`):
a dropdown here would be a roster of everybody alive in Ravenheart, handed to
anyone who opened the dialog. Matching *late* is the other half — resolving a
name to an id when the watch is saved would make the dialog a **roster oracle**,
answering "is there anybody called that?" to anyone who probed it.
`matchesTypedName` is exact and takes either the full display name or the bare
`First Last`.

## 2a. Coming up the road, or just crossing the square

`outsideZoneOnly`, off by default, and `db/lib/intercept.js#originHolds` is the
whole of it: on, a watch only catches somebody who **crossed into this zone** on
the move that brought them here.

It exists because a Safe watch at the town gate was stopping the same townsfolk
every day with the same line. The `InterceptHit` ration (§5) already caps that at
once per person per turn, but once per person per turn is still everybody who
lives there — and the watch was meant for strangers coming up the road.

Three things about it are deliberate:

- **It is not a "who".** `anyPerson` subsumes `anyConcealed`, and this is
  subsumed by neither: it narrows whichever who you picked, typed names
  included. So it never greys out, and `setInterceptImpl` does not clear it the
  way it clears `anyConcealed`.
- **It is not folded into `matchesArrival`.** That function is the hood rule and
  only the hood rule (§2). Where you came from is geography, not a face, and
  `matchesArrival` stays pure over an identity.
- **An arrival with no previous zone counts as outside.** An unknown origin is a
  stranger; the other way round would be a hole in a watch somebody deliberately
  turned on.

Each arrival is judged **on its own journey**, not on the mover's — a leader
crossing a border can be carrying somebody who never left the zone, so
`performLocationMove` hands `fireWatches` a `fromZoneId` per arrival beside the
destination's `zoneId`. That per-arrival `fromZoneId` is computed in
`db/lib/locationTravel.js` and, until this, was written and never read.

## 3. The hold

`Character.heldUntil` and `Character.heldById`. **Both derived, and nothing
sweeps**: past the timestamp you are free, and nothing had to notice. It is the
keyed-way pattern (`MAP.md` §2b) applied to a person instead of a door.

- **Safe** — `now + 2 minutes`.
- **Ambush** — a fight's hold, written by `db/lib/combat.js#settleHold`
  rather than here (§5a, `ATTACK.md` §3): until the fight is over, and never
  past the turn's end.

`Character.heldReason` says **which** has hold of somebody — `HELD_REASON` in
this file, and there are six values rather than two because a fight holds
everybody in it and they must not read the same sentence — the jumped, the
jumper, somebody asked to join, somebody withdrawing (`ATTACK.md` §3) — and because a
thief who was caught (`caught`: five minutes at a stash, an hour in a pocket) is held by nobody at all when the
stash had no owner (`THEFT.md` §1e, no `heldById`, so only the clock ends it) and
by the victim when there was one (§2g, a failed or noticed Pickpocket — `heldById` is the
target, so every clear below works for them). Both are written by
`holdWhereTheyStand`, which carries the clock rule below and one more: it never
lands on a fight that is still running, however soon that fight ends. A column
rather than a lookup because the predicate below is pure and eight surfaces
read it — and two more pure readers sit beside it, `inFight` and
`caughtSecondsLeft`, which are what shuts Pickpocket on a fight or a caught
hand (`THEFT.md` §2g).

A follower held by nobody is left behind as `stuck` rather than `held`, so the
leader reads *"X couldn't follow."* and not *"Somebody has hold of X."*

`heldReasonFor(character, now)` is the one predicate, pure, and it is what both
the mover's gate and every picker read — so a surface can never draw a way the
mover is about to refuse. Under five minutes it counts down; past that it says
"until the end of the turn", because `43188s` would be worse than saying
nothing. A caught thief is the exception: their hold has a known end, so past
five minutes it counts down in minutes instead (`THEFT.md` §2g).

**It is not the only thing that stops a walk.** A 1 on the Caving Die keeps a
caver underground until the turn is pushed — `cavingRestrictionsFor`
(`CAVING.md` §2c), a separate predicate reading a separate table, and a
narrower one: it takes the way up to the surface rather than every way out of
the room. The two are deliberately not merged; a hold is a person's hand on you
and lapses on a clock, and that one is a locked door waiting on the push.

**Three writers end a hold before its time**, and `heldById` is what lets each
of them know whose holds to clear. All three are about an *intercept* hold:
each carries `heldReason: { notIn: FIGHT_REASONS }`, because both sides of a
fight are held, `heldById` names only one opponent of possibly several, and only
the fight's participant rows know who is still in it. A fight ends through
`db/lib/combat.js`, and only there (`ATTACK.md` §7).

1. The holder presses **Release** — on the sheet, or on the button in their own
   DM. Both go through `db/lib/dmAnswer.js#answerInterceptHold`, so the faces
   cannot drift. `releaseHeldBy`'s `WHERE` is the ownership check; there is no
   second lookup to disagree with it.
2. The holder **leaves** — `performLocationMove` clears their holds inside its
   own transaction when they walk, and `applyLocationMoveSideEffects` clears
   them for every other way of going: a GM's teleport, a rite, a Bulk Move.
   You cannot keep a hand on a shoulder from the next zone, and it should not
   matter whether you chose to go. The two clears overlap on the walking case,
   which costs one no-op update.
3. The holder **dies** — `db/lib/characterDeath.js`, beside the escort release.

A held character's own `heldUntil` is never cleared on their own death. It
costs a corpse nothing and lapses by itself.

## 4. Where the freeze bites

**One gate**, at the top of `performLocationMove`, beside the incapacitation
check. Every move in the game funnels through there, so it covers the `/chat`
travel panel, `/map`, the bot's picker and `/location` at once.

**And one more, which is the easy one to miss.** Escort followers never touch
that gate — they are re-authorised in the transaction and then moved by a
single `updateMany` — so without a second check a friend could carry a held
character straight out of the ambush. `performLocationMove` drops a held
follower into `leftBehind` with the reason `held`, and `escortAuthority`
refuses to attach one at all (above its FORCED branches, so an ambusher cannot
walk off with their own prisoner either).

`held` is the **one** `leftBehind` reason the leader is told out loud. Every
other reason stays unnamed, because naming a hidden crawl's refusal would
announce that the crawl is there (`MAP.md` §2a) — but somebody having hold of
your friend is plain to see.

`resolveNeighbors` writes the refusal onto **every** row, not just the ones that
cross a zone: a held person cannot walk anywhere. `listed` is left alone, so the
ways still draw, shut, with the reason on them.

**A watch catches somebody mid-walk, at a Location they were only passing
through.** A walk of several hops across a zone (`MAP.md` §3c) is the real
single-hop move repeated, so `fireWatches` runs at every stop on the road, not
just at the far end. A hold landing in the middle ends the walk there, and the
walker is told how far they got and then your own line — they are standing at
your Location, not at the one they picked.

That is deliberate, and it is what stops a walk being a free pass across the
zone: a watched crossroads is a real reason to go the long way round. The
walker's **own** watch dies at the first hop either way, under §1's rule that
any move at all cancels it.

## 5. Firing

**An Ambush whose owner is out of combat mode is dormant** (`COMBAT-MODE.md` §3).
`fireWatches` drops it in its `live` filter, beside the ACT check, and keeps
the row: it works again the moment its owner is alert. A Safe watch is never
dormant. Combat mode can go off
under a standing watch — turned off on a later turn, or switched off by the
push at Exhausted — and the dialog says so rather than drawing a watch that
cannot fire.

`fireWatches` is called once by `performLocationMove` with the whole arriving
party — mover first, then everyone they brought — which is what makes "if
several people come up together, all of them get stopped" free rather than a
feature of its own. It sends nothing: it returns DM descriptors, and the caller
sends them after the transaction, the way `cavingDm` already works.

**It hooks the mover, not `applyLocationMoveSideEffects`.** That hook is the one
every writer of `locationId` runs, and the `LocationVisit` precedent argues for
it — but a visit is a fact of geography, true however you got there, and an
intercept is one person acting on another with the fiction "stopped on the
road". Coming down the road is the gate. Hooking the universal writer would
mean a GM's teleport, a Bulk Move, a staged Relocate to, a threat spawn, a
Thanati rite and a brand-new character's first placement could all trip
somebody's ambush. The cost, stated plainly: **a rite that yanks people
somewhere will not trip a watch.** That is the right side of the trade.

The query loads every watch **anchored to the arrival Location whose owner is
also standing there**. Both clauses, not one: the anchor is the rule (§1), and
the owner's live position is what neuters a row the cancel missed. It can miss:
every caller of `applyLocationMoveSideEffects` swallows its throw, so one
Discord failure mid-relocation leaves a live row at a place its owner has
walked out of.

A watch does not fire if its owner is not `ALIVE`, cannot `ACT`, or is
**themselves one of the arrivals** — you cannot lay in wait while you are
walking, and catching the person you travelled with would be a trick nobody
meant to build.

### Stacking

- Several watches may match one arrival. They are frozen **once**: the longest
  hold wins, so an Ambush always beats a Safe stop and a second Safe stop
  cannot shorten the first. The write is conditional on the clock, so a hold
  already running longer is left where it is. Ambushes hold through their fight
  (`combat.js#settleHold`) and Safe stops through the loop here, and both writes carry the same
  condition, so the two cannot fight over one person.
- The victim gets **one DM per intercepting character**. Three guards at the
  gate is three lines, because walking into three people is what happened.
- A Safe watch reports its whole haul in one line to its owner. An Ambush is
  one DM per victim, because each carries a Release button and a button answers
  about exactly one person (`db/lib/dmActions.js#dmAction`).
- **The zone filter is checked BEFORE the ration is claimed.** A local a watch
  deliberately ignored must not burn that turn's one catch, or a stranger
  arriving later the same turn would walk straight through.
- **You catch a given person at most once a turn.** `InterceptHit`, and the
  `@@unique([interceptorId, targetCharacterId, turnId])` **is** the enforcement
  — the insert is what claims the catch, so two arrivals in one tick cannot
  both pass. Without it a lapsed two-minute hold is walked straight back into,
  and a Safe watch on a busy road becomes an endless roadblock and an endless
  DM feed.

  The row is keyed to the **catcher**, never to the watch. A watch is churn: it
  dies when its owner steps out of the room and is a new row when they come
  back, and Stop-then-Save is two clicks. Keyed to the row, the ration would be
  reset by any of that, and a Safe watch could catch the same person all
  afternoon. Keyed to the person, re-setting a watch buys nothing.

### 5b. Automatically search?

`autoSearch`, off by default: a watch that catches somebody also raises a
**Search** offer against them ([`SEARCH.md`](SEARCH.md) §6). It buys the ask and
never the answer — the consent DM is the ordinary one, No is a real answer, and
they still get the Hide items picker first.

It runs **last**, after the `InterceptHit` ration above has claimed the catch
and after an Ambush has sprung, and it skips an ambush that caught nobody
(`hit.held`) — searching somebody you did not actually stop would be a lie, the
same flag the victim's DM already gates on.

It is **not a who**, which is why it is not a fourth chip in the dragnet row and
why nothing subsumes or clears it: the three flags above say who this watch
catches, and this says what happens once it has them. A watch with only this
ticked still catches nobody, because the query at the top of `fireWatches` needs
a who.

A ration already spent by hand this turn means no offer and **no DM to the
target** — they must not hear about a search that never happened — and a `-#`
line under the interceptor's own catch confirmation, because silence there would
read as a bug.

`fireWatches` requires `db/lib/search.js` lazily, at call time, for the same
reason §5a requires `combat.js` that way: that module requires this one back for
`seenAs` / `identityOf` / `IDENTITY_SELECT`.

### 5a. An Ambush is a fight

When an Ambush fires it calls `db/lib/combat.js#springAmbush` (Combat
Overhaul.docx; `ATTACK.md` §9):

- **The first catch of the turn starts a fight**: the owner is its initiator,
  the arrival its target, and the watch's `message` is the opening line on the
  target's DM. The ambusher is held too — springing the trap puts you in it.
- **Every later catch joins that same fight** as a target, snapshotted as they
  walk in, with no distance rule. Ambushers are snapshotted when it first
  sprang.
- **Collaborators.** An Ambush may name people standing there when it is set
  (`InterceptWatch.collaboratorIds`, ids kept server-side and never sent to a
  browser; the dialog re-derives who is picked from the room). Those still
  standing there when it springs are asked to join, like an attack's
  collaborators. The Discord modal has no room for a picker, so the bot asks in
  a second step after the watch saves (`verbs/watch.js#setWatchCollaborators`).
- **Skipped before the ration** — an arrival already in a fight, or an owner
  busy in some other fight — so a catch that could not happen never spends the
  turn's one.

`fireWatches` requires `db/lib/combat.js` **lazily**, at call time, because that
module requires this one back for the hold's own vocabulary. A cycle resolved at
call time rather than load time, so neither half ever sees a partial exports
object.

## 6. The DMs

Three lines here, and an Ambush's are the fight's (`ATTACK.md` §4): the victim
hears "You were stopped on the road. It's an ambush!" with the watch's message
on a `»` line under it and the fight's own buttons.

| Line | `DM_KIND` |
|---|---|
| The victim, Safe — carries the typed message | `NOTICE` |
| The interceptor's confirmation | `NOTICE` |
| The victim, released | `NOTICE` |

All of them are `NOTICE`, the first included. They used to be `CONVERSATION`
because the interceptor typed the words, but a stop on the road is still the
game delivering it, and as `CONVERSATION` every one of them pinged the GM inbox.
`authorDiscordUserId` is still set on the Safe stop and on an ambush's opening
line, so who said it stays on record.

Bascinet's Ambush line does not mention the message, but a player who typed one
and had it silently dropped would read that as a bug, so it rides along on its
own `»` line underneath rather than being folded into the sentence.

**The Safe stop reads "You were stopped on the road by a young man:"**, the
stopper named as the victim knows them, with the message on a `»` line under
it. It used to add "He said" / "She said" / "They said"; Bascinet's copy pass
(2026-09-27) dropped that, and `saidWord` with it.

**The typed message is untrusted**, and is cleaned at **save** time, not at
send — `cleanMessage()` caps it at 300 characters and strips `@everyone` /
`@here` using `db/lib/discordMarkup.js`'s own `ping` pattern. Sanitizing at save
means the stored row, the `DirectMessage` row, `/gm/messages`, the player's web
thread and the Discord send are all clean from one place; sanitizing at send
would leave the logged copy carrying the ping, and `remarkDiscord.js` renders
that token on the web too. `<@id>`, `<#id>` and `<t:…>` deliberately survive:
they are the sanctioned vocabulary `db/test/discordMarkup.test.js` pins.

Belt to those braces, every Intercept DM is sent with
`allowedMentions: { parse: [] }`. Threading that option through both `sendDm`
twins and `postDmBatched` closes the same hole for any future DM carrying
player text. It rides **every** chunk of a batched message, unlike `components`
and `embeds`, which ride only the last — a ping in an early chunk would
otherwise go out unmuzzled.

## 7. Release

An ambush is a fight now, and a fight ends the fight's ways (`ATTACK.md` §7) —
Call off, a side emptying, a GM, the push. What follows is the legacy button a
pre-overhaul ambush DM still carries.

The button in an old ambusher's DM is `DM_ACTION.ATTACK_HOLD`, labelled **Cancel
attack**, and it is the odd one out of that family: every other kind is a
**pending row somebody is being asked about**, and this is the person who
imposed a state ending it. That is also why it never became an `Offer` kind — an
Offer's *responder* answers, and here the *initiator* does; modelling it as one
would mean "accept" meant "release" and every reader of the Offer table would
have to learn that one kind means the opposite of the others.

It was `INTERCEPT_HOLD` until an ambush became an attack. That kind, its
`icept:release:` prefix and its answerer all stay, so a button already sitting
in somebody's DMs when the change shipped still does something — but nothing
builds a new one, and `interceptReleaseRow` is gone.

A Safe hit also draws its own row on the GM's Other lens, carrying both people
and what each of them filed this turn (`ADJUDICATION.md`, the Other lens) — but no cancel button.
The two-minute hold lapsed on its own clock long before a GM got there, so one
could only ever answer *They're already free.*

The authoritative control for a fight is the Attack dialog's fight panel. The
Intercept dialog's own
holding list is Safe stops and caught pickpockets (`THEFT.md` §2g) — it excludes
both fight reasons, for the reason §3 gives: listing a fight there would draw a Let-them-go button whose
only possible answer is *They're already free.*

## 8. The surface

`/character`'s verb strip, in the **Others** section. The dialog is
`web/app/components/actions/InterceptDialog.js` on `ActionDialog`, and it loads
whatever watch is set so it can be reopened and edited at any time.

**The icon on the strip never greys.** Setting or editing a watch is free
regardless of what you've filed this turn, so neither the strip nor Save
inside the dialog has anything to grey for it.

**Nothing in it is a tooltip** (`SHEET.md` §3). Both mode sentences print on the
page, both at once rather than only the chosen one; the dialog names the place
the watch is anchored to and says that walking away ends it; and the hood rule
reads under the name field — it is the one thing about this verb a player could not
work out by using it.

`web/app/components/NameChips.js` is the app's first real multi-select input:
a `.field` wrapping a `.chip-row` of typed tokens and an input that commits on
Enter, on comma, and **on blur** — losing what you just typed because you
reached for Save is the one thing a control like this must not do. A token
carries `data-active` but no `aria-pressed`: a `ChipPicker` chip is a toggle, a
token here is a remove control.

The two dragnets sit in their own `.chip-row` **above** the names, because ✕ has
to mean exactly one thing in a row and "anyone who comes" is not a name somebody
typed. "Any person" subsumes "any concealed person" and is stored as the only
one, so the greying-out is true rather than merely drawn.

**Only from outside the zone** (§2a) is a third chip in that same row, and it is
the odd one there: the other two are a who, and this narrows whichever who you
picked. It buys a whole new control's worth of clutter otherwise — a checkbox of
its own under a dialog that already runs to five fields — and the row is a row of
toggles, which is exactly what it is. So it never greys, and one line under the
row says what it does, since nothing in this dialog is a tooltip.

## 9. The audit

Three `actionType`s, all under the existing `request_` family so
`auditNarrative.js` needs no new band:

| Type | Written by | `turnId` |
|---|---|---|
| `request_intercept_set` | the save, Stop watching, and a move cancelling it | yes |
| `request_intercept_fired` | `fireWatches`, bot-side too | **yes** |
| `request_intercept_released` | the sheet's Release | yes |

`turnId` is set on the fired row because the once-per-turn rule is turn-scoped
and a row without it is unreadable as a record of that rule. Worth being clear,
though: **unlike the three rations in `REQUESTS.md` §1a, the rule is not
enforced by counting these rows.** The unique on `InterceptHit` is. Those three
count audit rows only because they have no state of their own; this has.

The move-cancel row is written with `actorDiscordUserId: "system"`, not the
walker's: nobody *chose* to end the watch, and a GM's teleport ends one the
same way somebody's own legs do.

Nothing here is destructive, so no `restore` snapshot is owed (`REQUESTS.md` §2).

## 10. Where the code lives

| File | Role |
|---|---|
| `db/lib/intercept.js` | The whole mechanism. The ONLY module that decides who a watch catches, and the only one that knows what a hold is |
| `db/lib/locationTravel.js` | The mover's gate, the per-follower drop, the fire hook |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — cancels the watch on ANY relocation, and sends the letter |
| `db/lib/locationGraph.js` | `resolveNeighbors` draws the refusal on every way |
| `db/lib/escort.js` | Refuses to attach somebody being held |
| `db/lib/combat.js` | What an Ambush actually starts (`ATTACK.md` §9) |
| `db/lib/dmAnswer.js` | `answerInterceptHold` — Release, shared by both faces |
| `db/lib/search.js` | What `autoSearch` raises when a watch fires ([`SEARCH.md`](SEARCH.md)) |
| `web/app/(app)/character/interceptActions.js` | Load, save, stop, release |
| `web/app/components/actions/InterceptDialog.js` | The dialog |
| `web/app/components/NameChips.js` | The typed-name token input |
| `db/test/intercept.test.js` | The pure halves — the hood rule above all |
