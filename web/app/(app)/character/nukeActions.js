"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { readDatacard, armNuke as armNukeVerb, disarmNuke as disarmNukeVerb } from "@lifeweb/db/lib/verbs/roles";
import { sendDm } from "@/lib/discordGuild";
import { SFX } from "@lifeweb/db/lib/sfx";

// The Nuclear Datacard's three buttons. The rules are
// db/lib/verbs/roles.js's, shared with Discord's /nuke pointer|arm|disarm.
//
// Use Pointer files no Request — the third control on the grid that doesn't
// (Examine and Read are the others), for the same reason: it moves nothing,
// costs nothing, spends no Move and can be pressed as often as you like.
// Reading an instrument is not an act, and there is nothing for a GM to
// review or undo.
//
// Arm and Disarm DO file one. They change the state of the world and a GM
// must be able to see and reverse them — the whole safeguard on this feature
// is that the two-turn window is visible and defusable.

// The holder, from the session and never from a posted id — a server action is
// a public endpoint, and the button's `show`/`gate` are hints, not locks.
async function holder() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      discordUserId: true,
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  return { session, me };
}

async function readPointerImpl() {
  const { me } = await holder();
  const result = await readDatacard(prisma, { character: me });
  if (!result.ok) throw new UserError(result.error);
  // The answer arrives as a DM rather than on the page, so a player reading
  // the card in a room full of people gives nothing away by doing it.
  await sendDm(me.discordUserId, result.line, { source: "player_event" }).catch((err) =>
    console.error(`Datacard pointer DM to ${me.name} failed:`, err),
  );
  return { line: result.line, here: result.here, sfx: SFX.NUKE_PING };
}

async function armNukeImpl() {
  const { session, me } = await holder();
  const result = await armNukeVerb(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  revalidatePath("/character");
  return { firesOn: result.firesOn, line: result.line, sfx: SFX.NUKE_ARM };
}

async function disarmNukeImpl() {
  const { session, me } = await holder();
  const result = await disarmNukeVerb(prisma, {
    character: me,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  revalidatePath("/character");
  return { disarmed: true, line: result.line, sfx: SFX.OK_QUIET };
}

// NOT named usePointer: ESLint's rules-of-hooks reads any exported
// `useX` as a React hook and refuses it inside a callback. The button still
// says Use Pointer.
export async function readPointer() {
  return guarded(() => readPointerImpl());
}
export async function armNuke(input) {
  return acting(() => armNukeImpl(input));
}
export async function disarmNuke(input) {
  return acting(() => disarmNukeImpl(input));
}
