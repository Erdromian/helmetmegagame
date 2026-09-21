# Thanati

<!--
PARTLY PLACEHOLDER. Written by Claude for its own orientation while building
the cult, so the next session has a map. Bascinet's own design doc has since
arrived for two parts of it — the Words of the Circle (§4, §4b, §4c) and the
Rite of Conversion (§4a) — and those sections now follow it. The rest is
still Claude's map and should be replaced as more of that doc lands. Nothing
here is game text.
-->

The death cult as gameplay: who is one, what they carry, the four buttons in
the **THANATI** section of `/character`, and the rite pipeline — which has no
button at all. The two seats a GM hands out are `THREATS.md`; the rationale,
the fate guidance and the round scripts are `SECRETS.md` §5 (gitignored).

## 1. Who is a Thanati

Whoever holds the `thanati` Belief (`docs/tags.yaml`, `catalog: secret`). The
leader holds `thanati-leader` on top. Both arrive by Assign or Spawn
(`db/lib/threats.js`), each kit also granting `literacy`. Points: 4 for a
cultist, 7 for the leader.

**The cult has no starting location.** Each kit used to grant an
`underquarter-basements` tag opening the knocked-through basements under the
Underquarter; that tag is gone, along with the Underquarter itself, and the
Thanati now begin nowhere in particular. Where they gather is theirs to find.

Nobody outside the faith sees the Belief. `Tag.inspectVisibility` stays
HIDDEN; `db/lib/examine.js#examineReadout` adds one line — "Thanati" or
"Thanati Leader" — only when the **viewer** holds `thanati`
(`viewerIsThanati`, passed by `examineActions.js`). Robes and mask are
ordinary worn equipment and show to anyone.

The cult is a set of tags and nothing else. Cultists keep whatever seat they
hold in the open; the roster is Recall Comrades, and the hideout is a pointer
on `GameState`.

## 2. The tags

| Slug | What |
|---|---|
| `flesh-of-tzchernobog` | Craftable by a Thanati: 1 ⬢, Dead Simple, 3 a turn. Eating it grants `dark-inspiration`. Not a meal — no `ate-meal`. |
| `dark-inspiration` | Status, 2 turns (`durationTurns`). Half of what makes a chant count. |
| `black-robes` | BODY armor, `visible: worn`. Craftable by a Thanati, 1 ⬢, no Move cost (`turnsCost: 0`, uncapped — not Dead Simple, just free). The other half of a counted chant. The combat line in its description is prose for a GM. |
| `thanati-mask` | Pre-existing headgear, conceals identity. |
| `grimoire` | Craftable from one `blank-book`, Dead Simple, 1 a turn. Holding it unlocks the **Grimoire** document. |
| `madness` | The Rite of Madness's yield. Two turns, and description-only: nothing enforces the attacking, a GM does. |
| `poison-tooth` / `installed-poison-tooth` | Bought from the shelf, consumed into the installed half. Biting down is adjudicated, not a button. |
| `adders-bite` | A phial, consumed into `phrygian-toxin`. |
| `dynamite-stick` / `dynamite-bundle` | The bundle is an ordinary Craft recipe with an enforced ingredient: five sticks, no skill. |
| `sacrificial-knife` | A knife. Shelf only. |
| `radio-27065` | Shelf only, at 20. Not a weapon but a channel: holding one opens `#27.065`, and everyone else holding one hears you (`CHANNELS.md` §7). Tradeable, so a radio that leaves the cult takes the frequency with it. |

The Basements stash (`docs/zones.yaml`) starts with one robe, four daggers and
nineteen sheets of paper.

"Thanati equipment", for the robes' combat line, means whatever
`THANATI_WARES` in `db/lib/thanati.js` sells. That list carries ONE price per
ware now, not an obol column and a ⬢ column: an obol is one ⬢ (`DEPOT.md`), the
two were always equal, and Purchase Gear spends both together.

## 3. The buttons (`web/app/(app)/character/thanatiActions.js`)

All four are declared in `actionRegistry.js` under `THANATI` and **hide**
rather than grey on `isThanati` / `isThanatiLeader` (own-sheet facts).
`character/page.js` resolves the flags and the dialog data; every action
re-checks the tag from the session.

- **Recall Comrades** — an instant verb (no dialog; `components/actions/
  index.js#INSTANT`). Returns `listComrades()` to the page, and the notice
  under the button lists every living cultist as `Name · Role`, leader first
  and marked `[LEADER]`. It used to go out as a DM; the page is private
  already. Free, no Move. Audit `request_recall_comrades`.
  `formatComrades` is still in `db/lib/thanati.js` for a Discord caller.
