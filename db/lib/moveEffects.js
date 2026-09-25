// What a Move pushes onto the world when it resolves, and how to take it back. The GM-facing half of adjudication needs "this Move gave the player
// 5 ⬢" and later "undo that" without ever recomputing from live state, since the sheet moves on between the two. Every push is snapshotted onto
// `Action.appliedEffects`, and revert reads ONLY that snapshot. Same rule as Request.payload vs Request.effect (docs/systemdocs/REQUESTS.md §2).
// `appliedEffects` is JSON rather than a column per pushable thing so this can grow at one entry in MOVE_EFFECTS; revert skips keys it doesn't know.

// A Move can't drive a character's balance negative; anything that would is clamped. RETURNS THE ACTUAL MOVEMENT,
// since the clamp means the nominal and applied deltas differ — snapshotting the nominal and crediting it back on Unsolve would mint ⬢ from nothing.
async function addResources(tx, characterId, amount, ctx) {
  if (!amount) return 0;
  // The clamp and the atomicity both live in db/lib/resourceStack.js now — this used to be raw SQL with a GREATEST(0, ...) against
  // Character.resources, and there is no such column since ⬢ became a stack.
  const { moved, clamped } = await addCharacterResources(tx, characterId, amount);
  const party = characterParty({ id: characterId });
  if (moved && party) await recordDelta(tx, party, moved, ctx);
  // The floor is the other silent burn: a debit larger than the balance destroys the shortfall instead of going negative.
  if (party && clamped > 0) {
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: clamped }, { ...ctx, reason: "CLAMP" });
  }
  return moved;
}

