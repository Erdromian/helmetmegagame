// Read-only: why can't a spectator read anything? Prints, and changes nothing:
//   - GameState.phase (the seat is shut outside RUNNING/ENDED, db/lib/spectatorAccess.js)
//   - whether SPECTATOR_ROLE_ID is a role in this guild, and who holds it
//   - the role's and @everyone's guild-level View / Read Message History bits
//   - the spectator overwrite on #turns, Deadchat, one #summary and a few Location channels,
//     against what db/lib/spectatorAccess.js wants written there now
//
//   npm run db:spectator-diag
//
// Only GETs against Discord, one read of the database. Safe against the live game.
require("dotenv").config();
const { prisma } = require("../../index");
const { getGuildRoles, getGuildChannels } = require("../../lib/discordRest");
const { SPECTATOR_ROLE_ID } = require("../../lib/roleIds");
const { spectatorsVisible, spectatorOverwrite, managedSpectatorChannels } = require("../../lib/spectatorAccess");

const VIEW = 1024n;
const READ_HISTORY = 65536n;

function bits(value) {
  const n = BigInt(value ?? "0");
  return `View ${n & VIEW ? "yes" : "no"}, Read History ${n & READ_HISTORY ? "yes" : "no"}`;
}

async function holders(guildId) {
  // Paged roster read, the way web/lib/discordGuild.js#fetchGuildMembers does it.
  const out = [];
  let after = "0";
  for (;;) {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    });
    if (!res.ok) throw new Error(`member list ${res.status}`);
    const page = await res.json();
    out.push(...page.filter((m) => m.roles?.includes(SPECTATOR_ROLE_ID)));
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return out;
}

async function main() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");

  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { phase: true } });
  const visible = spectatorsVisible(state?.phase);
  console.log(`Phase: ${state?.phase ?? "(no row)"} -> spectators ${visible ? "SHOULD see" : "are SHUT OUT of"} the game`);

  const roles = await getGuildRoles();
  const role = roles.find((r) => r.id === SPECTATOR_ROLE_ID);
  const everyone = roles.find((r) => r.id === guildId);
  if (!role) {
    console.log(`Spectator role ${SPECTATOR_ROLE_ID}: NOT IN THIS GUILD. Every spectator overwrite targets nobody.`);
    const named = roles.filter((r) => /spectat/i.test(r.name));
    for (const r of named) console.log(`  A role named "${r.name}" exists with id ${r.id}`);
  } else {
    console.log(`Spectator role: "${role.name}" (${role.id}), guild-level ${bits(role.permissions)}`);
  }
  console.log(`@everyone guild-level: ${bits(everyone?.permissions)}`);

  try {
    const held = await holders(guildId);
    console.log(`Members holding the Spectator role: ${held.length}`);
  } catch (err) {
    console.log(`Members holding the Spectator role: couldn't read (${err.message})`);
  }

  const want = spectatorOverwrite({ visible })[0];
  const managed = await managedSpectatorChannels(prisma);
  const live = new Map((await getGuildChannels()).map((c) => [c.id, c]));
  const sample = [
    ...managed.filter((t) => t.label === "#turns" || t.label === "#deadchat"),
    ...managed.filter((t) => t.label.endsWith("/summary")).slice(0, 1),
    ...managed.filter((t) => !t.label.includes("/") && !t.label.startsWith("#")).slice(0, 3),
  ];
  let drifted = 0;
  for (const t of managed) {
    const o = live.get(t.id)?.permission_overwrites?.find((x) => x.id === SPECTATOR_ROLE_ID);
    if (!o || o.allow !== want.allow || o.deny !== want.deny) drifted += 1;
  }
  console.log(`Managed channels: ${managed.length}, carrying the wrong spectator bits: ${drifted}`);
  console.log(`Wanted now: allow ${bits(want.allow)}`);
  for (const t of sample) {
    const channel = live.get(t.id);
    if (!channel) {
      console.log(`  ${t.label}: channel id ${t.id} not found in the guild`);
      continue;
    }
    const o = channel.permission_overwrites?.find((x) => x.id === SPECTATOR_ROLE_ID);
    console.log(`  ${t.label}: ${o ? `allow ${bits(o.allow)}; deny ${bits(o.deny)}` : "NO spectator overwrite"}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
