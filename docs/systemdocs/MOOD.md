# Mood

The dial under every character's nerves, and the one word it shows through.
Read this before touching `db/lib/mood.js`, `db/lib/moodPass.js`, the Mood box
on the sheet, the phobias, Brave / Rough Camper / Outsider / Spelunker / Pale,
`GameConfig.moodIntensity`, or anything that should frighten, hurt, feed or
cheer a character.

It was the **fear dial** until 2026-09-09: 0–100 with the sign the other way up,
projected onto five status tags (`uncomfortable` … `panic`) with a DM on every
band change. Three things were wrong with that. It only went one way, so a
drink or a haven bottomed out at "no tag" and comfort was worth nothing to
somebody already calm. It shouted — every band change was a DM, which buried
the two bands that cost dice. And the band was a *tag*, five catalog rows whose
only job was to render a number as a word, which meant a GM hand-grant could
fight the dial for the same `@@unique([characterId, tagId])` row.

The fear dial had itself replaced two older things on 2026-09-06: the phobia
rule table (`db/lib/phobias.js`) and the Nobility "Disappointed" track. Both
are still gone; their jobs are two rows in the tables below.

## 1. The dial

`Character.mood` is a float, **+64 down to −100**, that no player ever sees as
a number. It is shown and edited on the Dev Panel's Identity tab (clamped on
save, `web/lib/characterWrite.js`). Everything else that moves it goes through
`db/lib/mood.js`.

What a player sees is **one word**, in the Mood box on their sheet (§4), read
off the band the dial sits in. The bands are 18 wide and symmetric about Fine,
and the boundary belongs to the band further from Fine on both sides — so −10
is Uncomfortable, +10 is Content, −82 is Panicking, +46 is Happy:

| Mood | Word | Tone | Dice |
|---|---|---|---|
| +46 … +64 | Happy | good | |
| +28 … +46 | Pleased | good | |
| +10 … +28 | Content | good | |
| −10 … +10 | **Fine** | muted | |
| −10 … −28 | Uncomfortable | warn | |
| −28 … −46 | Stressed | warn | |
| −46 … −64 | Anxious | warn | |
| −64 … −82 | Afraid | bad | −1 to every Gambit |
| −82 … −100 | Panicking | bad | −2 to every Gambit |

`bandOf` never returns null: a mood of 0 is **Fine**, which is a word like any
other. The good half is **flavour only**, on Bascinet's call — Happy rolls the
same dice as Fine. The two bottom bands carry their modifier on the band row
itself, which is what `db/lib/gambitModifier.js` reads; a mood is one number,
so it lands in exactly one band and the two can never sum.

**A player is DM'd only when they drop INTO Afraid or Panicking**, and the line
is plain: `You are now Afraid.` Nothing is said for the other seven bands, and
nothing is said on the way back out — climbing out of Afraid is the player's
own business, and the box on their sheet already says so. `moodBandDm` is the
whole rule. Hooks inside a transaction hand the DM to `setMoodDmSender`'s
registered sender (registered once in `db/index.js` beside the client), which
fires a moment and a half after the call — after the surrounding write has, in
practice, committed. That is a delay, not a commit signal: a transaction that
rolls back after moving the dial still sends its line. Accepted, because every
such transaction is a short request action whose remaining statements are an
audit row. The turn passes pass `notify: false` and carry their DMs back for
the thunk instead.

## 2. The coefficient

`GameConfig.moodIntensity` (k, default 1, live on `/gm/dev` under *Mood*) is
the one knob. Every **harm** is multiplied by k; every **relief** and the
nightly drift are divided by k. Higher is a harsher world that heals slower.
`0` is the off switch: everything resolves to 0 and the mood pass sets every
dial to Fine at the next close.

## 3. What sinks a mood

All base values, before k and before the multipliers in §6. Harm is **negative**
in `EVENTS`, so most callers name only the kind. `kind` is what the multipliers
key on.

