import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import {
  JOURNAL_TITLE_MAX_LENGTH,
  JOURNAL_BODY_MAX_LENGTH,
  JOURNAL_LABEL_MAX_LENGTH,
  JOURNAL_MAX_LABELS,
} from "@/lib/constants";

// What a memory may hold, in one place, for both writers: the player's own
// /memories actions and the GM's Dev Panel tab (docs/systemdocs/MEMORIES.md §8).
// A server action re-checks every length here rather than trusting an input's
// maxLength.

const FRIEND_NAME_MAX = 80;
const FRIEND_ROLE_MAX = 60;
const FRIEND_NOTES_MAX = 2000;

// A typed role that is exactly a seat's name files the entry under that seat's
// estate on the page. Anything else is still kept, word for word, and files
// under "Unknown".
export async function roleSlugFor(roleText) {
  if (!roleText) return null;
  const role = await prisma.role.findFirst({
    where: { name: { equals: roleText, mode: "insensitive" } },
    select: { slug: true },
  });
  return role?.slug ?? null;
}

export function cleanFriend({ name, roleText, notes }) {
  const cleanName = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, FRIEND_NAME_MAX);
  if (!cleanName) throw new UserError("Give them a name, even a made-up one.");
  return {
    name: cleanName,
    roleText: String(roleText ?? "").trim().replace(/\s+/g, " ").slice(0, FRIEND_ROLE_MAX) || null,
    notes: String(notes ?? "").trim().slice(0, FRIEND_NOTES_MAX),
  };
}

// Trims, drops blanks, de-dupes case-insensitively (keeping the first casing
// seen), and caps both the count and each label's length.
function cleanLabels(labels) {
  if (!Array.isArray(labels)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim().slice(0, JOURNAL_LABEL_MAX_LENGTH);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= JOURNAL_MAX_LABELS) break;
  }
  return out;
}

export function cleanJournal({ title, body, labels, pinned, turnNumber }) {
  const cleanTitle = String(title ?? "").trim().slice(0, JOURNAL_TITLE_MAX_LENGTH);
  const cleanBody = String(body ?? "").trim().slice(0, JOURNAL_BODY_MAX_LENGTH);
  if (!cleanTitle) throw new UserError("Give the entry a title.");
  if (!cleanBody) throw new UserError("An entry needs some text.");
  return {
    title: cleanTitle,
    body: cleanBody,
    labels: cleanLabels(labels),
    pinned: Boolean(pinned),
    turnNumber: Number.isInteger(turnNumber) ? turnNumber : null,
  };
}
