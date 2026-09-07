import { prisma } from "@lifeweb/db";
import { notifyTyping } from "@lifeweb/db/lib/typingNotify";
import { auth } from "@/lib/auth";
import { loadFeedCharacter, mayWritePlace } from "@/lib/feedAccess";

// POST /api/feed/typing { place } — the web half of "somebody is writing
// something". Discord raises its own event and bot/src/events/typingStart.js
// carries it across; this is the same fact from the other face, landing on the
// same NOTIFY channel so a reader cannot tell which one somebody is on.
//
// Gated exactly like a send: it goes through mayWritePlace, so a place a
// player cannot speak in cannot be made to say their name either. A Location
// is scenery, so typing there raises nothing — which is right, since there is
// no composer to type into.
export const dynamic = "force-dynamic";

// At most one notify per character per place per window. A composer fires this
// on every keystroke; the client throttles too, but the client is the half a
// player can rewrite, so the real limit is here.
const THROTTLE_MS = 4000;

// characterId + placeKey -> when it last went out. Module-level, so it lives
// for the process the way every other in-memory debounce in the app does. One
// web replica (HALL.md §3), and a stale entry costs one suppressed typing line.
const lastSent = new Map();

function throttled(key) {
  const now = Date.now();
  const at = lastSent.get(key) ?? 0;
  if (now - at < THROTTLE_MS) return true;
  lastSent.set(key, now);
  // The map only ever grows by the number of (person, place) pairs actually
  // typed in, but a long-lived process deserves a sweep all the same.
  if (lastSent.size > 2000) {
    for (const [k, when] of lastSent) if (now - when > THROTTLE_MS * 10) lastSent.delete(k);
  }
  return false;
}

export async function POST(request) {
  const session = await auth();
  if (!session?.discordUserId) return Response.json({ ok: false }, { status: 401 });

  const character = await loadFeedCharacter(session.discordUserId);
  if (!character) return Response.json({ ok: false }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const place = typeof body?.place === "string" ? body.place : null;
  if (!place) return Response.json({ ok: false }, { status: 400 });

  // Cheap first: a throttled call never touches the gate, so holding a key
  // down costs one string compare rather than a place-list rebuild.
  if (throttled(`${character.id}:${place}`)) return Response.json({ ok: true, throttled: true });

  if (!(await mayWritePlace(prisma, character, place))) {
    return Response.json({ ok: false }, { status: 403 });
  }

  await notifyTyping(prisma, { placeKey: place, characterId: character.id });
  return Response.json({ ok: true });
}
