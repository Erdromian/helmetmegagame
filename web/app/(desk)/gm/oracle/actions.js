"use server";

// The Oracle desk's one write. See docs/systemdocs/ORACLE.md.
//
// Reading is done by the page as a server component; the only thing a GM does
// to a page here is rewrite it, and that is the whole correction mechanism —
// there is no regenerate, so an edit has to stick.

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";

const MAX_BODY = 20_000;

// Every GM, not just a superadmin: the desk is a GM surface, and the settings
// behind it are the superadmin part. The layout gate already ran, but a server
// action is a public endpoint and re-checks for itself.
async function requireGm() {
  const session = await auth();
  if (!session?.discordUserId) throw new Error("Not authorized.");
  const { isGm } = await getGmSession();
  if (!isGm) throw new Error("Not authorized.");
  return session;
}

export async function saveSynopsis({ id, body }) {
  const session = await requireGm();

  const text = String(body ?? "").trim().slice(0, MAX_BODY);
  if (!text) return { ok: false, error: "A page cannot be empty." };

  // editedAt is what stops a later run replacing this text, and what tells the
  // desk to draw the page as a person's rather than a draft. Stamped here and
  // never cleared: a page somebody took the trouble to fix stays fixed.
  const row = await prisma.oracleSynopsis.update({
    where: { id: String(id) },
    data: {
      body: text,
      editedAt: new Date(),
      editedByDiscordUserId: session.discordUserId,
    },
    select: { id: true, body: true, editedAt: true },
  });

  revalidatePath("/gm/oracle");
  return { ok: true, row: { ...row, editedAt: row.editedAt?.toISOString() ?? null } };
}