| Event | kind | Base | Where |
|---|---|---|---|
| Arrive at a WILDERNESS Location | WILDERNESS | −2 | `applyArrivalMood`, from `locationMove.js` — **capped, below** |
| Arrive at a CAVE Location | CAVE | −3 | same, and capped with it |
| End the turn in the WILDERNESS | WILDERNESS | −10 | mood pass |
| End the turn in a CAVE | CAVE | −14 | mood pass |
| A new wound tag lands (`health-wounds`, `health-maiming`, `health-infection`) | WOUND | by rung, §5 | `applyWoundMood`, four writers |
| `dying` granted, by any path | DYING | −40 | `applyWoundMood` |
| The Caving Die rolls a 1 | CAVE_TROUBLE | −10 | `cavingPass.js#rollCaving` |
| Bound | BOUND | −15 | `bind.js#applyBind` |
| Still bound at turn end | BOUND | −10 | mood pass |
| Crucified | CRUCIFIED | −80 | `crucifyCharacterRequestImpl` |
| Tortured, broke or held | TORTURED | −40 | `tortureCharacterRequestImpl` (TORTURE.md) |
| A piece cut off you | MUTILATED | −50 | `mutilateRequestImpl` (TORTURE.md §6). A corpse takes no hit — a dead row's dial is read by nobody. |
| Someone dies in your Location | DEATH_SEEN | −15 to each witness | `characterDeath.js#applyDeathToRow` |
| An unburied body in your Location at turn end | CORPSE | −5 | mood pass |
| Shot at by a turret and alive, hit or graze, either gun | TURRET | −25 | `turretPass.js#applyTurretShot` |
| `hungerStreak > 0` at turn end | HUNGER | −5 | mood pass |
| A noble with no `dined` marker at turn end | NOBLE_MEAL | −10 | mood pass |
| Looted while alive | ROBBED | −10 | `lootCharacterRequestImpl` |

**Place classes** come from `placeClassOf(location)`, in this precedence:
HAVEN (the `haven` attribute: Inn, Keep, Sanctuary) > INDOORS
(`Location.indoors`, and a `safe` cave Location, which is why Customs is a roof
and not the dark) > CAVE (`zone.kind === CAVE_LEVEL`) > WILDERNESS (the
`wilderness` attribute: every Forest, Black Hills and Marshes Location except
`factory`, `farms` and `marshes-village`) > OPEN (everything else outdoors).
Both attributes live in `db/lib/locationAttributes.js` and print on Examine.

A **first placement** (creation, a spawn, a GM dropping somebody in from
nowhere) has no `from` Location and charges no arrival cost: nobody walked.

Arrival cost **is rationed**: everything a character's own legs take off the
dial in one open turn, together, stops at `MOVE_MOOD_TURN_CAP` (**15**). This
used to be uncapped, on the argument that eight cave Locations should cost
eight times what camping does. What that missed is how cheap a step is next to
the band table. A Refugee whose entire job is cutting Godflesh out of the
Marshes walked five `wilderness` Locations — every godflesh site there is one —
and hit Uncomfortable at exactly −10 on the first afternoon, before a single
turn had closed and therefore before the drift or a roof had ever added
anything back. Pacing two tiles farmed the dial for free.

Three things the ration is careful about:

- It counts the delta that **actually landed**, after the multipliers and after
  `GameConfig.moodIntensity`. Capping the base instead would hand Brave (factor
  `0.5`) twice everyone else's allowance.
- It counts **movement only**. A wound, a death seen, a turret burst and the
  nightly place term all land in full on top of a capped-out day. It also only
  ever bites on the way DOWN — walking into the Cathedral is not movement the
  cap has an opinion about.
- It keys off `term.move`, **not** off `kind`. `arrivalTermFor` and
  `placeTermFor` return the same `WILDERNESS` / `CAVE` kinds, because kind is
  what the multipliers read — a cave is a cave whether you walked in or slept
  there. Only the flag separates a step from a night.

The running total lives in `Character.moveMoodTurnId` / `moveMoodUsed` as a
positive magnitude, the same claim-token shape as `zoneMovesTurnId` /
`zoneMovesUsed` and written with the same guarded `updateMany`, so two arrivals
in one tick cannot both spend the same remainder. Between turns there is no
turn to ration against, so a move charges in full.

## 4. The Mood box

The word lives in its own tile on `/character`, between **Carrying** and
**Gambit die** (`web/app/components/LedgerBand.js`, `SHEET.md` §2). It is one
of the tiles with something to say, so it opens a line under the row of tiles —
**on hover as well as on click**, because that is what Bascinet asked for and
because `SHEET.md`'s rule still holds: nothing on that sheet is a tooltip.
What it says is Bascinet's own wording, verbatim (`MOOD_DETAIL`):

