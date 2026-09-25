"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { UserError, guarded } from "@/lib/actionResult";
import { loadMemoryViewer, lineKey } from "@/lib/memories";
import { STAR_ROW_SELECT, saveStarredRow } from "@/lib/starNote";
import { scrambleFields } from "@lifeweb/db/lib/memoryScramble";

// ★ on a line in "Memories of the day" — a Highlight, the same Note a ★ in
// /chat makes (web/lib/starNote.js). The gate is different, and has to be:
// /chat asks whether you can read the place NOW, and the whole point of a
// memory is that you have walked away since. So the question here is whether
// this line is in YOUR day — a HeardLine for your own living character, today.
export async function starMemory(seq) {
  return guarded(async () => {
    const session = await auth();
    if (!session?.discordUserId) throw new UserError("You need to be signed in.");
    const { character, state, dayNumber } = await loadMemoryViewer(session.discordUserId);
    if (!character || dayNumber == null) throw new UserError("That line is gone.");

    let key;
    try {
      key = BigInt(seq);
    } catch {
      throw new UserError("That line is gone.");
    }
    const heard = await prisma.heardLine.findUnique({
      where: { characterId_seq: { characterId: character.id, seq: key } },
      select: { dayNumber: true },
    });
    if (!heard || heard.dayNumber !== dayNumber) throw new UserError("That line is gone.");
    // A line you cannot make sense of is not one you can keep: the Highlight
    // would hold the real words behind the nonsense.
    if (scrambleFields(state, lineKey(key), { content: "x" }).scrambled) {
      throw new UserError("You can't make sense of that line right now.");
    }

    const row = await prisma.archiveEntry.findUnique({ where: { seq: key }, select: STAR_ROW_SELECT });
    if (!row || row.deletedAt || !row.content) throw new UserError("That line is gone.");

    await saveStarredRow(row, session.discordUserId);
    revalidatePath("/memories");
    return { line: "Saved to your Highlights." };
  });
}
