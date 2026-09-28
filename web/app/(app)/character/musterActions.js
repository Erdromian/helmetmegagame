"use server";

// A MUSTER late party's two player verbs (docs/systemdocs/LATE-PARTIES.md §4):
// put your name down with priorities over the party's fates, and take it back
// out. The draw itself is db/lib/latePartyRaffle.js, at the end of the turn.
// Every gate is re-derived here -- a server action is a public endpoint.
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { loadLiveParty } from "@lifeweb/db/lib/lateParty";
import { normalizePriorities } from "@lifeweb/db/lib/playerPreferences";
import { readGameState } from "@lifeweb/db/lib/gameState";
import { auth } from "@/lib/auth";
import { getGuildMember, isGm, isLeaderWhitelisted, onRoster, playtestRosterClosed } from "@/lib/discordGuild";

// The same doors createCharacter checks, less the fate: signed in, nobody
// alive, the game open to this member, a MUSTER party live, and no drawn seat
// already waiting to be built.
async function musterGate() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in first." };
  const discordUserId = session.discordUserId;

  const [living, seat, party, state, config, member] = await Promise.all([
    prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { id: true } }),
    prisma.lobbyEntry.findFirst({
      where: { discordUserId, status: "ASSIGNED", expiresAt: { gt: new Date() }, latePartyId: { not: null } },
      select: { id: true },
    }),
    loadLiveParty(prisma),
    readGameState(prisma),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId, 0), // always fresh: a gate must not refuse on a stale roles list
  ]);
  if (living) return { error: "You already have a character." };
  if (seat) return { error: "You have already been drawn. Build your character." };
  if (party?.party.mode !== "MUSTER") return { error: "There is no lateparty mustering." };
  const phase = state?.phase;
  if (phase !== "RUNNING" && phase !== "ENDED" && !isGm(member)) {
    return { error: "Ravenheart isn't open yet." };
  }
  if (!onRoster(member, { playtestMode: playtestRosterClosed(config) })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }
  return { discordUserId, party, whitelisted: isLeaderWhitelisted(member) };
}

// Puts this player's name down, or changes their priorities if it is down
// already. Priorities are the lobby's shape and rules (one High), over the
// party's own fates only; a whitelisted fate is dropped for a player without
// the role, exactly as the lobby drops it.
export async function saveMusterEntry({ priorities }) {
  const gate = await musterGate();
  if (gate.error) return { ok: false, error: gate.error };
  const { discordUserId, party, whitelisted } = gate;

  const allowed = new Set(
    party.fates.filter((f) => f.role && (whitelisted || !f.role.requiresWhitelist)).map((f) => f.roleSlug),
  );
  const clean = normalizePriorities(priorities, allowed);
  if (Object.keys(clean).length === 0) {
    return { ok: false, error: "Set at least one fate above Off, or you can't be drawn." };
  }
  await prisma.latePartyEntry.upsert({
    where: { partyId_discordUserId: { partyId: party.party.id, discordUserId } },
    create: { partyId: party.party.id, discordUserId, priorities: clean, whitelisted },
    update: { priorities: clean, whitelisted },
  });
  revalidatePath("/gm/dev");
  return { ok: true, priorities: clean };
}

export async function leaveMuster() {
  const gate = await musterGate();
  if (gate.error) return { ok: false, error: gate.error };
  await prisma.latePartyEntry.deleteMany({
    where: { partyId: gate.party.party.id, discordUserId: gate.discordUserId },
  });
  revalidatePath("/gm/dev");
  return { ok: true };
}
