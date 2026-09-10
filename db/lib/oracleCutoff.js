// Fires the Oracle when a turn's Move cutoff passes. See docs/systemdocs/ORACLE.md.
//
// The Oracle used to run at turn close, from the side-effect thunk. That put it
// on the wrong side of the only three hours it was built to help with: Moves
// lock at 21:00 CT and gamemasters adjudicate what was filed between then and
// the midnight push, so a chronicle written after the push arrived once the
// ruling was over. It runs at the lock now, and a GM reads it while they work.
//
// There is no lock EVENT to hang this on. moveCutoffAt() is derived from
// turn.startedAt and moveWindow() only answers when something asks, so this is
// a per-minute check rather than a subscription. A fixed 21:00 cron would be
// wrong for a turn a GM opened by hand at 02:00, and would fire during a frozen
// clock when no turn is moving at all.

const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { runOracle } = require("./oracle");

// A failing zone costs a 180s timeout plus one retry before it gives up
// (oracleClient.js), so a provider outage at the cutoff would otherwise spend
// the whole three-hour window retrying. Three tries and the turn is left to
// Run now. In-process on purpose: a restart is a new situation and deserves a
// fresh count, and this is not worth a column.
const MAX_ATTEMPTS = 3;

// See the guard below — this keeps the run out of the stage sweep's minute.
const SETTLE_MS = 2 * 60 * 1000;
const attempts = new Map();

function spendAttempt(turnId) {
  // Only ever one turn in flight, so anything else in here is last turn's.
  for (const key of attempts.keys()) {
    if (key !== turnId) attempts.delete(key);
  }
  const spent = attempts.get(turnId) ?? 0;
  attempts.set(turnId, spent + 1);
  return spent;
}

// Should this turn be drafted right now? Pure, so every branch is testable
// without a database, a clock or a provider — which matters, because all but
// one of them is a REFUSAL and a refusal that fires by mistake is silent.
// Returns a reason rather than a bare false so a log line can say which.
function cutoffDecision(turn, { now = new Date(), clockFrozen = false } = {}) {
  if (!turn) return { draft: false, reason: "no open turn" };

  const { locked, hasLock, cutoffAt } = moveWindow(turn, { now, clockFrozen });

  // No cutoff, no page. A frozen clock or a turn shorter than the lock has no
  // moment to fire on, and inventing one would mean writing a chronicle of a
  // turn nobody has finished filing. The next turn with a real cutoff windows
  // back over the gap, so the material still reaches a page.
  if (!hasLock) return { draft: false, reason: "this turn never locks" };

  // `locked` is false on BOTH sides: before the cutoff, and again once the turn
  // has outlived its derived end because an advance was missed. The second is
  // deliberate (turnClock.js) and means a turn can go unchronicled — Run now is
  // the recovery, and it is a better answer than drafting into a turn that is
  // hours past its own ending.
  if (!locked) return { draft: false, reason: now < cutoffAt ? "before the cutoff" : "past the turn's end" };

  // Two minutes after the lock, not on it. The Makeshift Stage sweep holds
  // "0 3,9,15,21" in this same timezone (bot/src/events/ready.js), and its own
  // comment says those hours were offset off midnight precisely so a sweep
  // never races a turn close. Opening seven model calls and a full turn load in
  // that same minute would walk straight back into it.
  if (now.getTime() - cutoffAt.getTime() < SETTLE_MS) return { draft: false, reason: "settling" };

  return { draft: true, reason: "at the cutoff" };
}

async function runOracleAtCutoff(db, { now = new Date() } = {}) {
  // advanceTurn leaves nothing OPEN between flipping the old turn RESOLVED and
  // creating the next one, so no open turn is an ordinary answer here, not a
  // fault — the same window riteSweep.js works around.
  const turn = await db.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, startedAt: true },
  });
  if (!turn) return { ran: false };

  const { draft } = cutoffDecision(turn, { now, clockFrozen: await clockFrozen(db) });
  if (!draft) return { ran: false };

  if ((attempts.get(turn.id) ?? 0) >= MAX_ATTEMPTS) return { ran: false };

  // One key per zone, and a failure is logged rather than thrown: this is a
  // cron with nobody waiting on it, and one dead zone must not cost the five
  // that would have written fine. A run that ends short leaves the set
  // incomplete, so the next tick redraws the turn whole (db/lib/oracle.js) —
  // which is why a partial failure here is safe to walk away from.
  const step = async (key, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Oracle step "${key}" failed:`, err.message ?? err);
    }
  };

  const before = spendAttempt(turn.id);
  const result = await runOracle(db, { turnId: turn.id, step, skipIfComplete: true });

  // Nothing to do is not an attempt. Un-spend it, or a quiet game would burn
  // its three tries on the ticks that found the set already complete.
  if (!result.ran) attempts.set(turn.id, before);

  return { ...result, turnNumber: turn.number };
}

module.exports = { runOracleAtCutoff, cutoffDecision };
