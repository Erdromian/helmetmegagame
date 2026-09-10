// The Oracle's run: six correspondents and an editor, once per turn.
// See docs/systemdocs/ORACLE.md.
//
// Called from db/lib/turnSideEffects.js, NOT from a TURN_PASSES entry. That is
// load-bearing and the reason is worth keeping next to the code: a pass runs
// inside resolveNeeds()'s serial loop, gates needsResolvedAt, and is awaited
// inline by the bot's cron, so a pass that spends two minutes on an HTTP call
// holds the whole turn advance open and blows the 15s transaction timeout on
// the way. TURN-ENGINE.md states the rule outright — passes return data and
// never make network calls.
//
// The thunk is where slow, retryable, non-database work belongs, and its step()
// gives this run per-zone resumability for free.

const { complete } = require("./oracleClient");
const { correspondentPrompt, editorPrompt, splitEditorReply } = require("./oraclePrompts");
const { loadTurnMaterial, zoneBlock, linkCharacterTokens } = require("./oracleInput");

// Whether a run is even possible. Checked at RUN time rather than baked into
// the side-effect payload, so enabling the Oracle between the advance and the
// resume does the obvious thing.
function oracleReady(config) {
  return Boolean(config?.oracleEnabled && config?.oracleApiKey && config?.oracleModel);
}

// The zones a correspondent is written for: the seat zones, the same set
// listSelectableZones() offers a GM. That is not a coincidence — it is the
// granularity GmZoneView filters at, so one page per seat zone is exactly one
// page per thing a GM can be scoped to.
function seatZones(prisma) {
  return prisma.zone.findMany({
    where: { gmRoleId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

// The last N turns of pages for one scope, oldest first, as context.
//
// Reads `body`, which is the EDITED text when a GM has rewritten it. That is
// the entire correction mechanism: there is no regenerate, so a page a GM fixed
// is what the next turns are told, and a page nobody touched carries forward as
// drafted.
async function memoryFor(prisma, { turnNumber, zoneId, take }) {
  if (!take || take < 1) return [];
  const rows = await prisma.oracleSynopsis.findMany({
    where: { zoneId: zoneId ?? null, turn: { number: { lt: turnNumber } } },
    orderBy: { turn: { number: "desc" } },
    take,
    select: { body: true, turn: { select: { number: true } } },
  });
  return rows.reverse().map((row) => `[turn ${row.turn.number}]\n${row.body}`);
}

// Write one page. Upsert rather than create: a resume that reaches a zone whose
// step was recorded but whose row somehow is not should heal rather than throw,
// and a "Run now" over an existing turn should replace its own draft.
//
// editedAt/editedBy are deliberately NOT cleared here — see the caller, which
// refuses to overwrite a page a GM has rewritten.
function writePage(prisma, { turnId, zoneId, body, threads, config, usage }) {
  const data = {
    body,
    threads: threads ?? undefined,
    provider: config.oracleProvider,
    model: config.oracleModel,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
  return prisma.oracleSynopsis.upsert({
    where: { turnId_zoneId: { turnId, zoneId: zoneId ?? null } },
    create: { turnId, zoneId: zoneId ?? null, ...data },
    update: data,
  });
}

// A page a GM has rewritten is theirs. Neither a resume nor a Run now may
// silently replace it — the edit IS the correction, and losing one would make
// the only correction mechanism unreliable.
async function isEdited(prisma, turnId, zoneId) {
  const row = await prisma.oracleSynopsis.findUnique({
    where: { turnId_zoneId: { turnId, zoneId: zoneId ?? null } },
    select: { editedAt: true },
  });
  return Boolean(row?.editedAt);
}

// One zone's page. Returns nothing useful — the row is the output.
async function runCorrespondent(prisma, { turn, zone, material, config, aggregatesSeen }) {
  if (await isEdited(prisma, turn.id, zone.id)) return;

  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: zone.id,
    take: config.oracleMemoryTurns,
  });
  const block = zoneBlock(material, zone, { aggregatesSeen, memory });

  const result = await complete(config, {
    system: correspondentPrompt(config),
    user: block.text,
    maxTokens: 1200,
  });

  await writePage(prisma, {
    turnId: turn.id,
    zoneId: zone.id,
    // {char:Ada Vance} -> {char:<id>|Ada Vance}, and a name nobody answers to
    // loses its braces rather than becoming a link to the wrong person.
    body: linkCharacterTokens(result.text, material.characters),
    config,
    usage: result,
  });
}

// The front page. Reads the six zone pages back OUT OF THE DATABASE rather than
// taking them from the correspondents' return values, so a resume whose zone
// steps ran in a previous process still has something to edit.
async function runEditor(prisma, { turn, config, characters }) {
  if (await isEdited(prisma, turn.id, null)) return;

  const pages = await prisma.oracleSynopsis.findMany({
    where: { turnId: turn.id, zoneId: { not: null } },
    select: { body: true, zone: { select: { name: true } } },
  });
  if (pages.length === 0) return;

  const memory = await memoryFor(prisma, {
    turnNumber: turn.number,
    zoneId: null,
    take: config.oracleMemoryTurns,
  });

  const user = [
    memory.length ? `PREVIOUS FRONT PAGES\n${memory.join("\n\n")}` : null,
    `THIS TURN (${turn.number})`,
    ...pages.map((page) => `## ${page.zone?.name ?? "Elsewhere"}\n${page.body}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await complete(config, {
    system: editorPrompt(config),
    user,
    maxTokens: 1200,
  });

  const { body, threads } = splitEditorReply(result.text);
  await writePage(prisma, {
    turnId: turn.id,
    zoneId: null,
    body: linkCharacterTokens(body, characters),
    threads,
    config,
    usage: result,
  });
}

// The whole run. `step` is turnSideEffects.js's — one key per zone plus one for
// the editor, so a crash re-runs only what never finished. When called from
// anywhere without a ledger (the panel's Run now), pass a step that just calls
// through.
//
// Every failure path here is a return, never a throw: step() already swallows,
// but a turn must not depend on that for its correctness.
async function runOracle(prisma, { turnId, step }) {
  const config = await prisma.gameConfig.findFirst();
  if (!oracleReady(config)) return { ran: false, reason: "The Oracle is off or unconfigured." };

  const turn = await prisma.turn.findUnique({
    where: { id: turnId },
    select: { id: true, number: true, startedAt: true },
  });
  if (!turn) return { ran: false, reason: "No such turn." };

  const zones = await seatZones(prisma);
  if (zones.length === 0) return { ran: false, reason: "No seat zones." };

  const material = await loadTurnMaterial(prisma, turn, { includeChat: config.oracleIncludeChat });

  // Shared across the six calls so a once-per-turn line lands in one zone's
  // input rather than all six. Sequential rather than parallel for the same
  // reason: the set is only meaningful if the zones are built in order.
  const aggregatesSeen = new Set();
  for (const zone of zones) {
    await step(`oracle:${zone.slug}`, () =>
      runCorrespondent(prisma, { turn, zone, material, config, aggregatesSeen }),
    );
  }

  await step("oracle:editor", () => runEditor(prisma, { turn, config, characters: material.characters }));
  return { ran: true, zones: zones.length };
}

module.exports = { runOracle, oracleReady, seatZones, memoryFor };
