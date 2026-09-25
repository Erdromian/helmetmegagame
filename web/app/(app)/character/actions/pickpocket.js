// Pickpocket (docs/systemdocs/THEFT.md §2): going through a standing person's
// pockets.
//
// Two acts, one row. `pickpocketRequestImpl` rolls and claims; if the roll was
// any good it hands back what the target is carrying, and
// `pickpocketTakeImpl` moves the one kind of thing the thief picked, as many as
// fit in the budget, once. The PickpocketAttempt
// row is the ration AND the authorization for the second half — see the model's
// own comment in schema.prisma for why it is one row and why it is not an Offer.
//
// This is NOT Loot. Loot needs its target helpless, hits them with a ROBBED
// mood and tells them their body was searched. The whole point here is that on
// a good roll nobody is told anything at all.

import { prisma } from "@lifeweb/db";
import { rollWithAdvantage } from "@lifeweb/db/lib/advantage";
import {
  FAILED,
  NOTICED,
  holdsPickpocket,
  pickpocketBonus,
  pickpocketBudgetLbs,
  pickpocketDefense,
  pickpocketOutcome,
  pickpocketTook,
  pickpocketRation,
  pickpocketSelfBlock,
  PICKPOCKET_SPENT,
  pickpocketableHoldings,
  weighPicks,
} from "@lifeweb/db/lib/pickpocket";
import { isHere } from "@lifeweb/db/lib/presence";
import { ACT, blockerFor } from "@lifeweb/db/lib/incapacitation";
import { capitalizeFirst } from "@lifeweb/db/lib/concealedIdentity";
import {
  seenAs,
  seenBy,
  identityOf,
  IDENTITY_SELECT,
  HELD_REASON,
  CAUGHT_HOLD_MS,
  holdWhereTheyStand,
  inFight,
  caughtSecondsLeft,
} from "@lifeweb/db/lib/intercept";
import { CONCEALMENT_TAG_FIELDS } from "@lifeweb/db/lib/presentedIdentity";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
import { carryAdmits } from "@lifeweb/db/lib/carry";
import { rowWeight, round2 } from "@lifeweb/db/lib/tagWeight";
import { dropCharacterTag, addToStack } from "@/lib/tagEffects";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import { requireCharacter, revalidateAll, parseCount, lockCharacter } from "./shared.js";
import { SFX } from "@lifeweb/db/lib/sfx";

// Bascinet's words, verbatim. Both name the thief by the face the room saw, so
// a hooded one reads "A young man pickpocketed you!".
const NOTICED_DM = (who) => `${who} pickpocketed you!`;
const FAILED_DM = (who) => `${who} tried to pickpocket you, but failed!`;
// ...and what you can do about it. On either DM the thief is pinned for
// CAUGHT_HOLD_MS and you are the one holding them (THEFT.md §2g), so the line
// has to say so, or the victim assumes they're already gone and never answers.
// Added only when the hold actually landed — a thief already in a fight, or
// held longer, gets the first sentence alone. It names the button, too: the
// holding list lives in the Intercept dialog, which is nowhere a robbed person
// would think to look.
const STUCK =
  "They won't get far for the next 5 minutes — you have hold of them. To let them go sooner, open Intercept and press Let them go.";

// A superset of IDENTITY_SELECT, and `tags` OVERRIDES rather than merges —
// the single most breakable line here, exactly as SEARCH_SELECT's comment says
// of its own. Drop CONCEALMENT_TAG_FIELDS and presentedIdentity reports every
// hood as a bare face, so a refusal unmasks somebody. Drop `category` and the
// Assets rule in pickpocketableHoldings reads undefined, which would put every
// weightless horse and deed back on the table. Drop `stackable` and every take
// silently pins to 1. Drop `heldUntil`/`heldReason` and inFight reads the
// target as never fighting, so a pocket could be picked mid-brawl.
const PICKPOCKET_SELECT = {
  ...IDENTITY_SELECT,
  heldUntil: true,
  heldReason: true,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      tagId: true,
      quantity: true,
      equipped: true,
      expiresTurn: true,
      source: true,
      tag: {
        select: {
          id: true,
          name: true,
          slug: true,
          category: true,
          tradeable: true,
          stackable: true,
          weightLbs: true,
          forcedName: true,
          ...CONCEALMENT_TAG_FIELDS,
        },
      },
    },
  },
};