> Certain things, like spending time in the wilderness without the Rough Camper
> trait or receiving wounds harm your mood. Other things, like listening to
> music, fulfilling desires, or eating meals boost your mood. A poor mood
> impacts your Gambit rolls.

The word is **coloured by tone, not by a token picked at the call site** — the
rule `web/app/components/StatusPill.js` sets. `MOOD_BANDS` carries a `tone` per
band and `.ledger-tile-value[data-tone=…]` in `globals.css` decides what that
looks like: `muted` for Fine (grey), `warn` through the middle three, `bad`
(`--danger`, full red) for Afraid and Panicking, `good` for the three above
Fine. The four tokens are the ones `.status-pill` already uses, so
`npm run audit:contrast --workspace=web` already covers them. The tile also
drops `--font-mono`, because a word is not data.

`web/app/(app)/character/page.js` hands the raw number to the sheet — it has
to, since both the box's word and the Gambit tile's modifier are computed
client-side — but nothing renders the figure. Only `bandOf()`'s label.

## 5. Wounds read the cure ladder

A wound's rung on the cure ladder (`TAGS.md` §5c) decides how much it costs,
read off its requirement block by `woundRungOf`. `woundMoodFor` returns it
**signed**:

| Rung | Derivation | Mood |
|---|---|---|
| 0 | no requirement block at all | 0 |
| ½ | 0 ⬢ (minor-bleeding, dislocated-shoulder) | −4 |
| 1 | 1 ⬢ | −8 |
| 2 | 2 ⬢, 0 turns (frostbite) | −15 |
| 3 | 2 ⬢, 1 turn (choking) | −30 |
| 3½ | 3 ⬢ (severe-bleeding, arterial-bleed, parasites) | −35 |
| 4 | 4–5 ⬢ | −40 |
| 5 | 6–7 ⬢ | −45 |
| 6 | 8 ⬢, no Gambit | −55 |
| 7 | `requirementGambit` | −65 |

Illness, mind, minor and recovery tags cost nothing — a cold is not a wound. A
tier-0 wound (no block) is real, untreatable and too small to matter. So the
ladder is now read three ways — the bill, the Heal picker, and the mood — and a
rung priced carelessly is wrong three ways.

**Four writers create wound rows, and all four call `applyWoundMood`:**
`tagWrites.js#addToStack` and `#grantTagSlugs` (their `!existing` branches only:
a stack going up or an already-held tag is not a new wound), the turret's own
write in `turretPass.js#applyTurretShot`, the untreated-wound chain's
`createMany` in `tagExpiryPass.js` (which first works out which rows will
actually land past `skipDuplicates`). The starvation Dying grant in
`hungerPass.js` is a batch `createMany` too and charges DYING through
`applyMood` directly after it lands. **A new direct `characterTag.create` of a
Health tag must call `applyWoundMood` too.** Character creation's kit grant is
deliberately exempt — starting with Arthritis is a build, not an injury.

Being **healed** of a wound (a routine cure, not a Gambit attempt) gives back
half of what that wound took.

## 6. What lifts a mood

| Event | Base | Where |
|---|---|---|
| End the turn OPEN (a settled place, outdoors) | +4 | mood pass |
| End the turn INDOORS | +6 | mood pass |
| End the turn in a HAVEN | +12 | mood pass |
| Consume anything that lands you tipsy / wasted / unconscious / blind-drunk / high / euphoric | +30 | `consumeTagRequestImpl` |
| Consume a `lavish-meal` | +30 | same |
| Consume `tea`, `maggot-milk`, or anything granting `caffeinated` (Coffee) | +15 | same |
| Consume a `fine-meal` | +15 | same |
| Consume a treat — `sweets`, `honey`, `honeyed-cakes`, `fish-roe`, `pumpkin` | +8 | same |
| Consume a `cigarette`, a `sky-lantern` or a `firecracker` | +8 | same |
| Consume anything at all that grants `ate-meal` | +5 | same |
| Fulfil a Desire (player claim or GM award) | +10 per point | both award sites |
| A confession the die absolved | +15 | `confessionPass.js` |
| A **Musician's** `/play`, once per listener per turn | +10 to everyone at the Location | `handlePlayCommand` |
| Walk into the Cathedral, once per turn | +10 | `applyArrivalMood` |
| Be healed of a wound | +½ what it took | `healCharacterRequestImpl` |

