import { describeTurn } from "@/lib/turnFormat";
import { GAME_YEAR } from "@lifeweb/db/turnCalendar";
import LockChip from "./LockChip";
import BascinetClock from "./BascinetClock";

// The bar's own clock, behind its own divider (AppBar.js): "Day 14 · 1098 ·
// Turn 27 · 10:28 PM", plus the Moves-lock countdown when a turn is open.
// This replaces the old TurnMeta.js, which also carried the zone — the bar
// no longer says where you are that way, since the active link already does.
//
// A server component inside its own Suspense boundary (AppBar.js) so a slow
// turn query never holds the nav links off the screen; it awaits nothing
// else, unlike TurnMeta, which also loaded the viewer's zone.
export default async function ClockBlock({ turnPromise, clockPromise }) {
  const [turn, clock] = await Promise.all([turnPromise, clockPromise]);
  const { day } = describeTurn(turn);
  // Before the game starts there IS a turn row — Restart Game mints Turn 1 and Start Game restamps it — so reading the
  // row alone told everybody sitting in the lobby it was Day 1, Turn 1 of a game nobody had begun. The phase is what
  // knows better. ENDED keeps the last turn's numbers: the game is over, and they are what it ended on.
  const lobby = clock?.phase === "LOBBY" || clock?.phase === "CLOSED";
  return (
    <span className="top-bar-clock">
      <span className="header-note mono">
        {lobby ? "LOBBY" : turn ? `Day ${day} · ${GAME_YEAR} · Turn ${turn.number}` : "NO TURN OPEN"}
      </span>
      <BascinetClock />
      <LockChip />
    </span>
  );
}
