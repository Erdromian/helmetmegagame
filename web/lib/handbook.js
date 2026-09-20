import "server-only";
import fs from "node:fs";
import { cache } from "react";
import { docsPath } from "@lifeweb/db/lib/repoPaths";

// Turbopack inlines __dirname as a literal, so use docsPath, not a hand-rolled path.join.
const getHandbookText = cache(() => {
  const p = docsPath("handbook.md");
  if (!p) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
});

// TEMPORARILY OFF. Bascinet does not want players reading the handbook yet.
// Both surfaces already treat a null body as "there is no handbook" — the
// public /handbook page calls notFound(), and /documents drops the pinned
// card — so this one flag closes both, and nothing else has to know.
// To put it back: set this to false and uncomment the three /handbook nav
// entries in web/lib/navItems.js. Nothing else was touched.
const HANDBOOK_HIDDEN = true;

export function getHandbookBody() {
  if (HANDBOOK_HIDDEN) return null;
  const text = getHandbookText();
  if (!text) return null;
  return text.replace(/^#\s+.*\n+/, "");
}

// Reserved in db/lib/syncDocuments.js#RESERVED_KEYS — a synthesized card's key can never double as a real Document row's key.
export const HANDBOOK_KEY = "handbook";