// searchAuthority's shape and, where the question is the same, its exact
// sentences. Every refusal names the target by the face the room saw and never
// by the row — a refusal is the last place to out somebody (INTERCEPT.md §2).
// `seen` is what the thief calls the target (intercept.js#seenBy): a stranger
// reads as "a young man" (docs/systemdocs/STRANGERS.md).
function pickpocketAuthority(actor, target, { seen = null } = {}) {
  if (!actor || !target) return "They aren't here.";
  if (actor.id === target.id) return "Pick somebody else's pocket.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  // "They aren't here." with no name, the same as no target at all — a plain id
  // for somebody here in a hood resolves to nobody (db/lib/targetKey.js), and
  // a named absent sentence would tell the two cases apart.
  if (target.status !== "ALIVE") return "They aren't here.";
  // allowConcealed, the Search posture: a hood hides who you are, not what is
  // in your pockets.
  if (!isHere(actor, target, { allowConcealed: true })) return "They aren't here.";

  const mine = blockerFor(actor.tags, ACT);
  if (mine) return `You're ${mine.name}.`;
  const theirs = blockerFor(target.tags, ACT);
  const named = () => capitalizeFirst(seen ?? seenAs(identityOf(target)));
  if (theirs) return `${named()} is ${theirs.name}.`;

  // A hand the scene just caught stays out of pockets until the hold lapses
  // (THEFT.md §2g) — a failed pickpocket's own five minutes, or a Steal the
  // room saw. The hold takes movement everywhere else; this is the one verb
  // it takes besides, or a caught thief would spend the wait working the
  // rest of the room. Counted down in the same words the shut ways use.
  //
  // Nobody picks a pocket in the middle of a fight, on either side of it. A
  // fight holds both parties to the end of the turn, and this re-runs at the
  // take as well as at the roll, so an Attack landing between the two shuts
  // the picker that was already open.
  //
  // The thief's half is pickpocketSelfBlock, the same sentences the greyed
  // button shows (web/lib/peoplePools.js). The target's half never greys
  // anything — that would be a fact about the room.
  const self = pickpocketSelfBlock({ caughtSeconds: caughtSecondsLeft(actor), fighting: inFight(actor) });
  if (self) return self;
  if (inFight(target)) return `${named()} is in a fight.`;
  return null;
}

// The shared key resolver (db/lib/targetKey.js), not a copy of it: a token
// minted in a room this character has since left answers null, and so does a
// plain id for somebody standing here in a hood. This used to unwrap the key by
// hand and take any bare id, so a suspect's id posted by hand reached them.
async function resolveTarget(character, targetKey) {
  const id = await resolveTargetKey(prisma, character, targetKey);
  if (!id) return null;
  return prisma.character.findFirst({ where: { id }, select: PICKPOCKET_SELECT });
}

// What the thief is shown. A plain name and a weight, and NO tag chip — the
// MoveThingsDialog helpless-pockets rule (REQUESTS.md §5b): the filter here is
// `tradeable` rather than `catalogVisibility`, so a secret tag is already named
// in this list, and handing over its description, recipe and cost as well would
// be a second leak on top of the one the verb is for.
function holdingRows(target) {
  return pickpocketableHoldings(target.tags).map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
    quantity: ct.quantity,
    stackable: Boolean(ct.tag.stackable),
    each: rowWeight({ ...ct, quantity: 1 }),
  }));
}

// A thief the target felt, pinned for five minutes where they stand and held
// BY THE VICTIM (THEFT.md §2g) — a failed roll at the roll, a noticed one at the
// take. The same Character.heldUntil every picker and the mover's gate already
// read, and the same column pickpocketAuthority reads to keep this hand out of
// pockets until it lapses. heldById is the target, so the victim gets the
// ordinary Let-them-go button, and walking off or dying frees the thief the
// way it frees anyone they hold. holdWhereTheyStand's two rules apply: a hold
// already running longer is left alone, and a running fight is never
// overwritten. Called after the attempt is already claimed (and, at the take,
// after the goods moved), so a failed write is logged and the victim still
// hears the first line. -> whether the hold landed.
function pinThief(thief, victim) {
  return holdWhereTheyStand(prisma, thief.id, {
    until: new Date(Date.now() + CAUGHT_HOLD_MS),
    reason: HELD_REASON.CAUGHT,
    heldById: victim.id,
  }).catch((err) => {
    console.error(`Pickpocket: caught hold failed for ${thief.id}:`, err.message ?? err);
    return false;
  });
}

