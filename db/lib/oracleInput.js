// Everything the Oracle reads, turned into one text block per zone.
// See docs/systemdocs/ORACLE.md.
//
// This module is the whole of the Oracle's access to game state, which is
// deliberate: what a correspondent may see is a question with a right answer,
// and it should be answerable by reading one file.
//
// Three things here are easy to get wrong and are each commented where they
// happen: the turn window is derived from startedAt and NOT from AuditLog's
// turnId, tags are filtered to the two categories that actually move, and a
// concealed character is written with both faces rather than one.

const { auditLinesFor } = require("./oracleAudit");
const {
  CONCEALMENT_TAG_FIELDS,
  forcedNameFrom,
  concealmentFrom,
  presentedIdentity,
} = require("./presentedIdentity");

// The only two tag categories worth re-reading every turn. A character's
// Beliefs and Skills are bought at creation and never move, so shipping all
// 699 tags' worth of catalog every turn would pay repeatedly for a constant —
// and crowd out the moves, which are the part that changes.
//
// Health and status are the two that DO move: injuries, the mood band, Tipsy,
// Ate Meal. Everything else reaches the Oracle as a CHANGE, through the audit
// lines, rather than as a standing fact.
const LIVE_TAG_CATEGORIES = ["health", "status"];

// ArchiveEntry kinds that are events rather than speech. These are already
// turn-stamped, which AuditLog rows are not.
const BEAT_KINDS = ["DEATH", "CHARACTER_CREATED", "DESIRE_FULFILLED", "LIFEWEB", "TRAVEL"];

// The turn's wall-clock window.
//
// It has to be derived, because AuditLog.turnId is NULL on most rows: the
// column exists for the per-turn rations and is not a general "which turn was
// this" stamp. /gm/audit derives the same way. Filtering audit rows on turnId
// would silently return almost nothing, which reads as a quiet turn rather than
// as the bug it is.
async function turnWindow(prisma, turn) {
  const next = await prisma.turn.findFirst({
    where: { number: { gt: turn.number } },
    orderBy: { number: "asc" },
    select: { startedAt: true },
  });
  return { from: turn.startedAt, to: next?.startedAt ?? new Date() };
}

// How the Oracle refers to somebody.
//
// ORACLE.md: real names, with the mask annotated. A GM reading this needs to
// know both that it was Bram and that the room did not know that — writing only
// the true name hides that a disguise was in play, and writing only the alias
// makes a character impossible to follow across turns.
function displayName(character) {
  const tags = character.tags ?? [];
  const presented = presentedIdentity(character, {
    forcedName: forcedNameFrom(tags),
    concealment: concealmentFrom(tags),
  });
  if (presented.name && presented.name !== character.name) {
    return `${character.name} (seen as "${presented.name}")`;
  }
  return character.name;
}

function liveTagNames(character) {
  return (character.tags ?? [])
    .filter((row) => LIVE_TAG_CATEGORIES.includes(row.tag?.category))
    .map((row) => (row.quantity > 1 ? `${row.tag.name} ×${row.quantity}` : row.tag.name));
}

// One Move as one line. diceRoll and diceModifier are kept apart in the schema
// on purpose — a GM must be able to tell a natural 5 from a modified one — so
// they are reported apart here too rather than silently summed.
function moveLine(action, name) {
  const bits = [`${name} | ${action.moveKind ?? "MOVE"}`];
  if (action.diceRoll != null) {
    const modified = action.diceRoll + (action.diceModifier ?? 0);
    bits.push(
      action.diceModifier ? `die ${action.diceRoll} -> ${modified} (${action.diceModifier})` : `die ${action.diceRoll}`,
    );
  }
  if (action.laborTier) bits.push(`tier ${action.laborTier}`);
  if (action.resourceDelta != null) bits.push(`${action.resourceDelta} ⬢`);
  if (action.location?.name) bits.push(action.location.name);
  bits.push(action.moveReviewStatus === "SOLVED" ? "solved" : "unsolved");
  return `${bits.join(" | ")}\n  "${String(action.description ?? "").replace(/\s+/g, " ").trim()}"`;
}

// Load once, slice per zone. Six queries for the whole turn rather than six per
// zone: the correspondents run in parallel and would otherwise stampede the
// pool at exactly the moment turn rollover is already contending for it.
async function loadTurnMaterial(prisma, turn, { includeChat = false } = {}) {
  const window = await turnWindow(prisma, turn);

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      concealed: true,
      zoneId: true,
      locationId: true,
      zone: { select: { id: true, name: true } },
      location: { select: { name: true } },
      role: { select: { name: true } },
      faction: { select: { name: true } },
      tags: {
        select: {
          quantity: true,
          equipped: true,
          tag: { select: { ...CONCEALMENT_TAG_FIELDS, category: true } },
        },
      },
    },
  });

  const [actions, auditRows, beats, chat] = await Promise.all([
    prisma.action.findMany({
      where: { turnId: turn.id },
      select: {
        id: true,
        characterId: true,
        zoneId: true,
        description: true,
        moveKind: true,
        moveReviewStatus: true,
        diceRoll: true,
        diceModifier: true,
        resourceDelta: true,
        laborTier: true,
        location: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
      orderBy: { createdAt: "asc" },
      select: {
        actionType: true,
        actorDiscordUserId: true,
        targetCharacterId: true,
        details: true,
      },
    }),
    prisma.archiveEntry.findMany({
      where: { turnNumber: turn.number, kind: { in: BEAT_KINDS } },
      orderBy: { sentAt: "asc" },
      select: { kind: true, zoneId: true, content: true, characterName: true },
    }),
    includeChat
      ? prisma.archiveEntry.findMany({
          where: { turnNumber: turn.number, kind: "MESSAGE" },
          orderBy: { sentAt: "asc" },
          select: { zoneId: true, characterName: true, concealedAlias: true, content: true },
        })
      : Promise.resolve([]),
  ]);

  const names = {
    byCharacterId: new Map(),
    byDiscordUserId: new Map(),
  };
  for (const character of characters) {
    const label = displayName(character);
    names.byCharacterId.set(character.id, label);
    if (character.discordUserId) names.byDiscordUserId.set(character.discordUserId, label);
  }

  return { window, characters, actions, auditRows, beats, chat, names };
}