const { characterParty, recordDelta, record, BURN } = require("./economyLedger");
const { addCharacterResources } = require("./resourceStack");
const { TIRED_SLUG, ARELITZ_SLUG, FOODSTUFFS_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");
const { expiryFrom } = require("./turnFormat");
const { applyFatigueStep, revertFatigueStep, grantExhaustedOutright } = require("./fatigue");
const { drawProspectingLoot } = require("./cavingLoot");
const { isGatheringZone } = require("./gathering");
const { PROSPECTING_SLUG } = require("./constants");
const { AUTO_MINE_NOTE, AUTO_REFINE_NOTE } = require("./constants");
const { reapFoodstuffs, FARM_PLANTS } = require("./soilery");

// One entry per pushable thing. `read` decides what this Move would push right now; `apply` pushes it and returns WHAT ACTUALLY MOVED; `revert`
// takes back exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value, { reason: "MINING" }),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },

  // Two days in the seam before a rest, tracked by db/lib/fatigue.js's Tired -> Exhausted ladder. Mining is the one thing that climbs it from a
  // Move — db/lib/mining.js#computeMiningAccess refuses the next day only on Exhausted. Gated on the Mine button's own marker. The snapshot key stays
  // "exhausted" even for a Tired grant, or older rows stop reverting.
  exhausted: {
    read: (action) => (action.gmNotes === AUTO_MINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      const turn = await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } });
      if (!turn) return 0;
      // The Mine gate already refused an Exhausted character, so applyFatigueStep is always
      // granting Tired or Exhausted here, never a no-op.
      return (await applyFatigueStep(tx, action.characterId, turn.number)) ?? 0;
    },
    revert: async (tx, action, snapshot) => {
      await revertFatigueStep(tx, action.characterId, snapshot);
    },
  },

  // A day spent on the Godard Factory floor: one Godflesh becomes eight Squeeze (db/lib/refinery.js). Filed by the Refine button, which is the
  // only thing that stamps this marker. Climbs the same Tired -> Exhausted ladder Mining does
  // (db/lib/fatigue.js) — a day on the floor is the same order of effort as a day in the seam, so
  // Refine escalates the ladder rather than granting Exhausted outright the way Farming does.
  // web/app/(app)/character/actions/refine.js's own EXHAUSTED_SLUG gate refuses the next shift.
  refined: {
    read: (action) => (action.gmNotes === AUTO_REFINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      // WHERE THE REFINE WAS FILED, not where they are standing now — a free zone move costs no Action (CARRY.md §2a), so the two can differ.
      let locationId = action.locationId ?? null;
      if (!locationId) {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: { locationId: true },
        });
        locationId = character?.locationId ?? null;
      }
      const { applyRefinery } = require("./refinery");
      // { empty: true } still means a day was spent on the floor, so fatigue applies even when
      // there was no Godflesh left to work — the same reasoning "0, not null" below.
      const refined = locationId ? ((await applyRefinery(tx, action.characterId, locationId)) ?? { empty: true }) : { empty: true };

      const turn = await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } });
      const fatigue = turn ? await applyFatigueStep(tx, action.characterId, turn.number) : null;

      // 0, not null: applyMoveEffects falls back to the READ value when apply reports nothing.
      if (!locationId && !fatigue) return 0;
      return { ...refined, fatigue };
    },
    revert: async (tx, action, snapshot) => {
      const { revertRefinery } = require("./refinery");
      await revertRefinery(tx, action.characterId, snapshot);
      // Guarded: revertFatigueStep treats a falsy snapshot as the legacy "plain Exhausted grant"
      // shape (db/lib/fatigue.js), so it must only be called when applyFatigueStep actually
      // granted something.
      if (snapshot?.fatigue) await revertFatigueStep(tx, action.characterId, snapshot.fatigue);
    },
  },

  // The prospecting loot roll (docs/systemdocs/MINING.md). Only a Mine draws it — this is what mining pays in stone rather than in ⬢, and nothing
  // else is digging. It reuses the Caving Die's table machinery (db/lib/cavingLoot.js), which is why there is no YAML behind it: the whole
  // MiningDropOption subsystem it replaced was deleted on 2026-09-18.
  //
  // In a gathering zone (db/lib/gathering.js — the Black Hills) the same press draws on the gathering table instead, and what comes up is food
  // in a small stack rather than one stone; cavingLoot.js decides that by zone, so nothing here tells the two apart beyond the `quantity`.
  // A zone with no column on either table draws nothing, and that is ordinary. Town never gets this far: its Locations carry no mining
  // coefficient, so the Mine button there is always refused (db/lib/mining.js).
  //
  // The key, the AUTO_MINE_NOTE trigger and the { kind: "TAG", tagId, ... } snapshot shape are all unchanged on purpose, so Action rows written
  // under the old die still revert through the arm below.
  miningDrop: {
    read: (action) => (action.gmNotes === AUTO_MINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      // The table is keyed by zone SLUG; the Action carries the id it was filed at, which is the right one to read — a character who walked out of
      // the caves after pressing Mine still dug where they dug. mine.js files the Location's own zone, the same one the verb was read off.
      const zone = action.zoneId
        ? await tx.zone.findUnique({ where: { id: action.zoneId }, select: { slug: true } })
        : null;
      if (!zone) return 0;

      // NOT a gate any more — underground the skill picks which column gets drawn, and an unskilled digger still turns up stones, just poorer
      // ones (db/lib/cavingLoot.js). The gathering table ignores it, so a gathering zone skips the lookup. Whether the press was allowed at all
      // (the pickaxe underground, nothing in the hills) is decided upstream in db/lib/mining.js.
      const prospecting = isGatheringZone(zone.slug)
        ? false
        : !!(await tx.characterTag.findFirst({
            where: { characterId: action.characterId, tag: { slug: PROSPECTING_SLUG } },
            select: { id: true },
          }));
      const drawn = drawProspectingLoot(zone.slug, { prospecting });
      if (!drawn) return 0;

      const tag = await tx.tag.findUnique({
        where: { slug: drawn.slug },
        select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true },
      });
      if (!tag) {
        // Catalog out of sync with cavingLoot.js. validateCavingLoot() at startup exists precisely so this never fires; if it does, swallow it —
        // a phantom tag must not take the ⬢ payout down with it.
        console.error(`Prospecting loot: tier "${drawn.tier}" drew unknown tag "${drawn.slug}" — run npm run db:sync-tags.`);
        return 0;
      }

      // addToStack (db/lib/tagWrites.js) increments an existing stack and pins a non-stackable tag at quantity 1, so a repeat find of the same
      // non-stackable item is a no-op. The catalog's own clock rides along — nothing backfills expiresTurn later. `turn.number + 1`, not bare
      // turn.number, since at payout `turn` is the turn being CLOSED.
      const { addToStack } = require("./tagWrites");
      const turn = tag.defaultDurationTurns
        ? await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } })
        : null;
      // A gathering find comes as a stack; a stone is always one. addToStack pins a non-stackable tag at 1 whatever is asked, so the
      // snapshot records what was actually granted and the revert takes back exactly that.
      const quantity = tag.stackable === true ? Math.max(1, drawn.quantity ?? 1) : 1;
      await addToStack(tx, action.characterId, tag.id, quantity, {
        source: "EVENT",
        stackable: tag.stackable === true,
        expiresTurn: turn ? expiryFrom(turn.number + 1, tag.defaultDurationTurns) : null,
      });
      return { kind: "TAG", tier: drawn.tier, tagId: tag.id, tagSlug: tag.slug, tagName: tag.name ?? "something", quantity };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot) return;
      // RESOURCES is the old die's shape — kept so a row pushed before 2026-09-18 still reverts. Nothing writes it any more.
      if (snapshot.kind === "RESOURCES") {
        await addResources(tx, action.characterId, -snapshot.amount);
        return;
      }
      // `quantity` is absent on rows written before the gathering table existed, and those were always one stone.
      if (snapshot.kind === "TAG" && snapshot.tagId) {
        const { dropCharacterTag } = require("./tagWrites");
        await dropCharacterTag(tx, action.characterId, snapshot.tagId, snapshot.quantity ?? 1);
      }
    },
  },

  // Soilery (db/lib/soilery.js, SOILERY.md): a Farm Move commits at press, but the wither die and
  // the Exhausted lockout only land here, at push, exactly like `refined` above.
  // `action.farmPlan` is `{ v: 3, locationId, planted, fertilized }`, written by farmRequestImpl.
  // A v1/v2 plan (crops and seed licences, before the Soilery Rework) was filed before the deploy
  // and resolves as an ordinary farm of Foodstuffs, capped at the plants it actually sowed.
  farmed: {
    read: (action) => (action.farmPlan ? 1 : 0),
    apply: async (tx, action) => {
      const plan = action.farmPlan;
      const planted =
        plan.v >= 3
          ? plan.planted
          : Math.min(FARM_PLANTS, (plan.rows ?? []).reduce((sum, row) => sum + (row.planted ?? 0), 0));
      const fertilized = plan.fertilized === true;
      const reaped = reapFoodstuffs(planted, Math.random, { fertilized });
      const foodstuffs = await tx.tag.findUnique({ where: { slug: FOODSTUFFS_SLUG }, select: { id: true } });
      if (!foodstuffs) {
        console.error(`Farm payout: no "${FOODSTUFFS_SLUG}" tag — run npm run db:sync-tags. The harvest is lost.`);
      } else if (reaped > 0) {
        const { addToStack } = require("./tagWrites");
        await addToStack(tx, action.characterId, foodstuffs.id, reaped, { source: "EVENT", stackable: true });
      }
      const turn = await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } });
      const fatigue = turn ? await grantExhaustedOutright(tx, action.characterId, turn.number) : null;
      return { v: 3, tagId: foodstuffs?.id ?? null, planted, reaped: foodstuffs ? reaped : 0, fertilized, fatigue };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot) return;
      const { dropCharacterTag } = require("./tagWrites");
      if (snapshot.v >= 3) {
        if (snapshot.tagId && snapshot.reaped > 0) await dropCharacterTag(tx, action.characterId, snapshot.tagId, snapshot.reaped);
      } else {
        // A harvest of crops pushed before the rework: give back whatever still exists.
        for (const row of snapshot.rows ?? []) {
          if (row.reaped > 0) await dropCharacterTag(tx, action.characterId, row.tagId, row.reaped);
        }
      }
      if (snapshot.fatigue) await revertFatigueStep(tx, action.characterId, snapshot.fatigue);
    },
  },

  // Breaking in an unruly arelitz (db/lib/arelitz.js, ARELITZ.md §6): a
  // Gambit whose die and modifier are already rolled at filing time
  // (Action.diceRoll/diceModifier), same as a Heal Gambit — but this
  // resolves automatically HERE at push, rather than waiting on a GM, so a
  // stable's worth of attempts never sits in limbo. `action.breakInPlan` is
  // `{ v: 1, kind: "room"|"character", roomId|characterId, tagId, tagName }`,
  // written by breakInArelitzRequestImpl.
  brokeIn: {
    read: (action) => (action.breakInPlan ? 1 : 0),
    apply: async (tx, action) => {
      const { breakInSucceeded } = require("./arelitz");
      const { dropCharacterTag, dropRoomTag, addToStack, addToRoomStack } = require("./tagWrites");
      const plan = action.breakInPlan;
      const rolled = breakInSucceeded(action.diceRoll, action.diceModifier);
      // The target may have been sold, transferred or butchered between
      // filing and push — checked here, not assumed, so a gone target never
      // silently grants a broken-in arelitz from nothing.
      const still =
        plan.kind === "character"
          ? await tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId: plan.characterId, tagId: plan.tagId } },
              select: { quantity: true },
            })
          : await tx.roomTag.findUnique({
              where: { roomId_tagId: { roomId: plan.roomId, tagId: plan.tagId } },
              select: { quantity: true },
            });
      const ok = rolled && Boolean(still?.quantity);
      if (ok) {
        const brokenTag = await tx.tag.findUnique({ where: { slug: ARELITZ_SLUG }, select: { id: true, stackable: true } });
        if (plan.kind === "character") {
          await dropCharacterTag(tx, plan.characterId, plan.tagId, 1);
          await addToStack(tx, plan.characterId, brokenTag.id, 1, { source: "EVENT", stackable: brokenTag.stackable });
        } else {
          await dropRoomTag(tx, plan.roomId, plan.tagId, 1);
          await addToRoomStack(tx, plan.roomId, brokenTag.id, 1);
        }
      }
      return {
        ok,
        gone: rolled && !still?.quantity,
        roll: action.diceRoll,
        modifier: action.diceModifier ?? 0,
        kind: plan.kind,
        holderId: plan.kind === "character" ? plan.characterId : plan.roomId,
        tagId: plan.tagId,
        tagName: plan.tagName,
      };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot?.ok) return;
      const { dropCharacterTag, dropRoomTag, addToStack, addToRoomStack } = require("./tagWrites");
      const brokenTag = await tx.tag.findUnique({ where: { slug: ARELITZ_SLUG }, select: { id: true, stackable: true } });
      if (snapshot.kind === "character") {
        await dropCharacterTag(tx, snapshot.holderId, brokenTag.id, 1);
        await addToStack(tx, snapshot.holderId, snapshot.tagId, 1, { source: "EVENT", stackable: true });
      } else {
        await dropRoomTag(tx, snapshot.holderId, brokenTag.id, 1);
        await addToRoomStack(tx, snapshot.holderId, snapshot.tagId, 1);
      }
    },
  },
};

