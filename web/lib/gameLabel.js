// What a game is CALLED. Never "Game 13". Lives here, not inside `/archive`, since both the
// picker and the Dev Panel's Games section (DEV-PANEL.md §11c) name a game.
// The dates are read in UTC, not the host's zone: the picker renders on the server
// and again in the reader's browser, and a name has to come out the same in both.
export function gameTitle(game) {
  if (game?.label) return game.label;
  const fmt = (d) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (game?.startedAt && game?.endedAt) return `${fmt(game.startedAt)} – ${fmt(game.endedAt)}`;
  if (game?.startedAt) return `From ${fmt(game.startedAt)}`;
  if (game?.createdAt) return `Unplayed · opened ${fmt(game.createdAt)}`;
  return "Unplayed";
}

export function shortId(game) {
  return (game?.id ?? "").slice(0, 7);
}
