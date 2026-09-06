# The Hall, phase by phase

The per-phase build specs for `/play` (design in [HALL.md](HALL.md)). Phases 0–5 shipped 2026-09-06; a phase is deleted from here once HALL.md describes it. Internal reference, not game text.

## Phases 1–6: the rest (approved 2026-09-06, "just finish the rest")

Sequential Opus workers, one at a time in the main tree (another session holds
uncommitted edits in `db/lib/roomAccess.js`, `channelDoctor.js`, `locationMove.js`
and `bot/src/events/interactionCreate.js`; workers touch those only where a phase
says so, and the orchestrator stages by hunk). Every phase ends with lint, build,
`node --check` on bot/db files, a report, then the orchestrator's review, a
production check, commit, push. Migrations are hand-written SQL; folder names follow
`20260911070000_…` upward. `docs/systemdocs/HALL.md` is updated by the phase that
changes what it describes. Every player-visible string ends in ‡.

### Phase 6: typing, markdown, the wipe, mentions, the GM view

- **Typing.** `GuildMessageTyping` intent in `bot/src/index.js`; a `typingStart`
  handler maps user → ALIVE character → place key and `NOTIFY bascinet_typing`
  `{ placeKey, characterId }`. `POST /api/feed/typing { place }` does the same from
  the web, at most every 4 s per tab. The hub fans `event: typing` to that place's
  streams with the **presented** name resolved server-side. The client shows "X is
  typing… ‡", "X and Y are typing… ‡", "Several people are typing… ‡" for 6 s after
  the last event, never for the viewer's own character.
- **Markdown.** `web/app/components/ChatMarkdown.js`: `react-markdown` +
  `remark-gfm` + `remarkTokens` + a small remark plugin for `||spoiler||` (click
  to reveal), `-#` subtext lines, and quoted speech: any `"…"` span becomes
  `<span class="speech">` coloured by a new `--speech` token declared in every
  theme block (a warm lift of `--text`; gate it at AA with the audit). Parsed once
  per row on arrival (store the tree, not the string). `MarkdownContent` stays for
  DMs.
- **Mentions.** Composer `@` autocomplete over `whosHere().named`; inserts
  `{char:<id>}`; `CharacterMentionsProvider` mounted on the Play page with that
  roster so the chip renders; the outbox rewrites `{char:<id>}` to `<@&roleId>`
  for Discord (renders as a chip, notifies nobody, per PROXYING §6) and calls the
  relay DM path (`bot/src/lib/mentions.js#notifyMentioned`) for web-origin rows;
  Discord-origin `<@&roleId>` is rewritten to `{char:<id>}` in `prepareSpeech`.
  A mention chime on the web via `chime.js`, muted by its own `hall-chime-muted`
  key.
- **The dawn wipe.** `GameConfig.feedWipeSeq BigInt @default(0)`; `runDawnWipe`
  sets it to the current max seq; `placesFor` feeds and the catch-up read `seq >
  feedWipeSeq` when `messageWipeEnabled`; the `#summary` and `wipe: clear`
  channels follow the same watermark since their rows share it.
- **GM view.** The player desk's inspector gains a **Scene ‡** tab: the `Feed`
  component read-only on the character's current Location and Rooms, through the
  same stream (the GM gate from phase 2).
- **Deferred, on purpose:** Web Push (needs VAPID keys, a service worker, and iOS
  install guidance — its own change), attachments, a Discord-side "Bascinet is
  typing" echo.

