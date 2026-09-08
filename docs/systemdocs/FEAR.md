# Fear

The hidden dial under every character's nerves, and the five status tags it
shows through. Read this before touching `db/lib/fear.js`, `db/lib/fearPass.js`,
the band tags, the phobias, Brave / Rough Camper / Outsider / Spelunker / Pale,
`GameConfig.fearIntensity`, or anything that should frighten or calm a
character.

It replaced two older things on 2026-09-06: the phobia rule table
(`db/lib/phobias.js`, which pinned Afraid or Panic on a character for as long
as they stood in the caves or the Black Hills) and the Nobility "Disappointed"
track (a missed-meal counter with its own tag and Gambit penalty). Both are
gone; their jobs are two rows in the tables below.

## 1. The dial

`Character.fear` is a float, 0–100, that no player ever sees as a number. It is
shown and edited on the Dev Panel's Identity tab (clamped on save,
`web/lib/characterWrite.js`), and a GM edit settles the band tag in the same
Apply. Everything else that moves it goes through `db/lib/fear.js`.

What a player sees is **one status tag**, projected from the band the dial sits
in. Bands are half-open, so exactly 10 is Uncomfortable and exactly 82 is Panic:

| Dial | Tag | Dice |
|---|---|---|
| 0–10 | nothing | |
| 10–28 | `uncomfortable` | |
| 28–46 | `stressed` | |
| 46–64 | `anxious` | |
| 64–82 | `afraid` | −1 to every Gambit |
| 82–100 | `panic` | −2 to every Gambit |

The tag rows carry `source: CONDITION`, which is what `settleFearTag` owns: it
grants the one wanted slug, deletes any other CONDITION row on the five, and
leaves **every other source alone**. A GM who hand-grants Afraid keeps it for as
long as they set, and the settle neither rewrites its expiry nor collides with
it on `@@unique([characterId, tagId])` — which also means a sheet can show the
dial's Stressed beside a GM's Afraid; the dice take the worse of the two. A character who is not ALIVE wants no
band, so a corpse's row is swept the next time anything settles them. The two
top bands are Gambit modifiers in `db/lib/gambitModifier.js`; the settle keeps
one band row per sheet, so they never sum.

When the band changes the player gets one line, plain: `You are now Stressed.`
and, when the last band drops off, `You've calmed down.` Hooks inside a
transaction hand the DM to `setFearDmSender`'s registered sender (registered
once in `db/index.js` beside the client), which fires a moment and a half
after the call — after the surrounding write has, in practice, committed. That
is a delay, not a commit signal: a transaction that rolls back after moving
the dial still sends its line. Accepted, because every such transaction is a
short request action whose remaining statements are an audit row. The turn
passes pass `notify: false` and carry their DMs back for the thunk instead.

## 2. The coefficient

`GameConfig.fearIntensity` (k, default 1, live on `/gm/dev` under *Fear*) is the
one knob. Every **gain** is multiplied by k; every **relief** and the nightly
decay are divided by k. Higher is a more frightening world that heals slower.
`0` is the off switch: gains resolve to 0 and the fear pass empties every dial
at the next close.

## 3. What frightens

All base values, before k and before the multipliers in §5. `kind` is what the
multipliers key on.

| Event | kind | Base | Where |
|---|---|---|---|
| Arrive at a WILDERNESS Location | WILDERNESS | +2 | `applyArrivalFear`, from `locationMove.js` |
| Arrive at a CAVE Location | CAVE | +3 | same |
| End the turn in the WILDERNESS | WILDERNESS | +10 | fear pass |
| End the turn in a CAVE | CAVE | +14 | fear pass |
| A new wound tag lands (`health-wounds`, `health-maiming`, `health-infection`) | WOUND | by rung, §4 | `applyWoundFear`, four writers |
| `dying` granted, by any path | DYING | +40 | `applyWoundFear` |
| The Caving Die rolls a 1 | CAVE_TROUBLE | +10 | `cavingPass.js#rollCaving` |
| Bound | BOUND | +15 | `bind.js#applyBind` |
| Still bound at turn end | BOUND | +10 | fear pass |
| Crucified | CRUCIFIED | +80 | `crucifyCharacterRequestImpl` |
| Tortured, broke or held | TORTURED | +40 | `tortureCharacterRequestImpl` (TORTURE.md) |
| A piece cut off you | MUTILATED | +50 | `mutilateRequestImpl` (TORTURE.md §6). A corpse takes no hit — a dead row's dial is read by nobody. |
| Someone dies in your Location | DEATH_SEEN | +15 to each witness | `characterDeath.js#applyDeathToRow` |
| An unburied body in your Location at turn end | CORPSE | +5 | fear pass |
| Shot at by a turret and alive, hit or graze, either gun | TURRET | +25 | `turretPass.js#applyTurretShot` |
| `hungerStreak > 0` at turn end | HUNGER | +5 | fear pass |
| A noble with no `dined` marker at turn end | NOBLE_MEAL | +10 | fear pass |
| Looted while alive | ROBBED | +10 | `lootCharacterRequestImpl` |

