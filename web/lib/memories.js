import { prisma } from "@lifeweb/db";
import { scrambleState, scrambleFields } from "@lifeweb/db/lib/memoryScramble";
import { ensurePin } from "@lifeweb/db/lib/acquaintances";
import { parsePlaceKey } from "@lifeweb/db/lib/placeKey";

// The one server-side answer to "whose memories, and can they read them today"
// for /memories and its actions (docs/systemdocs/MEMORIES.md). Every player
// caller starts from the session's discordUserId, never a posted id; the GM's
// Dev Panel tab starts from a character id, behind its own GM gate.
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

// The same answer for one character by id, whatever their status — the GM's
// Dev Panel tab (MEMORIES.md §8), which reads the dead and the gibbed as
// readily as the living. Null when there is no such character. It mints no
// PIN: a GM looking is not the character remembering.
export async function loadMemoryOwner(characterId) {
  const [character, openTurn] = await Promise.all([
    characterId
      ? prisma.character.findUnique({ where: { id: characterId }, select: { ...VIEWER_SELECT, discordUserId: true } })
      : null,
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true, dayNumber: true } }),
  ]);
  if (!character) return null;
  const dayNumber = openTurn?.dayNumber ?? null;
  const state = scrambleState({ characterId: character.id, tags: character.tags, dayNumber: dayNumber ?? 0 });
  return { character, state, dayNumber, turnNumber: openTurn?.number ?? null };
}

// Where a line was said, as a place name — best-effort, and only for the keys
// a day's line can carry. Several keys resolve with one query per kind.
export async function placeNames(placeKeys) {
  const ids = { room: new Set(), loc: new Set(), zone: new Set(), conv: new Set(), party: new Set() };
  for (const key of placeKeys) {
    const parsed = parsePlaceKey(key);
    if (parsed && ids[parsed.kind]) ids[parsed.kind].add(parsed.id);
  }
  const [rooms, locations, zones, threads, parties] = await Promise.all([
    ids.room.size
      ? prisma.room.findMany({ where: { id: { in: [...ids.room] } }, select: { id: true, name: true, location: { select: { name: true } } } })
      : [],
    ids.loc.size ? prisma.location.findMany({ where: { id: { in: [...ids.loc] } }, select: { id: true, name: true } }) : [],
    ids.zone.size ? prisma.zone.findMany({ where: { id: { in: [...ids.zone] } }, select: { id: true, name: true } }) : [],
    ids.conv.size
      ? prisma.playerThread.findMany({ where: { id: { in: [...ids.conv] } }, select: { id: true, location: { select: { name: true } } } })
      : [],
    ids.party.size ? prisma.partyThread.findMany({ where: { id: { in: [...ids.party] } }, select: { id: true, name: true } }) : [],
  ]);
  const names = new Map();
  for (const r of rooms) names.set(`room:${r.id}`, r.location?.name ? `${r.name}, ${r.location.name}` : r.name);
  for (const l of locations) names.set(`loc:${l.id}`, l.name);
  for (const z of zones) names.set(`zone:${z.id}`, `${z.name} summary`);
  // A conversation's own title is somebody's private choice of words; where it
  // happened is enough to jog a memory.
  for (const t of threads) names.set(`conv:${t.id}`, t.location?.name ? `A conversation, ${t.location.name}` : "A conversation");
  for (const p of parties) names.set(`party:${p.id}`, p.name);
  return names;
}

// The item keys, in one place, so the page and the edit guards garble exactly
// the same things.
export const journalKey = (id) => `journal:${id}`;
export const starKey = (id) => `star:${id}`;
export const lineKey = (seq) => `line:${seq}`;

// A journal entry as its writer reads it today. Words roll one by one, so the
// guard has to ask about the real words the page drew, not a stand-in.
export function scrambleJournal(state, entry) {
  return scrambleFields(state, journalKey(entry.id), { title: entry.title, body: entry.body });
}

// A day's line as the rememberer reads it: `row` has already been through
// their own lens (the name they heard it under, STRANGERS.md). The page and
// the ★ guard both ask this, so the line that cannot be starred is exactly the
// one the page drew with nonsense in it.
export function scrambleLine(state, seq, row) {
  return scrambleFields(state, lineKey(seq), { name: row.name ?? "", content: row.content ?? "" });
}
