"use server";

// The Late party verbs, behind /gm/dev?s=lateparty (db/lib/lateParty.js,
// docs/systemdocs/LATE-PARTIES.md).
//
// SUPERADMIN, not GM-tier like Late joins: a party locks every fate but its own
// for as long as it runs, which is a decision about the whole game's creation,
// not one seat. Bascinet's call, 2026-09-27. Re-checks everything the UI
// already checked, since a server action is a public endpoint.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import {
  normalizePartyFates,
  startLateParty,
  endLateParty,
  latePartyMessage,
  playersWithoutLivingCharacter,
} from "@lifeweb/db/lib/lateParty";
import { requireDev } from "@/lib/devAccess";
import { CANONICAL_ORIGIN } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";

function repaint() {
  revalidatePath("/gm/dev");
  revalidatePath("/character");
}

// The form posts one `include` checkbox per fate it wants, and a `slots:<slug>`
// field beside each, blank for unlimited. A fate with a number typed in is
// wanted whether or not its box was ticked -- nobody types "3" meaning no.
export async function startLatePartyAction(formData) {
  const session = await requireDev("super");
  const roles = await prisma.role.findMany({ select: { slug: true } });

  const slotsOf = (slug) => formData.get(`slots:${slug}`)?.toString().trim() ?? "";
  const wanted = new Set(formData.getAll("include").map((slug) => slug.toString()));
  for (const { slug } of roles) if (slotsOf(slug) !== "") wanted.add(slug);
  const rows = [...wanted].map((roleSlug) => ({ roleSlug, slots: slotsOf(roleSlug) }));
  const bad = rows.find((row) => row.slots !== "" && !/^[1-9]\d*$/.test(row.slots));
  if (bad) return { error: "Slots must be a whole number from 1, or blank for unlimited." };
  const fates = normalizePartyFates(rows, roles.map((r) => r.slug));
  if (fates.length === 0) return { error: "Pick at least one fate, with at least 1 slot or blank for unlimited." };

  const party = await prisma.$transaction((tx) => startLateParty(tx, { fates, by: session.discordUserId }));
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "late_party_start",
        details: { partyId: party.id, fates },
      },
    })
    .catch((err) => console.error("Late party audit log failed:", err));

  repaint();
  after(async () => {
    // Sequential on purpose, as Start Game's DMs are: a burst of them at once
    // is a rate-limit incident.
    const recipients = await playersWithoutLivingCharacter(prisma);
    for (const discordUserId of recipients) {
      await sendDm(discordUserId, latePartyMessage(CANONICAL_ORIGIN), {
        authorDiscordUserId: session.discordUserId,
        source: "late_party",
      }).catch((err) => console.error(`Late party DM failed for ${discordUserId}:`, err));
    }
  });
  return { ok: true };
}

export async function endLatePartyAction() {
  const session = await requireDev("super");
  const closed = await prisma.$transaction((tx) => endLateParty(tx, { by: session.discordUserId }));
  if (closed === 0) return { error: "There is no late party to end." };
  await prisma.auditLog
    .create({
      data: { actorDiscordUserId: session.discordUserId, actionType: "late_party_end", details: {} },
    })
    .catch((err) => console.error("Late party audit log failed:", err));
  repaint();
  return { ok: true };
}
