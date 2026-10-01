// The per-turn medical-Gambit pass, run from db/index.js#resolveNeeds() right
// after Confessions and before the staged push — same slot as Research and
// Confession, and for the same reason: the die was decided at file time
// (web/app/(app)/character/actions/medical.js#healCharacterRequestImpl,
// Action.diceRoll/diceModifier), and this is where it gets read and turned
// into a result. docs/systemdocs/MEDICAL.md §3a, docs/systemdocs/TAGS.md §5c.
//
// Every Action carrying an `auto:heal_gambit` gmNotes marker on the closing
// turn is resolved here, whatever a GM did to it on the desk
// (db/lib/autoGambits.js): total = diceRoll + diceModifier against the
// threshold frozen on its own request_heal_character audit row at file time
// (db/lib/healGambit.js#healThreshold). Clearing it cures the affliction, the
// same aftermath a routine cure grants; missing it leaves the affliction on
// and grants a complication picked off db/lib/healComplications.js, scaled
// to how badly the roll missed. Either way the Action is SOLVED with a
// result line, so the staged push (db/lib/stagedPush.js) closes it as
// adjudicated rather than silently.
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never
// sends it. Returns an object even when idle: db/index.js treats null as a
// failed pass to retry.
const { dropCharacterTag, grantTagSlugs } = require("./tagWrites");
const { rollTagChain } = require("./tagShapes");
const { applyMood, applyWoundMood, woundMoodFor } = require("./mood");
const { rollLine } = require("./gambitModifier");
const { severityRungOf, healOutcome } = require("./healGambit");
const { pickComplication } = require("./healComplications");
const { seenById } = require("./intercept");
const { capitalizeFirst } = require("./concealedIdentity");
const { logAudit } = require("./auditLog");
const { isSettled, withSettled } = require("./autoGambits");

const HEAL_AUDIT_ACTION = "request_heal_character";
const RESOLVED_AUDIT_ACTION = "heal_gambit_resolved";

