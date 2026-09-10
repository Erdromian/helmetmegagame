// Pure turn-formatting helpers with no database dependency, kept separate
// from turn.js's getOpenTurn() so client components can import these
// without dragging the @lifeweb/db (Prisma) barrel into the browser bundle.
//
// turnsLeft/formatTurnsLeft/tagDuration used to be hand-maintained copies of
// the db/lib/turnFormat.js originals — byte-identical apart from the `export`
// keyword, with nothing keeping them in step. They are re-exported from the
// deep path instead, which resolves without the barrel (and so without Prisma)
// because @lifeweb/db declares no `exports` map. Everything below is genuinely
// web-only: themes and the turn label a page renders.
export { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor } from "@lifeweb/db/lib/turnFormat";

// How long is left to file a Move, as the one sentence both surfaces that ask
// the question use: the turn card in Chat's YOU column and the sheet's band,
// and now the Move dialog's own header.
//
// It counts to the CUTOFF, not to the turn's end. Moves stop three hours
// before midnight (MOVE_LOCK_HOURS), so counting to the end told a player they
// had three hours they did not have.
//
// Computed in the browser off the ISO string so it cannot go stale on a page
// left open, and null when moveWindow says there is no lock at all — a frozen
// clock or a short manual turn has no honest time to count to
// (db/lib/turnClock.js).
export function untilLabel(closesAt, now) {
  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - now;
  if (ms <= 0) return "locked";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `closes in ${hours} h`;
  return `closes in ${Math.max(1, Math.round(ms / 60_000))} m`;
}

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  return { day, phase: turn.phase, label: `DAY ${day} · ${turn.phase}` };
}

// The themes globals.css defines. Both phase themes are underground darks;
// "limestone" is the light-theme backup and is deliberately NOT reachable from
// a phase — only via the BASCINET_THEME override below.
export const THEMES = ["dusk", "dawn", "limestone"];

export function themeForPhase(phase) {
  return phase === "DUSK" ? "dusk" : "dawn";
}

// Lets a whole environment be pinned to one theme regardless of the turn, so
// limestone can actually be looked at and compared side by side — without it
// there is no way to reach a theme that no phase maps to. Unset (the normal
// case) or unrecognised falls straight through to the phase theme, so a typo
// degrades to correct behaviour rather than an unstyled page.
export function resolveTheme(phase, override) {
  return THEMES.includes(override) ? override : themeForPhase(phase);
}

// "Turn 1, Dusk" — the raw sequential turn number (not the day/2 grouping
// describeTurn() computes), used in tables that list individual actions.
export function formatTurnLabel(turnNumber, phase) {
  if (turnNumber == null) return "-";
  if (!phase) return `Turn ${turnNumber}`;
  const phaseLabel = phase.charAt(0) + phase.slice(1).toLowerCase();
  return `Turn ${turnNumber}, ${phaseLabel}`;
}

// How many turns a timed tag has left. `CharacterTag.expiresTurn` is an
// absolute turn number, never a countdown, so the answer is just the gap to
// the open turn — see the sweep in db/index.js#resolveNeeds. Null whenever
// either side is missing, which is the common case: most tags never expire.
//

// The single source for "how long does this tag last", covering all four
// states a chip can be in. `left` is turnsLeft() for a held CharacterTag (null
// for a bare catalog reference); `defaultDurationTurns` is the Tag's catalog
// duration.
//
// Returns { label, badge } or null when the tag simply doesn't expire:
//   held, counting down  -> { "2 turns left",            "2t"   }
//   held, final turn     -> { "Expires this turn",       "last" }
//   catalog reference    -> { "Lasts 1 turn once granted","1t"  }
//   neither              -> null
//
// turnsLeft() counts the open turn, so the final turn arrives here as 1.
//

// expiryFor moved to db/lib/turnFormat.js (re-exported above) — the
// staged-push pass grants timed tags at turn end and needs the same rule.
