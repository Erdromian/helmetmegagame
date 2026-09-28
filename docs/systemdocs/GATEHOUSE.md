# The gatehouses

Bascinet's `E:\Bascinet\V3\Fates\Incarn and gates.docx` reworks both of
Ravenheart's gatehouses. This doc is how it was built. Where it and the
design doc disagree, the design doc wins and this one is the bug.

## 1. The two gates

**The Keep's gatehouse is the Courtyard** (`fortress-2`). Its rooms stay (Gate,
Yard, Watchtower). The portcullis between it and the Residences (`town-8`) is
still the one way up into the Fortress, still manned (`announce: true_name`),
and now worked from **both Locations**: a gate button on each anchor and on
each place card in `/chat`, drawn for everybody. It moves only for a worn,
registered ring carrying `portcullis-key` — the Baron's, the Hand's, the
Meister's, the Cerberi's, the Squires' and the Censor's. Anybody else who
presses it reads "Nothing happens." The Watchtower no longer works it.

**The Town Gatehouse** (`town-1`) keeps its name and stops being the road out.
Its way to the Bridge is gone. Instead the **Bridge and the Square are joined
by a gate** — manned, modular, the only way between the Town and the Black
Hills (`db/lib/gateBypass.js` holds it to that) — whose **lever is in the
Gatehouse's Gate Controls**. The lever has no lock of its own: anybody in the
room may pull it (the doc). When it moves, the gate sound plays and a line is
posted in the Gatehouse, the Bridge and the Square. While it is open, anybody
may walk through; while it is shut, the way through is to **request passage**.

The way from the Square into the Gatehouse is `locked: gatehouse-key`: the
Baron's, the Hand's, the Incarn's, the Cerberi's, the Squires' and the Censor's
rings.

`db/lib/gateControls.js` names both shapes (MAP.md §2a): an **anchor gate** and
a **remote lever**. Everything else about a modular gate — the watchtower's
winch, the echo through the bars, the announcement — is as it was.

The map marker for the Town Gatehouse moved one cell west in PR #257, which
was this doc's "shift 1 tile to the left".

## 2. The Town Gatehouse's rooms

| Room | Slug | Opens onto | What is in it |
|---|---|---|---|
| Gate | `town-1-1` | the Gatehouse, and the **Bridge** (public) | Request Passage (inward, from the Bridge side only); Submit for Documentation (either side) |
| Gate Controls | `town-1-2` | the Gatehouse | the lever; Process Requests (gatehouse-key ring); Create Documents (anybody); a phonebook |
| Incarn's Chambers | `town-1-3` | the Gatehouse | `access: [incarns-key]` |
| Gatehouse Window | `town-1-4` | the Gatehouse, and the **Square** (public) | Request Passage (outward, from the Square side only) |

Gate Controls is the old Watchhouse row, renamed, with its access list cleared
(getting into the Gatehouse is the lock) and its shortbow and spear gone. The
two windows are multi-locational rooms (MAP.md §2d): the people inside can talk
to the people outside, and both sides' HERE columns list each other. Request
Passage is drawn only on the **outside** of each window — `sides: true` on its
affordance, so it can draw on a side's copy of a room at all — because nobody
asks to pass from inside the gatehouse.

Incarn's Chambers had no description in the doc; the one in `docs/zones.yaml`
was drafted.

## 3. Request Passage

