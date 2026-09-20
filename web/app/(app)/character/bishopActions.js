"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { acting, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { grantTagSlugs, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import { SFX } from "@lifeweb/db/lib/sfx";
import {
  BISHOP_SLUG,
  EXCOMMUNICATED_SLUG,
  POST_CHRISTIAN_SLUG,
  excommunicationCap,
  excommunicateTarget,
  listExcommunications,
} from "@lifeweb/db/lib/excommunication";

// The BISHOP's section of the character panel: Excommunicate, and the lift
// that undoes it. Same posture as cerberonActions.js beside it — each one
// resolves the Bishop from the session, never from a posted id, and re-checks
// the tag the button's `show` already read, because a server action is a
// public endpoint and a hidden button is a hint, not a lock.
//
// Only three sentences ever reach a player from here, and all three are
// Bascinet's. Do not add a fourth.

// Bascinet's words, verbatim.
const NOT_POST_CHRISTIAN = "They're not Post-Christian.";
const NOT_A_PERSON = "That isn't a valid person.";

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
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  // No line of Bascinet's covers "you are not the Bishop", and nothing in the
  // UI can reach this — the button is hidden rather than greyed. The refusal
  // the caller WOULD have got for a name they may not touch does the job.
  if (!slugs.has(BISHOP_SLUG)) throw new UserError(NOT_A_PERSON);
  return { session, me, slugs, cap: excommunicationCap(slugs) };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// "{n}/{cap} people excommunicated" — Bascinet's counter, written once so the
// dialog's line and the server's refusal can never drift apart.
function counter(n, cap) {
  return `${n}/${cap} people excommunicated`;
}

// ---- Excommunicate ---------------------------------------------------------
// The name is TYPED, not picked — Engrave's reasoning (a dropdown would be a
// roster of the living handed to whoever opened it), and the whole name, so
// the wrong Jorren is not one click away. Costs NOTHING: no Move, no ⬢. The
// cap is the whole limit, and Depriver is the only thing that raises it.
//
// Unlike a warrant, an ambiguous name REFUSES rather than marking everybody
// who answers to it: a seat of the cap is precious, and taking one back costs
// the Bishop a trip to this dialog.
async function excommunicateRequestImpl({ name: rawName }) {
  const { session, me, cap } = await bishop();

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError(NOT_A_PERSON);

  // A composed name is not something Prisma can compare against, so the living
  // roster comes back and excommunicateTarget (pure, tested) does the rest.
  // `tags` is narrowed to the one belief that matters and `excommunicationBorne`
  // to whether anybody already holds a mark on them.
  const candidates = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      discordUserId: true,
      status: true,
      tags: {
        where: { quantity: { gt: 0 }, tag: { slug: POST_CHRISTIAN_SLUG } },
        select: { tagId: true },
      },
      excommunicationBorne: { select: { id: true } },
    },
  });
  const { target, reason } = excommunicateTarget(candidates, typed, { selfId: me.id });
  if (reason === "not-post-christian") throw new UserError(NOT_POST_CHRISTIAN);
  if (!target) throw new UserError(NOT_A_PERSON);

  // The friendly refusal. The real check is the create below, whose unique on
  // targetCharacterId is what stops two Bishops racing onto one soul.
  const held = await prisma.excommunication.count({ where: { bishopId: me.id } });
  // Unreachable through the dialog, which greys its own button at the cap, so
  // this is for a stale page. Bascinet's counter is the only sentence there is
  // for it, and it is the true one.
  if (held >= cap) throw new UserError(counter(held, cap));

  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    // Both halves together: the row is who laid it, the tag is the mark itself
    // (schema.prisma's Excommunication comment). Neither is any use alone.
    await tx.excommunication.create({
      data: { bishopId: me.id, targetCharacterId: target.id },
    });
    await grantTagSlugs(tx, target.id, [EXCOMMUNICATED_SLUG], openTurn?.number ?? null);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_excommunicate",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: { name: target.name, typed, by: me.name },
    });
  });

  await afterInventoryChange([target.id]);
  // Bascinet's words, verbatim. The sound rides the DM so the excommunicated
  // hear the same thing the Bishop just heard, wherever they are standing.
  notifyCharacter(target, "You have been excommunicated, cursing you until it is lifted.", {
    sfx: SFX.BANISH,
  });
  // Deliberately no speakHere: nothing was written for the room, and the tag
  // is `visible: true`, so anybody who looks finds out by looking.
  revalidate();

  const roster = await listExcommunications(prisma, me.id);
  return { ok: true, name: target.name, roster, line: counter(roster.length, cap), sfx: SFX.BANISH };
}

// ---- Lift ------------------------------------------------------------------
// From the list in the same dialog, so there is no name to type and no name to
// get wrong. ONLY YOUR OWN: the row carries who laid it, and another Bishop's
// mark is not yours to take off.
async function liftExcommunicationRequestImpl({ targetId: rawId }) {
  const { session, me, cap } = await bishop();

  const targetId = rawId?.toString().trim() ?? "";
  const row = targetId
    ? await prisma.excommunication.findUnique({
        where: { targetCharacterId: targetId },
        select: {
          id: true,
          bishopId: true,
          targetCharacter: {
            select: { id: true, name: true, discordUserId: true, status: true },
          },
        },
      })
    : null;
  // No row, or somebody else's — the same answer either way, on purpose. Which
  // of the two it was would tell a Bishop whether another Bishop has been at
  // work, and that is not this button's to say.
  if (!row || row.bishopId !== me.id) throw new UserError(NOT_A_PERSON);
  const target = row.targetCharacter;

  const tag = await prisma.tag.findUnique({
    where: { slug: EXCOMMUNICATED_SLUG },
    select: { id: true },
  });

  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    await tx.excommunication.delete({ where: { id: row.id } });
    // Both halves together again. A missing tag row is a no-op rather than a
    // throw — a GM who already took the tag off by hand should still be able
    // to free the seat.
    if (tag) await dropCharacterTag(tx, target.id, tag.id);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_lift_excommunication",
      targetCharacterId: target.id,
      turnId: openTurn?.id ?? null,
      details: { name: target.name, by: me.name },
    });
  });

  await afterInventoryChange([target.id]);
  // Bascinet's words, verbatim. No sound: the sound is the act of banishing,
  // and taking it back is the quiet half.
  notifyCharacter(target, "You are no longer excommunicated.");
  revalidate();

  const roster = await listExcommunications(prisma, me.id);
  return { ok: true, name: target.name, roster, line: counter(roster.length, cap) };
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