**Place classes** come from `placeClassOf(location)`, in this precedence:
HAVEN (the `haven` attribute: Inn, Keep, Sanctuary) > INDOORS
(`Location.indoors`, and a `safe` cave Location, which is why Customs is a roof
and not the dark) > CAVE (`zone.kind === CAVE_LEVEL`) > WILDERNESS (the
`wilderness` attribute: every Forest, Black Hills and Marshes Location except
`factory`, `farms` and `marshes-village`) > OPEN (everything else outdoors).
Both attributes live in `db/lib/locationAttributes.js` and print on Examine.

A **first placement** (creation, a spawn, a GM dropping somebody in from
nowhere) has no `from` Location and charges no arrival fear: nobody walked.
There is no per-turn ration on arrival fear on purpose — a mount's two
crossings are two real arrivals, and walking eight cave Locations in a day is
supposed to cost eight times what camping does, the same rule the Caving Die
already applies.

## 4. Wounds read the cure ladder

A wound's rung on the cure ladder (`TAGS.md` §5c) decides how much it
frightens, read off its requirement block by `woundRungOf`:

| Rung | Derivation | Fear |
|---|---|---|
| 0 | no requirement block at all | 0 |
| ½ | 0 ⬢ (minor-bleeding, dislocated-shoulder) | 4 |
| 1 | 1 ⬢ | 8 |
| 2 | 2 ⬢, 0 turns (frostbite) | 15 |
| 3 | 2 ⬢, 1 turn (choking) | 30 |
| 3½ | 3 ⬢ (severe-bleeding, arterial-bleed, parasites) | 35 |
| 4 | 4–5 ⬢ | 40 |
| 5 | 6–7 ⬢ | 45 |
| 6 | 8 ⬢, no Gambit | 55 |
| 7 | `requirementGambit` | 65 |

Illness, mind, minor and recovery tags frighten nobody — a cold is not a wound.
A tier-0 wound (no block) is real, untreatable and too small to matter. So the
ladder is now read three ways — the bill, the Heal picker, and the fear — and a
rung priced carelessly is wrong three ways.

**Four writers create wound rows, and all four call `applyWoundFear`:**
`tagWrites.js#addToStack` and `#grantTagSlugs` (their `!existing` branches only:
a stack going up or an already-held tag is not a new wound), the turret's own
write in `turretPass.js#applyTurretShot`, the untreated-wound chain's
`createMany` in `tagExpiryPass.js` (which first works out which rows will
actually land past `skipDuplicates`). The starvation Dying grant in
`hungerPass.js` is a batch `createMany` too and charges DYING through
`applyFear` directly after it lands. **A new direct `characterTag.create` of a
Health tag must call `applyWoundFear` too.** Character creation's kit grant is deliberately exempt —
starting with Arthritis is a build, not an injury.

Being **healed** of a wound (a routine cure, not a Gambit attempt) eases half of
what that wound added.

## 5. What calms

| Event | Base | Where |
|---|---|---|
| The night itself, for anyone above 0 | −4 | fear pass |
| End the turn OPEN (a settled place, outdoors) | −4 | fear pass |
| End the turn INDOORS | −6 | fear pass |
| End the turn in a HAVEN | −12 | fear pass |
| Consume anything that lands you tipsy / wasted / unconscious / blind-drunk / high / euphoric | −30 | `consumeTagRequestImpl` |
| Consume a `lavish-meal` | −30 | same |
| Consume `tea` | −15 | same |
| Consume a `cigarette` | −8 | same |
| Fulfil a Desire (player claim or GM award) | −10 per point | both award sites |
| A confession the die absolved | −15 | `confessionPass.js` |
| A **Musician's** `/play`, once per listener per turn | −10 to everyone at the Location | `handlePlayCommand` |
| Walk into the Cathedral, once per turn | −10 | `applyArrivalFear` |
| Be healed of a wound | −½ its wound value | `healCharacterRequestImpl` |

A **fine meal calms nobody**, on purpose: it feeds a noble (§6) and that is all.
The drink rule is keyed on the *status* a consume grants rather than on the
bottle, so a brew added to the catalog later is soothing the day it ships; one
consume takes the **largest** single figure, never a sum (Bliss lands two
statuses and is one drink). The two once-a-turn rations are `AuditLog` rows
with `turnId` set (`fear_cathedral`, `fear_soothed_play` — `REQUESTS.md` §1a),
both rare enough not to drown `/gm/audit`. Only one place term applies per
night, the best one. Relief is never multiplied by a tag.

## 6. Multipliers

Held tags scale a **gain** by its kind; the factors multiply, and a 0 wins:

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

## 7. Nobles

