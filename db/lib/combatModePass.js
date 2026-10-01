// Combat mode at the push (docs/systemdocs/COMBAT-MODE.md §4; Combat Mode.docx): everybody still in
// combat mode when a turn pushes gets Tired; somebody already Tired gets Exhausted instead, and their
// combat mode is turned off, since it can't be on while Exhausted. It climbs the same Tired ->
// Exhausted ladder as a day's mining (db/lib/fatigue.js). Run from db/index.js#resolveNeeds() BEFORE
// tagExpiry: the Tired this pass granted last push expires at this push's sweep, and a pass after
// the sweep would never see it, so nobody would ever step up. Takes `prisma` as a parameter — see
// db/lib/dm.js.
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { nextFatigueSlug } = require("./fatigue");
const { alivePassCharacters } = require("./aliveCharacters");
const { GUARD_LINES, endGuardsFor } = require("./guard");
const { BLOODCRAZED_SLUG, WIGHT_SLUG } = require("./secretSlugs");

const COMPULSION_SLUGS = [BLOODCRAZED_SLUG, WIGHT_SLUG];

const NOTICE = {
  [TIRED_SLUG]: "You were alert and on edge all of last turn. You're **Tired**.",
  [EXHAUSTED_SLUG]: "Staying alert while already tired has completely worn you out. You're **Exhausted**, and combat mode is off.",
  already: "You're **Exhausted**. Combat mode is off.",
};

async function runCombatModeFatiguePass(prisma, turn) {
  const [tiredTag, exhaustedTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: TIRED_SLUG }, select: { id: true, defaultDurationTurns: true } }),
    prisma.tag.findUnique({ where: { slug: EXHAUSTED_SLUG }, select: { id: true, defaultDurationTurns: true } }),
  ]);
  if (!tiredTag || !exhaustedTag) {
    const missingSlug = !tiredTag ? TIRED_SLUG : EXHAUSTED_SLUG;
    console.error(`runCombatModeFatiguePass: no "${missingSlug}" tag — run npm run db:sync-tags. Combat mode won't tire anyone.`);
    return { turnNumber: turn.number, tired: 0, exhausted: 0, switchedOff: 0, notices: [] };
  }
  const tagBySlug = { [TIRED_SLUG]: tiredTag, [EXHAUSTED_SLUG]: exhaustedTag };

  // A Bloodcrazed or Wight Vampire is held in combat mode by the compulsion, not by choice, so it never
  // tires them and is never switched off here (vampireCompulsion.js; Bascinet, 2026-10-01).
  const characters = await alivePassCharacters(prisma, {
    where: {
      combatModeSinceTurn: { not: null },
      tags: { none: { quantity: { gt: 0 }, tag: { slug: { in: [...COMPULSION_SLUGS] } } } },
    },
    select: {
      id: true,
      discordUserId: true,
      tags: {
        where: { tag: { slug: { in: [TIRED_SLUG, EXHAUSTED_SLUG] } } },
        select: { id: true, tag: { select: { slug: true } } },
      },
    },
  });

  let tired = 0;
  let exhausted = 0;
  let switchedOff = 0;
  const notices = [];

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    // Null means already Exhausted: nothing left to grant, but it still can't stay on.
    const targetSlug = nextFatigueSlug(held);
    const turnsOff = targetSlug !== TIRED_SLUG;
    const tiredRow = targetSlug === EXHAUSTED_SLUG ? character.tags.find((ct) => ct.tag.slug === TIRED_SLUG) : null;

    const ok = await prisma
      .$transaction(async (tx) => {
        if (targetSlug) {
          const tag = tagBySlug[targetSlug];
          // Escalating consumes the Tired row, the db/lib/fatigue.js#applyFatigueStep reasoning.
          if (tiredRow) await tx.characterTag.delete({ where: { id: tiredRow.id } });
          // skipDuplicates: an existing row keeps its own clock (db/lib/tagExpiryPass.js).
          await tx.characterTag.createMany({
            data: [{
              characterId: character.id,
              tagId: tag.id,
              source: "EVENT",
              quantity: 1,
              expiresTurn: expiryFrom(turn.number + 1, tag.defaultDurationTurns ?? 1),
            }],
            skipDuplicates: true,
          });
        }
        if (turnsOff) {
          await tx.character.update({ where: { id: character.id }, data: { combatModeSinceTurn: null } });
        }
        return true;
      })
      .catch((err) => {
        console.error(`runCombatModeFatiguePass: failed for ${character.id}:`, err.message ?? err);
        return false;
      });
    if (!ok) continue;

    if (targetSlug === TIRED_SLUG) tired += 1;
    if (targetSlug === EXHAUSTED_SLUG) exhausted += 1;
    if (turnsOff) switchedOff += 1;
    if (character.discordUserId) {
      notices.push({ discordUserId: character.discordUserId, content: NOTICE[targetSlug ?? "already"] });
    }
    // Combat mode off ends an escort (ATTACK.md §6a). Lazily required: intercept.js reaches back into the
    // turn machinery, and this pass runs from db/index.js.
    if (turnsOff) {
      const { seenById } = require("./intercept");
      const ended = await endGuardsFor(prisma, [character.id], { line: GUARD_LINES.COMBAT_OFF, seenById }).catch((err) => {
        console.error(`runCombatModeFatiguePass: ending the escort failed for ${character.id}:`, err.message ?? err);
        return [];
      });
      for (const dm of ended) notices.push({ discordUserId: dm.discordUserId, content: dm.content });
    }
  }

  return { turnNumber: turn.number, tired, exhausted, switchedOff, notices };
}

module.exports = { runCombatModeFatiguePass, COMBAT_MODE_NOTICE: NOTICE };
