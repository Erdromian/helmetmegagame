// Everything the Oracle reads, turned into one text block per zone.
// See docs/systemdocs/ORACLE.md.
//
// This module is the whole of the Oracle's access to game state, which is
// deliberate: what a correspondent may see is a question with a right answer,
// and it should be answerable by reading one file.
//
// Three things here are easy to get wrong and are each commented where they
// happen: the turn window runs lock to lock and is derived rather than read off
// AuditLog's turnId, tags are filtered to the two categories that actually
// move, and a concealed character is written with both faces rather than one.

const { auditLinesFor } = require("./oracleAudit");
const { moveCutoffAt } = require("./turnClock");
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

// The turn's wall-clock window, LOCK TO LOCK.
//
// It has to be derived, because AuditLog.turnId is NULL on most rows: the
// column exists for the per-turn rations and is not a general "which turn was
// this" stamp. /gm/audit derives the same way. Filtering audit rows on turnId
// would silently return almost nothing, which reads as a quiet turn rather than
// as the bug it is.
//
// Cutoff to cutoff rather than start to end, because that is when the Oracle
// now runs. Turn N's page is written at N's Move cutoff, so it can only see as
// far as that; the three hours after it — the late chat, the GM's own
// adjudications, and everything the midnight push fires — belong to N+1's page,
// which is the first one written after they happened. Windowing on startedAt
// instead would ask each page for three hours that did not exist yet when it
// was drafted, and no page would ever carry them.
//
// The floor is the last turn that was actually CHRONICLED, not simply the last
// turn. Those differ, and using the wrong one loses days.
//
// A turn with a frozen clock or one shorter than the lock gets no page at all,
// and moveCutoffAt() cannot tell you that: it is a pure function of startedAt
// and hands back a 21:00 for every turn that has one, lock or no lock. Anchor
// on the previous turn and a frozen Tuesday reads as covered when nothing ever
// covered it. Anchor on the last turn that has a page and the frozen days fall
// inside the next real page's window, which is where they belong.
//
// The clamp is the other half. A turn a GM opens at 23:00 ends at midnight, so
// its derived cutoff is 21:00 — two hours BEFORE it began. Left alone that
// pulls the floor backwards and two pages chronicle the same evening twice.
//
// Pure, so all of that is testable without a database.
function windowBetween(anchorTurn, turn) {
  const to = moveCutoffAt(turn) ?? new Date();
  if (!anchorTurn) return { from: turn.startedAt, to };
  const cutoff = moveCutoffAt(anchorTurn);
  const startedAt = new Date(anchorTurn.startedAt);
  const from = cutoff && cutoff > startedAt ? cutoff : startedAt;
  return { from, to };
}

async function turnWindow(prisma, turn) {
  // The newest earlier turn that has a page. Falls through to the newest
  // earlier turn of any kind when the Oracle has never run — enabling it
  // mid-game should not make its first page a chronicle of the entire game.
  const anchor =
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number }, oraclePages: { some: {} } },
      orderBy: { number: "desc" },
      select: { number: true, startedAt: true },
    })) ??
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number } },
      orderBy: { number: "desc" },
      select: { number: true, startedAt: true },
    }));
  return windowBetween(anchor, turn);
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
    // Moves go by the WINDOW too, not by turnId, and for a reason that only
    // shows up once the run moved to the cutoff: the auto-labor pass files a
    // Move for everybody who filed none, and it does that at the PUSH — three
    // hours after this turn's page is written (db/lib/autoLaborPass.js, a
    // TURN_PASS). Stamped turnId N, created after N's page exists. On the FK
    // they would appear in no page ever, and in a hundred-player game they are
    // most of the Moves there are. The window catches them in N+1, beside the
    // audit lines that say what they paid.
    //
    // A player's own Move is unaffected: it can only be filed before the lock,
    // so it lands in its own turn's window either way.
    prisma.action.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
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
    // Beats and chat go by the WINDOW, not by turnNumber, and the difference
    // matters now that the run happens at the cutoff. An entry stamped
    // turnNumber N but sent after N's lock does not exist yet when N's page is
    // written, and a page keyed on turnNumber N+1 would never look for it —
    // so the last three hours of every day would fall out of the record
    // entirely. The window is the authority; the stamp is not.
    //
    // sentAt rather than createdAt: the table carries both, and every index is
    // on sentAt. createdAt has none, so filtering on it would put a sequential
    // scan of the whole transcript on this path once a turn.
    prisma.archiveEntry.findMany({
      where: { sentAt: { gte: window.from, lt: window.to }, kind: { in: BEAT_KINDS } },
      orderBy: { sentAt: "asc" },
      select: { kind: true, zoneId: true, content: true, characterName: true },
    }),
    includeChat
      ? prisma.archiveEntry.findMany({
          where: { sentAt: { gte: window.from, lt: window.to }, kind: "MESSAGE" },
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
    // The roster is asked FIRST, and the order is the whole point. A MONONYM —
    // Adeliz, Grendel, Weasel — is a real character name that also looks
    // exactly like a cuid to a shape test: letters, no spaces. Checking the
    // id-shape first therefore mistook every single-word name for an id
    // already resolved and handed it back untouched, so `{char:Adeliz}` was
    // stored as a token pointing at nobody, and the one name in the sentence a
    // GM most wants to click was the one that could never be clicked.
    const id = byName.get(name.toLowerCase());
    if (id) return `{char:${id}|${name}}`;
    // Nobody answers to it. Either it is already a canonical id, which is left
    // exactly as it is, or the model invented a person — and an invented name
    // loses its braces and becomes ordinary prose rather than a live link to
    // the wrong character (ORACLE.md §5).
    if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return raw;
    return name;
  });
}

module.exports = {
  LIVE_TAG_CATEGORIES,
  BEAT_KINDS,
  windowBetween,
  turnWindow,
  displayName,
  loadTurnMaterial,
  zoneBlock,
  linkCharacterTokens,
};