function lockCharacter(tx, characterId) {
  return tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

async function runHealGambitPass(prisma, turn) {
  const idle = { turnNumber: turn.number, resolved: 0, cured: 0, complicated: 0, failed: 0, dms: [] };

  const actions = await prisma.action.findMany({
    where: {
      turnId: turn.id,
      // Coarse DB pre-filter, the same "regex/marker in JS decides, the
      // query just narrows" split researchPass.js uses.
      gmNotes: { contains: "auto:heal_gambit" },
    },
    include: {
      character: { select: { id: true, name: true, discordUserId: true } },
    },
  });
  if (actions.length === 0) return idle;

  const dms = [];
  let resolved = 0;
  let cured = 0;
  let complicated = 0;
  let failed = 0;

  for (const action of actions) {
    const medic = action.character;
    if (!medic) continue;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // Only a Reject (the row is gone) or this pass's own earlier run stops
        // it. A GM's Result, Solve or Reopen does not (autoGambits.js).
        const fresh = await tx.action.findUnique({ where: { id: action.id }, select: { gmNotes: true } });
        if (!fresh || isSettled(fresh.gmNotes)) return null;
        const gmNotes = withSettled(fresh.gmNotes);

        // The frozen quote from file time: which tag, on whom, and the
        // threshold the roll has to clear (db/lib/healGambit.js#healThreshold,
        // stamped by medical.js). Matched by the actionId this same request
        // wrote into its own audit row — there is exactly one per Action.
        const auditRow = await tx.auditLog.findFirst({
          where: {
            actionType: HEAL_AUDIT_ACTION,
            details: { path: ["actionId"], equals: action.id },
          },
        });
        const details = auditRow?.details;
        const targetCharacterId = details?.targetCharacterId ?? null;
        const tagId = details?.tagId ?? null;
        const threshold = details?.threshold ?? null;
        if (!targetCharacterId || !tagId || threshold == null) {
          // Shouldn't happen — every gambit heal logs its own quote at file
          // time. Solved anyway, with a message that says so, rather than
          // left to jam the desk forever.
          await tx.action.update({
            where: { id: action.id },
            data: {
              moveReviewStatus: "SOLVED",
              gmNotes,
              resultMessage: "Could not be resolved automatically — its own record was incomplete.",
              reviewedAt: new Date(),
            },
          });
          return null;
        }

        const target = await tx.character.findUnique({
          where: { id: targetCharacterId },
          select: { id: true, name: true, discordUserId: true, status: true },
        });
        // As the medic knows them: a stranger they treated is "a young man"
        // in the result too (intercept.js#seenBy).
        const targetName = target ? await seenById(tx, action.characterId, target.id) : "the patient";
        const selfHeal = targetCharacterId === action.characterId;

        // Same lock order medical.js's own routine branch uses — sorted, not
        // medic-then-patient, so two of these resolving in the same push
        // (or one racing a live request somehow still in flight) can't
        // deadlock. In practice nothing else can file against either row
        // while a turn is between OPEN turns, but the discipline is cheap.
        const lockIds = selfHeal ? [action.characterId] : [action.characterId, targetCharacterId].sort();
        for (const id of lockIds) await lockCharacter(tx, id);

        const { text: rollText, total } = rollLine(turn, action);

        // Gone since filing — traded, cured some other way, or the row's
        // tag simply isn't there any more. An unread roll couldn't have
        // cured it either way; nothing left to resolve against.
        const held = target
          ? await tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId: targetCharacterId, tagId } },
            })
          : null;
        if (!target || target.status !== "ALIVE" || !held) {
          const resultMessage = `${total} → nothing to resolve — ${!target ? "the patient is gone" : target.status !== "ALIVE" ? `${targetName} is no longer living` : `${targetName} no longer holds it`}.`;
          await tx.action.update({
            where: { id: action.id },
            data: { moveReviewStatus: "SOLVED", gmNotes, resultMessage, reviewedAt: new Date() },
          });
          return {
            resolved: true,
            medicDm: `${rollText} There was nothing left to treat.`,
            patientDm: null,
          };
        }

        // The rung the ladder prices this affliction at (TAGS.md §5c),
        // group-agnostic on purpose — see healGambit.js#severityRungOf for
        // why this can't reuse mood.js's own wound rung.
        const tag = await tx.tag.findUnique({
          where: { id: tagId },
          select: {
            slug: true,
            name: true,
            removesInto: true,
            requirementResources: true,
            requirementTurns: true,
            requirementPerTurn: true,
            requirementGambit: true,
            group: { select: { slug: true } },
          },
        });
        const severityRung = severityRungOf(tag);
        const { succeeded, complicationRung } = healOutcome({
          die: action.diceRoll,
          diceModifier: action.diceModifier,
          threshold,
          severityRung,
        });

        let moodDm = null;
        let complicationName = null;
        if (succeeded) {
          await dropCharacterTag(tx, targetCharacterId, tagId);
          await grantTagSlugs(tx, targetCharacterId, rollTagChain(tag.removesInto), turn.number);
          // Half of what the wound would have cost the mood, the same relief
          // a routine cure gives (MOOD.md) — 0 outside the three groups the
          // mood dial actually charges for a wound, same as it is today.
          const relief = -woundMoodFor(tag) / 2;
          if (relief > 0) {
            const applied = await applyMood(tx, targetCharacterId, { kind: "HEALED", base: relief, notify: false });
            moodDm = applied?.dm ?? null;
          }
        } else {
          const complicationSlug = pickComplication(tag.group?.slug, complicationRung);
          const granted = complicationSlug
            ? await grantTagSlugs(tx, targetCharacterId, [complicationSlug], turn.number)
            : [];
          const grantedRow = granted[0] ?? null;
          complicationName = grantedRow?.tagName ?? null;
          // Only a tag that actually LANDED costs mood — an already-held
          // non-stackable complication (`added: 0`) is a no-op on the sheet,
          // and applyWoundMood must not charge for a wound that never
          // arrived (same rule applyWoundMood's own callers all follow).
          if (grantedRow?.tagId && grantedRow.added > 0) {
            const applied = await applyWoundMood(tx, targetCharacterId, [grantedRow.tagId], { notify: false });
            moodDm = applied?.dm ?? null;
          }
        }

        const resultMessage = succeeded
          ? `${total} → cured ${selfHeal ? "their own" : `${targetName}'s`} ${tag.name} (${total} vs ${threshold}).`
          : `${total} → the attempt on ${selfHeal ? "their own" : `${targetName}'s`} ${tag.name} went wrong` +
            `${complicationName ? `: ${complicationName}` : ""} (${total} vs ${threshold}).`;

        await tx.action.update({
          where: { id: action.id },
          data: { moveReviewStatus: "SOLVED", gmNotes, resultMessage, reviewedAt: new Date() },
        });

        await logAudit(tx, {
          actorDiscordUserId: "system",
          actionType: RESOLVED_AUDIT_ACTION,
          targetCharacterId,
          turnId: turn.id,
          details: {
            actionId: action.id,
            medicCharacterId: action.characterId,
            tagId,
            tagName: tag.name,
            succeeded,
            total,
            threshold,
            complicationSlug: succeeded ? null : complicationName,
          },
        });

        const medicDm = succeeded
          ? `${rollText} You cured ${selfHeal ? "your own" : `${targetName}'s`} ${tag.name}.`
          : `${rollText} The attempt didn't take${selfHeal ? "" : ` on ${targetName}`} — ${selfHeal ? "you're" : `${targetName} is`} left with ${complicationName ?? "something worse"} on top of it.`;
        const medicName = selfHeal ? null : capitalizeFirst(await seenById(tx, targetCharacterId, medic.id));
        const patientDm =
          !selfHeal && target.discordUserId
            ? succeeded
              ? `${medicName} finished treating your ${tag.name}.`
              : `${medicName}'s treatment for your ${tag.name} went wrong — you're now dealing with ${complicationName ?? "something worse"} too.`
            : null;

        return { resolved: true, succeeded, medicDm, patientDm, patientDiscordUserId: target.discordUserId, moodDm };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.succeeded) cured += 1;
      else if (outcome.succeeded === false) complicated += 1;
      if (medic.discordUserId && outcome.medicDm) {
        dms.push({ discordUserId: medic.discordUserId, content: outcome.medicDm });
      }
      if (outcome.patientDiscordUserId && outcome.patientDm) {
        dms.push({ discordUserId: outcome.patientDiscordUserId, content: outcome.patientDm });
      }
      if (outcome.moodDm) dms.push(outcome.moodDm);
    } catch (err) {
      failed += 1;
      console.error(`Heal Gambit ${action.id} failed to resolve:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, cured, complicated, failed, dms };
}

module.exports = { runHealGambitPass };
