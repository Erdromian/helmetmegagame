"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { announceFight } from "@lifeweb/db/lib/combatAnnounce";
import {
  loadAttack,
  startFight,
  interveneFight,
  answerFightInvite,
  describeFight,
  callOffFight,
} from "@lifeweb/db/lib/verbs/combat";

// FIGHTING, from the character sheet, /chat and the DM thread (docs/systemdocs/ATTACK.md).
//
// Same posture as interceptActions.js: the actor is resolved from the session and never from a posted
// id, the dialog's own lists are advisory because a server action is a public endpoint, and every refusal
// is a UserError through guarded(). The rules are db/lib/verbs/combat.js, shared with the Discord bot;
// this file only resolves who is asking and sends what the verb hands back.
//
// A fight costs nothing — no Move, no ⬢, no Action row (Bascinet, 2026-09-27).

async function me() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");
  return { session, character };
}

async function openTurnOrRefuse() {
  const turn = await getOpenTurn();
  if (!turn) throw new UserError("There's no turn open right now.");
  return turn;
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
}

// Post-commit, after() rather than inside: no network call may run inside a transaction, and a Discord
// outage must not undo the fight.
function sendAfter(result) {
  const dms = result?.dms ?? [];
  const announce = result?.announce ?? null;
  if (dms.length === 0 && !announce) return;
  after(async () => {
    for (const dm of dms) {
      await sendDm(dm.discordUserId, dm.content, {
        kind: dm.kind,
        components: dm.components,
        meta: dm.meta,
        sfx: dm.sfx,
        authorDiscordUserId: dm.authorDiscordUserId ?? null,
        // A character name is player-typed, so it rides in these lines. The belt the Intercept DMs wear.
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    // The room hears it in the names each reader knows (db/lib/combatAnnounce.js): one lensed row on the
    // web, a DM each to the Discord players standing there.
    if (announce) await announceFight(prisma, announce, { skipIds: announce.fighters }).catch((err) => console.error("Attack: announcement failed:", err));
  });
}

function settle(result) {
  if (!result?.ok) throw new UserError(result?.error ?? "That didn't work.");
  sendAfter(result);
  revalidate();
  return { ok: true, line: result.line ?? null, ended: result.ended ?? false };
}

async function loadAttacksImpl() {
  const { character } = await me();
  const turn = await getOpenTurn();
  const out = await loadAttack(prisma, { characterId: character.id, turn });
  if (!out.ok) throw new UserError(out.error);
  return { ok: true, people: out.people, fights: out.fights, blocked: out.blocked, view: out.view };
}

async function attackCharacterImpl({ targetKeys, collaboratorKeys }) {
  const { session, character } = await me();
  const turn = await openTurnOrRefuse();
  return settle(
    await startFight(prisma, {
      characterId: character.id,
      discordUserId: session.discordUserId,
      targetKeys: Array.isArray(targetKeys) ? targetKeys.map(String) : [],
      collaboratorKeys: Array.isArray(collaboratorKeys) ? collaboratorKeys.map(String) : [],
      turn,
    }),
  );
}

async function interveneImpl({ combatId, side }) {
  const { session, character } = await me();
  const turn = await openTurnOrRefuse();
  return settle(
    await interveneFight(prisma, {
      characterId: character.id,
      discordUserId: session.discordUserId,
      combatId: String(combatId ?? ""),
      // Only the two the dialog sends. Anything else reaches intervene() as no side, which refuses it.
      side: side === "DEFENDER" || side === "ATTACKER" ? side : null,
      turn,
    }),
  );
}

async function answerInviteImpl({ participantId, join }) {
  const { session, character } = await me();
  const turn = await openTurnOrRefuse();
  return settle(
    await answerFightInvite(prisma, {
      characterId: character.id,
      discordUserId: session.discordUserId,
      participantId: String(participantId ?? ""),
      join: join === true,
      turn,
    }),
  );
}

async function describeImpl({ participantId, text }) {
  const { character } = await me();
  const turn = await openTurnOrRefuse();
  return settle(
    await describeFight(prisma, {
      characterId: character.id,
      participantId: String(participantId ?? ""),
      text: String(text ?? ""),
      turn,
    }),
  );
}

async function callOffImpl({ participantId }) {
  const { session, character } = await me();
  const turn = await openTurnOrRefuse();
  return settle(
    await callOffFight(prisma, {
      characterId: character.id,
      discordUserId: session.discordUserId,
      participantId: String(participantId ?? ""),
      turn,
    }),
  );
}

export async function loadAttacks() {
  return guarded(() => loadAttacksImpl());
}
export async function attackCharacterRequest(input) {
  return acting(() => attackCharacterImpl(input ?? {}));
}
export async function interveneRequest(input) {
  return acting(() => interveneImpl(input ?? {}));
}
export async function answerFightInviteRequest(input) {
  return acting(() => answerInviteImpl(input ?? {}));
}
export async function describeFightRequest(input) {
  return acting(() => describeImpl(input ?? {}));
}
export async function callOffFightRequest(input) {
  return acting(() => callOffImpl(input ?? {}));
}
