import { cache } from "react";
import { prisma } from "@lifeweb/db";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { clockFrozen } from "@lifeweb/db/lib/gameState";

// Multiple call sites (root layout, app shell, individual pages) all need
// the open turn on every request — cache() dedupes those into one query
// per request instead of 2-3. No TTL beyond that: turn state is GM-triggered
// and some actions rely on a fresh read right after revalidatePath, which a
// hand-rolled cross-request cache wouldn't respect.
//
// Pure formatting helpers (describeTurn, themeForPhase, formatTurnLabel)
// live in turnFormat.js, not here — this file imports @lifeweb/db (Prisma),
// and any client component importing from this file would drag that whole
// barrel (and its node:fs-touching dependencies) into the browser bundle.
export const getOpenTurn = cache(async () => {
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
});

// When Moves stop being accepted, as two plain numbers the browser can tick
// against. Nothing stores a turn's lock time — db/lib/turnClock.js derives it
// from `startedAt` (TURN-ENGINE.md §6a) — and the derivation needs to know
// whether the clock is frozen, so the read is here rather than in a component.
//
// Null when there is no turn, or when moveWindow says there is no lock at all:
// a frozen clock or a turn shorter than the lock window has no honest time to
// count to, and the header simply says nothing rather than inventing one.
//
// Numbers, not Dates, and deliberately no `locked` boolean. The header is a
// client component ticking every 30s, so it derives `locked` from these two
// itself — a boolean fixed at page load would be wrong on any desk left open
// across the cutoff, and shipping both would give two answers to one question.
//
// cache()d for the same reason getOpenTurn is: the root layout asks once and
// every header reads the answer through context.
export const getMoveWindow = cache(async () => {
  const [turn, frozen] = await Promise.all([getOpenTurn(), clockFrozen(prisma)]);
  if (!turn) return null;
  const { cutoffAt, endsAt, hasLock } = moveWindow(turn, { clockFrozen: frozen });
  if (!hasLock) return null;
  return { cutoffAtMs: cutoffAt.getTime(), endsAtMs: endsAt.getTime() };
});