`db/lib/gatehouse.js#requestPassage`. A request is some text plus anything the
asker offers from what they hold. **Nothing is taken when it is made.** The
offer is a list of `{ tagId, quantity }` on the `GatePassage` row, re-read
against what the asker actually holds every time it is shown or processed, so
a thing dropped or stolen in between simply drops out of it (the doc: "they
become absent from the request").

- IN from the Gate on the Bridge side, OUT from the Window on the Square side.
- One waiting request a character; sending another replaces it.
- **Leaving withdraws it.** `db/lib/locationMove.js#applyArrivalFacts` deletes a
  PENDING row whenever its owner changes Location — walking, a teleport, a rite,
  anything. An approval resolves the row before it moves anybody.

## 4. Process Requests

`processView` / `approvePassage` / `denyPassage` / `pourMagma` /
`passageHistory`. Gated on a **worn ring carrying `gatehouse-key`**
(`rings.js#wornRingAccess`: a key in a pocket does not count), and on standing
in Gate Controls.

The list is grouped **Into Ravenheart** and **Out of Ravenheart**; each row is
the asker as the clerk sees them (`intercept.js#seenByIdMany` — a stranger is
"a young man", STRANGERS.md), their text, and their offer as it stands now.

- **Approve** opens a second screen: take what you want from the offer, and
  add anything of your own to hand over — the doc's bribes and documents. On
  confirm, in one transaction: the kept stacks move to the clerk, the given
  stacks to the asker (one ledger row each, giver to taker), and the asker is
  **moved through the gate**: into the Square, or out onto the Bridge. It is a
  relocation, so it spends no Move, but the arrival is announced as the manned
  gate's would be. What is left in the offer was never taken, which is the
  doc's "given back". The asker is DM'd.
- **Deny** moves nothing and DMs "You were denied access through the gate."
- **Magma** kills and **gibs** everybody waiting to come **in**, never anybody
  asking to leave, after a confirm with the doc's words. Once a turn:
  `GameState.gatehouseMagmaTurnId` is claimed before anybody dies, so a double
  press cannot pour twice. The Bridge hears it.
- **History** (the corner button): everything decided, newest first — who
  asked, which way, what they said, the outcome, what changed hands, and whose
  ring the clerk was wearing (`GatePassage.resolvedByRing`, a snapshot).

## 5. Documents

**Submit for Documentation** is the finger-prick in the Gate: a confirm, then a
`GateDocumentation` row. Refused if the terminal already knows your blood — you
hold a treasury account — or your sample is already waiting.

**Create Documents** in Gate Controls is anybody's (the doc). It shows the new
submissions (as the clerk sees them: a sample is only blood) and the
**register**: everybody with a registered ring, and everybody documented, by
name, occupation and account. Real names, the treasury's own ring register's
posture (STRANGERS.md §7).

Approving a submission, with a name and an occupation the clerk writes:

1. opens a **TREASURY account** in that name, owing **-10 ¢** of processing
   fees (reason `DOCUMENTS_FEE`, ECONOMY.md);
2. prints the **Documents** into the clerk's hands — name, occupation, account
   and PIN — to be handed over at the gate like anything else;
3. writes `documents_issued` to the audit log and a line to the archive. The
   terminal itself keeps no log of it (the doc) — see §6.

Documents are `paperKind: DOCUMENTS`: fixed text, behind the literacy gate like
any paper, and nothing writes on, seals or pins them. They cannot be worn. At an
infoterminal they open their account for whoever holds them, on the ring's PIN
rule (RINGS.md §5) — the PIN is written on them, so stolen papers are as good as
the PIN to anybody who can read.

**Once a character.** Approval is refused while the character holds any
treasury account. The Meister's **Close account** on `/treasury`
(`depotCounter.js#closeAccount`) writes the balance off (`ACCOUNT_CLOSED`) and
deletes the account; the old papers then open nothing, and the character can be
documented afresh.

**Negative balances.** `bankAccounts.js#bumpBankAccount`'s floor is never above
where the account already stands: a deposit into -10 lands at -7, and a
withdrawal or a send from a negative balance moves nothing. Only the fee passes
a lower floor.

**Migrants no longer start with an account** (`docs/roles.yaml`): the
Gatehouse opens one when it documents them. The migration deleted the untouched
accounts living Migrants already had — empty, ringless, never used.

## 6. What is recorded

The doc says document creation is logged in the audit log and the archive and
nowhere in the terminal. The same holds for **everything done at the
controls**: the lever, the portcullis buttons, Approve, Deny, Magma, printing
and refusing Documents.

**The audit log** (`/gm/audit`, the **Gates** family in
`web/lib/auditNarrative.js`):

| Action | Written by |
|---|---|
| `gate_opened` / `gate_closed` | `toggleGate` — any gate; the lever's rows name Gate Controls |
| `gate_passage_requested` | Request Passage |
| `gate_passage_approved` / `gate_passage_denied` | the terminal, with what moved and the clerk's ring |
| `gate_magma` | the terminal, with who died |
| `documentation_submitted` | the finger-prick at the Gate |
| `documents_issued` / `documentation_denied` | Create Documents |
| `treasury_account_closed` | the Meister's Close account |

Every row done at the controls carries `locationId` and `roomId` (Gate
Controls), so the room filter finds them.

**The archive** gets one `ArchiveKind.GATEHOUSE` row per act, in real names —
"Aurelia Vane let Tomas Reed into Ravenheart. Took: Obol ×8." It is written
with **no `placeKey`**, so it reaches no feed: a bystander in the room hears the
gate move but never reads the clerk's decisions, and the terminal keeps no log.
`/archive` folds them as "n at the gate" under **Everything**. The PIN is never
written. The Den's shutters (`toggleGate` from a watchtower) are audited but
not archived; only the gatehouse's two gates are.

The Oracle sees neither: `gate_*` is not on `db/lib/oracleAudit.js`'s
allowlist and `GATEHOUSE` is not in `oracleInput.js`'s beat kinds.

## 7. The two faces

| | Web (`/chat`) | Discord |
|---|---|---|
| Request Passage | dialog: text and a picker with quantities | modal for the text, then a select of whole stacks |
| Submit for Documentation | the shared confirm | a confirm button |
| Process Requests | dialog: grouped radio list, Approve screen with two pickers, History in the header | panel: a select of requests, Approve (two selects of whole stacks), Deny, Magma, History |
| Create Documents | dialog: each submission with Name and Occupation, the register as a table | panel: a select of submissions, then a Name/Occupation modal or Deny |
| The lever, the portcullis | gate buttons (the lever in Gate Controls' room panel, the portcullis on both place cards) | `loc:gate:` buttons on the Gate Controls starter and on both anchors |

Web: `web/app/(app)/chat/GatehouseDialogs.js` and `gatehouseActions.js`.
Discord: `bot/src/events/interactions/gatehouse.js`. Every rule is in
`db/lib/gatehouse.js`, and every line a player reads is in
`db/lib/gatehouseText.js`.

## 8. Where the code lives

| | |
|---|---|
| `db/lib/gatehouse.js` | requests, the terminal, magma, documents, and the Discord half after a write (`finishGatehouse`) |
| `db/lib/gatehouseText.js` | every word, and the slugs (zero requires) |
| `db/lib/gateControls.js` | the anchor gate and the remote lever |
| `db/lib/gates.js#toggleGate` | the ring check, the lever's room check, the Gatehouse hearing the lever |
| `db/lib/placeAffordances.js` | the buttons, and `sides: true` |
| `db/lib/depotCounter.js` | Documents at the infoterminal; `closeAccount` |
| `db/lib/paperMint.js#mintDocuments` | the paper |
| `db/prisma/migrations/20261113000000_gatehouse_rework` | the tables, and the geography on a running game |
| `db/test/gatehouse.test.js` | the rules, the map, and the whole flow against Postgres |