// Pushes everything this Move is worth and returns the blob to stamp on `Action.appliedEffects`. Callers run this inside their own transaction.
// The snapshot records what `apply` reports moving, not what `read` asked for; apply returning nothing falls back to the asked-for value.
async function applyMoveEffects(tx, action) {
  const applied = {};
  for (const [key, effect] of Object.entries(MOVE_EFFECTS)) {
    const value = effect.read(action);
    if (!value) continue;
    const moved = await effect.apply(tx, action, value);
    const recorded = moved === undefined || moved === null ? value : moved;
    if (recorded) applied[key] = recorded;
  }
  return applied;
}

// Hands back exactly what `appliedEffects` says was pushed. An unknown key is skipped rather than thrown, so an old row still unsolves.
async function revertMoveEffects(tx, action) {
  const applied = action.appliedEffects ?? {};
  for (const [key, value] of Object.entries(applied)) {
    const effect = MOVE_EFFECTS[key];
    if (!effect || !value) continue;
    await effect.revert(tx, action, value);
  }
  return applied;
}

// "+5 ⬢" — the one-line human form of a snapshot, for panels and audit rows.
function describeMoveEffects(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    // Legacy rows recorded a bare `1`.
    else if (key === "exhausted") parts.push(value?.slug === TIRED_SLUG ? "Tired" : "Exhausted");
    // The ⬢ arm is the old mining drop die's shape (pre-2026-09-18); nothing writes it any more,
    // but rows from that era still print.
    else if (key === "miningDrop") {
      parts.push(
        value.kind === "TAG"
          ? `found ${value.tagName}${value.quantity > 1 ? ` ×${value.quantity}` : ""}`
          : `${value.amount > 0 ? "+" : ""}${value.amount} ⬢ (find)`,
      );
    }
    else if (key === "refined") {
      parts.push(
        value.empty
          ? "nothing to refine — no Godflesh here"
          : `+${value.produced?.quantity ?? 0} Squeeze, −1 Godflesh`,
      );
      if (value.fatigue) parts.push(value.fatigue.slug === TIRED_SLUG ? "Tired" : "Exhausted");
    }
    else if (key === "farmed") {
      parts.push(
        value.v >= 3
          ? `planted ${value.planted}, reaped ${value.reaped} Foodstuffs`
          : (value.rows ?? []).map((row) => `sowed ${row.planted} ${row.cropName} and reaped ${row.reaped}`).join(", "),
      );
      if (value.fatigue) parts.push("Exhausted");
    }
    else if (key === "brokeIn") {
      parts.push(
        value.ok
          ? `broke in ${value.tagName}`
          : value.gone
            ? `${value.tagName} was gone by the time the die was read`
            : `${value.tagName} threw them off (rolled ${value.roll}${value.modifier ? ` ${value.modifier > 0 ? "+" : ""}${value.modifier}` : ""})`,
      );
    }
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// The Move d6 lives in db/lib/rollDie.js so advantage.js can reach it without requiring this file back; still re-exported below.
// addResources is exported for db/lib/stagedPush.js, which pushes GM-staged resource adjustments through the same clamp-and-report statement.
module.exports = { addResources, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie, MOVE_EFFECTS };
