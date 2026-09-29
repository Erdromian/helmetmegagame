"use server";

import { getGmSession } from "@/lib/discordGuild";
import { FreshCharacter } from "../character/page";

// The data behind /chat's Actions menu (next/ChatActions.js): the character
// sheet's own load, fetched only when a player opens the menu. Chat's first
// paint carries just the people half of the sheet's pools (chat/page.js), and
// loading the rest on every visit would slow down the page players sit on all
// day for a menu most visits never open.
//
// It is the SAME load as /character (character/page.js#FreshCharacter), not a
// second copy of its gates, so the menu and the sheet cannot disagree about
// what is lit. Read-only, and every verb it lights re-checks itself on the
// server when pressed.

// What the sheet ships that no action dialog reads — the Desires picker, the
// tag store, the portrait maker. Left out so the menu's payload is only what
// its dialogs need.
const NOT_FOR_ACTIONS = [
  "desireCatalog",
  "desireFamilies",
  "desireFamilyGroups",
  "desireLockNotes",
  "desireSlotStates",
  "desireAddiction",
  "storeTags",
  "storeHeldTags",
  "storeRoleSlug",
  "portraitSelection",
  "portraitMakerEnabled",
  "portraitFantasyPartsEnabled",
  "avatarUploadsEnabled",
  "hasCustomAvatar",
  "bloodMenu",
];

export async function loadActionSheet() {
  const { session, inGuild } = await getGmSession();
  if (!session?.discordUserId || !inGuild) return { ok: false, error: "Sign in again to act." };
  const data = await FreshCharacter({ userId: session.discordUserId, raw: true });
  if (data?.kind !== "sheet") return { ok: false, error: "You have no living character." };
  const sheet = { ...data.sheet };
  for (const key of NOT_FOR_ACTIONS) delete sheet[key];
  return { ok: true, sheet };
}
