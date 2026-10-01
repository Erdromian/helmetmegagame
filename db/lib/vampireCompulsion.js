// The Vampire's forced compulsion (docs/systemdocs/VAMPIRE.md §4): while a character holds Bloodcrazed
// or Wight, the game — not the player — keeps them in combat mode and throws them at somebody to feed
// on. The feeding IS the attack: a real fight (db/lib/combat.js) whose initiator row is marked
// `compelled`, so the Vampire writes how they attack and feed in the fight's own box, can't call it off,
// and the GM's Combat desk heads their card with "This character is bloodcrazed and MUST feed this turn."
// (compulsionLines.js). No Move is filed for them: their Move stays theirs.
//
// WHO: a random suitable person at the Vampire's Location. Suitable is alive, not another Vampire, not a
// Thrall (anybody's — no Thrall records its master, VAMPIRE.md §10), and not already in a fight. The
// picker tries them in a random order until one fight starts (Bascinet, 2026-10-01).
//
// WHEN: once per turn, as many tries as it takes for one fight to start. Once a compelled fight has
// started this turn there is no second, whether or not it is still going; their own attacks are barred
// while they fight anyway (combatGate.js ALREADY_FIGHTING). It is tried:
//   - at turn open, from db/index.js#advanceTurn() (runVampireCompulsion) — the turn that is OPENING, not
//     the one that just closed, since a fight's hold is measured against the turn still running;
//   - on every arrival (locationMove.js#applyArrivalFacts → compelOnArrival): the Vampire walking in
//     somewhere with somebody to feed on, or somebody suitable walking in on them;
//   - the moment they become Bloodcrazed mid-turn (a blood ability's cost, a GM's edit: compelAttack).
//
// COMBAT MODE is forced on (no Exhausted or ACT refusal — it is not their choice), can't be switched off
// while either tag is held (verbs/combatMode.js), and doesn't tire them (combatModePass.js).
//
// Nothing here is gated by combatBlock or the Move lock: the compulsion is involuntary. Errors are
// per-character and logged, never thrown at the caller — a failed compulsion must not block a turn
// advance or somebody's walk.
const { BLOODCRAZED_SLUG, WIGHT_SLUG, VAMPIRE_SLUG, THRALL_SLUG } = require("./secretSlugs");
const { alivePassCharacters } = require("./aliveCharacters");
const { startCombat, sendCombatDms } = require("./combat");
const { ALREADY_FIGHTING } = require("./combatMode");
const { blockerFor, ACT } = require("./incapacitation");
const { logAudit } = require("./auditLog");

const COMPULSION_SLUGS = Object.freeze([BLOODCRAZED_SLUG, WIGHT_SLUG]);
// Never fed on by the compulsion: another Vampire, or a Thrall.
const UNSUITABLE_SLUGS = Object.freeze([VAMPIRE_SLUG, THRALL_SLUG]);

const TURN_SELECT = { id: true, number: true, startedAt: true, endsAt: true, turnLengthHours: true };
const HELD = { quantity: { gt: 0 } };

function slugOf(ct) {
  return ct?.tag?.slug ?? ct?.slug ?? null;
}

// `tags` as any select hands them back: [{ tag: { slug } }] or [{ slug }].
function holdsCompulsion(tags) {
  return (tags ?? []).some((ct) => COMPULSION_SLUGS.includes(slugOf(ct)));
}

