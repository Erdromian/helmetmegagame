"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { broadcastTrumpet, TRUMPET_COOLDOWN_MS } from "@lifeweb/db/lib/trumpet";
import { auth } from "@/lib/auth";

// Sounding a trumpet is heard across the Location graph — db/lib/trumpet.js for
// the reach, db/lib/soundBroadcast.js for how it carries. This is the web half:
// the button is on your own Character page rather than in Discord, because
// "only if you have one" is a per-reader question and a Discord button sits on
// an anchor message everybody shares.
//
// It writes an AuditLog row, unlike equipping. Blowing a trumpet is heard by
// most of the barony and cannot be taken back, so a GM asked "who did that"
// should have an answer — the same reasoning the bell rope's row follows.

// One clock per character, in this process's memory — the `lastShouted` pattern
// from the bot's /shout handler. In memory rather than a column because the
// cooldown is a courtesy against spam, not game state anybody reasons about; a
// deploy clearing it costs nothing. Per character rather than global because
// two heralds in two zones are two trumpets.
const lastSounded = new Map();

export async function soundTrumpet() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // The character comes from the session, never from the client: a server
  // action is a public endpoint, so an id posted directly would let anyone
  // sound somebody else's trumpet from somebody else's Location.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      locationId: true,
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return { ok: false, error: "No living character." };

  // Every gate the page already applied, re-applied. The button being hidden
  // is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag.slug === TRUMPET_SLUG)) {
    return { ok: false, error: "You aren't carrying a trumpet. ‡" };
  }
  if (!character.locationId) {
    return { ok: false, error: "You're nowhere. ‡" };
  }

  // ACT, not SPEAK: a trumpet takes breath AND hands, so being Bound stops you
  // where it deliberately would not stop a shout.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    return { ok: false, error: `You can't raise it to your lips — you're ${blocker.name}. ‡` };
  }

  const since = Date.now() - (lastSounded.get(character.id) ?? 0);
  if (since < TRUMPET_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((TRUMPET_COOLDOWN_MS - since) / 60_000));
    return {
      ok: false,
      error: `Your lips need about ${minutes} more minute${minutes === 1 ? "" : "s"}. ‡`,
    };
  }
  // Claimed BEFORE the posting loop, not after: the loop is a couple of dozen
  // REST calls and takes real seconds, which is exactly long enough for a
  // second click to slip past a cooldown stamped at the end.
  lastSounded.set(character.id, Date.now());

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "trumpet_sounded",
        targetCharacterId: character.id,
        details: { characterName: character.name, locationId: character.locationId },
      },
    })
    .catch((err) => console.error("Trumpet audit log failed:", err));

  // Post-commit and catch-logged, the db/lib/structures.js#announceEdgeState
  // discipline: a Discord outage must never roll back work that really
  // happened, and two dozen REST calls must not hold the click open
  // (ARCHITECTURE.md §5).
  const locationId = character.locationId;
  after(() =>
    broadcastTrumpet(prisma, locationId).catch((err) =>
      console.error("Trumpet broadcast failed:", err),
    ),
  );

  revalidatePath("/character");
  return { ok: true };
}
