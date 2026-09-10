# The Oracle — a written record of each turn

At turn close a gamemaster has no readable account of what just happened. What
exists is the raw material: ninety-odd `Action` rows, a few hundred `AuditLog`
gestures and thousands of chat lines spread across Location channels. Nobody
reads that, so most of what players did is never seen by the people
adjudicating.

The Oracle writes it down. Six correspondents, one per zone, each handed only
their own zone's material; then an editor, which reads all six and writes the
front page. It costs about a cent a turn.

It is **off by default** (`GameConfig.oracleEnabled`) and configured at
`/gm/dev?s=oracle`, which is superadmin-only. The desk that reads it,
`/gm/oracle`, is open to every GM — unless the **Playtest** switch is on, which
narrows it to superadmins while the thing is being tried out (§12).

## 1. Why it is shaped this way

Two assumptions turned out to be wrong, and the architecture is what is left
once they are removed.

**Cost is not a constraint.** The dense input tier — moves, the two live tag
categories, the filtered audit log, for ninety players — is about 34,000 tokens
a turn. On a cheap model that is well under a cent, roughly 50p for a
thirty-turn game. Including the entire chat transcript is closer to 650,000
tokens and still only a few pounds a game.

**Context is not a constraint either**, at least not the way it was assumed to
be. So the sharding is not a workaround for a window that is too small; it is
chosen, and for two reasons that survive any model:

- **A correspondent holding one zone writes a tighter page** than one asked to
  cover the whole map at once.
- **The shard boundary is the `GmZoneView` boundary.** One page per seat zone
  is exactly one page per thing a GM can be scoped to.

The second one has a limit worth stating plainly: `GmZoneView` on the desks is
**a view, not enforcement** — the server ships every row and the rail filters
it (`GAMEMASTERS.md` §1). The Oracle follows that convention rather than
breaking from it, so generating per zone makes stricter scoping *possible*
later; it does not by itself prevent anything.

The happy side effect of sharding is that **no single call is large**, so
swapping provider or model later costs nothing.

## 2. Where it runs, and where it must not

**Not a `TURN_PASSES` entry.** That is the obvious guess and it is wrong three
times over:

- A pass runs inside `resolveNeeds()`'s serial loop, and every name in
  `TURN_PASSES` (`db/index.js:194`) must record before `needsResolvedAt`
  stamps. A pass that spends two minutes on an HTTP call holds the whole
  advance open.
- The cron awaits `advanceTurn()` inline (`bot/src/lib/turnEngine.js`), so a
  slow pass blocks the bot process itself.
- The shared client runs `transactionOptions: { timeout: 15000 }`
  (`db/index.js:81`), already raised because auto-labor contends for pool slots
  at exactly this moment.

`TURN-ENGINE.md` states the rule outright: *nothing above this line talks to
Discord; nothing below it touches the database.* Passes return data and never
make network calls, precisely so none can hold a turn advance open.

**It runs in the side-effect thunk** (`db/lib/turnSideEffects.js`), last, after
everything a player might notice has already gone out. A DM that arrives late
is a bug; a synopsis that arrives late is a synopsis.

The grain there is already right. `step(key, fn)` records a key only once its
function returns, so **one key per zone** — `oracle:town`, `oracle:fortress`, …
plus `oracle:editor` — means a crash re-runs only the pages that never
finished. `resumeTurnSideEffects()` is called both by the thunk itself and by
the bot on every reconnect, so a dead deploy retries with no new machinery.

**A failure there can never fail the turn.** `runOracle` returns a reason
rather than throwing, `step()` swallows what it cannot, and the call site adds
a `.catch` on top of both. That belt-and-braces is deliberate: the turn's
correctness must not depend on the Oracle's error handling being right.

## 3. What it is allowed to see

| Block | Source |
|---|---|
| Moves | `Action` — description, `moveKind`, `diceRoll` **and** `diceModifier`, `resourceDelta`, `locationId`, `laborTier`, review status |
| Tags | `CharacterTag`, filtered to categories `health` and `status` |
| Events | `AuditLog`, filtered — §4 |
| Beats | `ArchiveEntry` of kind DEATH, CHARACTER_CREATED, DESIRE_FULFILLED, LIFEWEB, TRAVEL |
| Chat | `ArchiveEntry` of kind MESSAGE, only when `oracleIncludeChat` |

`db/lib/oracleInput.js` is the whole of that access, on purpose: what a
correspondent may see is a question with a right answer, and it should be
answerable by reading one file.

Three things there are easy to get wrong.

**The turn window is derived, not read.** `AuditLog.turnId` is NULL on most
rows — the column exists for the per-turn rations and is not a general "which
turn was this" stamp. `/gm/audit` derives the same way. Filtering audit rows on
`turnId` would return almost nothing, and read as a quiet turn rather than as
the bug it is.