function unsuitable(tags) {
  return (tags ?? []).some((ct) => UNSUITABLE_SLUGS.includes(slugOf(ct)));
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function openTurn(db) {
  return db.turn.findFirst({ where: { status: "OPEN" }, select: TURN_SELECT });
}

// Combat mode on, stamped with this turn, if it isn't already. Conditional, so a turn-open run racing an
// arrival stamps once. Returns true when it changed anything.
async function forceCombatMode(db, character, turn) {
  if (!character?.id || turn?.number == null) return false;
  const won = await db.character.updateMany({
    where: { id: character.id, combatModeSinceTurn: null },
    data: { combatModeSinceTurn: turn.number },
  });
  if (!won?.count) return false;
  await logAudit(db, {
    actorDiscordUserId: "system:vampire-compulsion",
    actionType: "character_combat_mode_set",
    targetCharacterId: character.id,
    turnId: turn.id,
    details: { on: true, turnNumber: turn.number, forced: "compulsion" },
  }).catch((err) => console.error(`Vampire compulsion: combat mode audit failed for ${character.id}:`, err.message ?? err));
  return true;
}

// Everybody the Vampire may be thrown at, in a random order: alive, here, not them, no Vampire or Thrall,
// nobody already fighting.
async function suitableTargets(db, vampire, turn) {
  if (!vampire?.locationId) return [];
  const here = await alivePassCharacters(db, {
    where: {
      locationId: vampire.locationId,
      id: { not: vampire.id },
      tags: { none: { ...HELD, tag: { slug: { in: [...UNSUITABLE_SLUGS] } } } },
    },
    select: { id: true },
  });
  if (here.length === 0) return [];
  const busy = new Set(
    (
      await db.combatParticipant.findMany({
        where: { characterId: { in: here.map((c) => c.id) }, activeTurnId: turn.id },
        select: { characterId: true },
      })
    ).map((b) => b.characterId),
  );
  return shuffle(here.filter((c) => !busy.has(c.id)));
}

// The one way in. Forces combat mode, then throws the Vampire at suitable people until a fight starts.
// Returns { started, combatId?, targetId?, reason? }. `turn` is optional: the open turn is read if absent.
async function compelAttack(db, { characterId, turn = null }) {
  try {
    const open = turn ?? (await openTurn(db));
    if (!open?.id) return { started: false, reason: "no-turn" };
    const vampire = await db.character.findUnique({
      where: { id: characterId ?? "" },
      select: { id: true, status: true, locationId: true, tags: { where: HELD, select: { tag: { select: { slug: true, name: true } } } } },
    });
    if (!vampire || vampire.status !== "ALIVE" || !holdsCompulsion(vampire.tags)) return { started: false, reason: "not-compelled" };

    await forceCombatMode(db, vampire, open);

    if (!vampire.locationId) return { started: false, reason: "nowhere" };
    // Out cold, bound and the like: the hunger can't move a body that can't act.
    if (blockerFor(vampire.tags, ACT)) return { started: false, reason: "cannot-act" };
    const fighting = await db.combatParticipant.findFirst({
      where: { characterId: vampire.id, activeTurnId: open.id },
      select: { id: true },
    });
    if (fighting) return { started: false, reason: "fighting" };
    const already = await db.combatParticipant.findFirst({
      where: { characterId: vampire.id, compelled: true, combat: { turnId: open.id } },
      select: { id: true },
    });
    if (already) return { started: false, reason: "done-this-turn" };

    const candidates = await suitableTargets(db, vampire, open);
    for (const target of candidates) {
      const fight = await startCombat(db, {
        initiatorId: vampire.id,
        targetIds: [target.id],
        turn: open,
        locationId: vampire.locationId,
        compelled: true,
      });
      if (!fight.ok) {
        // The Vampire themself got pulled into a fight meanwhile: nobody else is worth trying.
        if (fight.error === ALREADY_FIGHTING) return { started: false, reason: "fighting" };
        continue;
      }
      await sendCombatDms(db, fight.dms);
      if (fight.announce) {
        const { announceFight } = require("./combatAnnounce");
        await announceFight(db, fight.announce, { skipIds: [vampire.id, target.id] }).catch((err) =>
          console.error(`Vampire compulsion: announcing the fight failed for ${vampire.id}:`, err.message ?? err),
        );
      }
      return { started: true, combatId: fight.combat.id, targetId: target.id };
    }
    return { started: false, reason: candidates.length ? "all-refused" : "nobody" };
  } catch (err) {
    console.error(`Vampire compulsion failed for ${characterId}:`, err);
    return { started: false, reason: "error" };
  }
}

// Turn open: every Bloodcrazed or Wight Vampire, one at a time (never Promise.all — two Vampires at one
// Location must not race for the same victim).
async function runVampireCompulsion(prisma, newTurn) {
  const holders = await alivePassCharacters(prisma, {
    where: { tags: { some: { ...HELD, tag: { slug: { in: [...COMPULSION_SLUGS] } } } } },
    select: { id: true },
  });
  let compelled = 0;
  for (const vampire of shuffle(holders)) {
    const out = await compelAttack(prisma, { characterId: vampire.id, turn: newTurn });
    if (out.started) compelled += 1;
  }
  return { compelled, holders: holders.length };
}

// Somebody arrived at `locationId` (locationMove.js#applyArrivalFacts). A compelled Vampire arriving looks
// for somebody here; anybody suitable arriving wakes every compelled Vampire here who hasn't fed yet.
async function compelOnArrival(db, { characterId, locationId }) {
  if (!characterId || !locationId) return { compelled: 0 };
  // A stub client with no turns (a unit test of some other part of an arrival) has nothing to compel.
  if (typeof db?.turn?.findFirst !== "function") return { compelled: 0 };
  const turn = await openTurn(db);
  if (!turn) return { compelled: 0 };
  const arriver = await db.character.findUnique({
    where: { id: characterId },
    select: { id: true, status: true, locationId: true, tags: { where: HELD, select: { tag: { select: { slug: true } } } } },
  });
  if (!arriver || arriver.status !== "ALIVE" || arriver.locationId !== locationId) return { compelled: 0 };
  if (holdsCompulsion(arriver.tags)) {
    const out = await compelAttack(db, { characterId: arriver.id, turn });
    return { compelled: out.started ? 1 : 0 };
  }
  if (unsuitable(arriver.tags)) return { compelled: 0 };
  const hunters = await alivePassCharacters(db, {
    where: { locationId, id: { not: arriver.id }, tags: { some: { ...HELD, tag: { slug: { in: [...COMPULSION_SLUGS] } } } } },
    select: { id: true },
  });
  let compelled = 0;
  for (const hunter of shuffle(hunters)) {
    const out = await compelAttack(db, { characterId: hunter.id, turn });
    if (out.started) compelled += 1;
  }
  return { compelled };
}

module.exports = {
  COMPULSION_SLUGS,
  UNSUITABLE_SLUGS,
  holdsCompulsion,
  forceCombatMode,
  suitableTargets,
  compelAttack,
  runVampireCompulsion,
  compelOnArrival,
};
