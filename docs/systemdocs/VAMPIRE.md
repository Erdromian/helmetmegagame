# The Vampire — blood and humanity

An antagonist Threat (`THREATS.md`), assigned like any other. A Vampire's
primary objective is to survive and avoid giving in to their monstrous
nature. They carry two 0-100 stats nobody else on the roster has: **blood
level** and **humanity**.

**This doc now covers the whole design doc, pages 1-11.** §§1-5 below are
pages 1-3 (blood, humanity, the forced compulsion) — unchanged since they
first shipped. §6 onward is pages 4-11: the purchasable "Blood" menu of
boons, the vampire's own death, feeding's tag fallout, and the Vampire's
Desires and purchasable tags.

## 1. Becoming a Vampire

Opt-in is the same single "Enable antagonist roles" checkbox every other
Threat shares (`THREATS.md` §1) — there is no separate Vampire box. A GM hands
the seat to an opted-in, already-existing character with `assignThreat` on
`/gm/dev?s=assignments`, the same as Judge or Demoness. A Vampire is never
spawned as a brand-new arrival — `db/lib/threats.js`'s `vampire` entry carries
no `spawn` block, the first Threat that doesn't. There is no Role of its own
either (no unique kit or starting items in this scope), so its `brief` lines
carry what a Role's charter would otherwise say.

Both stats start at 100 the moment the seat is assigned (`Character.
vampireBloodLevel`/`vampireHumanity`, schema defaults). Neither is ever shown
to the player as a raw number — same posture as `hungerValue` — only the tag
chips below (and the Blood tile standing in for Hunger, §2c) say anything,
and only to the extent each one's visibility allows.

## 2. Blood level

Decays every turn, reaching 0 in **3 in-game days** without feeding, at a
rate configurable on the Dev Panel (`vampireBloodDecayPerDay`, default 34 —
100/3 rounded). The rate is authored per **in-game day**, not per turn or per
real day, because how many turns make a day is itself a GM knob
(`TURN-ENGINE.md` §1). `db/lib/vampirePass.js` splits the daily rate evenly
over the turns in one in-game day (`turnClock.js#turnsInGameDay`), rounded:

- **Turns per in-game day** (`GameConfig.turnsPerDay`) set to N: the day is N
  turns, whatever their length. 24-hour turns run two to a day drain 17 each,
  so a full meter lasts 6 turns (6 real days).
- Left at 0 (the clock rule): the day is the turn length's share of 24
  hours, so 34 a turn at 24 hours, 17 at 12, 11 at 8 and 9 at 6.

Either way "3 days to empty" means 3 in-game days.

Two independent tag tracks ride off the blood level, both recomputed every
turn close:

**Urgency** — hidden, mutually exclusive, exactly one held at all times:

| Tag | Blood | Says (to the vampire only) | Effect |
|---|---|---|---|
| Flush | 100 | "The blood of a mortal courses through your veins, rejuvenating you." | +1 to gambits |
| Satiated | 99-67 | "Your thirst for human blood is satisfied." | — |
| Thirsty | 66-34 | "Your appetite for blood is growing, it would be wise to find a victim soon..." | — |
| Famished | 33-1 | "You can barely contain your insatiable urge for blood! If you do not find a victim soon, you will lose all control." | — |
| Bloodcrazed | 0 | "You have lost all control of yourself and will prey upon the first person you see!" | Forces a feeding Gambit + an Attack — §4 |

The design doc's printed ranges for these overlap at their edges (100 /
100-67 / 66-34 / 33-1 / 0); `db/lib/vampire.js#bloodUrgencyBand` reads them as
non-overlapping steps with Flush the exact top value and Satiated taking the
rest of that band — see that file's own comment.

**Appearance** — visible, additive, either or both may be held at once:

| Tag | Blood | Says (to an observer) |
|---|---|---|
| Pale | ≤66 | (reuses the game's existing `pale` tag — see §2a) |
| Black Sclera | ≤33 | "The whites of their eyes look like bottomless black pits!" |

### 2a. Pale is reused, not reinvented

The design doc says to "apply existing pale tag," and that's exactly what
happens — `docs/tags.yaml`'s `pale` (currently the Migrant's starting trait,
and the gate `saint` requires) gets a second granter in
`db/lib/vampirePass.js`. **Known, small gap:** if a character is ever both a
Migrant and a Vampire, the pass's own drop-when-blood-recovers logic will
strip Pale the moment their blood clears 66, even though the Migrant reason
for holding it never went away — `CharacterTag` carries no "why," only a
single row per tag. A GM who hits this can just re-grant Pale by hand from
the character's Tags tab. Not worth tracking provenance for what should be a
rare double-cast.

### 2b. Feeding

**Feeding is a plain Gambit, not a coded action.** A vampire replenishes
their blood by writing an ordinary free-text Gambit describing it, the same
as any other hostile act in this game (`COMBAT.md`: "Nothing here resolves a
fight — that's a Gambit and a GM's ruling"). There is no "Feed" button, no
target picker, and no coded lethality formula — "its lethality will depend on
how thirsty for blood a vampire is" is GM narrative judgment, not a die roll.

If the GM judges the feeding succeeded, **the GM manually sets the vampire's
blood back to 100** on the character's GM edit screen
(`/gm/dev/characters/[characterId]`, the new Vampire panel — `DEV-PANEL.md`).
That panel shows the vampire's current urgency band next to the blood field
as free context (derived client-side, no extra query) so the GM can judge
severity against how desperate the vampire actually was. Setting blood there
re-syncs the Pale/Bloodcrazed-etc. chips immediately
(`db/lib/vampireBands.js`), rather than waiting for the next turn close.

Or the GM **stages it** from the Move itself, with the Effect composer's
Scales group (`ADJUDICATION.md` §1b), and it lands at the turn push with the
rest of the ruling. Blood and humanity both stage that way, set or moved. A
staged drop into Bloodcrazed takes the automatic 60 humanity (§3a), and a
staged humanity of 0 makes them Bestial and a Wight (§3), the same as if the
nightly pass had got them there. The nightly pass then leaves a staged meter
alone for that close — no drain on a staged blood, no regen or Bloodcrazed
loss on a staged humanity — so the Vampire starts the next turn on the GM's
number.

This is deliberate, not a placeholder: automating blood restoration or dice
would mean inventing a combat-resolution system this engine doesn't have
anywhere else. See the Blood Abilities menu (out of scope, §0 above) for
where a coded, purchasable effect belongs instead.

### 2c. Blood stands where Hunger would

A vampire is Hungerless (§8), so the two places every other character is
told their Hunger — the sheet's Hunger tile (`SHEET.md` §2) and the /chat You
plate's descriptor row (`CHAT.md` §0) — tell a vampire their **Blood**
instead: the urgency band's word (Flush, Satiated, Thirsty, Famished,
Bloodcrazed) toned good, muted, warn, bad, bad, with the band's own line from
the table above. Never the number. `db/lib/vampire.js#bloodDescriptorFor`
reads the held urgency tag first and falls back to `vampireBloodLevel` when
none is held, the same order `hunger.js#hungerDescriptorFor` uses;
`web/lib/descriptors.js#appetiteOf` picks Blood or Hunger. The urgency chip is
left off the sheet's status strip, since the tile already says it.

## 3. Humanity

Regenerates **+10 an in-game day**, split over the day's turns the same way
as blood decay
(`vampireHumanityRegenPerDay`, dev-panel configurable). Four hidden, mutually
exclusive bands:

| Tag | Humanity | Says |
|---|---|---|
| Humane | 100-76 | "Your connection to the mortal world around you is secure, for now." |
| Estranged | 75-51 | "You feel markedly detached from the rest of the world." |
| Disturbed | 50-26 | "You have lost any sense of remorse for the horrible things you've done." |
| Warped | 25-1 | "You find yourself at odds with the mortal world, and the those who inhabit it." |