**Only two tag categories.** A character's Beliefs and Skills are bought at
creation and never move, so shipping all of them every turn pays repeatedly for
a constant and crowds out the moves. Health and status are the two that change.
Everything else reaches the Oracle as a *change*, through the audit lines.

**Both faces of a hood.** A concealed character is written
`Bram Holt (seen as "a young man")`. Writing only the true name hides that a
disguise was in play; writing only the alias makes somebody impossible to
follow across turns. Since this is a GM surface, it gets both.

### One approximation, stated

**People are placed by where they stand now, not by where they stood during the
turn.** There is no per-turn position history to read: `LocationVisit` records
the *first* time somebody saw a place, and `ArchiveKind.TRAVEL` rows are off by
default and fire only on a zone crossing, so within-zone movement is recorded
nowhere at all.

Moves are unaffected — `Action.locationId` and `zoneId` are stamped at filing
time, deliberately, so a Labor filed on the Factory floor pays for the Factory
floor even if its author walked out afterwards. It is the **roster** and the
**audit lines** that are placed by current position.

At turn close, minutes after the turn ended, that is very nearly exact and is
the right trade against building a position log. It gets worse the further back
you go: a **Run now** over a turn from last week will group people by where
they stand today. Re-running an old turn is a debugging convenience, not a
supported way to backfill a chronicle.

## 4. The audit filter

`db/lib/oracleAudit.js`. An **allowlist** of about forty `actionType`s, not a
denylist — a new action is invisible to the Oracle until somebody decides it is
a story fact, which is the safe direction to fail: a missing line reads as a
quiet turn, an invented one reads as a hallucination.

Three shapes:

- **Included** — adjudication outcomes, caving, heals, loots, transfers,
  crafts, consumes, intercepts fired, escorts, name changes, Lifeweb feeding,
  desires, faction power shifts, deaths, arrivals.
- **Collapsed** — tag buys, adds and removes fold into one line per character.
- **Aggregated** — `hunger_resolved` and friends appear once for the whole
  turn, in whichever zone is built first, rather than once per character.

Everything else is dropped, which is most of the volume: the turn engine writes
a row per character per pass, so a hundred players' doings sit under thousands
of machine lines.

**This is not `web/lib/auditNarrative.js`.** That module renders a row into
React *segments* for `AuditFeed`, resolved against a DTO carrying a names map.
Reusing it would mean rebuilding that DTO inside `db/lib` to flatten it back
into a string, and `db/` cannot import from `web/` anyway. A model does not
need prose: `heal_character | Ada Vance -> Bram Holt | tagName: Splint` is
about as short as the English sentence and needs no renderer.

## 5. Names are resolved before they are stored

The model is told to write `{char:Ada Vance}`. What gets **stored** is the
canonical mention grammar, `{char:<id>|<Name>}`
(`db/lib/characterMentions.js`), rewritten by
`oracleInput.js#linkCharacterTokens` before the page is saved.

Resolving at write time rather than render time is what makes an invented name
harmless. A name no character answers to **loses its braces and becomes
ordinary prose**. So a model that hallucinates a person produces a sentence
about a stranger — never a live link to one, and never a link to the wrong one,
which is what matching loosely at render time would eventually do.

The two regexes cannot collide on the way: `characterMentions.js`'s `TOKEN_RE`
matches `[A-Za-z0-9_-]` only, so a name with a space in it is invisible to the
existing mention machinery right up until this function has finished with it.

## 6. The register

Encyclopedic. Plain, declarative, past tense, third person, no atmosphere and
no adjectives that carry judgement.

That was asked for, and it is also the best hallucination brake available: a
model told to write plainly and cite nothing but the rows it was handed has
very little room to invent, where one told to write atmospherically **must**
invent to comply.

Both prompts live in `GameConfig` and are edited from the panel, so the voice
can be tuned without a deploy — the same reasoning as `docs/handbook.md` being
read at runtime. NULL means "use the shipped default" in
`db/lib/oraclePrompts.js`, and a prompt matching that default is stored as NULL
rather than as a copy, so editing the default in a later deploy still reaches
anyone who has pressed Save.

The editor returns one document: prose, a bare `THREADS` line, then the
threads. Plain rather than JSON on purpose — a small model holds a flat shape
far more reliably than a nested one, and a malformed tail costs the threads
rail rather than the whole front page.

## 7. Memory, and the one correction

Every writer is shown the last `oracleMemoryTurns` turns of pages for its own
scope — three by default. That is what lets the Oracle say somebody has been
circling the gatehouse for three turns, which is the observation a GM cannot
get from a spreadsheet.

It reads `body`, which is **the edited text where a GM has rewritten one**.

That is the entire correction mechanism. **There is no regenerate.** If a page
is wrong, a GM rewrites it, and:

