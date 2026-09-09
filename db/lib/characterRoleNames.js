// The personal Discord role's title, reconciled against the name its character
// is actually going by.
//
// A character's mention role is a name token and nothing else (PROXYING.md §6).
// It used to be titled after the REAL bare name always, disguise or not, and
// that was deliberate — until it wasn't: a Disguise Kit's whole job is to put
// somebody behind a false name for three turns, and a scene where the false
// name is written in the prose and the real one is written in the @-token
// beside it is not a disguise. So the role follows a held Tag.forcedName
// (db/lib/disguiseMint.js, Apex Form), and comes back when the tag goes.
//
// A HOOD does not rename anything. See db/lib/characterRoleAppearance.js.
//
// WHY A RECONCILE AND NOT A HOOK. Count the ways a forcedName tag can arrive
// or leave: minted by the Disguise Kit, dropped early (a disguise row is
// removable on purpose), expired by advanceTurn's bulk deleteMany — which has
// no per-character seam in it at all — granted or revoked by a GM, traded,
// looted, stripped off a corpse, wiped by a Restart. That is eight or more
// generic tag writes, none of which knows a Discord role exists, several of
// them inside loops that would then make a REST call per iteration. Eight
// hooks is eight places that can each independently forget.
//
// So this asks Discord what the roles are called and PATCHes only the ones
// that disagree. One list call, no new column to remember what was last
// written and go stale, and a steady state that costs nothing. It runs from
// advanceTurn beside the Catatonic pass's own role updates, and the two are
// merged before anything is sent so one role is never PATCHed twice in a turn.
//
// Returned side effects, the ARCHITECTURE.md pattern: this computes, the
// caller sends.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { CATATONIC_SLUG } = require("./constants");
const { formatBareName } = require("./characterName");
const { characterRoleAppearance } = require("./characterRoleAppearance");

// A ceiling on one turn's worth of renames. Role PATCH is a slow per-guild
// bucket, and a Restart Game or a bulk grant could otherwise want a hundred of
// them in one pass and spend the guild's whole role budget on it. Whatever is
// left over is still disagreeing next turn, and gets picked up then.
const MAX_RENAMES_PER_PASS = 25;

// `roles` is what db/lib/discordRest.js#getGuildRoles returned — the caller
// fetches it, because the bot and the web app reach Discord differently and
// this module holds no client.
//
// Returns [{ roleId, name, color }], the same shape catatonicPass.js hands
// back, so advanceTurn can concatenate the two lists and send one.
async function reconcileCharacterRoleNames(prisma, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  const byId = new Map(roles.map((role) => [role.id, role]));

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", discordRoleId: { not: null } },
    select: {
      id: true,
      discordRoleId: true,
      firstName: true,
      lastName: true,
      // Both things the title is composed from: a name-forcing tag, and
      // whether they are flagged Catatonic. One row each, not the whole sheet.
      tags: {
        where: { OR: [{ tag: { forcedName: { not: null } } }, { tag: { slug: CATATONIC_SLUG } }] },
        select: { tag: { select: { slug: true, forcedName: true } } },
      },
    },
  });

  const updates = [];
  for (const character of characters) {
    const role = byId.get(character.discordRoleId);
    // A role the DB names but the guild does not have is the channel doctor's
    // to report, not this pass's to invent.
    if (!role) continue;

    const bare = formatBareName(character);
    if (!bare) continue;

    const forcedName = character.tags.find((held) => held.tag?.forcedName)?.tag?.forcedName ?? null;
    const catatonic = character.tags.some((held) => held.tag?.slug === CATATONIC_SLUG);
    const want = characterRoleAppearance(bare, { catatonic, forcedName });

    if (role.name === want.name && role.color === want.color) continue;
    updates.push({ roleId: character.discordRoleId, ...want });
    if (updates.length >= MAX_RENAMES_PER_PASS) break;
  }
  return updates;
}

module.exports = { reconcileCharacterRoleNames, MAX_RENAMES_PER_PASS };