// The user message for one zone. `aggregatesSeen` is threaded through the six
// calls so a once-per-turn line ("hunger was charged") lands in one zone's
// input rather than all six.
function zoneBlock(material, zone, { aggregatesSeen, memory = [] }) {
  const here = material.characters.filter((c) => c.zoneId === zone.id);
  const hereIds = new Set(here.map((c) => c.id));

  const roster = here.map((character) => {
    const bits = [displayName(character)];
    if (character.role?.name) bits.push(character.role.name);
    if (character.faction?.name) bits.push(character.faction.name);
    if (character.location?.name) bits.push(character.location.name);
    const live = liveTagNames(character);
    if (live.length) bits.push(live.join(", "));
    return `- ${bits.join(" · ")}`;
  });

  const moves = material.actions
    .filter((action) => hereIds.has(action.characterId) || action.zoneId === zone.id)
    .map((action) => moveLine(action, material.names.byCharacterId.get(action.characterId) ?? "somebody"));

  // An audit row carries no zone, so it is placed by its ACTOR's current
  // position. That is approximate — somebody can act in Town and walk to the
  // Fortress before the turn closes — and it is the right approximation: the
  // alternative is a row appearing in no zone's input at all.
  const auditHere = material.auditRows.filter((row) => {
    const actor = here.find((c) => c.discordUserId === row.actorDiscordUserId);
    return Boolean(actor) || (row.targetCharacterId && hereIds.has(row.targetCharacterId));
  });
  const auditLines = auditLinesFor(auditHere, material.names, aggregatesSeen);

  const beats = material.beats.filter((b) => b.zoneId === zone.id).map((b) => `${b.kind} | ${b.content}`);

  const chat = material.chat
    .filter((m) => m.zoneId === zone.id)
    .map((m) => `${m.concealedAlias ?? m.characterName ?? "someone"}: ${m.content}`);

  const sections = [
    `ZONE: ${zone.name}`,
    memory.length ? `PREVIOUS TURNS\n${memory.join("\n\n")}` : null,
    roster.length ? `PRESENT (${roster.length})\n${roster.join("\n")}` : "PRESENT\nNobody.",
    moves.length ? `MOVES\n${moves.join("\n")}` : null,
    auditLines.length ? `EVENTS\n${auditLines.join("\n")}` : null,
    beats.length ? `NOTABLE\n${beats.join("\n")}` : null,
    chat.length ? `CHAT\n${chat.join("\n")}` : null,
  ].filter(Boolean);

  return {
    text: sections.join("\n\n"),
    counts: { present: roster.length, moves: moves.length, events: auditLines.length + beats.length },
  };
}

// The model writes {char:Ada Vance}. Stored text uses the canonical mention
// grammar, {char:<id>|<Name>} (db/lib/characterMentions.js), so this rewrites
// one into the other against the turn's roster before the page is saved.
//
// Resolving at WRITE time rather than at render time is what makes an invented
// name harmless: a name no character answers to loses its braces and becomes
// ordinary prose. A model that hallucinates a person therefore produces a
// sentence about a stranger, never a live link to one — and never a link to the
// WRONG one, which is what matching loosely at render time would eventually do.
//
// Note the two regexes cannot collide: characterMentions.js's TOKEN_RE matches
// [A-Za-z0-9_-] only, so a name with a space in it is invisible to the existing
// mention machinery right up until this function has finished with it.
const NAME_TOKEN_RE = /\{char:([^{}|\n]{1,80})\}/g;

function linkCharacterTokens(text, characters) {
  if (!text) return "";

  // Both the bare name and the annotated form the Oracle is told to write, so
  // `{char:Bram Holt}` resolves whether or not the model appended the mask.
  const byName = new Map();
  for (const character of characters) {
    if (character.name) byName.set(character.name.toLowerCase(), character.id);
  }

  return String(text).replace(NAME_TOKEN_RE, (raw, inner) => {
    const name = inner.trim();
    // Already canonical — an id, no spaces. Leave it exactly as it is.
    if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return raw;
    const id = byName.get(name.toLowerCase());
    return id ? `{char:${id}|${name}}` : name;
  });
}

module.exports = {
  LIVE_TAG_CATEGORIES,
  BEAT_KINDS,
  turnWindow,
  displayName,
  loadTurnMaterial,
  zoneBlock,
  linkCharacterTokens,
};
