"use server";

import { revalidatePath } from "next/cache";
import { prisma, normalizeAntagonistSlugs } from "@lifeweb/db";
import { readGameState } from "@lifeweb/db/lib/gameState";
import { normalizePriorities, normalizeJoblessRole } from "@lifeweb/db/lib/playerPreferences";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getGuildMember, isLeaderWhitelisted, onRoster } from "@/lib/discordGuild";
import { isSpawnOnly } from "@/lib/characterCreation";

// The lobby's three verbs (docs/systemdocs/LOBBY.md §2). Every one re-derives
// the gate from the session and the phase — a server action is a public
// endpoint, and the lobby's own greying is only a hint.

async function lobbyGate() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in first." };
  const discordUserId = session.discordUserId;

  const [state, config, member, alive] = await Promise.all([
    readGameState(prisma, { phase: true }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { leaderWhitelistEnabled: true, playtestModeEnabled: true } }),
    // Always fresh: a gate must not refuse on a five-minute-old roles list.
    getGuildMember(discordUserId, 0),
    prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { id: true } }),
  ]);
  const superadmin = isSuperadmin(discordUserId);
  if (state?.phase !== "LOBBY") return { error: "The lobby isn't open." };
  const playtestMode = config?.playtestModeEnabled === true;
  if (!superadmin && !onRoster(member, { playtestMode })) {
    // In playtest mode this is not something a player can fix by asking, so
    // say the doors are shut rather than sending them to a GM for a role that
    // would not help.
    return {
      error: playtestMode
        ? "Ravenheart isn't open yet."
        : "You aren't on the roster for this game. Ask a GM if you think that's wrong.",
    };
  }
  if (alive) return { error: "You already have a character." };

  const whitelisted =
    superadmin || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  return { discordUserId, whitelisted };
}

// Which role slugs this player may name at any level: every pickable seat,
// minus the whitelisted ones when they lack the role.
async function allowedRoleSlugs(whitelisted) {
  const roles = await prisma.role.findMany({ select: { slug: true, requiresWhitelist: true } });
  return new Set(
    roles
      .filter((r) => !isSpawnOnly(r))
      .filter((r) => whitelisted || !r.requiresWhitelist)
      .map((r) => r.slug),
  );
}

export async function savePreferences({ priorities, antagonistOptIns, joblessRole }) {
  const gate = await lobbyGate();
  if (gate.error) return { ok: false, error: gate.error };
  const { discordUserId, whitelisted } = gate;

  const allowed = await allowedRoleSlugs(whitelisted);
  const data = {
    rolePriorities: normalizePriorities(priorities, allowed),
    antagonistOptIns: normalizeAntagonistSlugs(antagonistOptIns ?? [], { whitelisted }),
    joblessRole: normalizeJoblessRole(joblessRole),
  };
  await prisma.playerPreference.upsert({
    where: { discordUserId },
    create: { discordUserId, ...data },
    update: data,
  });
  return { ok: true, saved: data };
}

export async function setReady() {
  const gate = await lobbyGate();
  if (gate.error) return { ok: false, error: gate.error };
  const { discordUserId } = gate;

  // One row per player per game. A row in any state other than READY means
  // Start already happened to it, which cannot be the case in LOBBY — but the
  // check costs nothing and a stale tab is exactly when it matters.
  const existing = await prisma.lobbyEntry.findUnique({ where: { discordUserId } });
  if (existing && existing.status !== "READY") {
    return { ok: false, error: "Your seat for this game was already decided." };
  }
  const entry =
    existing ??
    (await prisma.lobbyEntry.create({ data: { discordUserId, status: "READY" } }));
  // Every preference row exists once somebody is readied, so Start never has
  // to special-case a player who touched nothing.
  await prisma.playerPreference.upsert({
    where: { discordUserId },
    create: { discordUserId },
    update: {},
  });
  revalidatePath("/character");
  revalidatePath("/gm/dev");
  return { ok: true, readyAt: entry.readyAt.toISOString() };
}

export async function setUnready() {
  const gate = await lobbyGate();
  if (gate.error) return { ok: false, error: gate.error };
  await prisma.lobbyEntry.deleteMany({ where: { discordUserId: gate.discordUserId, status: "READY" } });
  revalidatePath("/character");
  revalidatePath("/gm/dev");
  return { ok: true };
}
