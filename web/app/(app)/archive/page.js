import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { factsLine, rosterLine } from "@lifeweb/db/lib/epilogue";
import { formatAntagonistLines } from "@lifeweb/db/lib/objectives";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Pager from "@/app/components/Pager";
import Select from "@/app/components/Select";
import ArchiveTranscript from "./ArchiveTranscript";

// The transcript, one game at a time (docs/systemdocs/ARCHIVE.md). A past
// game is readable by any signed-in user; the current one opens when the game
// ends (GameState.archiveVisible), and to GMs always. Server-paged: this and
// /gm/audit are the two lists too long for client-side paging.
const PAGE_SIZE = 150;

export default async function ArchivePage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [{ isGm: gm }, state, games] = await Promise.all([
    getGmSession(),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { archiveVisible: true, gameId: true, phase: true } }),
    prisma.game.findMany({
      orderBy: { number: "desc" },
      select: { id: true, number: true, startedAt: true, endedAt: true, epilogue: true },
    }),
  ]);

  const params = await searchParams;
  const requestedNumber = Number.parseInt(params?.game?.toString() ?? "", 10);
  const current = games.find((g) => g.id === state?.gameId) ?? games[0] ?? null;
  const game = games.find((g) => g.number === requestedNumber) ?? current;
  const isCurrent = Boolean(game && game.id === state?.gameId);

  // The real gate. The nav hides the link when it's shut, but a page is a
  // public URL — same posture as /character's creation gate. A past game is
  // over, and its record is everyone's.
  if (!game) redirect("/character");
  if (isCurrent && !gm && !state?.archiveVisible) redirect("/character");

  const zoneName = params?.zone?.toString().trim() || "";
  const characterId = params?.character?.toString().trim() || "";
  const day = params?.day?.toString().trim() || "";
  const q = params?.q?.toString().trim() || "";
  // Speech only by default is what makes a day readable; Everything folds the
  // system rows back in (arrivals, deaths, moves) under one line per run.
  const show = params?.show?.toString() === "all" ? "all" : "speech";
  // Oldest-first by default: this is a diary to be read forward, not a log to
  // be skimmed newest-first like /gm/audit.
  const order = params?.order?.toString() === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  // A day is two turns, Dawn first: day 3 is turns 5 and 6.
  const dayNumber = day ? Number.parseInt(day, 10) : null;
  const dayTurns = dayNumber && dayNumber > 0 ? [dayNumber * 2 - 1, dayNumber * 2] : null;

  const where = {
    gameId: game.id,
    // Delete is soft since phase 1 of Chat, so a browser holding a row can
    // reconcile. The transcript still honours the retraction: a taken-back
    // message is not in it.
    deletedAt: null,
    // Speech is the default view, and since phase 4 the world writes MESSAGE
    // rows of its own (db/lib/scene.js — smells, bells, gate crossings). Those
    // are `source: SYSTEM`, and they are left out here: the events they narrate
    // already fold into the muted <details> line under "Everything", so showing
    // both would print every arrival twice. TURN_START stays regardless — it is
    // the sticky day divider, never a row.
    ...(show === "speech"
      ? {
          OR: [
            { kind: "TURN_START" },
            { kind: "MESSAGE", source: { not: "SYSTEM" } },
          ],
        }
      : {}),
    ...(zoneName ? { zoneName } : {}),
    ...(characterId ? { characterId } : {}),
    ...(dayTurns ? { turnNumber: { in: dayTurns } } : {}),
    ...(q ? { content: { contains: q, mode: "insensitive" } } : {}),
  };

  // Filter vocabularies come from the game's own rows, not the live tables:
  // a past game's characters are gone and its zones may have been re-synced
  // under new ids, but the snapshot names on the rows are exactly what was.
  const [entries, total, zoneRows, characterRows] = await Promise.all([
    prisma.archiveEntry.findMany({
      where,
      // id breaks ties: sentAt is millisecond-resolution, and a burst of
      // proxied messages can share a timestamp — without it the same row can
      // appear on two pages and another on neither.
      orderBy: [{ sentAt: order }, { id: order }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.archiveEntry.count({ where }),
    prisma.archiveEntry.groupBy({ by: ["zoneName"], where: { gameId: game.id, zoneName: { not: null } } }),
    prisma.archiveEntry.groupBy({
      by: ["characterId", "characterName"],
      where: { gameId: game.id, kind: "MESSAGE", characterId: { not: null } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const zones = zoneRows.map((r) => r.zoneName).sort((a, b) => a.localeCompare(b));
  const characters = characterRows
    .map((r) => ({ id: r.characterId, name: r.characterName ?? r.characterId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  function pageHref(newPage) {
    const next = new URLSearchParams({
      game: String(game.number), zone: zoneName, character: characterId, day, q, order, show, page: String(newPage),
    });
    for (const key of [...next.keys()]) if (!next.get(key)) next.delete(key);
    return `/archive?${next.toString()}`;
  }

  // End Game then Resume leaves the epilogue on the Game row and the archive
  // open (LOBBY.md §7). The transcript may stay readable, but the reveal — who
  // the antagonists are and whom they were told to kill — must not, while the
  // game is running again. GMs see it regardless.
  const revealHidden = isCurrent && !gm && state?.phase !== "ENDED";
  const epilogue = revealHidden ? null : (game.epilogue ?? null);
  return (
    <PageShell width="wide">
      <PageHeader
        title={`Archive · Game ${game.number}`}
      />

      {epilogue ? (
        <section className="panel flex flex-col gap-3 p-4">
          <h2 className="panel-header">How it ended</h2>
          {epilogue.closingNote ? <p className="text-sm">» {epilogue.closingNote}</p> : null}
          <p className="text-sm text-muted">{factsLine(epilogue.facts)}</p>
          {epilogue.antagonists?.length ? (
            <details className="archive-fold" open>
              <summary>The antagonists</summary>
              <ul>
                {formatAntagonistLines(epilogue.antagonists).map((line, i) => (
                  <li key={`${epilogue.antagonists[i].partyKey}`}>{line.replaceAll("**", "")}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className="archive-fold">
            <summary>Who was who</summary>
            <ul>
              {epilogue.roster.map((r) => (
                <li key={`${r.handle}-${r.name}`}>{rosterLine(r)}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Game</span>
          <Select name="game" defaultValue={String(game.number)}>
            {games.map((g) => (
              <option key={g.id} value={g.number}>
                Game {g.number}{g.id === state?.gameId ? " · current" : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={q} placeholder="anything said…" />
        </label>
        <label className="field">
          <span className="field-label">Day</span>
          <input name="day" type="number" min="1" defaultValue={day} placeholder="any" className="max-w-24" />
        </label>
        <label className="field">
          <span className="field-label">Zone</span>
          <Select name="zone" defaultValue={zoneName}>
            <option value="">Anywhere</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Character</span>
          <Select name="character" defaultValue={characterId}>
            <option value="">Anyone</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Show</span>
          <Select name="show" defaultValue={show}>
            <option value="speech">Speech</option>
            <option value="all">Everything</option>
          </Select>
        </label>
        <label className="field">
          <span className="field-label">Order</span>
          <Select name="order" defaultValue={order}>
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </Select>
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
      </form>

      <ArchiveTranscript entries={entries} />

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        unit="entries"
        prevHref={pageHref(page - 1)}
        nextHref={pageHref(page + 1)}
      />
    </PageShell>
  );
}
