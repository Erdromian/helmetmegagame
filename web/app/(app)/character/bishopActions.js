"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { acting, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { SFX } from "@lifeweb/db/lib/sfx";
import { excommunicate, liftExcommunication } from "@lifeweb/db/lib/verbs/roles";

// The BISHOP's section of the character panel: Excommunicate, and the lift
// that undoes it. The rules — and the only three sentences that ever reach a
// player from here, all Bascinet's — are db/lib/verbs/roles.js's, shared with
// Discord's /bishop excommunicate|lift. Each action here resolves the Bishop
// from the session, never from a posted id.
//
// The name is TYPED, not picked — Engrave's reasoning — and an ambiguous name
// refuses rather than marking everybody who answers to it: a seat of the cap
// is precious. The lift is from the Bishop's own list, never another Bishop's.

async function bishop() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  return { session, me };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

async function excommunicateRequestImpl({ name }) {
  const { session, me } = await bishop();
  const result = await excommunicate(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    name,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  // The sound rides the DM so the excommunicated hear the same thing the
  // Bishop just heard, wherever they are standing. Deliberately no ambient
  // line: the tag is `visible: true`, so anybody who looks finds out by looking.
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidate();
  return { ok: true, name: result.name, roster: result.roster, line: result.line, sfx: SFX.BANISH };
}

async function liftExcommunicationRequestImpl({ targetId }) {
  const { session, me } = await bishop();
  const result = await liftExcommunication(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    targetId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  // No sound: the sound is the act of banishing, and taking it back is the quiet half.
  for (const n of result.notify) notifyCharacter(n.character, n.text, n.opts);
  revalidate();
  return { ok: true, name: result.name, roster: result.roster, line: result.line };
}

// Both CHANGE something, so both go out through acting() rather than
// guarded(): between sittings the game is shut and a player may only talk
// (SESSIONS.md §5).
export async function excommunicateRequest(input) {
  return acting(() => excommunicateRequestImpl(input ?? {}));
}
export async function liftExcommunicationRequest(input) {
  return acting(() => liftExcommunicationRequestImpl(input ?? {}));
}
