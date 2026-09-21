// The picture a turn announcement carries, on both faces. There are only two:
// the nuke's, once the bomb has gone off, and the hellfire's, once the Rite of
// Ascension has fired. Every other turn posts bare — the eight everyday plates
// of Ravenheart were retired.
//
// The files live in web/public/assets/turn/, so the web serves them at
// /assets/turn/<name>.jpg and the Discord post uploads the same file off disk.
const fs = require("node:fs");
const path = require("node:path");
const { docsPath } = require("./repoPaths");

// null when docs/ can't be found (treat as "no plate"); guard every join,
// since path.join(null, ...) throws and would take down the whole announcement.
const REPO_ROOT = docsPath();
const TURN_BANNER_DIR = REPO_ROOT ? path.join(REPO_ROOT, "..", "web", "public", "assets", "turn") : null;

// Which plate this game has earned, or null. `game` carries the two stamps —
// THE STAMPS COME OFF THE GAME ROW, NOT GameState, since the Game row is created
// fresh by the wipe and so cannot lie about which game ended. The nuke wins if
// both have somehow happened.
function turnPlate(game) {
  if (game?.nukeDetonatedTurn != null) return "nuke";
  if (game?.ascensionFiredTurn != null) return "hellfire";
  return null;
}

// The plate as a file on disk for the Discord upload; null means post bare.
// `state` is the GameState row with `{ game: { select: { nukeDetonatedTurn,
// ascensionFiredTurn } } }`. A missing file never costs the announcement.
function turnBannerPath(_turn, state = null) {
  const plate = turnPlate(state?.game);
  if (!plate || !TURN_BANNER_DIR) return null;
  const full = path.join(TURN_BANNER_DIR, `${plate}.jpg`);
  if (fs.existsSync(full)) return full;
  console.error(`Turn banner: ${plate} plate missing from ${TURN_BANNER_DIR}`);
  return null;
}

module.exports = {
  TURN_BANNER_DIR,
  turnPlate,
  turnBannerPath,
};
