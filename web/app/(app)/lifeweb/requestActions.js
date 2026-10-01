"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import {
  prisma,
  MORTUS_SLUG,
  DRAINED_SLUG,
  LIFEWEB_ATTRIBUTE,
  hasAttribute,
  bloodValueForTags,
  bumpBlood,
  FEED_PERSON_AMOUNT,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { logAudit } from "@/lib/requests";
import { UserError, acting } from "@/lib/actionResult";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { killCharacter } from "@/lib/discordGuild";
import { SFX } from "@lifeweb/db/lib/sfx";
import { HERE_FIELDS } from "@lifeweb/db/lib/presence";
import { resolveHereTarget, seenName } from "@/lib/hereTarget";

// The Lifeweb's two player-facing Requests, same contract as the sheet's
// (web/app/(app)/character/requestActions.js): authenticate, re-validate,
// apply, write Request + AuditLog in ONE transaction. Both snapshot
// `bloodDelta` — what actually moved after the 0-100 clamp — since that is
// the only number an Undo can safely reverse (docs/systemdocs/REQUESTS.md §2).

// The /lifeweb gate is advisory — a server action is a public endpoint, so
// Mortus is re-checked here, plus standing at the Lifeweb — the Location with
// the `lifeweb` attribute, in the Undertown (MAP.md §5).
async function requireMortusCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, location: { select: { attributes: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (!character.tags.some((ct) => ct.tag.slug === MORTUS_SLUG)) {
    throw new UserError("Only the Mortii may touch the Lifeweb.");
  }
  if (!hasAttribute(character.location, LIFEWEB_ATTRIBUTE)) {
    throw new UserError("The Lifeweb is in the Undertown. You have to be standing there.");
  }
  return { session, character };
}

// The target has to be standing where the Mortus is, and arrives as a KEY
// (db/lib/targetKey.js): "character:<id>" for a face they can name,
// "hood:<token>" for a hood or a stranger. It used to be any bare id anywhere
// in the Fortress zone, and the picker listed the whole zone by real name and
// id — a hood-proof roster of the Fortress for every Mortus. resolveHereTarget
// is the same gate every other body verb uses, and it refuses a plain id for
// somebody the Mortus cannot name.
async function requireLivingTarget(character, targetKey) {
  const here = await resolveHereTarget(character, targetKey, { status: "ALIVE", select: HERE_FIELDS });
  // The whole row, re-read: Feed Person hands it to killCharacter, which needs
  // discordRoleId and everything the access teardown reads.
  const target = await prisma.character.findFirst({
    where: { id: here.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) throw new UserError("They aren't here.");
  return target;
}

function revalidateAll() {
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// Bleeding someone: the pool gains, and they carry Drained until it expires
// on its own via the turn sweep. Self-targeting is allowed — donating your
// own blood is the obvious reading of the button.
async function donateBloodRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireMortusCharacter();
  const target = await requireLivingTarget(character, targetCharacterId);
  // As the Mortus knows them: a hood or a stranger is "A young man".
  const seen = target.id === character.id ? "You" : await seenName(character, target.id);

  if (target.tags.some((ct) => ct.tag.slug === DRAINED_SLUG)) {
    throw new UserError(target.id === character.id ? "You're already Drained." : `${seen} is already Drained.`);
  }

  const [openTurn, drainedTag] = await Promise.all([
    getOpenTurn(),
    prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } }),
  ]);
  if (!drainedTag) throw new UserError("The Drained tag is missing — run npm run db:sync-tags.");

  const { amount, tier } = bloodValueForTags(target.tags);
  const expiresTurn = await expiryForGrant(prisma, drainedTag, openTurn, {
    characterId: target.id,
    where: "donateBloodRequest",
  });

  // `blood` must be produced INSIDE the transaction: it feeds the Undo
  // snapshot (REQUESTS.md §2) and must describe this statement's own move.
  let blood;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, amount);
    await tx.characterTag.create({
      data: { characterId: target.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
    });

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tier,
      nominalAmount: amount,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      drainedTagId: drainedTag.id,
      expiresTurn,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_donate_blood",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // Self-donation needs no DM — a player already knows what they clicked.
  if (target.id !== character.id) notifyCharacter(target, "You've been Drained.");

  revalidateAll();
  // The Tower taking blood, in the donor's own ears. It is not a room sound: who is being
  // Drained is nobody else's business, and a noise in the place would say it out loud.
  return { targetName: seen, amount: blood.delta, tier, sfx: SFX.LIFEWEB };
}

// Feeding someone to the Lifeweb kills them, here, on the click. The kill is
// claimed INSIDE the transaction moving the blood, with the same conditional
// `status: ALIVE` where-clause every death path uses (db/lib/characterDeath.js),
// so two Mortii feeding the same person can't both claim it. killCharacter()
// runs after commit — it must never hold the transaction open. Undo does not
// revive (REQUESTS.md §2): it only draws the blood back out.
async function feedPersonRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireMortusCharacter();
  const target = await requireLivingTarget(character, targetCharacterId);
  const seen = target.id === character.id ? "You" : await seenName(character, target.id);

  const openTurn = await getOpenTurn();

  let blood;
  let killed = false;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, FEED_PERSON_AMOUNT);

    // `count` is 0 when someone else got there first; blood still lands but the teardown below is skipped.
    const claim = await tx.character.updateMany({
      where: { id: target.id, status: "ALIVE" },
      data: { status: "DEAD" },
    });
    killed = claim.count > 0;

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      nominalAmount: FEED_PERSON_AMOUNT,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_feed_person",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // Rest of death runs outside the transaction, row status already written.
  // Not awaited-and-thrown: a Discord hiccup must not report the feed as failed.
  if (killed) {
    await killCharacter(target, "You were fed to the Lifeweb.").catch((err) =>
      console.error(`killCharacter failed after feeding ${target.id}:`, err),
    );
  }

  revalidateAll();
  return { targetName: seen, amount: blood.delta, killed, sfx: SFX.LIFEWEB };
}

// Validation comes back as { ok: false, error }, never thrown — Next.js redacts anything thrown out of a Server Action. See web/lib/actionResult.js.

export async function donateBloodRequest(input) {
  return acting(() => donateBloodRequestImpl(input));
}

export async function feedPersonRequest(input) {
  return acting(() => feedPersonRequestImpl(input));
}
