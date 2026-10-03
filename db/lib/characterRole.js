// A character's personal Discord role: the mentionable name token (PROXYING.md §6, CHANNELS.md §3), held by
// nobody and granting nothing. EVERY living character has one, playing on Discord or not. It is how a Discord
// player names somebody — /add, /remove, /heal and an @ all pick a role — so a character without one can't be
// let into a conversation from Discord at all. It names the character, never the account, so a web-only
// player gives nothing away by having one (CHAT.md §6a).
//
// Two callers: web/lib/discordGuild.js#ensureCharacterRole (creation, renames, the Bio save) and the channel
// doctor's character-role check (db/lib/channelDoctor/sweeps/roles.js), which mints any that are missing.
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel; require it by path.

const { characterRoleAppearance } = require("./characterRoleAppearance");
const { formatBareName } = require("./characterName");
const { CATATONIC_SLUG } = require("./constants");
const { createGuildRole, patchGuildRole, deleteGuildRole } = require("./discordRest");

// Name and colour, through characterRoleAppearance so a Catatonic grey and a disguise's false name stay intact.
async function characterRoleLook(prisma, character, bare) {
  const held = await prisma.characterTag.findMany({
    where: {
      characterId: character.id,
      OR: [{ tag: { slug: CATATONIC_SLUG } }, { tag: { forcedName: { not: null } } }],
    },
    select: { tag: { select: { slug: true, forcedName: true } } },
  });
  const catatonic = held.some((row) => row.tag?.slug === CATATONIC_SLUG);
  const forcedName = held.find((row) => row.tag?.forcedName)?.tag?.forcedName ?? null;
  return characterRoleAppearance(bare, { catatonic, forcedName });
}

// A new role for `character`, recorded only if the row still holds the id it was read with. Two writers
// minting at once (a save and the doctor) then keep one role, and the loser deletes its own. Throws on a
// REST failure, so the doctor can tell a repair from a miss. Needs id, firstName, lastName, discordRoleId.
async function mintCharacterRole(prisma, character) {
  const bare = formatBareName(character);
  if (!bare) throw new Error("no name to put on a role");
  const look = await characterRoleLook(prisma, character, bare);
  // permissions: "0" is NOT the API default — omitting it copies @everyone's bits, which made
  // db:prune-orphan-roles' "carries permissions" gate refuse to ever delete a character role.
  const role = await createGuildRole({ ...look, hoist: false, mentionable: true, permissions: "0" });
  const { count } = await prisma.character.updateMany({
    where: { id: character.id, discordRoleId: character.discordRoleId ?? null },
    data: { discordRoleId: role.id },
  });
  if (count === 0) {
    await deleteGuildRole(role.id).catch(() => {});
    const now = await prisma.character.findUnique({ where: { id: character.id }, select: { discordRoleId: true } });
    return now?.discordRoleId ?? null;
  }
  return role.id;
}

// Mint the role if none is recorded, else repaint it to the current name. Never throws; answers the role
// id, or whatever was recorded if Discord refused.
async function ensureCharacterRole(prisma, character) {
  if (!process.env.DISCORD_GUILD_ID || !process.env.DISCORD_TOKEN) return character.discordRoleId ?? null;
  const bare = formatBareName(character);
  if (!bare) return character.discordRoleId ?? null;
  try {
    if (!character.discordRoleId) return await mintCharacterRole(prisma, character);
    await patchGuildRole(character.discordRoleId, await characterRoleLook(prisma, character, bare));
    return character.discordRoleId;
  } catch (err) {
    console.error("ensureCharacterRole failed:", err);
    return character.discordRoleId ?? null;
  }
}

module.exports = { ensureCharacterRole, mintCharacterRole };
