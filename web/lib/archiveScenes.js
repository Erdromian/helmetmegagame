// How the transcript cuts rows into days and scenes (docs/systemdocs/ARCHIVE.md §5).
// Shared by the page (app/(app)/archive/ArchiveTranscript.js) and the text export
// (web/lib/archiveText.js), so a downloaded transcript breaks where the screen does.
// Pure: no React, no Prisma. The rows can be shaped (the page) or raw ArchiveEntry
// rows (the export): every column read here has the same name on both.

// A mark per kind, so a death and a move are not the same muted line.
export const FOLD_MARK = {
  CHARACTER_CREATED: "✦",
  DEATH: "†",
  DESIRE_FULFILLED: "✧",
  TRAVEL: "→",
  LIFEWEB: "❧",
  GATEHOUSE: "⊓",
};

// The day is snapshotted onto the ArchiveEntry itself — there is no Turn row to
// join here, and it stopped being derivable from the turn number when the turn
// length became a knob. The fallback covers rows written before the column.
export function dayLabel(row) {
  if (row.turnNumber == null) return "Before the game";
  return `Day ${row.dayNumber ?? Math.ceil(row.turnNumber / 2)}`;
}

// channelKinds meaning "a place in the world", already covered by zoneName.
// Anything else with no zone is a standing channel outside the zone system.
const PLACED_KINDS = new Set(["summary", "location", "scene", "intercom", "decree"]);

// The KEY is placeKey where there is one, since the display string alone
// merges two same-named rooms and splits a renamed one.
export function sceneOf(row) {
  const named = row.channelKind && !PLACED_KINDS.has(row.channelKind) ? `#${row.channelKind}` : null;
  const place = row.zoneName ?? named ?? "Elsewhere";
  return {
    key: row.placeKey ?? [place, row.locationName, row.threadName].filter(Boolean).join(" · "),
    placeKey: row.placeKey ?? null,
    zoneName: row.zoneName ?? null,
    // Zone, then Location, then room: the Location is what tells two scenes
    // in one zone apart when neither is in a room.
    label: [place, row.locationName, row.threadName].filter(Boolean).join(" · "),
    // A zone's own #summary is not a room, and saying so costs one word.
    channelKind: row.channelKind ?? null,
  };
}

// An act has no place key (it never goes on a feed), so it cannot be matched to
// the speech around it by key. Between two keyed rows the key decides; with
// either one missing, the name does.
export function sameScene(a, b) {
  if (!a || !b) return false;
  if (a.placeKey && b.placeKey) return a.placeKey === b.placeKey;
  return a.label === b.label;
}