At 0, permanently:

| Tag | Says | Effect |
|---|---|---|
| Bestial | "No more a human, your inner nature has broken free and can be subdued no longer!" | Disables humanity regen, for good |
| Wight | "A pale ghoul with vicious fangs! It lurks in search of blood." (visible) | Same forced compulsion as Bloodcrazed — §4 |

Both are permanent — no `durationTurns`, never re-derived from the number.
Bestial's regen-disable is gated on **holding the tag**, not on the number
being 0, so a GM manually raising humanity back up afterwards does not
quietly restart regeneration; the tag has to come off by hand for that.

### 3a. Humanity loss

**One rule is coded.** Becoming Bloodcrazed — the turn a vampire's blood
crosses *into* 0, never a turn they simply remain there — costs **60
humanity**, automatically, exactly once per crossing
(`HUMANITY_LOSS_BLOODCRAZED` in `db/lib/vampire.js`). The design doc's own
last sentence is the reason it can't double-fire on its own: "Characters only
incur an initial humanity loss from gaining the blood crazed tag, afterwards
they can spend as long bloodcrazed as it takes to feed without having its
humanity loss applied." `db/lib/vampirePass.js` detects this as a true
band-crossing (before ≠ bloodcrazed, after = bloodcrazed) every turn, off
that turn's own before/after values — never off a stored "already charged"
flag — so a vampire sitting in Bloodcrazed for ten turns straight is only
ever charged once, on the first of them.

