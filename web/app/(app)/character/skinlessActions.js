"use server";

// The Skinless's two web verbs (db/lib/skinless.js, docs/systemdocs/SKINLESS.md):
// respawning as one, which skips the wizard entirely, and Smell Skin on the
// sheet. Every gate is re-derived here -- a server action is a public endpoint.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import { readGameState } from "@lifeweb/db/lib/gameState";
import { loadLiveParty } from "@lifeweb/db/lib/lateParty";
import { SKINLESS_ROLE_SLUG, spawnSkinless } from "@lifeweb/db/lib/skinless";
import { smellSkin as smellSkinVerb } from "@lifeweb/db/lib/verbs/roles";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { seedStartingMap } from "@lifeweb/db/lib/mapMemory";
import { seedAcquaintances } from "@lifeweb/db/lib/acquaintances";
import { closeDeadchatTo } from "@lifeweb/db/lib/deadchat";
import { ensureCharacterRole, getGuildMember, isGm, onRoster, playtestRosterClosed } from "@/lib/discordGuild";
import { recordArchiveEvent } from "@/lib/archive";

// A party that names the Skinless is live, or it is not; nothing else to say.
const NO_HORDE_REFUSAL = "There is no Skinless horde to join right now.";

// Respawns the signed-in player as a Skinless of the live party. No form: the
// body, the name and the kit are all rolled (db/lib/skinless.js#spawnSkinless).
// Open or muster alike -- the Skinless never run out of room, so there is
// nothing to draw. The curse does not reach a party fate, so it is not read.
export async function respawnAsSkinless() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: { id: true } })) {
    redirect("/character");
  }

  const [party, state, config, member, openTurn] = await Promise.all([
    loadLiveParty(prisma),
    readGameState(prisma),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId, 0), // always fresh: a gate must not refuse on a stale roles list
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
  ]);

  // The doors createCharacter checks, less the fate: the game running (or a GM
  // skipping ahead), and this member on the roster. A superadmin passes both.
  const bypass = isSuperadmin(discordUserId);
  const phase = state?.phase;
  if (!bypass && phase !== "RUNNING" && phase !== "ENDED" && !isGm(member)) {
    return { error: "Ravenheart isn't open yet." };
  }
  if (!bypass && !onRoster(member, { playtestMode: playtestRosterClosed(config) })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }
  if (!party?.fates.some((f) => f.roleSlug === SKINLESS_ROLE_SLUG && f.role)) {
    return { error: NO_HORDE_REFUSAL };
  }

  let spawned;
  try {
    spawned = await spawnSkinless(prisma, { discordUserId, partyId: party.party.id, turn: openTurn });
  } catch (err) {
    if (err.message === "ALREADY_ALIVE") redirect("/character");
    if (err.message === "PARTY_OVER" || err.message === "NO_ROLE") return { error: NO_HORDE_REFUSAL };
    throw err;
  }
  const { character: created, role, location, tags } = spawned;

  // Discord side effects, best-effort, as createCharacter runs them.
  await ensureCharacterRole(created).catch(() => {});
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch(() => {});
  }
  const heldSlugs = tags.map((t) => t.slug);
  await seedStartingMap(
    prisma,
    { ...created, tags: heldSlugs.map((slug) => ({ equipped: false, tag: { slug } })) },
    role.slug,
    heldSlugs,
  ).catch(() => {});
  await seedAcquaintances(prisma, created.id).catch((err) => console.error("seedAcquaintances failed:", err));
  await closeDeadchatTo(prisma, discordUserId).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        skinless: true,
        partyId: party.party.id,
        zone: location?.zone?.name ?? null,
        location: location?.name ?? null,
        tags: tags.map((t) => t.name),
      },
    },
  });

  await recordArchiveEvent({
    kind: "CHARACTER_CREATED",
    character: created,
    zoneId: created.zoneId ?? null,
    zoneName: location?.zone?.name ?? null,
    turn: openTurn,
    content: `${created.name} crawled out of the dark as ${role.name}.`,
  });

  revalidatePath("/", "layout");
  redirect("/character");
}

// Smell Skin, from the sheet. The rule and its words are shared with Discord's
// /skinless smell (db/lib/verbs/roles.js).
async function smellSkinImpl() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true },
  });
  if (!me) redirect("/character");
  const result = await smellSkinVerb(prisma, { character: me });
  if (!result.ok) throw new UserError(result.error);
  return { ok: true, line: result.line };
}

export async function smellSkin() {
  return guarded(() => smellSkinImpl());
}
