"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { createRequest, logRequest } from "@/lib/requests";
import {
  DEVICE_SLUG,
  DATACARD_SLUG,
  NUKE_FUSE_TURNS,
  pointerReading,
  pointerLine,
} from "@lifeweb/db/lib/nuke";
import { sendDm } from "@/lib/discordGuild";

// The Nuclear Datacard's three buttons.
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
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  return { session, me, slugs };
}

function requireCard(slugs) {
  if (!slugs.has(DATACARD_SLUG)) throw new UserError("You aren't carrying the datacard. ‡");
}

// Both halves, for Arm and Disarm. You cannot work the device you are not
// holding, which is what the greyed button already says.
function requireBoth(slugs) {
  requireCard(slugs);
  if (!slugs.has(DEVICE_SLUG)) throw new UserError("The device isn't here in your hands. ‡");
}

async function readPointerImpl() {
  const { me, slugs } = await holder();
  requireCard(slugs);

  const reading = await pointerReading(prisma, me.locationId);
  const line = pointerLine(reading);

  // The answer arrives as a DM rather than on the page, so a player reading
  // the card in a room full of people gives nothing away by doing it.
  await sendDm(me.discordUserId, line, { source: "player_event" }).catch((err) =>
    console.error(`Datacard pointer DM to ${me.name} failed:`, err),
  );
  return { line, here: Boolean(reading.here) };
}

async function armNukeImpl({ reason: rawReason }) {
  const { session, me, slugs } = await holder();
  const reason = String(rawReason ?? "").trim();
  if (!reason) throw new UserError("Say why. ‡");
  requireBoth(slugs);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open. ‡");

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.nukeDetonatedTurn != null) throw new UserError("It has already gone off. ‡");
  if (config?.nukeArmedTurn != null) throw new UserError("It is already counting down. ‡");

  // The absolute turn it fires on. Two turns, counted the way every other
  // duration in the game counts: armed while turn T is open, it goes at the
  // close of T+1.
  const firesOn = openTurn.number + NUKE_FUSE_TURNS - 1;
  const effect = { firesOn, armedOnTurn: openTurn.number, locationId: me.locationId };

  await prisma.$transaction(async (tx) => {
    await tx.gameConfig.update({ where: { id: 1 }, data: { nukeArmedTurn: firesOn } });
    await createRequest(tx, {
      characterId: me.id,
      turnId: openTurn.id,
      type: "ARM_NUKE",
      reason,
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_arm_nuke",
      targetCharacterId: me.id,
      reason,
      details: effect,
    });
  });

  revalidatePath("/character");
  return { firesOn };
}

async function disarmNukeImpl({ reason: rawReason }) {
  const { session, me, slugs } = await holder();
  const reason = String(rawReason ?? "").trim();
  if (!reason) throw new UserError("Say why. ‡");
  requireBoth(slugs);

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open. ‡");

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (config?.nukeDetonatedTurn != null) throw new UserError("It has already gone off. ‡");
  if (config?.nukeArmedTurn == null) throw new UserError("It isn't armed. ‡");

  // Snapshotted so an Undo can put the countdown back exactly where it was
  // rather than guessing at it.
  const effect = { wasFiringOn: config.nukeArmedTurn, disarmedOnTurn: openTurn.number };

  await prisma.$transaction(async (tx) => {
    await tx.gameConfig.update({ where: { id: 1 }, data: { nukeArmedTurn: null } });
    await createRequest(tx, {
      characterId: me.id,
      turnId: openTurn.id,
      type: "DISARM_NUKE",
      reason,
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_disarm_nuke",
      targetCharacterId: me.id,
      reason,
      details: effect,
    });
  });

  revalidatePath("/character");
  return { disarmed: true };
}

// NOT named usePointer: ESLint's rules-of-hooks reads any exported
// `useX` as a React hook and refuses it inside a callback. The button still
// says Use Pointer.
export async function readPointer() {
  return guarded(() => readPointerImpl());
}
export async function armNuke(input) {
  return guarded(() => armNukeImpl(input));
}
export async function disarmNuke(input) {
  return guarded(() => disarmNukeImpl(input));
}
