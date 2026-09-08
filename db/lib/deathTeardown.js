// The DISCORD half of a character's death, in one place — the twin of
// db/lib/characterDeath.js, which owns the database half.
//
// Three callers used to write this walk out by hand: the turn engine's
// side-effect thunk (db/index.js), the rites (db/lib/riteEffects.js), and
// web/lib/discordGuild.js#killCharacter. A fourth never wrote it at all — a
// turret kill left the character DEAD on the sheet and fully present in the
// guild, still holding their personal role, every channel overwrite and their
// nickname, with no ghost seat. That gap is why this file exists.
//
// ORDER MATTERS, and it is the same order killCharacter has always used:
// revoke the overwrites while the role still names them, then delete the role,
// then clear the nickname, then hand over the ghost seat.
//
// REST only, never inside a transaction (ARCHITECTURE.md §5). Every step is
// wrapped: a death is a database fact and must not be undone by a 429.
//
// Takes `prisma` as the first parameter — the db/lib/dm.js convention — and is
// deliberately off the @lifeweb/db barrel; require it by path.
const { deleteGuildRole, addMemberRole, setGuildNickname, getGuildMember } = require("./discordRest");
const { revokeAllCharacterAccess } = require("./accessSweep");
const { GHOST_ROLE_ID } = require("./roleIds");

// `character` needs only { id, name, discordUserId, discordRoleId }. The role
// id has to be READ BEFORE applyDeathToRow runs, which nulls the column — every
// caller captures it first for exactly this reason.
async function applyDeathTeardown(prisma, character) {
  const log = (what) => (err) => console.error(`Death teardown: ${what} failed:`, err?.message ?? err);

  await revokeAllCharacterAccess(prisma, character).catch(log(`revoke for ${character.name}`));

  if (character.discordRoleId) {
    await deleteGuildRole(character.discordRoleId).catch(log(`role delete for ${character.name}`));
  }

  // Checked up front so a departed player's steps don't just 403 into the REST
  // breaker's tally. No member, no nickname to clear and no seat to grant.
  const member = await getGuildMember(character.discordUserId).catch(() => null);
  if (!member) return { member: false };

  await setGuildNickname(character.discordUserId, null).catch(log(`nickname for ${character.name}`));
  await addMemberRole(character.discordUserId, GHOST_ROLE_ID).catch(log(`ghost seat for ${character.name}`));
  return { member: true };
}

module.exports = { applyDeathTeardown };
