// Validation errors must come back from a server action as *data*, never a thrown Error —
// production Next.js redacts a thrown error to React error #441. Callers branch on `ok`, never try/catch, for validation.
import { deployVersion } from "@/lib/deployVersion";
import { prisma } from "@lifeweb/db";
import { sessionGate } from "@lifeweb/db/lib/betweenSessions";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

// Anything but UserError rethrows untouched — `redirect()`/`notFound()` keep working. `version` is
// written FIRST so an action's own still wins; read by noteActionVersion() (useDeskVersion.js).
//
// `sfx` is the sound the clicker's own tab plays (web/app/components/sfx.js). A refusal carries
// the general one from here, so every refused action in the game buzzes without a single call
// site knowing sound exists; an action that wants its own — the Depot's money tone, mining's
// clink — returns it and wins, since `out` is spread last, same as with `version`.
export async function guarded(fn) {
  try {
    const out = await fn();
    return { ok: true, version: deployVersion(), ...(out ?? {}) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, version: deployVersion(), error: e.message, sfx: "refuse" };
    throw e;
  }
}

// The same thing for an action that CHANGES something. Between sittings the game is shut and a player may only talk
// (SESSIONS.md §5), so every verb goes out through here and every read stays on guarded(). The refusal is the same shape a
// UserError produces, buzzer and all, so no caller learns a new branch.
//
// This is the POLICY, not the lock — a few engines under db/lib check the same gate themselves, so an action file that
// forgets to reach for acting() still cannot write.
export async function acting(fn) {
  const gate = await sessionGate(prisma);
  if (!gate.ok) return { ok: false, version: deployVersion(), error: gate.message, sfx: "refuse" };
  return guarded(fn);
}