The food rules are keyed on the *status* a consume grants where there is a
distinctive one (so a brew added to the catalog later is soothing the day it
ships) and on the item where there is not; one consume takes the **largest**
single figure, never a sum. That is what keeps Sweets worth 8 rather than 8+5,
Fine Meal 15 rather than 15+5, and Bliss (which lands two statuses) one drink.
An Instant Camera is deliberately worth nothing.

A Fine Meal used to be worth nothing at all, on the argument that it only fed a
noble. It is +15 now — "makes an ordinary person happy" is its own catalog
line — and it still feeds the noble besides (§7).

**The nightly drift** replaced the old one-way decay. Every mood slides
`MOOD_DRIFT` (**4**) back toward Fine at every close, from *both* sides, never
overshooting 0: a fright wears off, and so does a good evening. It carries
`noMultiplier: true`, so no tag scales it — Brave halving a happy person's
decline would be nonsense.

The two once-a-turn rations are `AuditLog` rows with `turnId` set
(`mood_cathedral`, `mood_soothed_play` — `REQUESTS.md` §1a), both rare enough
not to drown `/gm/audit`. Only one place term applies per night, the best one.
Relief is never multiplied by a tag.

## 7. Multipliers

Held tags scale **harm** by its kind; the factors multiply, and a 0 wins:

