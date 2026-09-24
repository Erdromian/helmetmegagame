// Caches every guild member's Discord handle, so a GM can search "peace.lock"
// instead of a snowflake. The rule and the writes live in
// db/lib/discordAccounts.js — this is only the gateway half.
const { prisma } = require("@lifeweb/db");
const { accountRowsFromMembers, syncDiscordAccounts } = require("@lifeweb/db/lib/discordAccounts");

// The bulk catch-up, called from ready.js. `guild.members.fetch()` is a gateway
// fetch, not REST, so it costs nothing against the request budget
// (bot/src/lib/leaveReconcile.js says the same of its own).
async function syncDiscordAccountsForGuild(guild) {
  try {
    await guild.members.fetch();
    const rows = accountRowsFromMembers([...guild.members.cache.values()]);
    const { created, updated, unchanged } = await syncDiscordAccounts(prisma, rows);
    console.log(
      `Discord handles for guild ${guild.name}: ${created} new, ${updated} changed, ${unchanged} unchanged`,
    );
  } catch (err) {
    console.error(`Failed to sync Discord handles for guild ${guild.name}: ${err.message}`);
  }
}

module.exports = { syncDiscordAccountsForGuild };
