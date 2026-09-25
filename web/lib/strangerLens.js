import "server-only";
import { prisma } from "@lifeweb/db";
import { createLens } from "@lifeweb/db/lib/strangers";

// The reader's lens on the feed (db/lib/strangers.js, docs/systemdocs/STRANGERS.md):
// a speaker they cannot put a name to reads as "a young man", with their own
// voice number when they have heard it. Every surface that hands feed rows to a
// browser runs them through one of these. `viewer` is web/lib/feedAccess.js's
// loadFeedViewer answer. A GM reads rows as built, and a reader with no
// character of their own (a ghost, the lobby) recognises everybody.
export function lensFor(viewer) {
  return createLens(prisma, { characterId: viewer?.character?.id ?? null, gm: Boolean(viewer?.gm) });
}

// A whole batch through the lens: one round of lookups, then the rows.
export async function lensRows(viewer, rows) {
  return lensFor(viewer).all(rows);
}