// ─── Phase 1: the roll ─────────────────────────────────────────────────────

export async function pickpocketRequestImpl({ targetKey }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // Re-checked server-side. The greyed button is a hint, never a lock.
  if (!holdsPickpocket(character.tags)) throw new UserError("You don't know how to do that.");

  const target = await resolveTarget(character, targetKey);
  if (!target) throw new UserError("They aren't here.");
  // How each would name the other: a thief is named to the victim as the victim knows them.
  const targetSeen = await seenBy(prisma, character.id, target);
  const thiefSeen = await seenBy(prisma, target.id, character);
  const refusal = pickpocketAuthority(character, target, { seen: targetSeen });
  if (refusal) throw new UserError(refusal);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const bonus = pickpocketBonus(character.tags);
  // The mark's side of the die (THEFT.md §2i). Read off the target's sheet and
  // never named to either side — the payload rule below is what keeps it from
  // being readable off the dialog.
  const defense = pickpocketDefense(target.tags);
  const budgetLbs = pickpocketBudgetLbs(character.tags);
  const roll = rollWithAdvantage(character.tags, 6);
  const outcome = pickpocketOutcome(roll.die + bonus - defense);
  // Read ONCE, here, and frozen onto the row below. See the reopen branch.
  const felt = holdingRows(target);

  // The claim: ONE reach per thief per turn, at anybody (THEFT.md §2). The
  // unique key is still per target, because the take looks its row up by
  // target, so the per-thief rule is a read-then-insert under a lock on the
  // thief's own row — two tabs reaching at two people at once queue on it, and
  // the second one reads the first one's row. An untouched row at the SAME
  // target is a refreshed page or a reopened dialog, which gets the SAME die
  // back rather than losing the attempt or rerolling into a better one.
  // `fresh` is what stops a reopened dialog re-sending the target's DM or
  // re-pinning the thief: only the roll that actually happened may speak.
  let attempt;
  let fresh = true;
  let rows = felt;
  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);
    // Every row, not the first: a thief who reached at two people in the turn
    // this rule shipped holds two, and the one at THIS target is the one that
    // can reopen.
    const mine = await tx.pickpocketAttempt.findMany({
      where: { thiefId: character.id, turnId: openTurn.id },
    });
    const existing = mine.find((a) => a.targetCharacterId === target.id) ?? mine[0] ?? null;
    const ration = pickpocketRation(existing, target.id);
    if (ration === "spent") {
      throw new UserError(
        existing.targetCharacterId === target.id
          ? `You already went through ${targetSeen}'s pockets this turn.`
          : PICKPOCKET_SPENT,
      );
    }
    if (ration === "reopen") {
      fresh = false;
      attempt = existing;
      return;
    }
    attempt = await tx.pickpocketAttempt.create({
      data: {
        thiefId: character.id,
        targetCharacterId: target.id,
        turnId: openTurn.id,
        die: roll.die,
        bonus,
        defense,
        outcome,
        budgetLbs,
        revealed: felt,
      },
    });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "pickpocket",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      place: character,
      // `presented`, never the row name (INTERCEPT.md §2). The die lives here
      // and on the attempt row, and nowhere a player can read it.
      details: {
        presented: seenAs(identityOf(target)),
        attemptId: attempt.id,
        die: roll.die,
        rolls: roll.rolls,
        advantage: roll.advantage,
        bonus,
        defense,
        outcome,
        budgetLbs,
      },
    });
  });
  // The frozen list, not a fresh scan. A reopened dialog replays the one look
  // the attempt bought — otherwise a thief who reached in and cancelled could
  // keep the dialog open all turn and watch things arrive in and leave
  // somebody's pockets, which is a far wider exposure than the verb is for.
  // A row written before that column existed has no snapshot; it falls back
  // to the old live read, which is no worse than what it already had.
  if (!fresh && Array.isArray(attempt.revealed)) rows = attempt.revealed;

  if (attempt.outcome === FAILED) {
    // Caught with a hand in their pocket, so stuck (THEFT.md §2g). `fresh`
    // only — a reopened dialog rolled nothing and must not extend the hold.
    if (fresh) {
      const who = capitalizeFirst(thiefSeen);
      const pinned = await pinThief(character, target);
      notifyCharacter(target, pinned ? `${FAILED_DM(who)} ${STUCK}` : FAILED_DM(who));
    }
    revalidateAll();
    // Nothing moves, and the thief is told nothing about the die beyond this.
    return { outcome: FAILED };
  }

  // CLEAN and NOTICED return the IDENTICAL payload. If the thief could tell a 5
  // from a 2 from what comes back, the die would be readable off the dialog and
  // a noticed theft would just be one you re-plan around. The target's DM is
  // the only thing that differs, and it is sent at the TAKE, not here — a hand
  // in a pocket that took nothing is not something to notice.
  revalidateAll();
  return {
    outcome: "took",
    targetId: target.id,
    targetName: targetSeen,
    budgetLbs: attempt.budgetLbs,
    spentLbs: attempt.spentLbs,
    rows,
  };
}

