"use server";

import { revalidatePath } from "next/cache";
import { prisma, normalizeAntagonistSlugs } from "@lifeweb/db";
import { normalizePriorities, normalizeJoblessRole } from "@lifeweb/db/lib/playerPreferences";
import { auth } from "@/lib/auth";
import { getGuildMember } from "@/lib/discordGuild";
import { lobbyGate as lobbyGateDb, setReady as setReadyDb, setUnready as setUnreadyDb } from "@lifeweb/db/lib/verbs/place";
import { isSpawnOnly } from "@/lib/characterCreation";

// The lobby's three verbs (docs/systemdocs/LOBBY.md §2). Every one re-derives
// the gate from the session and the phase — a server action is a public
// endpoint, and the lobby's own greying is only a hint.

// The phase, the roster and "no living character yet" are db/lib/verbs/place.js's
// lobbyGate, shared with the Ready / Not ready buttons on Discord's #turns;
// this supplies the member's roles the way the page that drew the button did.
async function lobbyGate() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in first." };
  const discordUserId = session.discordUserId;
  const roleIds = await memberRoleIds(discordUserId);
  return lobbyGateDb(prisma, { discordUserId, roleIds });
}

// Same window the page that drew the button gated on (character/page.js), so
// the action is never stricter than the render — and it shares that render's
// memoized cache() entry. Asking for 0 instead skipped the roster cache
// entirely and put a live per-member Discord GET behind every click, which is
// the one route discordGuild.js keeps as a fallback on purpose.
async function memberRoleIds(discordUserId) {
  const member = await getGuildMember(discordUserId, 60_000);
  return member?.roles ?? [];
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

// The rule is db/lib/verbs/place.js#setReady, shared with the Ready button on
// Discord's #turns while the lobby is open.
export async function setReady() {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "Sign in first." };
  const discordUserId = session.discordUserId;
  const result = await setReadyDb(prisma, { discordUserId, roleIds: await memberRoleIds(discordUserId) });
  if (!result.ok) return { ok: false, error: result.error };
  // NOT revalidatePath("/character"): that re-renders the whole page inside
  // this action's reply, and the button waits on it. The client owns its own
  // ready state from the value below, and the lobby refreshes itself anyway.
  revalidatePath("/gm/dev");
  return { ok: true, readyAt: result.readyAt };
}

export async function setUnready() {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "Sign in first." };
  const discordUserId = session.discordUserId;
  const result = await setUnreadyDb(prisma, { discordUserId, roleIds: await memberRoleIds(discordUserId) });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/gm/dev");
  return { ok: true };
}