| Tag | Kinds | Factor |
|---|---|---|
| `brave` (5 pt, was 4) | everything | ×0.5 |
| `rough-camper` (2 pt) | WILDERNESS, CAVE | ×0.5 |
| `outsider` (1 pt, requires Rough Camper) | WILDERNESS | ×0 |
| `spelunker` (1 pt, requires Rough Camper) | CAVE | ×0 |
| `pale` (the Migrant's) | CAVE | ×0.5 |
| `hemophobia` (−4) | WOUND | ×2 |
| `agoraphobia` (−4) | WILDERNESS | ×2 |
| `claustrophobia` (−3) | CAVE | ×2 |
| `teratophobia` (−2) | CAVE_TROUBLE | ×3 |
| `pyrophobia` (−2) | WOUND, only `burned` / `severe-burns` | ×3 |
| `pain-immunity` (status) | TORTURED | ×0 |
| `opium-high` (status) | TORTURED | ×0 |
| `rage` (the Rite of Rage, THANATI.md §4) | everything | ×0 |
| `blessed` (status, 3t — a `chrism`'s anointing) | everything | ×0.5 |
| `heartforged-blade` (**while equipped** — the first equipped-conditional rule; a caller that can't say what's equipped skips it, failing safe) | everything | ×0 |

Brave × Rough Camper × Agoraphobia on a wilderness night is ×0.5; Pale ×
Claustrophobia in the caves is ×1, which is funny and correct. Acrophobia is
gone (nothing in the game is high enough), and the phobias' old "may make you
Afraid… may cause Panic" sentences went with it. The cancel tag is named
Spelunker because `caving` is already a Skills tag and role kits resolve tags
by display name.

**Who starts with what** (`docs/roles.yaml`, `db/lib/threats.js`): Rough Camper
and Outsider on both Brigands and the Tribune; those two plus Brave on the
Tribunal Ordinator; Rough Camper on the Fisherman; Rough Camper and Spelunker
on the Mercenary; the `commoner-hunter` kit unpacks Rough Camper; the Demoness
seat assigns Rough Camper, the Judge assigns Rough Camper, Outsider and Brave.

## 8. Nobles

`nobility` no longer grants Disappointed. A noble who ends the turn without
having eaten a fine or lavish meal takes −10 (NOBLE_MEAL, so Brave halves it);
Hungerless and Dying nobles are exempt. "Ate one this turn" is the hidden
`dined` status tag that `fine-meal` and `lavish-meal` consume into beside
`ate-meal`. It has **no `durationTurns`** — a 1-turn grant would be swept at
position 10 of `TURN_PASSES`, nine passes before the mood pass reads it — so
the mood pass deletes it itself, exactly as the hunger pass eats `ate-meal`.
The marker is hidden and the sheet shows no Dinner row for it — the old
Disappointed tracker went with the track, on Bascinet's call. The Merchant now
starts with Nobility too, and therefore with its 1-point Desire lock.
`Character.missedMealStreak` is an orphan column: kept, never read.

## 9. The turn pass

`db/lib/moodPass.js`, `"mood"` in `TURN_PASSES`, in the slot the phobia pass
held: **after `hunger`** (it reads the final `hungerStreak`), **after `carry`**
(the final sheet), **before `corpseFollow`**, and **before `travelArrival`** —
every pass above that one settles the turn that just ended, and a traveller
spent it walking out of where they started, so they pay the night for the
place they set out from (the same rule auto-labor and the turrets use).

Per ALIVE character it gathers the terms — place, drift, HUNGER, BOUND, CORPSE,
NOBLE_MEAL — and applies them in one write through `applyMoodTerms`, its own
transaction per character so one bad row cannot roll back a hundred good ones,
and hands `applyMoodTerms` the row it already loaded (the multiplier slugs and
this pass's own gates in one filtered read) rather than letting it read the
sheet again. Somebody already at Fine, in a place that neither lifts nor
lowers, is skipped without a write. The `dined` markers are eaten in one
`deleteMany` **after** the loop, not per character: a pass that dies half-way
is re-run from the top, and a per-character delete would have charged the
nobles it had already reached for a dinner they ate. A replay is therefore at
worst a repeated night, never a wrong direction.
Corpse Locations are one query for the whole pass (`RoomTag` plus carried
`CharacterTag` on an unburied `corpseOf`, the death-smell shape). One
`AuditLog` row, `mood_resolved`, with the summary; the DMs ride back on `dms`
and go out on the `tagExpiryDms` channel in `db/index.js`, since "your sheet
changed" is what they are. Returns an object, never null.

## 10. The tuning

The designer's checks, all asserted in `db/test/mood.test.js`:

- Seven wilderness moves are −14: **Uncomfortable** from the walk alone. A
  wilderness night on top (−10 + 4) lands at −20, still Uncomfortable.
- A moderately severe wound (rung 3, −30) on top of that is −50: **Anxious**.
- At −20, two nights indoors (+6 +4 each) clear the dial; one night in a Haven
  reaches Fine on its own.

The dial is clamped in the database (`LEAST/GREATEST` in the UPDATE), so two
hooks in the same tick cannot race a stale read past either end.

## 11. Where the code lives

- `db/lib/mood.js` — the tables (`EVENTS`, one signed table: harm negative,
  relief positive, so most callers name only the kind; `MOOD_BANDS`;
  `PLACE_TERMS`; `MOOD_DRIFT`; `DESIRE_RELIEF_PER_POINT`; the consume relief
  map), the pure functions (`bandOf`, `placeClassOf`, `placeTermFor`,
  `driftTermFor`, `woundRungOf`, `woundMoodFor`, `multiplierFor`,
  `resolveDelta`, `moodBandDm`, `clampMood`), and the Prisma surface
  (`applyMood`, `applyMoodTerms`, `applyWoundMood`, `applyArrivalMood`,
  `setMood`, `consumeReliefFor`, `setMoodDmSender`, `loadIntensity`). Off the
  barrel; require by subpath.
- `db/lib/moodPass.js` — the nightly settle.
- `db/lib/gambitModifier.js` — Afraid −1, Panicking −2, read off the band.
- `db/lib/torture.js` — the TORTURED hit's caller side (TORTURE.md).
- `db/lib/locationAttributes.js` — `wilderness`, `haven`.
- `db/lib/gameConfigFields.js` — `moodIntensity`.
- `web/app/components/LedgerBand.js` — the Mood box (§4).
- `db/test/mood.test.js` and `db/test/gambitModifier.test.js` — the pure half.
- Hooks: `locationMove.js`, `tagWrites.js`, `turretPass.js`, `tagExpiryPass.js`,
  `hungerPass.js`, `cavingPass.js`, `bind.js`, `characterDeath.js`,
  `confessionPass.js`, `riteEffects.js` (the Rite of Panic's `setMood`),
  `web/app/(app)/character/requestActions.js` (consume, heal, loot, crucify,
  torture, desire), `web/app/(app)/gm/dev/characters/[characterId]/actions.js`
  (GM desire award, the dial edit), `bot/src/events/interactionCreate.js`
  (`/play`).

## 12. What the rework left behind

- The five band tags are gone from `docs/tags.yaml`. Rows still on live sheets
  come off with `npm run db:prune-tags -- --apply` — destructive, and its own
  decision.
- `TagSource.CONDITION` is an orphan enum value. Nothing writes it; it stays,
  because this schema drops nothing.
- `settleFearTag` is gone entirely. So are `UNCOMFORTABLE_SLUG` … `PANIC_SLUG`
  in `db/lib/constants.js`.