- **Recover Equipment** — an instant verb with a one-line confirm, since it
  spends the Move. The button's label is what it would hand back ("Recover
  Robes & Mask", "Recover Mask"; `actionRegistry.js#labelFor`) and it greys
  with "You have both." once nothing is missing. Grants whichever of
  `black-robes` / `thanati-mask` the cultist lacks and says so in the notice.
  Spends the Move (`web/lib/moveSpend.js`, lifted out of
  `requestActions.js` for this). Cooldown of one turn: refused if an audit
  row `request_recover_equipment` by this player carries this turn's or the
  previous turn's `turnId` — the ration-counts-rows pattern.
- **Set Hideout** (leader only) — picks a room at the leader's current
  Location that `accessibleRooms` says they can enter; writes
  `GameState.thanatiHideoutRoomId` (a snapshot id, no FK). Re-settable.
- **Purchase Gear** — greyed unless standing at the hideout's Location. Pays
  from **four pools**: the hideout room's ⬢ and its `obol` stack, and the
  buyer's own of each. The two controls are PREFERENCES, not restrictions —
  which currency drains first and which purse — and the rest cover whatever is
  left, so a cult with the money spread across four piles can still buy. All
  four are decrement-as-check inside one transaction. Goods land on the hideout
  floor via `addToRoomStack` whoever paid; the room hears the ordinary stash
  line. Audit `thanati_purchase`, with the split it actually took.

## 4. Rites — no button

A rite happens because the room heard the right word from the right people
while the right things lay on its floor. `docs/systemdocs/THANATI.md` §4 is the
whole mechanism:

1. **Words.** `db/lib/rites.js#RITES` is the catalog (name, minimum chanters,
   ingredients, Bascinet's description, `run`). `rollRiteWords` gives every
   rite **one to three words** from `THANATI_DICTIONARY` (§4b).
   `db/lib/riteWords.js#ensureRiteWords` rolls lazily
   into `GameState.riteWords` the first time anything asks (a chant, the
   Grimoire document, the GM panel) with a guarded `updateMany` so two first
   readers cannot both roll. Restart Game recreates GameState, so a new game
   rolls new words — which is the whole point: nobody can carry a Word of the
   Circle over from a game they have already played. A rite ADDED to the
   catalog mid-game would otherwise never get one, so `ensureRiteWords` also
   tops up: `rollRiteWords(rng, RITES, existing)` keeps every phrase already
   rolled, counts it among the taken, and rolls only the missing keys.

   **It also re-rolls a phrase the rules have outgrown**, which is a different
   question from a missing one. A roll is written once and outlives the rules
   that made it: the dictionary, the blocklist, the word cap and the catalog
   can all move in a deploy, and nothing else ever looks at the stored value
   again. `rites.js#staleRiteWords` is what looks — it names the keys whose
   phrase now breaks a rule (a word retired from the dictionary, a phrase that
   has become a reserved battle cry, one over the cap, or two that nest), and
   `ensureRiteWords` drops exactly those and keeps the rest. Without it a game
   goes on printing a forbidden phrase in the Grimoire and firing on it.
   A key with no phrase at all is **missing**, not stale, and belongs to the
   top-up above.

   **Three rules reject a candidate phrase**, and they are not the same rule:

   - **The word cap.** At most three words, counted on the phrase AS WRITTEN
     (`phraseWordCount`). Not as normalized: `rud'minuox` reads as one word to
     whoever has to say it even though `normalizeChant` splits it in two, and
     three dictionary entries are not three words now that `pestis cruento`
     and two others are two-word entries.
   - **Nesting**, against the phrases already rolled, in both directions.
     Matching is "contains", so a phrase sitting inside another would fire two
     rites off one line.
   - **The blocklist** — `PROHIBITED_CIRCLE_PHRASES`, §4c. **Whole phrase
     only**, by equality after normalization. The words in it stay in the
     dictionary and may be rolled in any other company; it is the exact phrase
     that is barred.
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
   present (`floorHas`: `RoomTag` stacks, ⬢ among them since they are a stack
   row like anything else now — `db/lib/resourceStack.js`; the
   person/corpse/photograph/weapon kinds are the scripted rite's to judge and
   count as present until then) → `status: READY`, `firesAt = now + 2 min`,
   and the room hears, once, as `-#` subtext: *You feel tense... Anyone else
   who wants to participate should join in now.* (Bascinet's line.)
4. **The sweep.** `db/lib/riteSweep.js#runRiteSweep`, every minute on the bot
   (`ready.js`). OPEN past twelve hours → EXPIRED. READY past `firesAt` →
   re-check the floor (gone → back to OPEN, clock cleared), claim the row
   (`updateMany where status READY`), consume the floor ingredients, run the
   rite's effect (`riteEffects.js#EFFECTS[key]`, §9), stamp participants
   (distinct chanters still ALIVE), write one audit row `rite_fired`. Firing
   is within a minute of the mark, not on the second. An effect that throws
   is recorded on the row (`result.error`) and shown on the GM panel.

Several rites may run in one room at once; the ingredients are the only real
contention. A non-cultist who has robes, Flesh and a Grimoire chants like
anyone else — nothing here reads the Belief.

### 4a. Conversion asks (`db/lib/conversionRite.js`)

**The Rite of Conversion is the one rite that does not do anything to
anybody.** It puts a question in front of somebody, and they answer it. **One
cultist is enough to ask it.**

**The target must be able to walk away from the question.** Not bound, not
shackled, not dying, catatonic, crucified, paralyzed, unconscious or in
seizure — one predicate, `slugsBlocking(ACT)` from
`db/lib/incapacitation.js`, rather than a hand-rolled pair of restraint slugs.
This is the exact reversal of what the rite used to want: it took a **Bound**
person, and the Grimoire promised the cult that refusing would leave them
*"severely weakened and distraught, allowing you to finish them off."* Both
halves of that are gone. An invitation cannot be put to somebody in no
position to refuse it, and an invitation that punishes "no" is not one.

### The two stages

**The cultist chooses.** `riteIngredients.js#convertCandidates` hands the
effect **every** eligible non-cultist in the room rather than picking one, and
`EFFECTS.conversion` returns `{ awaiting: "convert-target" }` — so the attempt
parks on `RiteAttempt.AWAITING`, the way the Rite of Panic parks waiting for a
zone. Every chanter is DM'd a select menu, and **the first to answer claims
it** (`conversionRite.js#answerConversionPick`, a guarded `updateMany` on
AWAITING, the same shape `answerPanic` uses). Asking only one nominated
cultist would strand the rite for its whole twelve hours if that one happened
to be asleep.

Nothing off the DM is trusted. The answerer must be one of the chanters
snapshotted on the attempt, and **the candidate list is rebuilt at pick time**
rather than read off the snapshot — minutes pass between the chant and the
answer, and somebody bound, converted or killed in the gap must not still be
offerable. The labels in the menu go through `seenAs(identityOf(…))`, so a
hood is not quietly undone by the picker.

**Then the target answers.** An `Offer` of kind `CONVERSION` — the same consent
row Lesson, Bind, Confession, Escort, Kiss, Search and Collar use, so the DM
buttons, the card on `/character` and the routing in `db/lib/dmAnswer.js` all
come for free. The offer does not exist until somebody has been picked.

### Saying no costs nothing

Every other offer declines for free, and this one does now too. What a refusal
still does is close the row, let the room see it happen, and **tell the cultist
who called them** — which is the one thing the rite owes anybody, and which
nothing used to do.

**It keeps its clock.** `Offer.expiresAt`, three hours, swept by
`db/lib/riteSweep.js` on the minute pass that is already running, with
`db/lib/offerExpiryPass.js` as the turn-close backstop. Silence still resolves
as a decline rather than hanging, so there is **one road out of a pending
question and not two**; it simply costs nothing now. `ASK_REFUSED_DM` is
therefore worded to fit both — it says they did not join, never that they said
so. **All three roads call the same `refuseConversion()`**, and its guarded
`updateMany` is what stops two of them telling the cultist twice.

Accepting no longer lifts `depressed` or sets the dial to the floor of
Pleased. That was a rescue from a wound this rite no longer inflicts, and
doing it anyway would clear a depression the character earned somewhere else.

There is no cooldown. The cult may chant it again as often as it likes.

**The Pious are a valid target, sorted last.** They used to be dropped from the
candidate list entirely; `deprioritizeSlugs` puts them behind everyone else
instead. That sort is presentation now rather than a rule — a cultist reading
the menu may pick one deliberately — but it still means the obvious pick is
never the wasted one. The vision bounces off: no `Offer` row is ever written,
they get the hallucination DM and `EVENTS.RITE_DISMISSED` (+50), and the room
hears them refuse. The cult finds out it wasted the chant by reading the room.

**Nobody is ever named**, on any surface. The vision names no cultist, the room
lines use `aliasSubject()`, and `web/app/(app)/character/page.js` nulls
`otherName` for this kind so the initiator's name never reaches the browser at
all — a rule about the payload, not about the string.

| Answer | Target hears | Room hears |
|---|---|---|
| Accept | "This reality is cursed! …" plus any Belief conflict | "…'s eyes widen as they begin to understand…" |
| Refuse, or three hours' silence | "You cannot bring yourself to assent to such a reality!" | "The target rises, resolute in their convictions. The rite has failed." |
| Pious | "You see a strange vision… nothing but a hallucination." | "… refuses the ritual, a look of determination in their eyes!" |

The cultist who called them hears `ASK_REFUSED_DM` on either of the last two,
and nothing at all on an Accept — the room's line is the telling there.

### 4b. The dictionary

`THANATI_DICTIONARY` in `db/lib/rites.js`, 51 entries. Bascinet's table, with
the English the code does not carry — nothing reads a gloss, so keeping one in
`rites.js` would be a second place to hold in step for no behaviour. Price a
new word by this table, not by the shape of a neighbouring one.

Three entries are **two words** (`pestis cruento`, `cruento pestis`, `cruento
paashaeximus`), which is why the cap counts words rather than entries. The
hyphens and the apostrophes are for the reader: `normalizeChant` strips
everything that is not a letter, so `domus-bhaava` and `domus bhaava` are the
same chant, as are `exim'ha` and `exim’ha`.

| English | Cultist | | English | Cultist |
|---|---|---|---|---|
| believer (colloquial) | `rud'minuox` | | love (formal) | `odiosuu` |
| believer (formal) | `rudsceleratus` | | massacre (colloquial) | `cruo-stragaraNa` |
| blessed (formal) | `pestis cruento` | | massacre (formal) | `prayaNavita` |
| blood (formal) | `cruo` | | order (formal) | `vilomaxus` |
| blood brother (formal) | `crunatus` | | pray (colloquial) | `profanx` |
| blood heaven (formal) | `pretiacruento` | | pray (formal) | `profanuxes` |
| bloodhungry (formal) | `cruentu` | | shit (colloquial) | `exim'ha` |
| bloodshed (colloquial) | `cruensseasrjit` | | spirit (colloquial) | `tuulenux` |
| bloodthirsty (colloquial) | `cruonit` | | spirit (formal) | `praaNsilenux` |
| chaos (formal) | `shaantitus` | | to be (colloquial) | `esco` |
| curse (formal) | `cruento pestis` | | to be (formal) | `bhuuesco` |
| dark (formal) | `domus` | | to become (colloquial) | `desco` |
| death (colloquial) | `marana` | | to become (formal) | `bhuudesco` |
| drink (colloquial) | `bibox` | | to do, to inflict upon | `hatanoceo` |
| eat (colloquial) | `vorox` | | to have, possess (colloquial) | `gero` |
| ecstasy/enlightenment (formal) | `cruento paashaeximus` | | to have, possess (formal) | `geropayati` |
| enemies (formal) | `Shatruex` | | to make bloody (colloquial) | `cruonita` |
| foreigner (formal) | `infirmux` | | to make dark (formal) | `infuscomus` |
| fresh (colloquial) | `crudux` | | unbeliever/Humanity (colloquial) | `malax` |
| gun (colloquial) | `vigra` | | unbeliever/Humanity (formal) | `caecux` |
| hate (colloquial) | `invisux` | | unquenchable (formal) | `quodpipax` |
| hate (formal) | `invisuu` | | weakling (colloquial) | `pallex` |
| heaven (formal) | `maravita` | | wisdom (formal) | `durbentia` |
| home (formal) | `domus-bhaava` | | world (formal) | `lokemundux` |
| light (formal) | `acerbus-shatruex` | | | |
| living dead (formal) | `pretaanluxis` | | | |
| love (colloquial) | `odiosux` | | | |

`hatanoceo` is **one** entry, not two: Bascinet's table gives it for both the
colloquial and the formal "to do, to inflict upon". A duplicate would fail
`db/test/rites.test.js`'s uniqueness-after-normalization assertion, which is
exactly what that assertion is for.

### 4c. The prohibited phrases

`PROHIBITED_CIRCLE_PHRASES`, 26 of them. These are the cult's battle cries —
what a player shouts in character — so none may also be the thing that fires a
rite. **Whole phrase only.** Their words stay in the dictionary and roll
freely in any other combination: `pretiacruento` on its own is refused,
`pretiacruento marana` is not.

```
"apigami"                                bhuudesco invisuu
bhuuesco marana                          crudux cruo
cruento paashaeximus                     cruento pestis shatruex
cruo crunatus durbe                      cruo lokemundux
cruo stragarana malaxos                  geroxe cruo
En marana domus nava crunatus            caecux infirmux
malax "say ti"                           maranax pallex
maranax malax                            maranax infirmux
pallex "ti"                              Geroxe bibox malax
pestis Cruento                           pestis cruento vilomaxus pretiacruento
pretaanluxis cruonit                     pretiacruento
stragarana                               vorox esco marana
vilomaxus                                "Pro" stragarana malaxos
```

Several use word forms the dictionary does not carry — `geroxe`, `durbe`,
`maranax`, `malaxos`, `en`, `nava`, `pro`, `say ti` — and so could never be
rolled anyway. They are listed in full regardless, so the blocklist stays true
to Bascinet's text rather than to whatever the dictionary happens to hold. The
quote marks need no stripping: `normalizeChant` drops them like any other
non-letter.

**`apigami` and `stragarana` left the dictionary** when this list arrived.
They were rollable words before, and they are battle cries and nothing else.

## 5. The Grimoire document

`docs/documents.yaml` `grimoire`, gated on the **Grimoire** tag name, body
`{grimoire}`. `web/app/(app)/documents/page.js` swaps the marker for
`web/lib/grimoire.js#grimoireBody(words)`: one block per rite —
`**Name** | Minimum cultists: N | Ingredients: …`, the description, and
`_Word of the Circle:_ {word:phrase}`. `{word:…}` is a token whose payload is
the text; `DocumentMarkdown`, `RichText` and `ChipText` render it as a
`.chip.word-chip`. Documents have no literacy gate, which is why every seat
kit grants Literacy.

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
| `db/lib/riteSweep.js` | Expire / fire / rearm |
| `db/lib/ascensionPass.js` | The end of the world, at a turn close |
| `db/lib/conversionRite.js` | The Conversion handshake: the circle's picker, the vision, the three answers, the three-hour clock |
| `bot/src/lib/conversionPick.js` | Discord's half of that picker; the web's is `DmThread.js#ConversionPick` |
| `db/test/rites.test.js` | The pure half |
| `db/test/conversionRite.test.js` | The handshake, the picker and the blocklist's reach |
| `web/lib/moveSpend.js` | `requireFreeMove`, `fileAutoRoutine` |
| `web/lib/grimoire.js` | The Grimoire body |
| `web/app/(app)/character/thanatiActions.js` | The four actions |
| `web/app/components/actions/HideoutDialog.js`, `PurchaseDialog.js` | The two that open a dialog |
| `web/app/(app)/gm/dev/threats/RitesPanel.js` | The GM view |

## 9. The rite scripts

`db/lib/riteEffects.js#EFFECTS`, one handler per rite key, run by the sweep on
the top-level client after the floor is eaten. What each does, in Bascinet's
words where a room or a player hears anything:

| Rite | Needs (resolved by `riteIngredients.js`) | Does |
|---|---|---|
| Initial | 1 chanter | DMs every participant the cult's objectives with Success!/Incomplete |
| Conversion | every character at the Location with access to the room who is **able to act** and not already Thanati; leaders first, **Pious last** | **Waits.** Parks on AWAITING and DMs the circle a picker; the pick writes the `Offer` — see §4a |
| Sacrifice | a Bound character with access | pins the living sacrifice-* objectives, **gibs** them (`killByRite`, `gib: true`), 2–7 remains + 1–2 Flesh + 2–5 ⬢ on the floor. No corpse is minted at all — see `CORPSES.md` §1a |
| Scrying | 15 ⬢ | a `scrying-eye` on the floor |
| Possession | a weapon stack on the floor, 15 ⬢ | one unit becomes a custom "<Name> (Animated)" copy, indestructible |
| Reanimation | a corpse on the floor, 1 heart, 5 ⬢ | `reviveByRite`: ALIVE in this Location with `ghoul`, `servant-of-tzchernobog`, `hungerless`; role, Cursed and placement restored |
| Stupidity | 1 squeeze, a photograph (floor first, then hands), 5 ⬢ | target gets `stupid`; the print is spent |
| Omniscience | 1 skinless-brain, a photograph | every participant is DMed the target's full tag list; print spent |
| Summoning | 1 saltpeter, 15 ⬢ | every living Thanati not on hallowed ground moves to this Location and is unbound |
| Panic | 1 heart, 20 ⬢ | room hears "Name a zone."; status **AWAITING**; the next participant line naming a Zone (else a Location) sets everyone there to mood −100, Panicking (`answerPanic`) |
| Reflection | 1 black-robes (floor), 15 ⬢ | `shimmering-robes` on the floor (counts as robes for chanting) |
| Rage | 1 ravenheart-red | every participant gets `rage`: every mood harm ×0, Desires locked but cruelty |
| Judgement | 1 heart, 2 eye, a photograph, 40 ⬢; target not Pious, not on hallowed ground | target **gibbed** wherever they stand, their Location hears "… explodes into mist!", remains dropped in a random public Room there — there is no body to drop them beside |
| Madness | 1 mindbreaker-toxin, a photograph, 15 ⬢; same target rule as Judgement | target gets `madness` for two turns; the print is spent |
| Fulfillment | nothing on the floor — but the **leader must be among the chanters**, and it fires once per game | 100 ⬢ per completed cult objective, on the room's floor; room hears "Bounty! What success!" |
| Ascension | 1 barons-scepter, 1 bishops-mitre, 250 ⬢, eight chanters | arms the end of the world for two turns' time and tells every zone where it is being planned |

**Ascension is the second way a game ends** and is built like the bomb, on
purpose. The rite stamps `GameState.ascensionArmedTurn = openTurn + 2` and
snapshots the leader into `ascensionLeaderCharacterId`; `db/lib/ascensionPass.js`
runs each close, beside `nukeExplosionPass` and after the staged push, so a
leader killed this turn beats the clock. If that leader is not ALIVE the
countdown is cleared and nothing more is said. Otherwise `ascensionFiredTurn`
is stamped (never cleared), every `#summary` hears the hellfire line, the game
ends through `endGameInDb`, and `turnBannerPath` pins `hellfire.jpg` on for
good — for **this** game: the stamp is written to `Game.ascensionFiredTurn`,
not to `GameState`, so the next game starts under a clean sky
(`TURN-ENGINE.md` §banner). A GM can also call it off from `/gm/dev?s=reports`, beside Defuse.

**The hellfire kills everyone**, gibbed, with no zone exemption — not even the
caves. That is the whole difference between the two endings: the bomb leaves
survivors underground with a game to keep playing, and this leaves nothing to
play.

**If the bomb and the rite come due on the same close, the cult wins.** The
ascension pass runs before `nukeExplosionPass` for exactly that reason: the
blast would otherwise kill the snapshot leader and cancel the rite. By the time
the bomb runs there is nobody left alive for it to find, and the epilogue is the
cult's, because `endGameInDb` is a no-op once the state is ENDED.

Fulfillment's "leader must be present" and "once a game", and Ascension's
"not while one is already running", are checked in `riteIngredients.js` with
the Pious and hallowed-ground rules — **not** in the handlers. The sweep eats
the floor before it runs an effect, so a refusal from inside one would have
swallowed a sceptre, a mitre and 250 ⬢ for nothing. Upstream it is an ordinary
rearm and costs the circle only its two minutes.

**The consumption line is universal.** A rite whose only thing to say is "the
floor is gone" says `INGREDIENTS_CONSUMED` — *The ingredients evaporate into
dust.* — and nothing else. The flavoured lines (the eyeball, the shimmering
robes, the rising corpse, the exploding sacrifice) are what the rite MADE and
stay as they are.

"Hallowed ground" is `HALLOWED_LOCATION_SLUGS` (the Cathedral) in
`riteIngredients.js`, a code constant rather than a zone attribute so it needs
no sync. A rite whose resolved target is invalid never fires and never eats its
floor: the sweep sends it back to OPEN with `result.rearmed` naming what was
missing.

Photographs: `Tag.photoOfCharacterId` (set by `photoMint.js` from both
cameras) names the subject; older prints fall back to the name on the print.
A Ghoul's speech goes through `babble.js#growl` (say.js `growling`). The
Scrying Eye is `feedAccess.js#hasScryingEye`: equipped, **robes on**
(`ROBE_SLUGS`, so the Rite of Reflection's pair counts) **and** web-only —
then every room and conversation at the Location becomes readable, `canSpeak:
false`. The robes are Bascinet's rule, and they mean a stolen eye is worth
nothing to a thief who is not in the cult's dress.
