import { prisma } from "@lifeweb/db";
import { scrambleState, scrambleFields } from "@lifeweb/db/lib/memoryScramble";
import { ensurePin } from "@lifeweb/db/lib/acquaintances";

// The one server-side answer to "whose memories, and can they read them today"
// for /memories and its actions (docs/systemdocs/MEMORIES.md). Every caller
// starts from the session's discordUserId, never a posted id.
//
// The Friends section and the day's lines belong to the CHARACTER — a new
// character starts knowing only what their seat knows — while Notes and
// Highlights belong to the ACCOUNT, as they always have. So a player with no
// living character still gets their Notes and Highlights, and an empty
// Friends list.

const VIEWER_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  age: true,
  pin: true,
  roleTitle: true,
  role: { select: { slug: true, name: true, intro: true, description: true, groupSlug: true } },
  // What memoryScramble.js reads: which tags, and when they arrived.
  tags: {
    where: { tag: { slug: { in: ["concussed", "amnesiac"] } } },
    select: { acquiredAt: true, tag: { select: { slug: true } } },
  },
};

// `{ character, state, dayNumber }`. `character` is null for a player with no
// living character, and `state` is then never active — there is nobody to be
// concussed.
export async function loadMemoryViewer(discordUserId) {
  const [character, openTurn] = await Promise.all([
    discordUserId
      ? prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: VIEWER_SELECT })
      : null,
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true, dayNumber: true } }),
  ]);
  const dayNumber = openTurn?.dayNumber ?? null;
  // A character made before the PIN existed gets one the first time they look
  // (the backfill mints the rest). updateMany on `pin: null`, so it is a no-op
  // every visit after.
  if (character && !character.pin) {
    await ensurePin(prisma, character.id).catch(() => {});
    const fresh = await prisma.character.findUnique({ where: { id: character.id }, select: { pin: true } });
    character.pin = fresh?.pin ?? null;
  }
  const state = scrambleState({ characterId: character?.id ?? null, tags: character?.tags ?? [], dayNumber: dayNumber ?? 0 });
  return { character, state, dayNumber, turnNumber: openTurn?.number ?? null };
}

// The item keys, in one place, so the page and the edit guards garble exactly
// the same things.
export const journalKey = (id) => `journal:${id}`;
export const starKey = (id) => `star:${id}`;
export const lineKey = (seq) => `line:${seq}`;

// Whether a journal entry is unreadable today — the edit guard's question.
export function journalScrambled(state, id) {
  return scrambleFields(state, journalKey(id), { title: "x" }).scrambled;
}
