import Link from "next/link";

import { TableScroll } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import { gameTitle, shortId } from "@/lib/gameLabel";

// Every game there has ever been, and the way into each one's transcript.
//
// This exists because a game stopped having a number. The ordinal was the only
// thing tying the Game rows together into something a GM could look at, and
// looking at them matters — which restart was the real one, how long it ran,
// whether its transcript is still in the database or out in a packet.
//
// A plain table rather than the useTableState engine: a handful of rows, and
// nothing to search or sort. Same call as the Gamemasters roster.
//
// Most of the numbers come out of Game.epilogue, which is written when a game
// ends (db/lib/epilogue.js#buildEpilogue) — so a game still running has none of
// them and shows a dash. The archive count is the exception: it is counted live,
// because the epilogue's copy is a snapshot from the moment the game ended, and
// the game being played has no epilogue at all. A game whose rows have left the
// database (`archivedAt`) has no live count either, so it shows the count the
// packet was written with.
const COL_COUNT = 8;

function ending(game, isCurrent) {
  if (game.nukeDetonatedTurn != null) {
    return { tone: "bad", label: `Nuked, turn ${game.nukeDetonatedTurn}` };
  }
  if (game.ascensionFiredTurn != null) {
    return { tone: "bad", label: `Ascended, turn ${game.ascensionFiredTurn}` };
  }
  if (game.endedAt) return { tone: "muted", label: "Ended" };
  if (isCurrent) return { tone: "good", label: "Running" };
  // A row with no ending and no claim on the present: a restart that opened a
  // game nobody played, which is most of what a test week leaves behind.
  return { tone: "neutral", label: "Never finished" };
}

// The three packet states, in the order ARCHIVE.md gives them: no packet, a
// packet with the rows still in the database, and the rows gone into it.
function packet(game) {
  if (game.archivedAt) return { tone: "muted", label: "Archived away" };
  if (game.exportKey) return { tone: "good", label: "Exported" };
  return null;
}

function num(value) {
  return value == null ? "—" : value.toLocaleString();
}

export default function PastGames({ games, currentGameId, archiveCounts }) {
  return (
    <TableScroll minWidth="820px">
      <thead>
        <tr>
          <th scope="col">Game</th>
          <th scope="col">Id</th>
          <th scope="col">Ending</th>
          <th scope="col">Days</th>
          <th scope="col">Turns</th>
          <th scope="col">Lived</th>
          <th scope="col">Died</th>
          <th scope="col">Archive</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const isCurrent = g.id === currentGameId;
          const facts = g.epilogue?.facts ?? null;
          const end = ending(g, isCurrent);
          const pack = packet(g);
          const rows = g.archivedAt ? g.entryCount : archiveCounts[g.id];
          return (
            <tr key={g.id}>
              <td>
                {gameTitle(g)}
                {isCurrent ? <span className="chip">Current</span> : null}
                {g.closingNote ? (
                  <span className="block text-xs text-muted">» {g.closingNote}</span>
                ) : null}
                {g.exportKey ? <span className="block text-xs text-muted mono">{g.exportKey}</span> : null}
              </td>
              <td className="mono">{shortId(g)}</td>
              <td>
                <StatusPill tone={end.tone}>{end.label}</StatusPill>
                {pack ? <StatusPill tone={pack.tone}>{pack.label}</StatusPill> : null}
              </td>
              <td className="mono">{num(facts?.days)}</td>
              <td className="mono">{num(facts?.turns)}</td>
              <td className="mono">{num(facts?.characters ?? g.playerCount)}</td>
              <td className="mono">{num(facts?.deaths)}</td>
              <td className="mono">
                {/* An archived-away game still links: /archive renders the
                    stub saying where its transcript went (ARCHIVE.md). */}
                {rows > 0 ? (
                  <Link href={`/archive?game=${g.id}`} className="menu-item">
                    {num(rows)} ↗
                  </Link>
                ) : (
                  <span className="text-muted">{num(rows ?? 0)}</span>
                )}
              </td>
            </tr>
          );
        })}
        {games.length === 0 ? (
          <EmptyRow cols={COL_COUNT}>No game has been opened yet. ‡</EmptyRow>
        ) : null}
      </tbody>
    </TableScroll>
  );
}
