// Filing a Move, on either face. This is the Action row and every gate in
// front of it: the open turn, the move window, the one-Move-a-turn rule, the
// incapacitation block and Labor's rate. It came out of the bot's Move modal
// submit handler, which was the only place in the game that knew how to file
// one — so Chat's Move dialog could only ever have been a second copy.
//
// It writes no Discord and composes no confirmation: the bot's `confirmMove`
// still writes the DM's lines, and the web renders its own. What comes back
// is the Action, plus the labor rate when there is one, so either face can
// say what was filed.
const { Prisma } = require("@prisma/client");
const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { blockerFor, ACT } = require("./incapacitation");
const { resolveLaborRate } = require("./laborAccess");
const { touchCharacterActivity } = require("./characterActivity");
// Editing a confirmed Move re-confirms it, so the die and the ⬢ roll come
// from the one place that knows how to make them (db/lib/moveConfirm.js).
const { confirmMove } = require("./moveConfirm");

const MOVE_KINDS = new Set(["ROUTINE", "GAMBIT", "LABOR"]);
const DESCRIPTION_MAX = 2000;

// `character` needs { id, zoneId, locationId, discordUserId }.
// Returns { ok: true, action, laborRate, openTurn } or { ok: false, error }.
async function fileMove(prisma, { character, actorDiscordUserId, moveKind, description }) {
  if (!character) return { ok: false, error: "You don't have a living character. ‡" };
  if (!MOVE_KINDS.has(moveKind)) return { ok: false, error: "Pick a kind of Move first. ‡" };

  const raw = String(description ?? "").trim();
  if (!raw) return { ok: false, error: "Write something first." };
  if (raw.length > DESCRIPTION_MAX) return { ok: false, error: "That's too long to file. ‡" };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, error: "No turn is open — your Move wasn't recorded. ‡" };

  // Re-checked here rather than only where the dialog opened: a form can sit
  // open across the cutoff. Before the Action row, so a refusal costs no turn.
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) return { ok: false, error: "Moves for this turn are locked. Yours wasn't recorded. ‡" };

  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (alreadyActed) {
    return { ok: false, error: "You've already locked in a Move this turn — this one wasn't recorded. ‡" };
  }

  // The same gate every other action runs (db/lib/incapacitation.js): Bound,
  // Dying, Crucified, out cold — none of them files a Move. Checked after the
  // already-acted test so a refusal costs nothing, and before the Action row
  // so a refused Move never lands on the desk.
  const heldTags = await prisma.characterTag.findMany({
    where: { characterId: character.id },
    select: { tag: { select: { slug: true, name: true } } },
  });
  const stuck = blockerFor(heldTags, ACT);
  if (stuck) {
    return { ok: false, error: `You can't act right now — you're ${stuck.name}. Nothing was recorded. ‡` };
  }

  // Labor is its own kind, not a checkbox riding along with a Routine — so
  // picking it IS forgoing the day's other business.
  let resourceRollExpression = null;
  let laborRate = null;
  if (moveKind === "LABOR") {
    laborRate = await resolveLaborRate(prisma, character.id);
    if (!laborRate.ok) return { ok: false, error: `${laborRate.reason} ‡` };
    resourceRollExpression = laborRate.expression;
  }

  // @@unique([characterId, turnId]) is the real gate; a retried submit at
  // rollover must not become a second Move.
  let action;
  try {
    action = await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "PENDING_TYPE",
        moveKind,
        description: raw,
        resourceDelta: null,
        resourceRollExpression,
        zoneId: character.zoneId ?? null,
        // Stamped at filing time. A free zone move costs no Action, so by the
        // time a Labor pays at turn close they may be standing somewhere else.
        locationId: character.locationId ?? null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") return { ok: false, error: "You've already acted this turn. ‡" };
    throw err;
  }

  await touchCharacterActivity(prisma, character.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      // Three per-turn rations COUNT audit rows (REQUESTS.md §1a), so every
      // row a turn can hold gets its turn stamped even when nothing reads it
      // yet — a ration added later would otherwise silently read zero.
      turnId: openTurn.id,
      details: { actionId: action.id, kind: moveKind, tier: laborRate?.tier ?? null },
    },
  });

  return { ok: true, action, laborRate, openTurn };
}

