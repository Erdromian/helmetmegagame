# The Vampire — blood and humanity

An antagonist Threat (`THREATS.md`), assigned like any other. A Vampire's
primary objective is to survive and avoid giving in to their monstrous
nature. They carry two 0-100 stats nobody else on the roster has: **blood
level** and **humanity**.

**This doc covers pages 1-3 of the design doc only.** Pages 4-5 — a
purchasable "Blood" menu of boons (Blood Strength, Regeneration, Corrupt,
Celerity, Resilience, Bat Form, Solidarity, Obfuscate, Enthral, Nourish) —
are a separate, not-yet-built task. Nothing in this file implements them, and
nothing here should be read as blocking them.

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
chips below say anything, and only to the extent each one's visibility
allows.

## 2. Blood level

Decays every turn, reaching 0 in **3 days** without feeding, at a rate
configurable on the Dev Panel (`vampireBloodDecayPerDay`, default 34 — 100/3
rounded). The rate is authored per **day**, not per turn, because this
engine's turn length is itself a GM knob (6/8/12/24 hours,
`TURN-ENGINE.md`) — `db/lib/vampirePass.js` scales the configured daily rate
by the turn actually closing (`turnLengthHours / 24`), so "3 days to empty"
holds true whatever the server's turn length is set to.

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

This is deliberate, not a placeholder: automating blood restoration or dice
would mean inventing a combat-resolution system this engine doesn't have
anywhere else. See the Blood Abilities menu (out of scope, §0 above) for
where a coded, purchasable effect belongs instead.

## 3. Humanity

Regenerates **+10 a day**, same turn-length scaling as blood decay
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
   at the same Location and files a real `Attack` (`db/lib/attack.js`) —
   pinning both parties for the rest of the turn, same as a player pressing
   the button. Deliberately **not** gated by the normal band-gap or
   already-acted checks (`attackRefusal`/`attackMoveBlock`): this is an
   involuntary compulsion, not a fight the character chose, so "too strong
   to attack" and "already used your Move" don't apply.

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

Both rates are per-**day**, on `/gm/dev` under Vampire:

| Key | Default | |
|---|---|---|
| `vampireBloodDecayPerDay` | 34 | Empties a full meter in 3 days at the default 24h turn length |
| `vampireHumanityRegenPerDay` | 10 | Matches the design doc's own figure |

## 6. Where the code lives

| File | Role |
|---|---|
| `db/lib/vampire.js` | The pure meters — bands, the appearance track, turn-length scaling, the one coded humanity loss. No Prisma import |
| `db/lib/vampirePass.js` | The turn pass — decay/regen, grant/drop every checkpoint tag, the Bloodcrazed-crossing loss, the zero-humanity crossing into Bestial/Wight |
| `db/lib/vampireCompulsion.js` | §4 — the forced Gambit + Attack, run outside `TURN_PASSES` |
| `db/lib/vampireBands.js` | Immediate re-sync for the GM edit screen — a restored blood level clears the chips at once, not at next close |
| `db/lib/threats.js` | The `vampire` Threat entry — assign-only, no `spawn`, no Role |
| `db/lib/gameConfigFields.js` | The two dev-panel rates, `vampire` group |
| `docs/tags.yaml` | The 13 tags — the seat marker, the two checkpoint tracks, `status-vampire` group in `docs/taggroups.yaml` |
| `web/lib/characterWrite.js` | `vampireBloodLevel`/`vampireHumanity` as GM-staged-editable fields |
| `web/app/(app)/gm/dev/characters/[characterId]/IdentityTab.js` | The Vampire panel on the character edit screen |
| `db/test/vampire.test.js` | The band math, boundary by boundary |
