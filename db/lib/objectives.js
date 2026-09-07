// Antagonist objectives: scoring them, listing them, and the end-of-game
// reveal (docs/systemdocs/THREATS.md §6a). The catalog of kinds is
// db/lib/objectiveKinds.js; the rows are the Objective table.
//
// THREE CHECKERS decide a scripted kind, all read on demand rather than in a
// turn pass — a death is already an ArchiveEntry, the bomb is already a stamp
// on GameState, and a target's status is already on the row. Nothing here
// needs to run at turn close to be right at game end.
//
// The GM's PIN wins over any checker. Scripted kinds start unpinned (null: the
// game decides); manual kinds are never unpinned, since the pin is the only
// answer they have.
//
// Takes `prisma` as a parameter (the db/lib/dm.js convention) and stays off
// the @lifeweb/db barrel.

const { turnDay } = require("./turnFormat");
const { objectiveKind, describeObjective } = require("./objectiveKinds");
const { threatBySeatTag, partyOf, PARTIES } = require("./threats");
const { hasAttribute, WILDERNESS_ATTRIBUTE } = require("./locationAttributes");

// Can this Location be the target of "Blow up [Location]"? Above ground and
// not wilderness — the spec's "non-wilderness and non-caving". The page
// filters the dropdown by this and the action refuses by it. Needs the row's
// `attributes` and `zone.kind`.
function locationEligible(location) {
  return location?.zone?.kind === "SURFACE" && !hasAttribute(location, WILDERNESS_ATTRIBUTE);
}

async function loadDeaths(prisma, gameId) {
  return prisma.archiveEntry.findMany({
    where: { kind: "DEATH", ...(gameId ? { gameId } : {}) },
    select: { characterId: true, turnNumber: true },
  });
}