`nobility` no longer grants Disappointed. A noble who ends the turn without
having eaten a fine or lavish meal takes +10 (NOBLE_MEAL, so Brave halves it);
Hungerless and Dying nobles are exempt. "Ate one this turn" is the hidden
`dined` status tag that `fine-meal` and `lavish-meal` consume into beside
`ate-meal`. It has **no `durationTurns`** — a 1-turn grant would be swept at
position 10 of `TURN_PASSES`, nine passes before the fear pass reads it — so
the fear pass deletes it itself, exactly as the hunger pass eats `ate-meal`.
The marker is hidden and the sheet shows no Dinner row for it — the old
Disappointed tracker went with the track, on Bascinet's call. The Merchant now
starts with Nobility too, and therefore with its 1-point Desire lock.
`Character.missedMealStreak` is an orphan column: kept, never read. The
`disappointed` tag left the catalog with this change; the rows still on live
sheets come off with `npm run db:prune-tags -- --apply`, which is the same
gated step that removes Acrophobia.

## 8. The turn pass

`db/lib/fearPass.js`, `"fear"` in `TURN_PASSES`, in the slot the phobia pass
held: **after `hunger`** (it reads the final `hungerStreak`), **after `carry`**
(the final sheet), **before `corpseFollow`**, and **before `travelArrival`** —
every pass above that one settles the turn that just ended, and a traveller
spent it walking out of where they started, so they pay the night for the
place they set out from (the same rule auto-labor and the turrets use).

Per ALIVE character it gathers the terms — place, decay, HUNGER, BOUND, CORPSE,
NOBLE_MEAL — and applies them in one write through `applyFearTerms`, its own
transaction per character so one bad row cannot roll back a hundred good ones,
and hands `applyFearTerms` the row it already loaded (the multiplier slugs,
the band rows and this pass's own gates in one filtered read) rather than
letting it read the sheet again. A character at 0 with nothing but relief
owed is skipped without a write. The `dined` markers are eaten in one
`deleteMany` **after** the loop, not per character: a pass that dies half-way
is re-run from the top, and a per-character delete would have charged the
nobles it had already reached for a dinner they ate. A replay is therefore at
worst a repeated night, never a wrong direction.
Corpse Locations are one query for the whole pass (`RoomTag` plus carried
`CharacterTag` on an unburied `corpseOf`, the death-smell shape). Then a sweep
settles any non-ALIVE holder of a CONDITION band row. One `AuditLog` row,
`fear_resolved`, with the summary; the DMs ride back on `dms` and go out on the
`tagExpiryDms` channel in `db/index.js`, since "a tag on your sheet changed" is
what they are. Returns an object, never null.

## 9. The tuning

The designer's three checks, all asserted in `db/test/fear.test.js`:

- Seven wilderness moves are +14: **Uncomfortable** from the walk alone. A
  wilderness night on top (+10 − 4) lands at 20, still Uncomfortable.
- A moderately severe wound (rung 3, +30) on top of that is 50: **Anxious**.
- At 20, two nights indoors (−6 − 4 each) clear the dial; one night in a Haven
  drops the tag.

The dial is clamped in the database (`LEAST/GREATEST` in the UPDATE), so two
hooks in the same tick cannot race a stale read past 100 or below 0.

## 10. Where the code lives

- `db/lib/fear.js` — the tables (`EVENTS`, one signed table: gains positive,
  relief negative, so most callers name only the kind; `PLACE_TERMS`;
  `NIGHTLY_DECAY`; `DESIRE_RELIEF_PER_POINT`; the consume relief map), the
  pure functions (`bandOf`, `placeClassOf`, `placeTermFor`, `woundRungOf`,
  `woundFearFor`, `multiplierFor`, `resolveDelta`, `fearBandDm`,
  `clampFear`), and the Prisma surface (`applyFear`, `applyFearTerms`,
  `applyWoundFear`, `applyArrivalFear`, `settleFearTag`, `consumeReliefFor`,
  `setFearDmSender`, `loadIntensity`). Off the barrel; require by subpath.
- `db/lib/fearPass.js` — the nightly settle.
- `db/lib/gambitModifier.js` — Afraid −1, Panic −2.
- `db/lib/torture.js` — the TORTURED hit's caller side (TORTURE.md).
- `db/lib/locationAttributes.js` — `wilderness`, `haven`.
- `db/lib/gameConfigFields.js` — `fearIntensity`.
- `db/test/fear.test.js` — the pure half.
- Hooks: `locationMove.js`, `tagWrites.js`, `turretPass.js`, `tagExpiryPass.js`,
  `hungerPass.js`, `cavingPass.js`, `bind.js`, `characterDeath.js`,
  `confessionPass.js`, `web/app/(app)/character/requestActions.js` (consume,
  heal, loot, crucify, torture, desire), `web/app/(app)/gm/dev/characters/[characterId]/actions.js`
  (GM desire award, the dial edit), `bot/src/events/interactionCreate.js` (`/play`).
