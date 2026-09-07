# Thanati

<!--
PLACEHOLDER. Written by Claude for its own orientation while building the
cult, so the next session has a map. Replace this file as soon as a human
design doc exists — Bascinet has said one is coming. Nothing here is game
text; it is exempt from the ‡ rule like the rest of docs/systemdocs/.
-->

The death cult as gameplay: who is one, what they carry, the four buttons in
the **THANATI** section of `/character`, and the rite pipeline — which has no
button at all. The two seats a GM hands out are `THREATS.md`; the rationale,
the fate guidance and the round scripts are `SECRETS.md` §5 (gitignored).

## 1. Who is a Thanati

Whoever holds the `thanati` Belief (`docs/tags.yaml`, `catalog: secret`). The
leader holds `thanati-leader` on top. Both arrive by Assign or Spawn
(`db/lib/threats.js`), each kit now also granting `underquarter-basements`
(the way into the cult's usual start, `docs/zones.yaml`) and `literate`.
Points: 4 for a cultist, 7 for the leader.

Nobody outside the faith sees the Belief. `Tag.inspectVisibility` stays
HIDDEN; `db/lib/examine.js#examineReadout` adds one line — "Thanati" or
"Thanati Leader" — only when the **viewer** holds `thanati`
(`viewerIsThanati`, passed by `examineActions.js`). Robes and mask are
ordinary worn equipment and show to anyone.

There is **no Faction row**. Cultists keep their cover faction; the roster is
Recall Comrades, the hideout is a pointer on `GameState`.

## 2. The tags

| Slug | What |
|---|---|
| `flesh-of-tzchernobog` | Craftable by a Thanati: 1 ⬢, Dead Simple, 3 a turn. Eating it grants `dark-inspiration`. Not a meal — no `ate-meal`. |
| `dark-inspiration` | Status, 2 turns (`durationTurns`). Half of what makes a chant count. |
| `black-robes` | BODY armor, `visible: worn`. Craftable by a Thanati, 1 ⬢, one Routine. The other half of a counted chant. The combat line in its description is prose for a GM. |
| `thanati-mask` | Pre-existing headgear, conceals identity. |
| `grimoire` | Craftable from one `blank-book`, Dead Simple, 1 a turn. Holding it unlocks the **Grimoire** document. |

The Basements stash (`docs/zones.yaml`) starts with one robe, four daggers and
nineteen sheets of paper.

"Thanati equipment", for the robes' combat line, means whatever
`THANATI_WARES` in `db/lib/thanati.js` sells — a placeholder list Bascinet
fills.

## 3. The buttons (`web/app/(app)/character/thanatiActions.js`)

All four are declared in `actionRegistry.js` under `THANATI` and **hide**
rather than grey on `isThanati` / `isThanatiLeader` (own-sheet facts).
`character/page.js` resolves the flags and the dialog data; every action
re-checks the tag from the session.

- **Recall Comrades** — DMs `formatComrades(listComrades())`: every living
  cultist as `Name, Role`, leader first and marked `[LEADER]`, joined by ` • `.
  Free, no Move. Audit `request_recall_comrades`.
- **Recover Equipment** — grants whichever of `black-robes` / `thanati-mask`
  the cultist lacks. Spends the Move (`web/lib/moveSpend.js`, lifted out of
  `requestActions.js` for this). Cooldown of one turn: refused if an audit
  row `request_recover_equipment` by this player carries this turn's or the
  previous turn's `turnId` — the ration-counts-rows pattern.
- **Set Hideout** (leader only) — picks a room at the leader's current
  Location that `accessibleRooms` says they can enter; writes
  `GameState.thanatiHideoutRoomId` (a snapshot id, no FK). Re-settable.
- **Purchase Gear** — greyed unless standing at the hideout's Location. Pays
  from the hideout room's **floor**, `Room.resources` or the `obol` stack,
  buyer's pick, decrement-as-check; drops the goods on the same floor via
  `addToRoomStack`; the room hears the ordinary stash line. Audit
  `thanati_purchase`.

## 4. Rites — no button

A rite happens because the room heard the right word from the right people
while the right things lay on its floor. `docs/systemdocs/THANATI.md` §4 is the
whole mechanism:

1. **Words.** `db/lib/rites.js#RITES` is the catalog (name, minimum chanters,
   ingredients, Bascinet's description, `run`). `rollRiteWords` gives every
   rite one to three words from `THANATI_DICTIONARY`, rerolling any phrase
   that nests in another. `db/lib/riteWords.js#ensureRiteWords` rolls lazily
   into `GameState.riteWords` the first time anything asks (a chant, the
   Grimoire document, the GM panel) with a guarded `updateMany` so two first
   readers cannot both roll. Restart Game recreates GameState, so a new game
   rolls new words.
2. **The chant hook.** `db/lib/say.js#recordSpeech` calls
   `db/lib/riteChant.js#noteChant` after every archived line, on both faces,
   fire-and-forget. It counts a chant when the place is a Room thread
   (`room:`) or a Conversation linked to one (`conv:` → `PlayerThread.roomId`),
   the line **contains** a rite's phrase (`normalizeChant`: NFKC, lowercase,
   letters only; whole-word run, rolled order), and the speaker is wearing
   `black-robes` **and** holds `dark-inspiration` (`chanterReady`). It joins
   the live `RiteAttempt` for that rite in that room (OPEN or READY, opened
   inside twelve hours) or opens one, writes a `RiteChant`, and re-judges.
3. **READY.** Distinct chanters ≥ `minChanters` and the floor ingredients
   present (`floorHas`: `RoomTag` stacks and `Room.resources`; the
   person/corpse/photograph/weapon kinds are the scripted rite's to judge and
   count as present until then) → `status: READY`, `firesAt = now + 2 min`,
   and the room hears, once, as `-#` subtext: *You feel tense... Anyone else
   who wants to participate should join in now.* (Bascinet's line.)
4. **The sweep.** `db/lib/riteSweep.js#runRiteSweep`, every minute on the bot
   (`ready.js`). OPEN past twelve hours → EXPIRED. READY past `firesAt` →
   re-check the floor (gone → back to OPEN, clock cleared), claim the row
   (`updateMany where status READY`), consume the floor ingredients, run
   `rite.run` if the rite is scripted (else `result: { unscripted: true }`),
   stamp participants (distinct chanters still ALIVE), write one audit row
   `rite_fired`. Firing is within a minute of the mark, not on the second.

Several rites may run in one room at once; the ingredients are the only real
contention. A non-cultist who has robes, Flesh and a Grimoire chants like
anyone else — nothing here reads the Belief.

## 5. The Grimoire document

`docs/documents.yaml` `grimoire`, gated on the **Grimoire** tag name, body
`{grimoire}`. `web/app/(app)/documents/page.js` swaps the marker for
`web/lib/grimoire.js#grimoireBody(words)`: one block per rite —
`**Name** | Minimum cultists: N | Ingredients: …`, the description, and
`_Word of the Circle:_ {word:phrase}`. `{word:…}` is a token whose payload is
the text; `DocumentMarkdown`, `RichText` and `ChipText` render it as a
`.chip.word-chip`. Documents have no literacy gate, which is why every seat
kit grants Literate.

## 6. GM surface

`/gm/dev?s=antagonists` → **Rites** (`threats/RitesPanel.js`), read-only:
rite → phrase, and attempts (OPEN/READY plus the last fired) with room,
status, chanters, opened, fires-at.

## 7. Tables and what Restart wipes

`RiteAttempt` (rite, room snapshot, status OPEN/READY/FIRED/EXPIRED/CANCELLED,
opened/ready/fires/fired, participants, result) and `RiteChant` (attempt,
character snapshot, archive seq). `wipeGameData` deletes the attempts; chants
cascade. `GameState.riteWords` and `thanatiHideoutRoomId` go with the row.

## 8. Where the code lives

| File | What |
|---|---|
| `db/lib/rites.js` | Catalog, dictionary, roll, matcher (pure) |
| `db/lib/riteWords.js` | `ensureRiteWords` |
| `db/lib/thanati.js` | Slugs, roster, hideout, wares, `chanterReady` |
| `db/lib/riteChant.js` | The chant hook and `evaluateAttempt` |
| `db/lib/riteSweep.js` | Expire / fire |
| `db/test/rites.test.js` | The pure half |
| `web/lib/moveSpend.js` | `requireFreeMove`, `fileAutoRoutine` |
| `web/lib/grimoire.js` | The Grimoire body |
| `web/app/(app)/character/thanatiActions.js` | The four actions |
| `web/app/(app)/gm/dev/threats/RitesPanel.js` | The GM view |

## 9. Phase 2

The rite scripts (Conversion, Sacrifice, Scrying, Possession, Reanimation,
Stupidity, Omniscience, Summoning, Panic, Famine, Reflection, Rage,
Judgement, and the Initial Rite's objective DM) are `run` handlers to write,
plus the four non-floor ingredient kinds. The placeholder objective kinds in
`db/lib/objectiveKinds.js` get their `script` or are pinned by the handler.