// The most deaths any one in-game day saw. Two turns make a day
// (db/lib/turnFormat.js#turnDay); a row with no turn number belongs to no day.
function maxDeathsInOneDay(deaths) {
  const perDay = new Map();
  for (const d of deaths) {
    if (d.turnNumber == null) continue;
    const day = turnDay({ number: d.turnNumber });
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  let max = 0;
  for (const n of perDay.values()) if (n > max) max = n;
  return max;
}

// Every row's answer, batched: one character read for every target, one state
// read, one death read — each only if some row needs it and the caller did not
// hand it over (buildEpilogue already holds state and deaths).
//
// Returns Map<id, { done, source }>, source being "pinned" or "script".
async function evaluateObjectives(prisma, rows, { state = null, deaths = null } = {}) {
  const results = new Map();
  const targetIds = new Set();
  let needState = false;
  let needDeaths = false;

  for (const row of rows) {
    if (row.pinned != null) continue;
    const kind = objectiveKind(row.kind);
    if (kind?.script === "characterDead" && row.targetCharacterId) targetIds.add(row.targetCharacterId);
    if (kind?.script === "nukeDetonated") needState = true;
    if (kind?.script === "deathsInOneDay") needDeaths = true;
  }

  // The death rows must be this game's — ArchiveEntry outlives Restart Game —
  // so counting them needs the state's gameId too.
  const mustLoadState = (needState || (needDeaths && !deaths)) && !state;
  const [targets, loadedState] = await Promise.all([
    targetIds.size
      ? prisma.character.findMany({ where: { id: { in: [...targetIds] } }, select: { id: true, status: true } })
      : [],
    mustLoadState ? prisma.gameState.findUnique({ where: { id: 1 } }) : state,
  ]);
  const gameId = loadedState?.gameId ?? null;
  const loadedDeaths = needDeaths && !deaths ? await loadDeaths(prisma, gameId) : deaths;

  const statusOf = new Map(targets.map((t) => [t.id, t.status]));
  const worstDay = needDeaths ? maxDeathsInOneDay(loadedDeaths ?? []) : 0;

  for (const row of rows) {
    if (row.pinned != null) {
      results.set(row.id, { done: row.pinned, source: "pinned" });
      continue;
    }
    const kind = objectiveKind(row.kind);
    let done = false;
    switch (kind?.script) {
      // DEAD exactly. CURSED is a dead enum value, not a state
      // (docs/systemdocs/CHARACTERS.md); a Revive un-scores this until pinned.
      case "characterDead":
        done = statusOf.get(row.targetCharacterId) === "DEAD";
        break;
      case "deathsInOneDay":
        done = row.value != null && worstDay >= row.value;
        break;
      case "nukeDetonated":
        done = loadedState?.nukeDetonatedTurn != null;
        break;
      default:
        // A manual kind with no pin — should not exist, the actions refuse it —
        // reads as not done rather than as a throw.
        done = false;
    }
    results.set(row.id, { done, source: "script" });
  }
  return results;
}

// The rows, described and scored, oldest first. The helper the coming
// objective-reveal rite will call for one party; /gm/dev calls it for all.
async function listObjectives(prisma, { partyKey = null, state = null, deaths = null } = {}) {
  const rows = await prisma.objective.findMany({
    where: partyKey ? { partyKey } : {},
    orderBy: { createdAt: "asc" },
  });
  const scored = await evaluateObjectives(prisma, rows, { state, deaths });
  return rows.map((row) => {
    const kind = objectiveKind(row.kind);
    const result = scored.get(row.id) ?? { done: false, source: "script" };
    return {
      ...row,
      description: describeObjective(row),
      done: result.done,
      source: result.source,
      scripted: Boolean(kind?.script),
      placeholder: Boolean(kind?.placeholder),
    };
  });
}

// Which seat a character answers for within a party, when they hold more than
// one of its tags. The Thanati Leader holds `thanati` too; the seat whose grant
// includes the others' tags is the one that names them.
function primarySeat(seats) {
  return (
    seats.find((s) => seats.every((o) => o === s || (s.assign?.tagSlugs ?? []).includes(o.seatTagSlug))) ??
    seats[0]
  );
}

// The reveal: every party somebody actually sat in, its members and its
// scored objectives. `characters` are the rows buildEpilogue loads — name,
// createdAt and the seat tags — so nothing is read twice.
//
// A party with objectives and no member is left out. It never existed in
// play, and printing its prep would only confuse the room.
async function buildAntagonistReveal(prisma, { characters, deaths = null, state = null }) {
  const membersByParty = new Map();
  for (const c of characters) {
    const held = (c.tags ?? []).map((t) => threatBySeatTag(t.tag?.slug ?? t.slug)).filter(Boolean);
    if (held.length === 0) continue;
    const byParty = new Map();
    for (const seat of held) {
      const key = partyOf(seat).key;
      if (!byParty.has(key)) byParty.set(key, []);
      byParty.get(key).push(seat);
    }
    for (const [key, seats] of byParty) {
      const seat = primarySeat(seats);
      if (!membersByParty.has(key)) membersByParty.set(key, []);
      membersByParty.get(key).push({
        name: c.name,
        seat: seat.name,
        // Leader-ness: this seat's grant includes another party seat's tag.
        leads: seats.length > 1 && seats.some((o) => o !== seat),
        createdAt: c.createdAt ?? null,
      });
    }
  }
  if (membersByParty.size === 0) return [];

  const objectives = await listObjectives(prisma, { state, deaths });
  const reveal = [];
  for (const party of PARTIES) {
    const members = membersByParty.get(party.key);
    if (!members?.length) continue;
    members.sort((a, b) => {
      if (a.leads !== b.leads) return a.leads ? -1 : 1;
      return (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    });
    reveal.push({
      partyKey: party.key,
      partyName: party.name,
      solo: party.solo,
      members: members.map(({ name, seat }) => ({ name, seat })),
      objectives: objectives
        .filter((o) => o.partyKey === party.key)
        .map((o) => ({ text: o.description, weight: o.weight, done: o.done })),
    });
  }
  return reveal;
}

// Bascinet's format, one line per party:
//   Ash was a Judge.
//   Ash (Thanati Leader), Wren, Lark were the Thanati. Their objectives were:
//   Kill Corvin. **Success!** / Deface the icon. **Failed!**
// A seat name is appended only when it differs from the party's. The article
// is a literal "a": every seat name starts with a consonant.
function formatAntagonistLines(reveal) {
  return (reveal ?? []).map((party) => {
    const names = party.members.map((m) => (m.seat !== party.partyName ? `${m.name} (${m.seat})` : m.name));
    const head =
      party.solo && names.length === 1
        ? `${names[0]} was a ${party.partyName}.`
        : `${names.join(", ")} were the ${party.partyName}.`;
    if (party.objectives.length === 0) return head;
    const list = party.objectives
      .map((o) => `${o.text.replace(/[.!]+$/, "")}. ${o.done ? "**Success!**" : "**Failed!**"}`)
      .join(" / ");
    return `${head} Their objectives were: ${list}`;
  });
}

module.exports = {
  locationEligible,
  evaluateObjectives,
  listObjectives,
  buildAntagonistReveal,
  formatAntagonistLines,
  maxDeathsInOneDay,
  loadDeaths,
};