// A Move that is already filed, changed. Same gates as fileMove and one more:
// the row has to still be the player's to change — unadjudicated, unlocked,
// and nothing pushed onto the sheet from it yet.
//
// The one-Move-a-turn rule makes this the only way to correct a typo or think
// better of a Gambit: there is nothing to cancel and re-file, because the
// @@unique([characterId, turnId]) row is the turn.
const EDITABLE_STATUSES = new Set(["PENDING_TYPE", "CONFIRMED"]);
// PASSED is where every confirmed Routine lands the moment it is filed — it
// means "no GM needs to touch this", not "a GM has". Anything else on this
// field IS a GM holding the row.
const EDITABLE_REVIEW = new Set(["OPEN", "PASSED"]);

// Not every Action row on a turn was filed by the player. The lesson and the
// confession write a Gambit for the learner and the penitent, the auto-labor
// pass writes a Labor, a paid zone crossing writes a travel stub and a GM can
// spend somebody's turn from the dev panel — and every one of them stamps an
// `auto:` marker into `gmNotes` (db/lib/stagedPush.js tests the same
// substring, web/lib/moves.js reads the same markers for its labels). Those
// rows are the record of something that already happened, with an Offer or a
// tag write hanging off them, so Edit must never re-open one: changing the
// kind would roll a fresh die for a lesson nobody re-taught.
function filedByPlayer(action) {
  return !(action?.gmNotes ?? "").includes("auto:");
}

// One kind change a turn, counted off the audit log. Switching kinds
// re-confirms the row, and re-confirming ROLLS — so without a cap a Gambit
// could be re-rolled all afternoon by flipping to Routine and back. The count
// is the ration (REQUESTS.md §1a), which is why the `move_edited` row stamps
// `kindChanged` and sets `turnId`.
async function kindChangeUsed(prisma, characterId, turnId) {
  const used = await prisma.auditLog.count({
    where: {
      targetCharacterId: characterId,
      turnId,
      actionType: "move_edited",
      details: { path: ["kindChanged"], equals: true },
    },
  });
  return used > 0;
}

const KIND_SPENT = "You can change what kind of Move it is once a turn. ‡";
const NOT_YOURS = "That turn is already spoken for. ‡";
const SETTLED = "That Move has already been settled. ‡";

