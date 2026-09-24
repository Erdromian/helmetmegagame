// WHEN A LINE STARTS A RUN. A run is one speaker talking without a long gap,
// and the feed draws the portrait on a run's first line only (chat.css,
// `.tline-face`) — so this rule is what decides where the faces go.
//
// Both feeds (app/(app)/chat/Feed.js and its rebuild under next/) read it from
// here. The rebuild used to compare `speakerKey` alone, and the server only
// mints one for a HOODED row (db/lib/archive.js#feedRowShape) — so two named
// speakers both carried null, the feed never saw the speaker change, and a
// scene of people talking back and forth showed one portrait at the top and
// nothing else until seven minutes of silence. Zero imports, on purpose: it is
// reached from a "use client" file and from node --test alike.

// A gap this long starts a new run even from the same mouth.
export const RUN_GAP_MS = 7 * 60 * 1000;

// Whose line this is, as far as the browser may know. A hooded row somebody
// else said carries no characterId at all, so runs group on whichever handle
// the row has; `speakerKey` is stable per speaker and useless for anything
// else, which is the point.
export function speakerOf(row) {
  return row?.speakerKey ?? row?.characterId ?? null;
}

// The world speaking is not a speaker. It breaks a run on either side, so a
// "so-and-so arrives" between two of Ada's lines gives the second one its face.
function isSystem(row) {
  return !row || row.source === "SYSTEM" || !row.name;
}

export function startsRun(prev, row, gapMs = RUN_GAP_MS) {
  if (!prev) return true;
  if (isSystem(prev) || isSystem(row)) return true;
  if (speakerOf(prev) !== speakerOf(row)) return true;
  const at = row.sentAt ? new Date(row.sentAt).getTime() : 0;
  const prevAt = prev.sentAt ? new Date(prev.sentAt).getTime() : 0;
  return at - prevAt > gapMs;
}
