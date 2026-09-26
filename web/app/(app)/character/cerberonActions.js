"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { SFX } from "@lifeweb/db/lib/sfx";
import { arrestWarrant, removeWarrant, checkWanted as checkWantedVerb } from "@lifeweb/db/lib/verbs/roles";

// The CERBERON section of the character panel: Arrest Warrant, Remove Warrant
// and Check Wanted. The rules are db/lib/verbs/roles.js's, shared with
// Discord's /warrant issue|remove|list; each action here resolves the officer
// from the session, never from a posted id, and the shared function re-checks
// the tag the button's `show` already read — a server action is a public
// endpoint and a hidden button is a hint, not a lock.
//
// A warrant's name is TYPED, not picked (Engrave's reasoning: a dropdown would
// be a full roster handed to anyone). It costs NOTHING, and deliberately posts
// no paper: the only way anyone finds out is by looking the man in the face.

async function officer() {
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

async function arrestWarrantRequestImpl({ name }) {
  const { session, me } = await officer();
  const result = await arrestWarrant(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    name,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidate();
  // The issuer's own tab and nowhere else. The wanted man is told NOTHING.
  return { ok: true, name: result.name, caught: result.caught, line: result.line, sfx: SFX.GAVEL };
}

async function removeWarrantRequestImpl({ name }) {
  const { session, me } = await officer();
  const result = await removeWarrant(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    name,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidate();
  return { ok: true, name: result.name, caught: result.caught, line: result.line };
}

async function checkWantedImpl() {
  const { session, me } = await officer();
  const result = await checkWantedVerb(prisma, { character: me, discordUserId: session.discordUserId });
  if (!result.ok) throw new UserError(result.error);
  revalidate();
  return { ok: true, roster: result.roster, line: result.line };
}

export async function arrestWarrantRequest(input) {
  return acting(() => arrestWarrantRequestImpl(input ?? {}));
}
export async function removeWarrantRequest(input) {
  return acting(() => removeWarrantRequestImpl(input ?? {}));
}
export async function checkWanted() {
  return guarded(() => checkWantedImpl());
}