**Everything else in this table is GM guidance, not code** — there is no new
GM tool for it beyond the same Vampire panel used to restore blood. A GM
adjudicating a kill (the doc: "adjudicated by GMs, with the events leading up
to a character's death logged in the audit log") applies the loss by hand:

| Event | Humanity loss |
|---|---|
| Killing without reason | 40 |
| Killing due to overzealous feeding | 20 |
| Killing someone solely because they are an enemy/rival | 30 |
| Killing in self defence | 20 |

**Only once per turn, and the most severe applies.** If a vampire becomes
Bloodcrazed *and* kills someone the same turn, they lose 60 total, not 60 +
whichever kill amount — the automatic 60 already covers it. This cap is not
enforced in code; it's a rule for the GM applying these by hand to follow.

## 4. The forced compulsion

Bloodcrazed and Wight share one behavior, coded because it's system-
triggered rather than player-written: "the vampire's action to be
automatically submitted as feeding on a random other character in their
current location. It will also cause them to automatically submit an attack
action on a random character in their current location."

Every turn a character holds either tag, `db/lib/vampireCompulsion.js`:

1. Picks a random other ALIVE character at the vampire's Location and
   auto-files a Gambit-kind Move on the vampire's behalf describing the
   feeding (`gmNotes: "auto:bloodcrazed"`/`"auto:wight"`, no `playerFiled` —
   the same auto-authored-Gambit shape `db/lib/confession.js` and
   `db/lib/lessons.js` use). **The GM still adjudicates this Gambit exactly
   like a player-written one** — §2b's manual-restore-blood rule applies
   here too, with no automatic effect just because the game filed it.
2. Independently picks a (possibly different) random other ALIVE character
   at the same Location and starts a real fight against them
   (`db/lib/combat.js#startCombat`, `ATTACK.md`) — holding both until it is
   over, same as a player pressing the button. Deliberately **not** gated
   (`combatGate.js#combatBlock`): this is an involuntary compulsion, not a fight
   the character chose, so neither combat mode nor the turn lock applies. The
   victim is DMed like anybody attacked, and asked to write what they do, and
   the room is told.

If nobody else is at the vampire's Location, both are skipped for that turn
(logged, not an error) — there's nobody to prey on. If the vampire somehow
already has an Action row for the newly-opened turn (a defensive check, not
a real race — nothing could plausibly beat this), the whole step is skipped
for them that turn rather than colliding with `Action`'s one-per-turn unique
constraint.

**This step runs outside the normal turn-pass machinery on purpose.** It has
to file against the turn that's just *opening*, not the one that just
closed — `stagedPush` only ever resolves Action rows stamped with the
closing turn's own id, and an Attack's hold length is measured against the
turn still running, so filing either one against an already-closing turn
would give it a meaningless near-zero duration. `db/index.js#advanceTurn()`
calls it once, right after the new `Turn` row is created, reading whichever
vampires the blood/humanity pass's own close (§2, §3) just left holding
either tag. It is not a `TURN_PASSES` entry and carries no resume — a crash
mid-loop just means some vampires miss one turn's compulsion, logged and
moved on.

## 5. Config

Both rates are per **in-game day**, on `/gm/dev` under Vampire:

| Key | Default | |
|---|---|---|
| `vampireBloodDecayPerDay` | 34 | Empties a full meter in 3 in-game days |
| `vampireHumanityRegenPerDay` | 10 | Matches the design doc's own figure |

## 6. The Blood Abilities menu

A "Blood" button on the character screen (self-only, TagRail.js's header,
beside "Spend Tag Points") opens ten boons. Each one immediately deducts a
blood cost from `vampireBloodLevel` (refused if the vampire can't afford it),
applies its effect, and goes on a cooldown — `db/lib/vampireBloodAbilities.js`
is the pure catalog, `web/app/(app)/character/actions/bloodAbility.js` is the
one server action every "Use" button calls, dispatched by ability key.

| Ability | Requires | Cost | Cooldown | Effect |
|---|---|---|---|---|
| Blood Strength | — | 30 | 4v | +2 melee fighting, 1 turn (`blood-strength` tag) |
| Regeneration | — | 20 | 2v | Removes every held health-wounds/health-illness/health-infection tag except Burned/Severe Burns |
| Corrupt | Corruptor tag, 1 Heart | 70 | 6v | Consumes the Heart, grants Black Heart |
| Celerity | Celerity tag | 25 | 2v | +1 fighting both trees, 1 turn (`agility` tag) |
| Resilience | — | 30 | 2v | +0.3 melee/ballistic armor, 1 turn (`resilient` tag) |
| Bat Form | Bat Form tag | 50 | 4v | Instant free travel to any Location |
| Solidarity | Solidarity tag | 30 | 2v | A DM to every other ALIVE vampire |
| Obfuscate | Obfuscate tag | 40 | 4v | Grants Hidden, 1 turn — hides every other tag on inspection |
| Enthral | — | 50 | 4v | Target must be incapacitated and at your Location; grants them Thrall + Vampire Blood Addict |
| Nourish | — | 30 | 2v | Target must hold Thrall and be at your Location; clears their health-wounds tags and resets Vampire Blood Addict to 9 turns |

**The cooldown formula is the design doc's own**: `round(constant × v)`, `v` =
`GameConfig.vampireBloodAbilityCooldownVariable` (dev panel, default 5). Each
ability's own constant (4, 2, 6...) lives in the catalog, not the config —
rounded the same way `db/lib/vampire.js#perTurnRate` rounds the meter rates,
just multiplying instead of splitting a day over its turns.

**Cooldowns are tracked per character, not per ability column.**
`Character.vampireBloodAbilityCooldowns` is one JSON map, `{ [abilityKey]:
readyTurnNumber }` — ten `Int?` columns for one seat's ten abilities felt like
a lot of schema for how small this Threat is; `Tag.consumesInto`/`expiresInto`
are this schema's own precedent for a small flexible map living in one Json
column.

**Deliberately NOT gated on ACT/incapacitation**, except Bat Form (the one
ability the design doc itself conditions on capacity: "You must not be
incapacitated"). Everything else — most pointedly Regeneration — has to work
while Dying, because §7 below leans on exactly that to let a vampire save
themselves. A GM who judges a particular cast absurd (Bat Form mid-fight,
say) still adjudicates it by hand, the same posture Feeding's own lethality
gets.

**Bat Form is also refused while the Caving Die holds you** (`CAVING.md` §2c):
a 1 on the Die in your zone this turn means no flight at all until the push,
even once a GM has marked it resolved.
Flight is the one way out that crosses no link, so without this a vampire
could fly out of their own unadjudicated encounter. It is checked before any
blood is spent.

**Spending blood re-syncs the checkpoint chips immediately**
(`db/lib/vampireBands.js#syncVampireBandsNow`) rather than waiting for the
next turn close — the same reasoning a GM's manual blood edit already gets.

**Corrupt consumes the game's existing `heart` organ**, not a new
"human-heart" item — there was already exactly one harvested-heart tag in the
catalog (`docs/tags.yaml`, from Mutilate/Butcher), and it fits the design
doc's own flavor line. **Implanting a Black Heart into someone is left as GM
narrative judgment**, the same posture §2b's feeding restoration already
gets — a GM who rules an implant Gambit successful assigns the Vampire Threat
to that character by hand, on `/gm/dev`, same as any other seat.

**Enthral and Nourish target whoever is at the vampire's own Location** — the
design doc names no ownership tracking for a thrall ("your thrall" is
flavor), and the game already has no per-thrall "belongs to" column, so
Nourish reaches any thrall standing with you rather than one this specific
vampire personally enthralled. A GM who wants a thrall's loyalty to matter
narratively enforces that by hand, same as everything else on this doc that
leans on judgment rather than a lock.

## 7. Death — the vampire never truly dies to ordinary harm

"Vampires do not die from regular injuries expiring into the dying tag, or
from the turret, or any other form of physical injury short of a blow to the
heart, decapitation and burning... they will remain on death's door from
injuries, not dying until they are either finished off or use regeneration."

**Coded**: `db/lib/dyingDeathPass.js` excludes anyone holding the `vampire`
tag from its automatic kill outright. A vampire's Dying clock still runs, and
they still get the same eve-of warning DM everyone else does, but the pass
never actually kills them off the back of it — they simply stay Dying
indefinitely until a GM finishes them off by hand, or they cast Regeneration
(§6), which removes Dying along with every other non-burn wound/illness/
infection tag.

**GM narrative judgment**: "a blow to the heart, decapitation and burning" is
never coded as a distinct injury type — the catalog has no vocabulary that
tags a wound BY MECHANISM (fire vs. blade vs. blunt), only by severity. A GM
who judges a vampire's death-blow to actually qualify finishes them off the
normal way (HARM_CHARACTER's lethal half, or a GM-staged death on the turn
push) — same as any other character.

**However they're finished off, a vampire's death is never ordinary.**
`db/lib/vampireDeath.js#applyDeathWithVampireOverride` intercepts every death
path (`web/lib/discordGuild.js#killCharacter`, and the GM-staged/turn-push
path in `db/lib/stagedPush.js`) and overrides whatever Gib choice the GM
made: "they are immediately gibbed, turning into ash. A message will be sent
publicly to the location they are in... their items will be dropped on the
ground as well as a pile of ash tag." This is a third death shape, neither of
`db/lib/characterDeath.js`'s existing two — an ordinary death mints a
buryable corpse; `gib: true` wipes every tag, items included, and mints
nothing. A vampire's ash keeps neither: no buryable body (there is nothing
left to bury or butcher), but the items survive, unequipped and lootable off
the ground, same as an ordinary death leaves them. `applyDeathToRow`'s new
`noCorpse` option is what gets this — skip minting a corpse, keep the plain
unequip — and `vampireDeath.js` then mints a static `pile-of-ash` item into a
random public Room at the vampire's Location (`docs/tags.yaml`, `items-remains`
group, deliberately NOT `items-corpse` — that group slug is what
`db/lib/corpses.js#isCorpseTag` matches on, and ash is not a buryable body)
and posts `"{name} disintegrates into a pile of ash!"` to the Location's own
channel.

**Not exempted**: `catatonicDeathPass.js` (AFK inactivity is an OOC admin
concern, not an in-fiction injury, so it's left untouched) and the ash
override itself never refuses a death — it only changes what happens to the
body once one lands.

## 8. Feeding's fallout: tag exclusivity and hunger

**"Mutually exclusive with tags that would inhibit them from feeding such as
saint or pacifist. Such tags are removed from a character if they become a
vampire."** Coded as a data-only edge, not new logic: `docs/tags.yaml`'s
`vampire` tag carries `conflictsWith: [saint, pacifist, hemophobia]` (blood
makes a Hemophobe dizzy, and a vampire lives on it), the exact mechanism
Demoness's own seat tag already uses (`THREATS.md` §3) —
`threatActions.js#assignThreat` already strips a newly-granted seat's
`conflictsWith` edges off the character it's handed to, so this needed no new
code, only the edge itself.

**"Do not become hungry, nor... gain mood points from eating food or meals.
Desires relating to food and drink are unavailable to them."** The hunger
half reuses the game's existing `hungerless` tag — the same exemption
Demoness already carries — granted alongside the seat tag itself
(`db/lib/threats.js`'s `vampire.assign.tagSlugs`). The Desire half is
`docs/tags.yaml`'s `vampire` tag locking the `food` and `alcohol` Desire
families (`desires.locks`, TAGS.md §3a) — nothing else is touched, so a
vampire's other Desires (wealth, status, romance...) stay open alongside
their new `vampirism` ones (§9).

## 9. Vampire (and Thrall) Desires, and the purchasable tags

**Vampire-specific Desires** (`docs/desires.yaml`, `vampirism` family, gated
`requires.anyTags: [vampire]` except the last which also needs Corruptor):

| Desire | Tier | Cooldown |
|---|---|---|
| Drink the blood of a commoner | 1 | 3 |
| Drink the blood of someone beautiful | 2 | 3 |
| Drink the blood of a noble | 3 | 3 |
| Restore your humanity to Humane | 2 | 6 |
| Enthral a mortal | 3 | 6 |
| Turn someone into a vampire | 4 | 8 |

The three feeding Desires share a flat `cooldownTurns: 3` — this file's own
"Consumables" cooldown policy (a real per-attempt spend doesn't need the
ladder). **The design doc additionally asks that claiming any one of the
three lock out the other two for those same 3 turns.** There is no
cross-Desire lock in `db/lib/desireGates.js` today — it locks by HELD TAG,
never by a sibling Desire — so building one for three rows would be new
engine capability, not a catalog entry. Left as GM guidance instead, the
exact posture the humanity-loss table (§5's original scope) already gets: a
GM reviewing the queue declines a second blood-drinking claim inside the
window the first one's own cooldown already opened.

**Thrall-specific Desires**, same family, gated on holding `thrall`:

| Desire | Tier | Cooldown |
|---|---|---|
| Drink vampire blood | 2 | 3 |
| Save the life of your master | 3 | 6 |
| Gain true immortality by becoming a vampire | 5 | Once per lifetime |

"Thralls are barred from any non-thrall related Desire which is tier 2 or
lower" is the `thrall` tag's own `desires.locks: [{ tiers: [1, 2],
exceptFamilies: [vampirism] }]` — TAGS.md §3a's tiers-lock clause, exempting
the thrall's own family so their three stay open.

**Vampire Purchasable Tags** — `docs/tags.yaml`, all in the
`status-vampire-boons` group, which carries `requiredTag: vampire`
(`docs/taggroups.yaml`) so the whole shelf is invisible and unbuyable to
anyone who isn't a vampire, TAGS.md §3a's group-gate, the same mechanism
Demoness's own hidden categories use:

| Tag | Cost | What it unlocks |
|---|---|---|
| Night Eyes | 4 | Flavor — sees in the dark |
| Hardened Fangs | 5 | Flavor — bites through armour |
| Corruptor | 14 | The Corrupt ability |
| Celerity | 5 | The Celerity ability |
| Bat Form | 8 | The Bat Form ability |
| Solidarity | 4 | The Solidarity ability |
| Obfuscate | 9 | The Obfuscate ability |
| Underzealous | 6 | GM guidance: feeding is far less likely to kill |
| Remorseful | 12 | GM guidance: no humanity loss from killing in self-defence |

Bought mid-game through the ordinary `/store` point-buy — nobody is a vampire
at character creation (the seat is GM-assigned, `THREATS.md` §1), so there is
nothing for a creation-time purchase to gate against anyway.

**Non-purchasable tags this section adds** (role/ability-granted only —
`docs/tags.yaml`, `status-vampire` group): `fangs` (granted alongside the
seat, permanent, flavor only), `blood-strength`/`agility`/`resilient`/`hidden`
(the four 1-turn ability buffs above), `thrall` and `vampire-blood-addict`
(Enthral's two marks — the addict tag's `expiresInto: [dead]` is the reserved
token, `db/lib/tagShapes.js#DEAD_TOKEN`, that grants Dying stamped for the
SAME closing turn rather than a slower two-turn chain, which is what makes
"causes immediate death... when this expires" true rather than approximate),
and the two items `black-heart` (Corrupt's output) and `pile-of-ash` (§7's
ash death).

## 10. Where the code lives

| File | Role |
|---|---|
| `db/lib/vampire.js` | The pure meters — bands, the appearance track, turn-length scaling, the one coded humanity loss. No Prisma import |
| `db/lib/vampirePass.js` | The turn pass — decay/regen, grant/drop every checkpoint tag, the Bloodcrazed-crossing loss, the zero-humanity crossing into Bestial/Wight |
| `db/lib/vampireCompulsion.js` | §4 — the forced Gambit + Attack, run outside `TURN_PASSES` |
| `db/lib/vampireBands.js` | Immediate re-sync for the GM edit screen (and for a Blood Ability spend, §6) — a changed blood level clears the chips at once, not at next close |
| `db/lib/vampireBloodAbilities.js` | §6 — the pure ability catalog: cost, cooldown constant, required tag, effect. No Prisma import |
| `db/lib/vampireDeath.js` | §7 — the ash death override, intercepting every death path |
| `web/app/(app)/character/actions/bloodAbility.js` | §6 — the one server action every "Use" button calls |
| `web/app/components/BloodPanel.js` / `TagRail.js` | The Blood menu's UI — a Modal off the sheet header, StorePanel.js's own shape |
| `web/lib/vampireBloodView.js` | Server-resolves what BloodPanel.js needs to draw — availability, cooldowns, who's here to target |
| `db/lib/threats.js` | The `vampire` Threat entry — assign-only, no `spawn`, no Role; grants `hungerless` alongside the seat (§8) |
| `db/lib/gameConfigFields.js` | The two meter rates plus the Blood Ability cooldown variable `v`, `vampire` group |
| `docs/tags.yaml` | The seat marker, the two checkpoint tracks, the ten Blood Ability tags, the nine purchasable boons, and the ash/Black Heart items — `status-vampire`/`status-vampire-boons` groups in `docs/taggroups.yaml` |
| `docs/desires.yaml` | The six vampire and three thrall Desires, `vampirism` family (§9) |
| `web/lib/characterWrite.js` | `vampireBloodLevel`/`vampireHumanity` as GM-staged-editable fields |
| `web/app/(app)/gm/dev/characters/[characterId]/IdentityTab.js` | The Vampire panel on the character edit screen |
| `db/test/vampire.test.js` | The band math, boundary by boundary |
| `db/test/vampireBloodAbilities.test.js` | The ability catalog and cooldown math |
