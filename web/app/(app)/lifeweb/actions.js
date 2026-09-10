"use server";

import { revalidatePath } from "next/cache";
import { prisma, DRAINED_SLUG, bloodValueForTags, bumpBlood, FEED_PERSON_AMOUNT } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";

// Superadmin, not GM. The Web is the Mortii's to tend and everyone else's to
// wonder about — a GM watching a zone has no call to move its Blood, and the
// panel these two back is gone from their page. A server action is a public
// endpoint (CLAUDE.md), so the gate moving on the page means nothing until it
// moves here too.
async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!isSuperadmin(session.discordUserId)) throw new Error("Not authorized.");
  return session;
}

// The Drained tag auto-expires via its own Tag.defaultDurationTurns
// (docs/tags.yaml) — GM-triggered on behalf of any living character. A
// character already holding Drained cannot be drained again until it expires.
// The amount comes from db/lib/lifeweb.js, the same module the player-facing
// Donate Blood request reads, so the two paths can't grant different numbers.
export async function donateBlood(characterId) {
  const session = await requireSuperadmin();
  if (!characterId) return;

  const character = await prisma.character.findFirst({
    where: { id: characterId ?? "", status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) return;

  const alreadyDrained = character.tags.some((ct) => ct.tag.slug === DRAINED_SLUG);
  if (alreadyDrained) return;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  const { amount, tier } = bloodValueForTags(character.tags);
  // Fetched UNCONDITIONALLY, and the mark below is no longer conditional on it.
  // This used to read `openTurn ? await … : null`, so during a turn advance —
  // when nothing has status OPEN, which is a window that also stays open for
  // hours after a wedged advance — the pool got credited and the donor was
  // never marked. An unmarked donor walks straight back through the
  // alreadyDrained gate above, which is the exact double payout the shared
  // transaction below exists to prevent. expiryForGrant handles the missing
  // turn by deferring to the next one instead (db/lib/grantExpiry.js).
  const drainedTag = await prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } });
  if (!drainedTag) {
    console.error("Lifeweb drain: the Drained tag is missing — run npm run db:sync-tags.");
    return;
  }
  const expiresTurn = await expiryForGrant(prisma, drainedTag, openTurn, {
    characterId: character.id,
    where: "gmDonateBlood",
  });

  // Credit and mark in ONE transaction, same as the player-facing twin in
  // requestActions.js#donateBloodRequestImpl. Split apart, a throw between the
  // two left the pool credited and the donor unmarked — and an unmarked donor
  // passes the alreadyDrained gate above, so the same character could be
  // drained again for another full payout. bumpBlood is still the atomic
  // read-and-move (db/lib/lifeweb.js); it just runs on `tx` now.
  let blood;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, amount);
    await tx.characterTag.create({
      data: { characterId: character.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
    });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_donated_lifeweb_blood",
      targetCharacterId: character.id,
      details: { amount, tier, bloodDelta: blood.delta },
    },
  });

  revalidatePath("/lifeweb");
  revalidatePath("/gm/players", "layout");
  revalidatePath("/character");
}

// No character cost, no Drained tag — a flat top-up.
export async function feedLifewebPerson() {
  const session = await requireSuperadmin();

  // bumpBlood upserts the config row itself, so there is nothing to read first.
  const blood = await bumpBlood(prisma, FEED_PERSON_AMOUNT);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_fed_lifeweb_person",
      details: { amount: FEED_PERSON_AMOUNT, bloodDelta: blood.delta },
    },
  });

  revalidatePath("/lifeweb");
}
