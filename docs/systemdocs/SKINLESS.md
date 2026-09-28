# The Skinless

A hidden fate that only opens through a lateparty, and never fills. From
Bascinet's design doc `E:\Bascinet\V3\Skinless\Skinless Overview.docx`.

The code is `db/lib/skinless.js`. The respawn and Smell Skin actions are
`web/app/(app)/character/skinlessActions.js`; the respawn button is
`SkinlessRespawn.js` beside it.

Companion to [`LATE-PARTIES.md`](LATE-PARTIES.md) (the event that opens
them), [`STRANGERS.md`](STRANGERS.md) (the per-reader lens the grunts ride
on) and [`CORPSES.md`](CORPSES.md) (the brain).

## 1. How they arrive

**A superadmin starts a lateparty with the Skinless fate in it**
(`/gm/dev?s=lateparty`). The role is spawn-only (`SPAWN_ONLY_FATE_SLUGS`), so
nobody sees it anywhere until then. Its Slots field is shut: a Skinless fate is
always unlimited (`normalizePartyFates`' `alwaysUnlimited`), so the party runs
until a superadmin ends it, and every other fate stays locked the whole time.
That is the doc's "regular character creation is permanently disabled until
the story ends or a superadmin halts the lateparty".

**One spawn point per party.** Starting a party that names them picks a random
live Location of the Depths (`pickSkinlessSpawn`) and stores it on
`LateParty.skinlessLocationId`. Every Skinless that party makes arrives there
(Bascinet's call, 2026-09-28). The panel names it.

**Respawning skips creation entirely.** The Skinless card in the picker, and a
card of its own on a muster's page, carries one button: **Respawn as a
Skinless**. There is nothing to draw in a muster, since there is always room,
so a Skinless is never put in the hat (Bascinet's call). The button calls
`respawnAsSkinless`, which checks the same doors creation does (signed in,
nobody alive, game open, on the roster, a party naming the Skinless live) and
then `spawnSkinless` rolls the body in one transaction under the Role and party
locks:

- **Sex:** a coin flip, MAN or WOMAN.
- **Name:** a first name from that half of the doc's pool
  (`SKINLESS_NAMES`, 28 a side, Bascinet's names as written), and the last
  name **Skinless**. No age, no honorific.
- **Face:** `web/public/assets/skinless/skinless-avatar.webp`, for anybody
  holding the `skinless` tag, served by `web/lib/avatarResponse.js`. A
  stranger sees it too: what they are is plain to anyone who looks.
- **Tags** (`rollSkinlessTags`): the preset — Skinless, Hungerless, Cave
  Eyes, Melee I, Caving, Climbing, Ranged I, Guerrilla — then one of Spear,
  Cracked Bone Club, Hatchet or Sling, then each of the doc's 22 random tags
  rolled on its own: **Low 10%, Medium 25%, High 50%** (Bascinet's numbers).
  A random tag that clashes with one already chosen (Dwarf and Giant, Frail
  and Strong) or lacks its prerequisite is skipped. The list is shuffled first,
  so neither half of a clashing pair always wins.
- **No points** to spend, no bank account, no ring, no `knows:`.

The doc's "Melee 1", "Ranged 1", "Medical 1" and "Guerilla" are the catalog's
Melee I, Ranged I, Medical I and Guerrilla; its "Bone club" is the Cracked
Bone Club.

`createCharacter` and `reserveFateAction` refuse the Skinless fate outright,
so the wizard cannot build one by hand. **Metempsychosis never lands in it**
(`reincarnate.js#openRoles`): it would hand the soul a role's kit rather than
the rolled body. A soul dying in a Skinless-only party finds no seat, the way
it already could, and the player respawns as a Skinless by hand.

## 2. What the tag does

Every rule hangs off holding the `skinless` tag, not the role, so a GM granting
or stripping it by hand moves all of them.

| Rule | Where |
|---|---|
| Nothing on the body: HEAD, BODY, ACCESSORY and FINGER refuse. A weapon in hand and a mount are fine | `db/lib/verbs/self.js#equipOneTag` (both faces) |
| The face and the appearance text are fixed; the Bio card says so instead of offering them | `character/actions.js`, `BioForm.js`, `AvatarField.js` |
| Hungerless (the existing tag) — never hungry, food does nothing | `db/lib/hunger.js`, unchanged |
| Only the Skinless desires: the tag locks every other family | `docs/tags.yaml` + `docs/desires.yaml` |
| No belief from the store; never a Rite of Conversion candidate; a GM's threat Assign refuses | `store/actions.js`, `riteIngredients.js#convertCandidates`, `threatActions.js#assignThreat` |
| A butcher cuts a Skinless Brain out besides the usual | `character/actions/corpse.js` |
| Smell Skin (§4) | `db/lib/verbs/roles.js#smellSkin` |
| Grunts (§3) | `db/lib/strangers.js`, the Discord posters |
| Visible on a look | `visible: true` on the tag |

**Cave Eyes** is a real modifier, not a situational one: `fighting: { tree:
both, tiers: 1, when: { zoneKind: [CAVE_LEVEL] } }`. `zoneKind` is a new
`fighting.when` key (`db/lib/tagShapes.js`, `db/lib/fightingSkill.js`), true
while the holder stands in the Caves or the Depths. The sheet passes where the
player is standing. A surface that does not know (the GM desks) lists Cave Eyes
as situational rather than adding it.

**Hostility** is charter prose. There is no hostility system; fights are a GM's
to rule on (`ATTACK.md`).

## 3. Grunts

A Skinless's speech reaches anybody who is not a Skinless as grunts of about
the same length (`gruntify`, `db/lib/babble.js` with the Skinless's own
syllables). The grunts are **seeded by the row's `seq`**, so every reader and
both faces see the same ones.

- **The web** decides per reader in the lens (`strangers.js#createLens`):
  `prepare` reads which speakers hold the tag and whether the reader does, and
  `lensRow` swaps the content. A GM, the speaker, another Skinless and a
  SYSTEM row keep the words. A ghost hears grunts. Every browser surface goes
  through the lens: the stream, first paint, history, search, `/memories` and
  Highlights (`starNote.js` files what the reader heard).
- **Search** drops a hit whose lensed text no longer holds the words, or
  searching would translate the grunts.
- **Learning names** from a Skinless's line teaches only other Skinless
  (`memoryHearing.js#learnFromSpeech`).
- **Discord** shows one text to everybody, so a Skinless's line is posted as
  grunts (`discordTextFor`, in `proxy.js`, `feedOutbox.js` both for the post
  and an edit, and `roomRelay.js`). Each **other** Skinless present who types
  through Discord — whose own latest line was sent from there — is DMed the
  words (`relayWordsToSkinless`), with the speaker named as they know them. A
  Skinless on the web reads the words in `/chat` already and gets no DM
  (Bascinet's call). A Skinless's grunts relay no mentions.
- **Shouts, overheard whispers and the phone** carry grunts: a shout to
  everyone, the whisper leak to everyone, a phone line to everyone but a
  Skinless holding the far receiver.
- **Deadchat** is out of character, so a dead Skinless speaks plainly there.

## 4. Smell Skin

A role button on the sheet (`actionRegistry.js`, SKINLESS section, hidden for
anyone without the tag) and `/smell` on Discord (`actionCatalog.js`; the command
name gives nothing away). It counts the hops, over every way the way a shout
does (`locationGraph.js#soundRange`), to the nearest living character without
the tag, and answers `smellSkinLine`. Free, unlimited, and tells nobody else.

## 5. What it does not touch

- **The decoy.** `db/lib/threats.js` has an antagonist opt-in named
  "skinless" among its decoys. It is unrelated and left alone.
- **Monster Skinless.** The Depths hunt still brings back a Skinless Corpse
  (`CORPSES.md`). A dead Skinless *player* leaves an ordinary custom corpse,
  and the brain comes from §2's butcher rule.
- **Roles do not sync on deploy.** A running game needs `npm run db:sync-roles`
  once after this ships, or the fate has no Role row and the panel says so.