- the rewritten text is what later turns are told;
- `editedAt` is stamped and never cleared, so a later run or a Run now will not
  overwrite it (`oracle.js#isEdited`).

The cost of this design, stated plainly: **a page nobody notices is wrong
carries forward for three turns.** That was accepted deliberately in exchange
for not building a reroll. It makes prompt quality load-bearing in a way a
reroll would not, and it is the first thing to revisit after a few real turns.

## 8. The desk

`/gm/oracle`, a fifth desk beside `turns`, `players` and `audit`, under the
`(desk)` layout that already gates `isGm`. Three columns, the shape
`.desk-body` already provides: zone rail, one page, inspector.

**The right column is `web/app/components/InspectorColumn.js`** — the same
component the other two desks mount, with the same Sheet / Tags / Moves /
Archive / DMs tabs. Nothing about it is rebuilt. Clicking a name in the prose
asks it for the Moves tab through `requestedTab`, exactly the way the
adjudication desk's "Past moves" button does.

A name is a real `<button>`, not a styled span: it is a control, so it has to
be reachable by keyboard and announced as one. It is drawn inline with a dotted
underline rather than as a chip — a synopsis is prose, and a paragraph studded
with pills stops reading like one.

`OracleMarkdown.js` is the third renderer built on `MESSAGE_PLUGINS`, after
`MarkdownContent` (a DM) and `DocumentMarkdown` (a document): same plugins, its
own `richtoken` component. That is the established way to say "this surface
speaks the short token vocabulary and means something different by one of
them".

## 9. The API key

`GameConfig.oracleApiKey`, write-only in the panel: masked after saving, never
returned to a client, replaced rather than edited. An empty box means "leave it
alone", so an ordinary save cannot wipe the credential.

This is a **deliberate departure** from `DISCORD_TOKEN`, which lives in an env
var because it is a credential. The trade is that the provider and model can be
swapped without a deploy. The cost, stated so nobody discovers it later:

- **it is in every `pg_dump` in the backup bucket**, and
- **it must never enter an archive packet** — check `ARCHIVE.md`'s export
  column list before touching either.

`web/app/(app)/gm/dev/oracleActions.js` is the only module that reads it
outside a run, and it is a separate file from `actions.js` for exactly that
reason: "one function writes it, none reads it back to a client" is far easier
to keep true when it lives alone.

## 10. Where the code lives

| File | Role |
|---|---|
| `db/lib/oracle.js` | The run: correspondents, the editor, the memory, the edit guard |
| `db/lib/oracleInput.js` | The ONLY access to game state, and the name resolver |
| `db/lib/oracleAudit.js` | Which audit rows are story facts, and how one is written |
| `db/lib/oraclePrompts.js` | The two default prompts and the editor-reply parser |
| `db/lib/oracleClient.js` | The one outbound call — a timeout and a single retry |
| `db/lib/turnSideEffects.js` | Calls `runOracle`, last, passing its own `step` |
| `web/app/(desk)/gm/oracle/` | The desk, its markdown renderer, and the edit |
| `web/app/(app)/gm/dev/oracleActions.js` | Settings, the key, Test connection, Run now |
| `web/app/(app)/gm/dev/OracleForm.js` | The panel |
| `db/test/oracle.test.js` | The pure halves — the audit filter above all |

## 11. Things not built, and why

- **No regenerate.** §7.
- **No needs-a-ruling or quiet list.** Both were designed and cut; the
  `DESTRUCTIVE` set in `auditNarrative.js:332` is the ready-made priority seed
  if either is ever wanted.
- **Nothing player-facing.** The zone shards would make a per-zone rumour sheet
  nearly free, but it would need a far more restricted input tier than this
  one.
- **No Discord post and nothing in the archive packet.** Both were considered;
  neither is in v1.
- **No circuit breaker.** `db/lib/discordRest.js` has one because Discord is on
  the hot path of every request the game serves. This runs seven times a day.

## 12. The two switches

They answer different questions, which is why they are two columns and not one.

- **Enable** (`oracleEnabled`) — whether a chronicle is **written** at turn
  close. Off, the run returns a reason and no rows are created.
- **Playtest** (`oraclePlaytest`) — who may **read** one. On, `/gm/oracle` is
  superadmin-only.

So a turn can be drafted and reviewed before the other gamemasters ever meet a
page, which is the state this ships in: enable it, leave playtest on, read a
few turns, then take playtest off.

Playtest is **enforced in the page**, not merely hidden from the rail. Dropping
the nav item is presentation; the redirect in
`web/app/(desk)/gm/oracle/page.js` is the lock. That is the split
`playPanelEnabled` already uses for `/chat`, and the reason is the one CLAUDE.md
gives for every server action: a hidden control is a hint.
