// The Vampire's forced compulsion (docs/systemdocs/VAMPIRE.md): every turn a
// character holds Bloodcrazed or Wight, the game — not the player — files a
// feeding Gambit and opens a real fight (db/lib/combat.js) against a random
// other character at the same Location.
//
// Deliberately NOT a TURN_PASSES entry. Both filings need to land on the
// turn that is OPENING, not the one that just closed: db/lib/stagedPush.js
// only ever resolves Action rows stamped with the closing turn's own id, and
// db/lib/combat.js's hold length is measured against the turn
// that's still running — filing against an already-closing turn would give
// either one a meaningless near-zero duration. So this runs once from
// db/index.js#advanceTurn(), right after the new Turn row is created, reading
// whichever vampires db/lib/vampirePass.js's own close just left holding
// either tag.
//
// Errors are per-character, never Promise.all — one vampire's failure must
// not block the rest or the turn advance. There is no resume mechanism for
// this step (it isn't in Turn.resolvedPasses), which is fine: a crash
// mid-loop just means some vampires miss one turn's compulsion, logged and
// moved on.
const { BLOODCRAZED_SLUG, WIGHT_SLUG } = require("./constants");
const { alivePassCharacters } = require("./aliveCharacters");
const { IDENTITY_SELECT, seenBy } = require("./intercept");
const { startCombat, sendCombatDms } = require("./combat");

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function runVampireCompulsion(prisma, newTurn) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [BLOODCRAZED_SLUG, WIGHT_SLUG] } },
    select: { id: true, slug: true },
  });
  const bloodcrazedId = tags.find((t) => t.slug === BLOODCRAZED_SLUG)?.id ?? null;
  const wightId = tags.find((t) => t.slug === WIGHT_SLUG)?.id ?? null;
  if (!bloodcrazedId && !wightId) {
    console.error(`Vampire compulsion skipped: no "${BLOODCRAZED_SLUG}"/"${WIGHT_SLUG}" tag — run npm run db:sync-tags.`);
    return { compelled: 0 };
  }

  // Plain IDENTITY_SELECT (+ zoneId) — no override of its own `tags` shape;
  // startCombat loads its own. IDENTITY_SELECT already carries every held tag's slug, which is enough
  // to tell Wight from Bloodcrazed below with no second query.
  const holders = await alivePassCharacters(prisma, {
    where: { tags: { some: { tagId: { in: [bloodcrazedId, wightId].filter(Boolean) } } } },
    select: { ...IDENTITY_SELECT, zoneId: true },
  });

  let compelled = 0;
  for (const vampire of holders) {
    try {
      if (!vampire.locationId) continue; // nowhere to prey on anyone

      // Defensive idempotency guard, not a live race — nothing could
      // plausibly have filed a Move for this character in the instant since
      // newTurn was created.
      const already = await prisma.action.findFirst({
        where: { characterId: vampire.id, turnId: newTurn.id },
        select: { id: true },
      });
      if (already) continue;

      const others = await alivePassCharacters(prisma, {
        where: { locationId: vampire.locationId, id: { not: vampire.id } },
        select: IDENTITY_SELECT,
      });
      if (others.length === 0) {
        console.warn(`Vampire compulsion: ${vampire.name} is alone at their location, skipping.`);
        continue;
      }

      const heldWight = vampire.tags.some((t) => t.tag?.slug === WIGHT_SLUG);
      const feedTarget = pickRandom(others);
      const attackTarget = pickRandom(others);

      await prisma.action.create({
        data: {
          characterId: vampire.id,
          turnId: newTurn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          // The victim as the vampire knows them (intercept.js#seenBy): this is
          // the vampire's own sheet, and a hood or a stranger stays one there.
          description: `Blood-crazed, ${vampire.name} ravenously feeds on ${await seenBy(prisma, vampire.id, feedTarget)}.`,
          zoneId: vampire.zoneId ?? null,
          gmNotes: heldWight ? "auto:wight" : "auto:bloodcrazed",
        },
      });

      // No gate calls (combatGate.js#combatBlock) — this compulsion is
      // involuntary, not a fight the character chose, so neither combat mode
      // nor the turn lock applies. The victim is told like anybody attacked
      // (docs/systemdocs/ATTACK.md), since the fight holds them and asks them
      // to write what they do. The room is told too.
      const fight = await startCombat(prisma, {
        initiatorId: vampire.id,
        targetIds: [attackTarget.id],
        turn: newTurn,
        locationId: vampire.locationId,
      });
      if (fight.ok) {
        await sendCombatDms(prisma, fight.dms);
        if (fight.announce) {
          const { announceFight } = require("./combatAnnounce");
          await announceFight(prisma, fight.announce, { skipIds: [vampire.id, attackTarget.id] }).catch((err) =>
            console.error(`Vampire compulsion: announcing the fight failed for ${vampire.id}:`, err.message ?? err),
          );
        }
      } else {
        console.warn(`Vampire compulsion: ${vampire.name} could not attack: ${fight.error}`);
      }

      compelled += 1;
    } catch (err) {
      console.error(`Vampire compulsion failed for ${vampire.id}:`, err);
    }
  }

  return { compelled };
}

module.exports = { runVampireCompulsion };
