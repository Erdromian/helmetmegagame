// Combat mode, both faces (docs/systemdocs/COMBAT-MODE.md): the web's button on /chat and the
// sheet (web/app/(app)/chat/actions.js#setCombatMode) and the Discord bot's /combat
// (bot/src/lib/verbs/self.js). See ./common.js for the result shape.
//
// Takes the state the player WANTS rather than flipping whatever is stored: turning it on can't be
// undone this turn, so a stale tab that thought it was pressing "off" must never turn it on.
const { autoMovesOpen } = require("../turnGate");
const { blockerFor, ACT } = require("../incapacitation");
const { logAudit } = require("../auditLog");
const { refuse, asResult } = require("./common");
const { TOO_EXHAUSTED, LOCKED_ON, ALERT_TOO_LATE, holdsExhausted } = require("../combatMode");
const { GUARD_LINES, endGuardsFor } = require("../guard");
const { seenById } = require("../intercept");
const { holdsCompulsion } = require("../vampireCompulsion");
const { COMPELLED_LOCKED_ON } = require("../compulsionLines");

// `character` needs { id } — the column and the tags are read here, so neither face's select has
// to carry them. `on` is the wanted state.
function setCombatMode(prisma, { character, discordUserId, on }) {
  return asResult(async () => {
    // Any time of the turn, so the Move lock doesn't apply — but there has to be a turn, and a game
    // out of session refuses as it does for every other verb.
    const gate = await autoMovesOpen(prisma);
    if (!gate.ok) refuse(gate.message);
    const turn = gate.turn;

    const row = await prisma.character.findUnique({
      where: { id: character.id },
      select: {
        combatModeSinceTurn: true,
        tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true, name: true } } } },
      },
    });
    if (!row) refuse("You don't have a living character.");
    const since = row.combatModeSinceTurn;

    if (on) {
      if (since != null) return { line: "You're already in combat mode.", on: true, changed: false };
      const blocker = blockerFor(row.tags, ACT);
      if (blocker) refuse(`You can't do that right now. You're ${blocker.name}.`);
      if (holdsExhausted(row.tags)) refuse(TOO_EXHAUSTED);
      // Conditional, so two presses racing stamp once.
      const won = await prisma.character.updateMany({
        where: { id: character.id, combatModeSinceTurn: null },
        data: { combatModeSinceTurn: turn.number },
      });
      if (won.count === 0) return { line: "You're already in combat mode.", on: true, changed: false };
    } else {
      if (since == null) return { line: "You're not in combat mode.", on: false, changed: false };
      // A Bloodcrazed or Wight Vampire is held in it for as long as the tag lasts (vampireCompulsion.js).
      if (holdsCompulsion(row.tags)) refuse(COMPELLED_LOCKED_ON);
      // Never gated on ACT: coming out of it is the way down, the Call off and Stop watching rule.
      if (since === turn.number) refuse(LOCKED_ON);
      const won = await prisma.character.updateMany({
        where: { id: character.id, combatModeSinceTurn: { not: null, notIn: [turn.number] } },
        data: { combatModeSinceTurn: null },
      });
      if (won.count === 0) return { line: "You're not in combat mode.", on: false, changed: false };
    }

    await logAudit(prisma, {
      actorDiscordUserId: discordUserId ?? "",
      actionType: "character_combat_mode_set",
      targetCharacterId: character.id,
      details: { on: Boolean(on), turnNumber: turn.number },
    }).catch((err) => console.error("Combat mode audit log failed:", err));

    // Turning it on in the middle of a fight you were caught out by changes nothing about THAT fight — the
    // snapshot was taken when it reached you (Combat Overhaul.docx) — so say so, rather than let them think
    // they can now write their attack.
    let tooLate = false;
    if (on && typeof prisma.combatParticipant?.findFirst === "function") {
      const fight = await prisma.combatParticipant.findFirst({
        where: { characterId: character.id, activeTurnId: turn.id, alert: false },
        select: { id: true },
      });
      tooLate = Boolean(fight);
    }

    // An escort needs combat mode, so coming out of it ends one (ATTACK.md §6a; Bascinet, 2026-09-30). The
    // escort reads it in the reply below; the charge is told by DM, which the face sends.
    let dms = [];
    let line = on ? (tooLate ? `You feel alert. ${ALERT_TOO_LATE}` : "You feel alert.") : "You give yourself a chance to relax.";
    if (!on) {
      const guarding = await prisma.character.findUnique({ where: { id: character.id }, select: { guardingId: true } });
      if (guarding?.guardingId) {
        const name = await seenById(prisma, character.id, guarding.guardingId);
        dms = await endGuardsFor(prisma, [character.id], { line: null, seenById });
        line = `${line} ${GUARD_LINES.STOPPED(name)}`;
      }
    }

    return { line, on: Boolean(on), changed: true, dms };
  });
}

module.exports = { setCombatMode };