// ─── Phase 2: the take ─────────────────────────────────────────────────────

export async function pickpocketTakeImpl({ targetKey, tags: rawTags }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  if (!holdsPickpocket(character.tags)) throw new UserError("You don't know how to do that.");

  const lines = Array.isArray(rawTags)
    ? rawTags.map((t) => ({ tagId: String(t?.tagId ?? ""), quantity: parseCount(t?.quantity ?? 1, { min: 1 }) }))
    : [];
  if (lines.some((l) => !l.tagId || l.quantity == null))
    throw new UserError("Each line needs a tag and a whole number.");
  if (!lines.length) throw new UserError("Nothing to take.");
  // One kind of thing per reach, as many of it as the budget allows
  // (THEFT.md §2b). Checked here, not just in the dialog.
  if (lines.length > 1) throw new UserError("Take one kind of thing.");

  // Everything is re-resolved from the session. The browser names the target
  // and nothing else, and even that is re-checked.
  const target = await resolveTarget(character, targetKey);
  if (!target) throw new UserError("They aren't here.");
  // How each would name the other: a thief is named to the victim as the victim knows them.
  const targetSeen = await seenBy(prisma, character.id, target);
  const thiefSeen = await seenBy(prisma, target.id, character);
  const refusal = pickpocketAuthority(character, target, { seen: targetSeen });
  if (refusal) throw new UserError(refusal);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  // The authorization. Keyed on the CURRENTLY open turn, so a turn boundary
  // invalidates it for free with no sweep — and re-running pickpocketAuthority
  // above is the walk-away rule, which is why this verb needs no cancel hook in
  // locationMove.js the way a pending Search offer does.
  const attempt = await prisma.pickpocketAttempt.findUnique({
    where: {
      thiefId_targetCharacterId_turnId: {
        thiefId: character.id,
        targetCharacterId: target.id,
        turnId: openTurn.id,
      },
    },
  });
  // One take per reach. A take closes the whole budget, so spentLbs above 0
  // means this hand has already come out.
  if (!attempt || !pickpocketTook(attempt.outcome) || attempt.spentLbs > 0)
    throw new UserError("Your hand isn't in their pocket.");

  // Against a FRESH read of what they hold — the picker may be minutes old, and
  // they may have handed the thing away since.
  const reachable = new Map(pickpocketableHoldings(target.tags).map((ct) => [ct.tagId, ct]));
  const held = new Set(character.tags.map((ct) => ct.tagId));
  const moves = lines.map((line) => {
    const row = reachable.get(line.tagId);
    if (!row) throw new UserError("They aren't carrying that.");
    // The non-stackable pin (tagWrites.js#addToStack): a clamp rather than a
    // silent move of 1 against a request for 2, or Undo would take 2 back.
    let max = row.quantity;
    if (!row.tag.stackable) {
      if (held.has(line.tagId)) throw new UserError(`You already have ${row.tag.name}.`);
      max = 1;
    }
    return { tagId: line.tagId, quantity: Math.min(line.quantity, max), held: row };
  });

  // Rounded before the compare, the round2 the rest of the app already uses on
  // a summed weight. Unrounded, half a dozen 0.5 lb vials sum to 15.000000000002
  // and a take that lands exactly on the budget is refused for no visible
  // reason — the single most confusing way this could misbehave.
  const takenLbs = round2(weighPicks(moves));
  if (takenLbs > attempt.budgetLbs)
    throw new UserError(`That's more than you could lift unnoticed — ${attempt.budgetLbs} lb at most.`);

  // The thief's own ceiling. Refused rather than landed-and-shed: past 1.5× the
  // cap settleCarry sheds NEWEST-first into a public room with a line in it
  // (CARRY.md §5), which would announce a silent theft one second after it
  // succeeded.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { carryWeightLbs: true },
  });
  const verdict = carryAdmits({ tags: character.tags }, config, {
    weightLbs: takenLbs,
  });
  if (!verdict.ok) throw new UserError(verdict.reason);

  await prisma.$transaction(async (tx) => {
    // Sorted-id locking, the lootCharacterRequestImpl deadlock discipline: two
    // thieves picking each other at the same instant would otherwise lock in
    // opposite orders, and Postgres surfaces that as a raw 40P01.
    for (const id of [character.id, target.id].sort()) await lockCharacter(tx, id);

    // The claim is a conditional updateMany whose WHERE is the check, so two
    // tabs cannot both take. It spends the WHOLE budget whatever was taken, so
    // a 0 lb take (obols) still closes the reach. It goes FIRST: a refusal
    // here rolls back everything under it. The real pounds are on the
    // pickpocket_took audit row.
    const claimed = await tx.pickpocketAttempt.updateMany({
      where: { id: attempt.id, spentLbs: 0 },
      data: { spentLbs: attempt.budgetLbs },
    });
    if (claimed.count !== 1) throw new UserError("Your hand isn't in their pocket.");

    for (const move of moves) {
      // Re-read under the lock: dropCharacterTag on an already-gone row is a
      // silent no-op, so a loser of the race would look successful and take
      // nothing.
      const fresh = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: target.id, tagId: move.tagId } },
        select: { quantity: true, expiresTurn: true, source: true },
      });
      if (!fresh || fresh.quantity < move.quantity) throw new UserError("They aren't carrying that.");

      const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, target.id, move.tagId, move.quantity);
      await addToStack(tx, character.id, move.tagId, move.quantity, {
        source: fresh.source,
        expiresTurn: fresh.expiresTurn,
        stackable: Boolean(move.held.tag.stackable),
        poisonedCount: poisonedTaken,
        poisonPayload,
      });

      // One TRANSFER_TAG per line, the Transfer shape, so a GM can undo any
      // single piece of this from /gm/turns.
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_transfer_tag",
        targetCharacterId: target.id,
        turnId: openTurn.id,
        place: character,
        details: {
          tagId: move.tagId,
          tagName: move.held.tag.name,
          quantity: move.quantity,
          from: { kind: "character", id: target.id },
          to: { kind: "character", id: character.id },
          fromCharacterId: target.id,
          toCharacterId: character.id,
          via: "pickpocket",
          restore: { source: fresh.source, expiresTurn: fresh.expiresTurn, quantity: move.quantity },
        },
      });
    }

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "pickpocket_took",
      targetCharacterId: target.id,
      turnId: openTurn.id,
      place: character,
      details: {
        presented: seenAs(identityOf(target)),
        attemptId: attempt.id,
        outcome: attempt.outcome,
        takenLbs,
        budgetLbs: attempt.budgetLbs,
        lines: moves.map((m) => ({ tagId: m.tagId, tagName: m.held.tag.name, quantity: m.quantity })),
      },
    });
  });

  await afterInventoryChange([character.id, target.id]);

  // The DM fires at the TAKE and not at the roll, which is the honest reading:
  // you notice a hand in your pocket because something left it. A thief who
  // opened the picker and cancelled escapes notice — the spent ration is the
  // brake on doing that all afternoon. The hold lands here too, for the same
  // reason: the thief is caught when the victim feels it, and pinning them at
  // the roll would tell a noticed thief their band before they took anything.
  if (attempt.outcome === NOTICED) {
    const who = capitalizeFirst(thiefSeen);
    const pinned = await pinThief(character, target);
    notifyCharacter(target, pinned ? `${NOTICED_DM(who)} ${STUCK}` : NOTICED_DM(who));
  }

  // Nothing is posted to the room, on any outcome.
  revalidateAll();
  return { sfx: SFX.POCKET };
}
