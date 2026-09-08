# The character sheet (`/ledger`)

The second character sheet, and the one being built up. `/character`
(`web/app/components/CharacterSheet.js`) is still the first: a page that
scrolls, chips for tags, the icon rack of verbs. `/ledger`
(`web/app/components/CharacterLedger.js`) draws the same character as a
workspace. Both take the SAME prop bag, built once by
`web/app/(app)/character/page.js#FreshCharacter` — one load, two layouts, so
the two can never disagree about what a character is carrying. `/ledger`
passes its own snapshot `scope`, and nothing else differs on the way in.

## 1. The shell

`web/app/(app)/ledger/layout.js` owns the screen the way `play/layout.js`
does: a `.sheet-shell` (100dvh, no `PageShell`) under the shared `AppHeader`
(`web/app/components/AppHeader.js`). The header is a person rather than a
page name — titled with the character's name, their role and faction as the
meta line — and its actions are the avatar plus **← Back to the game · Esc**,
a link to `/play`. The turn chip is `AppHeader`'s own `TurnMeta`, the same one
every other page gets.

**Escape goes back to the game.** `ledger/EscapeToPlay.js` listens on
`window` in the *capture* phase and stands down when a dialog holds the
keyboard (`Modal.js#dialogHoldsKeyboard`), when a field has focus (it blurs
it instead), or when a floating thing is open — a pinned tag panel, a click
menu, a `Select` popup — whose own handler closes it on the same keypress.
Capture, because those handlers sit on `document` and React flushes their
close before a bubbling `window` listener runs; by then the menu was gone
and the page navigated out from under a player who meant to close a menu.
The `/play` snapshot (`CHAT.md` §5c) paints in the first frame, which is what
makes it feel immediate. Both the link and the listener are left out when the
Play page is switched off (`GameConfig.playPanelEnabled`), since `/play`
would only bounce back.

Inside the shell, `.sheet-body` is the band, then `.ledger-body`: three
columns (`18rem / 1fr / 22rem`) that each scroll on their own under the
pinned band. Under 1180px the body scrolls as one and the rail folds under
the working column; under 820px the three columns become three tabs, **You /
Do / Tags**, a `.tab-bar` keyed on `data-tab` in CSS with no JS media query.

## 2. The band (`LedgerBand.js`)

Pinned. Who this is, where they stand, and:

- **The status strip** — Chat's own `play/StatusStrip.js`: ⬢, the carry
  line, every Status and Health tag. On the sheet it takes `onPick`, and a
  clicked chip opens the tag's `TagDetails` under the strip. The rail has no
  Status card for that reason.
- **Four tiles** — free moves, ⬢ against the cap, carrying with the meter,
  the Gambit modifier (`db/lib/gambitModifier.js`, the same call the bot
  makes). A tile with something to say (why the free moves are 0, what holds
  the cap up) is a button; its detail reads under the row of tiles. It used
  to be a native `title=`.
- **This turn** — Chat's `TurnCard` + `MoveDialog`, wrapped in
  `SheetTurn.js`, over the same `play/actions.js#myMove` and the same minute
  poll (`play/useMyMove.js`, which `YouPanel.js` shares). File or edit the
  Move from here; a pending lesson or binding reads under it.
- **When the turn turns** (`TurnForecast.js`) — the turn passes read forward
  one step: tags on their last turn and what they become (`expiresInto`),
  crafts and builds that finish, the road's end, and dinner (the
  `hungerPass.js` rule: Hungerless owes nothing, a meal covers it, otherwise
  1 ⬢, 2 with Fast Metabolism, and short of that you go Hungry). Renders
  nothing on a quiet turn.
- **The verb strip** — `ActionGrid variant="strip"`: every action in
  `actionRegistry.js` as one wrapping row of small labelled buttons, sections
  split by a hairline. A gated verb is muted but clickable: clicking it writes
  the pool's `gateReason` (or "not now" plus the help sentence) to a line
  under the strip. The Trumpet joins the row when held.

## 3. The rail (`TagRail.js`)

One card per kind, one row per tag. `web/lib/sheetCards.js` is the pure half:
which card (the tag's category, Status excluded), the order inside it, the
sub-groups (the `TagGroup` a tag belongs to, with its colour from
`docs/taggroups.yaml`), and `rowValue()` — the one thing on the row's right,
picked in the order a player cares: turns left (in `--danger` on the last
turn), then pounds, then the armour word, then a carry or labor bonus, then a
stack count.

| Card | Order | Second line |
|---|---|---|
| Health | soonest to run out first | `→ Festering · cure 2 ⬢ · Medical (Basic)` from `expiresInto` and the requirement block |
| Skills | by family (TagGroup) | the next rung: the catalog tag whose `parentTagId` is this one, with its cost |
| Items | by kind, heaviest first; the header carries the total lb | — |
| Assets, General, Meta, Demoness | alphabetical | — |

`TagRow.js` is the row: click it and `TagDetails.js` opens inline beneath —
the same block `TagChip.js` shows on hover everywhere else, lifted out of it
so the two cannot drift. **Nothing on this sheet is a tooltip.** Bascinet's
rule for the surface, and the reason the strip, the tiles, the rows and the
rig all put their words on the page.

`RowVerbs.js` are the small buttons beside an Items, Assets or Health row —
Use, Equip/Unequip, Give, Destroy, Heal. The predicates are Chat's
(`play/thingRows.js#thingVerbs`, the same sets the Things drawer reads), the
handlers are the sheet's own dialogs through `RequestActionsProvider.open`
with the tag preselected, or `equipActions.js#toggleEquip`. Heal opens the
Heal dialog on yourself and that wound. Hidden until hover or focus on a
pointer device, always drawn on a touch one.

The header holds **Spend Tag Points** (the store modal, as on TagsPanel) and
the filter box: name, description or group; a card with nothing left hides
while a query is set.

## 4. The rig (`EquipBoard.js`)

The equipment rules are `TAGS.md`'s ("equipSlot / equipLayer /
twoHanded"): one thing per layer of Head, Body and Ride, one shield, three
hands, accessories uncapped. The board draws exactly that — a row per slot, a
cell per place, a two-hander spanning two hand cells, `Ride` only when
something to ride is held. A filled cell says the one fact worth a glance
(the armour words, "conceals you", a carry bonus, pounds) and carries ✕. An
empty cell is dashed and named; clicking it is a `ClickMenu` of what you
carry that fits there, and nothing fitting says so. The header is the
combined armour as words (`armorValue.js#combineArmor` → `armorWord`).

The rows are only as good as the catalog: slots and layers reach the database
through `npm run db:sync-tags`, which no deploy step runs, so a push without
it leaves every weapon, accessory and mount slotless and the board empty
(`TAGS.md`, "equipSlot / equipLayer / twoHanded").

Every click is `toggleEquip`, so a refusal — a second helm, a fourth hand — is
the server's sentence in `FormError` under the board. The `Ride` row goes
further and drops what `equipActions.js` would refuse anyway — a cart indoors,
a boat against a horse, anything at all with Motion Sickness — with a line in
the menu saying why. `ClickMenu.js` is the
portaled click menu that used to live inside `play/ThingsDrawer.js`.

## 5. What is not here

- **The Bio form is the form** (`BioForm.js`), unchanged, in the left column.
- No collapsing cards, no Traits/Drawbacks split — both were put to Bascinet
  and skipped.
- `/character` still draws chips (`TagsPanel.js`) and the old rack
  (`EquipmentPanel.js`, minus the slot denominator it no longer has). It is
  not touched by this work except where a mechanic changed under it.
