// Filing a Move, on either face. This is the Action row and every gate in
// front of it: the open turn, the move window, the one-Move-a-turn rule, the
// incapacitation block and Labor's rate. It came out of the bot's Move modal
// submit handler, which was the only place in the game that knew how to file
// one — so the Hall's Move dialog could only ever have been a second copy.
//
// It writes no Discord and composes no confirmation: the bot's `confirmMove`
// still writes the DM's lines, and the web renders its own. What comes back
// is the Action, plus the labor rate when there is one, so either face can
// say what was filed.
const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { blockerFor, ACT } = require("./incapacitation");
const { resolveLaborRate } = require("./laborAccess");
const { touchCharacterActivity } = require("./characterActivity");

const MOVE_KINDS = new Set(["ROUTINE", "GAMBIT", "LABOR"]);
const DESCRIPTION_MAX = 2000;

// `character` needs { id, zoneId, locationId, discordUserId }.
// Returns { ok: true, action, laborRate, openTurn } or { ok: false, error }.
async function fileMove(prisma, { character, actorDiscordUserId, moveKind, description }) {
  if (!character) return { ok: false, error: "You don't have a living character. ‡" };
  if (!MOVE_KINDS.has(moveKind)) return { ok: false, error: "Pick a kind of Move first. ‡" };

  const raw = String(description ?? "").trim();
  if (!raw) return { ok: false, error: "Write something first. ‡" };
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
      details: { actionId: action.id, kind: moveKind, tier: laborRate?.tier ?? null },
    },
  });

  return { ok: true, action, laborRate, openTurn };
}

module.exports = { MOVE_KINDS, DESCRIPTION_MAX, fileMove };
