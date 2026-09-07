// The reveal at the end of a game (docs/systemdocs/LOBBY.md §7): the closing
// note, a line of facts, and who was who — every character the game had,
// dead ones marked, antagonist seats named. Built once, stored on
// Game.epilogue so it outlives the wipe, rendered on /archive and posted to
// #turns as **Game Ended**.

const { threatBySeatTag, SEAT_TAG_SLUGS } = require("./threats");
const { buildAntagonistReveal, formatAntagonistLines } = require("./objectives");
const { listGuildMembers } = require("./discordRest");

// Always handed the plain client, never a transaction (db/index.js after the
// bomb, gameActions.js's End Game, actions.js's wipe) — the reads below and in
// buildAntagonistReveal depend on that.
async function buildEpilogue(prisma, { game, state, closingNote = null } = {}) {
  const gameId = game?.id ?? state?.gameId;
  const [characters, deaths, members, turns, letters, archived] = await Promise.all([
    prisma.character.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, roleTitle: true, status: true, discordUserId: true, createdAt: true,
        tags: { where: { tag: { slug: { in: SEAT_TAG_SLUGS } } }, select: { tag: { select: { slug: true } } } },
      },
    }),
    prisma.archiveEntry.findMany({ where: { kind: "DEATH", ...(gameId ? { gameId } : {}) }, select: { characterId: true, turnNumber: true } }),
    listGuildMembers().catch(() => []),
    prisma.turn.aggregate({ _max: { number: true } }),
    prisma.birdMessage.count(),
    gameId ? prisma.archiveEntry.count({ where: { gameId } }) : prisma.archiveEntry.count(),
  ]);

  const handleOf = new Map(members.map((m) => [m.user?.id ?? m.id, m.user?.global_name ?? m.user?.username ?? m.globalName ?? m.username]));
  const diedOn = new Map();
  for (const d of deaths) if (d.characterId && !diedOn.has(d.characterId)) diedOn.set(d.characterId, d.turnNumber);

  const roster = characters.map((c) => {
    const seatSlug = c.tags.map((t) => t.tag.slug).find((s) => threatBySeatTag(s));
    return {
      handle: handleOf.get(c.discordUserId) ?? c.discordUserId ?? "?",
      name: c.name,
      roleTitle: c.roleTitle,
      seat: seatSlug ? threatBySeatTag(seatSlug).name : null,
      died: c.status === "DEAD" ? (diedOn.get(c.id) ?? null) : null,
      dead: c.status === "DEAD",
    };
  });

  const startedAt = state?.startedAt ?? game?.startedAt ?? null;
  const endedAt = state?.endedAt ?? game?.endedAt ?? new Date();
  const days = startedAt ? Math.max(1, Math.round((new Date(endedAt) - new Date(startedAt)) / 86400000)) : null;

  // Who the antagonists were and how their objectives ended
  // (db/lib/objectives.js). Reuses the character and death rows above; the
  // state carries nukeDetonatedTurn for the Tribunal's check. Wrapped: a
  // scoring fault must not cost the game its ending.
  const antagonists = await buildAntagonistReveal(prisma, { characters, deaths, state }).catch((err) => {
    console.error("Antagonist reveal failed:", err);
    return [];
  });

  return {
    closingNote: closingNote ?? state?.closingNote ?? game?.closingNote ?? null,
    facts: {
      days,
      turns: turns._max.number ?? 0,
      characters: characters.length,
      deaths: roster.filter((r) => r.dead).length,
      letters,
      archived,
    },
    roster,
    antagonists,
    builtAt: new Date().toISOString(),
  };
}

function factsLine(facts) {
  const parts = [];
  if (facts.days) parts.push(`It lasted ${facts.days} day${facts.days === 1 ? "" : "s"}, ${facts.turns} turn${facts.turns === 1 ? "" : "s"}.`);
  else parts.push(`${facts.turns} turn${facts.turns === 1 ? "" : "s"}.`);
  parts.push(`${facts.characters} character${facts.characters === 1 ? "" : "s"} lived in Ravenheart, ${facts.deaths} died.`);
  if (facts.letters) parts.push(`${facts.letters} letter${facts.letters === 1 ? "" : "s"} flew.`);
  parts.push(`${facts.archived.toLocaleString()} thing${facts.archived === 1 ? "" : "s"} went into the archive.`);
  return `${parts.join(" ")} ‡`;
}

function rosterLine(r) {
  const seat = r.seat ? ` — the ${r.seat}` : "";
  const died = r.dead ? (r.died != null ? ` ✝ turn ${r.died}` : " ✝") : "";
  return `${r.handle} as ${r.name}, ${r.roleTitle ?? "no role"}${seat}${died}`;
}

// The Discord post. One string; the poster chunks it under 2000.
function formatEpilogue(epilogue, { number } = {}) {
  const lines = [`**Game Ended**${number ? ` · Game ${number}` : ""}`];
  if (epilogue.closingNote) lines.push(`» ${epilogue.closingNote}`);
  lines.push("", factsLine(epilogue.facts));
  // Older epilogues (before objectives existed) carry no `antagonists`.
  if (epilogue.antagonists?.length) {
    lines.push("", "**The antagonists**", ...formatAntagonistLines(epilogue.antagonists));
  }
  lines.push("", "**Who was who**");
  if (epilogue.roster.length === 0) lines.push("Nobody.");
  for (const r of epilogue.roster) lines.push(rosterLine(r));
  return lines.join("\n");
}

module.exports = { buildEpilogue, formatEpilogue, factsLine, rosterLine, formatAntagonistLines };
