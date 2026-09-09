// What a game is CALLED.
//
// Never "Game 13". A game used to carry a `number` beside its id — a creation
// ordinal that every playtest wipe consumed, which is how it reached 13 before
// the game had launched once. Showing it made the /archive picker read as a
// list of failures, and the column went entirely on 2026-09-09: a game is its
// id, and it reads as its label or the dates it ran.
//
// Lives here rather than inside `/archive` because two surfaces name a game
// now — the picker and the Dev Panel's Games section (`DEV-PANEL.md` §11c).

// A label if one was given, otherwise the dates it ran.
export function gameTitle(game) {
  if (game?.label) return game.label;
  const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (game?.startedAt && game?.endedAt) return `${fmt(game.startedAt)} – ${fmt(game.endedAt)}`;
  if (game?.startedAt) return `From ${fmt(game.startedAt)}`;
  // A game that never started still needs a name of its own. "Unplayed" alone
  // would read the same on every one of them, and a lobby that was opened and
  // abandoned three times is exactly the shape this picker is full of.
  if (game?.createdAt) return `Unplayed · opened ${fmt(game.createdAt)}`;
  return "Unplayed";
}

// The first seven characters of the cuid, the way a git short hash reads. What
// a GM matches against an audit row, a packet key or a backup — the id is the
// only handle a game has now, and the whole cuid is too long to wear in a chip.
export function shortId(game) {
  return (game?.id ?? "").slice(0, 7);
}
