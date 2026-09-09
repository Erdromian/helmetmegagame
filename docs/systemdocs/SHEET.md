# The character sheet (`/character`)

The sheet is `/character`, and `web/app/components/CharacterSheet.js` is the
component that draws it. There used to be two — a page of chips and an icon
rack at `/character`, and a rebuilt workspace at `/ledger` being judged against
it. The rebuild won. The old sheet and its panels are deleted, and `/ledger` is
a one-line permanent redirect to `/character` so old links and bookmarks still
land (`web/app/(app)/ledger/page.js`).

Everything it draws is built once by
`web/app/(app)/character/page.js#FreshCharacter`, which resolves one of four
`kind`s — a closed door, the lobby, the creation wizard, or the sheet — and
`CharacterView.js` picks the component. The other three are ordinary
`PageShell` pages; only the sheet is the workspace below.

## 1. The frame

**It is an ordinary scrolling page.** One scrollbar, the document's: the band
scrolls away with everything else, the three columns grow to fit their cards,
and reaching the bottom of the tag rail is the same gesture as reaching the
bottom of any other page. It was built the other way first — a `100dvh`
`.sheet-shell` over three independently scrolling columns, the way Chat still
works — and that was wrong for a sheet: nothing on it arrives while you read,
so nothing had to be pinned. The shell class is gone entirely.

`web/app/(app)/character/layout.js` draws the shared `AppHeader`
(`web/app/components/AppHeader.js`) and nothing else around `{children}`. The
header is a person rather than a page name — titled with the character's name,
their role and faction as the meta line — and its actions are the avatar plus
**← Back to the game · Esc**, a link to `/play`. The turn chip is `AppHeader`'s
own `TurnMeta`, the same one every other page gets.

The Back link and the Escape listener are drawn **only when there is a living
`ALIVE` character** (`loadHeaderIdentity()`, the same question that decides
`kind === "sheet"`) and only when the Play page is on
(`GameConfig.playPanelEnabled`), since `/play` would just bounce back. That
gate matters: a player halfway through the creation wizard pressing Escape
means "close this", not "leave".

**Escape goes back to the game.** `character/EscapeToPlay.js` listens on
`window` in the *capture* phase and stands down when a dialog holds the
keyboard (`Modal.js#dialogHoldsKeyboard`), when a field has focus (it blurs
it instead), or when a floating thing is open — a pinned tag panel, a click
menu, a `Select` popup — whose own handler closes it on the same keypress.
Capture, because those handlers sit on `document` and React flushes their
close before a bubbling `window` listener runs; by then the menu was gone
and the page navigated out from under a player who meant to close a menu.
The `/play` snapshot (`CHAT.md` §5c) paints in the first frame, which is what
makes it feel immediate.

Inside, `.sheet-body` is the band, then `.ledger-body`: three columns
(`18rem / 1fr / 22rem`). Under 1180px the rail folds under the working column;
under 820px the three columns become three tabs, **You / Do / Tags**, a
`.tab-bar` keyed on `data-tab` in CSS with no JS media query. Only the widths
change at those breakpoints — the scrolling is the same at every size.

## 2. The band (`LedgerBand.js`)

Who this is, where they stand, and:

- **The status strip** — Chat's own `play/StatusStrip.js`: ⬢, the carry
  line, every Status and Health tag. On the sheet it takes `onPick`, and a
  clicked chip opens the tag's `TagDetails` under the strip. The rail has no
  Status card for that reason.
- **Five tiles** — free moves, ⬢ against the cap, carrying with the meter,
  the **Mood box** (`MOOD.md` §4), the Gambit modifier
  (`db/lib/gambitModifier.js`, the same call the bot makes). Two of them have
  something to say and are buttons for it — free moves (why it is 0) and the
  Mood box (what moves a mood); their detail reads under the row of tiles,
  where a native `title=` used to be, and they share the one paragraph. The
  other three are numbers and do not press. Carrying opened a breakdown of
  what holds its cap up until that came off: one pressable tile in a row of
  read-only ones read as a bug.
- The Mood box opens its line **on hover as well as on click** — a request,
  not an exception: it is still the same on-page line, and there is still no
  tooltip. It is also the one tile whose value is a word rather than a number,
  so it drops `--font-mono` and takes its colour from a `data-tone` (Fine
  grey, Panicking `--danger`) instead of the `data-over` the others use.
- **This turn** — Chat's `TurnCard` + `MoveDialog`, wrapped in
  `SheetTurn.js`, over the same `play/actions.js#myMove` and the same minute
  poll (`play/useMyMove.js`, which `YouPanel.js` shares). File or edit the
  Move from here; a pending lesson or binding reads under it. The turn chip
  and the **Move…** button sit on ONE line — `.sheet-turn .chat-move` is a
  wrapping flex row, and the button keeps its natural width instead of
  stretching into a bar that doubled the box's height. A Move already filed
  breaks the line and takes the full width under the chips, because it holds a
  paragraph of somebody's own words and a clamp that opens. The rules are
  scoped to `.sheet-turn`: `/play`'s YOU column draws the same `TurnCard` and
  is deliberately untouched.
- **Turn Effects** (`TurnForecast.js`) — the turn passes read forward
  one step, as ONE wrapping line separated by `·` rather than a list, and with
  no full stops: four short clauses down a column made the box taller than the
  turn card beside it. Past three items the rest fold behind a `+N more`,
  decided by counting them and never by measuring the box (`ExpandableText.js`
  explains why). It reads: tags on their last turn and what they become (`expiresInto`),
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

The header holds **Spend Tag Points** (the store modal) and the filter box:
name, description or group; a card with nothing left hides while a query is
set.

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

## 6. The `ledger` names are kept on purpose

`LedgerBand.js`, `LedgerWork.js` and every `.ledger-*` class are named after
the route this sheet was built on. The route is gone; the names stay. Renaming
them is a few hundred lines of mechanical churn across the components and
`globals.css` for no change in behaviour, and every rename of that size is a
chance to break one selector nobody notices until a player opens the page.
Same reasoning CLAUDE.md gives for keeping the Lifeweb names: **a
`grep -i ledger` hit in this area is not a bug.** `SheetTurn.js`,
`TagRail.js`, `EquipBoard.js` and the `.sheet-*` classes are the ones that
were always named for the sheet, and they keep those names too.
