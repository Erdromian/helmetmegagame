import { cache } from "react";
import { hasGmRole } from "@lifeweb/db/lib/roleIds";
import { listGuildMembers } from "./discordGuild";

// The GM roster, with avatars, for the small pfp that sits next to any
// GM-attributed row in the web app (the lock holder on a queue row, a staged
// row's author, a request's reviewer).
//
// DERIVED from discordGuild.js#listGuildMembers rather than fetched.
//
// It used to do its own `/guilds/:id/members?limit=1000` — the byte-for-byte
// same Discord request that call makes — behind its own five-minute TTL and
// its own in-flight dedupe. So the player desk's conversation page asked
// Discord for the entire guild TWICE to render one conversation, and because
// the two TTLs expired independently, a click could pay for one, the other,
// or both. On a guild this size that is the slowest thing on the page by a
// wide margin, and it was the reason opening somebody could stall for seconds
// with no pattern to it.
//
// Deriving costs nothing and cannot drift: one fetch, one cache, one stale
// fallback, one answer about who is in the guild.
//
// The only thing that had to change to make this possible is that the member
// list now carries `guildAvatar` (the server-specific picture) beside
// `avatar` (the global one). A GM who set a server avatar should show that
// one, which is what the separate fetch was really for.
function avatarUrlFor(guildId, member) {
  if (member.guildAvatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${member.id}/avatars/${member.guildAvatar}.png?size=64`;
  }
  if (member.avatar) {
    return `https://cdn.discordapp.com/avatars/${member.id}/${member.avatar}.png?size=64`;
  }
  return null;
}

export const getGmProfiles = cache(async () => {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return [];
  // listGuildMembers already owns the TTL, the in-flight dedupe and the
  // serve-stale-on-failure path, and returns [] rather than throwing when
  // Discord is unreachable. Nothing to add.
  const members = await listGuildMembers();
  return members
    .filter((m) => hasGmRole(m.roles))
    .map((m) => ({
      discordUserId: m.id,
      username: m.username,
      avatarUrl: avatarUrlFor(guildId, m),
    }));
});