async function editMove(prisma, { character, actorDiscordUserId, actionId, moveKind, description }) {
  if (!character) return { ok: false, error: "You don't have a living character. ‡" };
  if (!MOVE_KINDS.has(moveKind)) return { ok: false, error: "Pick a kind of Move first. ‡" };

  const raw = String(description ?? "").trim();
  if (!raw) return { ok: false, error: "Write something first." };
  if (raw.length > DESCRIPTION_MAX) return { ok: false, error: "That's too long to file. ‡" };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, error: "No turn is open — nothing was changed. ‡" };

  // Re-checked here for the same reason fileMove re-checks it: a dialog can
  // sit open across the cutoff.
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) return { ok: false, error: "Moves for this turn are locked. Yours is as it was. ‡" };

  // Ownership and the turn are part of the QUERY, never trusted from the
  // post — a server action is a public endpoint.
  const existing = await prisma.action.findFirst({
    where: { id: String(actionId ?? ""), characterId: character.id, turnId: openTurn.id },
  });
  if (!existing) return { ok: false, error: "That Move isn't yours to change. ‡" };
  if (!filedByPlayer(existing)) return { ok: false, error: NOT_YOURS };
  if (!EDITABLE_STATUSES.has(existing.status) || !EDITABLE_REVIEW.has(existing.moveReviewStatus)) {
    return { ok: false, error: "A GM has already picked this Move up. ‡" };
  }
  // The cooperative adjudication lock (web/lib/moveEconomy.js#lockIsLive is
  // the same predicate, on the desk's side).
  if (existing.lockExpiresAt && existing.lockExpiresAt.getTime() > Date.now()) {
    return { ok: false, error: "A GM has already picked this Move up. ‡" };
  }
  if (existing.appliedEffects != null) return { ok: false, error: SETTLED };

  const heldTags = await prisma.characterTag.findMany({
    where: { characterId: character.id },
    select: { tag: { select: { slug: true, name: true } } },
  });
  const stuck = blockerFor(heldTags, ACT);
  if (stuck) {
    return { ok: false, error: `You can't act right now — you're ${stuck.name}. Nothing was changed. ‡` };
  }

  const previousKind = existing.moveKind ?? null;
  const kindChanged = previousKind !== moveKind;
  const wasConfirmed = existing.status === "CONFIRMED";

  // Before the labor rate is resolved, so a refusal costs nothing.
  if (kindChanged && (await kindChangeUsed(prisma, character.id, openTurn.id))) {
    return { ok: false, error: KIND_SPENT };
  }

  let laborRate = null;
  if (moveKind === "LABOR") {
    laborRate = await resolveLaborRate(prisma, character.id);
    if (!laborRate.ok) return { ok: false, error: `${laborRate.reason} ‡` };
  }

  const data = { moveKind, description: raw };
  // Only when there is no roll to disturb. A confirmed Labor whose text is
  // being fixed has already rolled, and its stored range was cut for Lazy
  // (db/lib/moveConfirm.js) — rewriting it with the pre-cut one would print a
  // range the payout is not inside.
  if (kindChanged || !wasConfirmed) {
    if (moveKind === "LABOR") {
      data.resourceRollExpression = laborRate.expression;
    } else {
      // A Routine must never keep a Labor's payout.
      data.resourceRollExpression = null;
      data.resourceRollValue = null;
      data.resourceDelta = null;
    }
  }
  if (kindChanged) {
    // The die belongs to the kind that rolled it. Changing kinds throws it
    // away; staying a Gambit keeps it, because Edit is not a re-roll button.
    data.diceRoll = null;
    data.diceModifier = null;
    data.resourceRollValue = null;
    data.resourceDelta = null;
    // PASSED was the old kind's answer. A Gambit needs a GM again.
    if (wasConfirmed) data.moveReviewStatus = "OPEN";
  }

  // The write is the gate, not the read above it. Between that findFirst and
  // here the staged push can claim the row (db/lib/stagedPush.js writes
  // appliedEffects from null under the same DbNull filter) or a GM can take
  // it — so the conditions ride along in the WHERE and a lost race edits
  // nothing rather than overwriting a settled Move.
  const claimed = await prisma.action.updateMany({
    where: {
      id: existing.id,
      appliedEffects: { equals: Prisma.DbNull },
      status: { in: [...EDITABLE_STATUSES] },
    },
    data,
  });
  if (claimed.count === 0) return { ok: false, error: SETTLED };

  let action = await prisma.action.findUnique({ where: { id: existing.id } });

  // Two rows need confirming again. A row that changed KIND, because that is
  // where the Gambit die is rolled and a Labor's range is rolled into ⬢ — and
  // a PENDING_TYPE row whatever changed, because that is a draft abandoned
  // half-way through the Discord dropdowns, and an edit of it is the player
  // finishing the Move. Left unconfirmed it stays invisible to the desk and
  // the push, and costs them the turn silently.
  let roll = null;
  if (kindChanged || !wasConfirmed) {
    const loaded = await prisma.action.findUnique({
      where: { id: existing.id },
      include: { character: { include: { tags: { include: { tag: true } } } } },
    });
    const confirmed = await confirmMove(prisma, loaded, actorDiscordUserId ?? character.discordUserId ?? null, {
      laborRate,
    });
    action = confirmed.updated;
    roll = confirmed.roll;
  }

  await touchCharacterActivity(prisma, character.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
      actionType: "move_edited",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: {
        actionId: action.id,
        kind: moveKind,
        previousKind,
        // Read back by kindChangeUsed() above — this row IS the ration.
        kindChanged,
        tier: laborRate?.tier ?? null,
      },
    },
  });

  return { ok: true, action, laborRate, openTurn, roll };
}

module.exports = {
  MOVE_KINDS,
  DESCRIPTION_MAX,
  EDITABLE_STATUSES,
  EDITABLE_REVIEW,
  fileMove,
  editMove,
  filedByPlayer,
  kindChangeUsed,
};
