"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { UserError, guarded } from "@/lib/actionResult";
import { loadMemoryViewer, scrambleJournal } from "@/lib/memories";
import { cleanJournal as cleanFields } from "@/lib/memoryEdits";

// CRUD for a player's private Journal (the Notes section of /memories). Every verb below
// re-resolves discordUserId from the session and scopes its write by it —
// never trusts an id posted from the client — because a server action is a
// public endpoint (the same discipline memories/actions.js#unstarNote already
// documents for Note).

async function requireSession() {
  const session = await auth();
  if (!session?.discordUserId) throw new UserError("You need to be signed in.");
  return session;
}

async function createEntryImpl(input) {
  const session = await requireSession();
  const fields = cleanFields(input);
  await prisma.journalEntry.create({ data: { discordUserId: session.discordUserId, ...fields } });
  revalidatePath("/memories");
}
export async function createEntry(input) {
  return guarded(() => createEntryImpl(input));
}

async function updateEntryImpl(id, input) {
  const session = await requireSession();
  const fields = cleanFields(input);
  // A Concussed player sees this entry as nonsense (db/lib/memoryScramble.js),
  // and saving over it would write the nonsense in. The Edit button is hidden
  // for it; this is the lock.
  // The guard asks about the entry's real words, which roll one by one.
  const { state } = await loadMemoryViewer(session.discordUserId);
  const entry = await prisma.journalEntry.findFirst({
    where: { id: id ?? "", discordUserId: session.discordUserId },
    select: { id: true, title: true, body: true },
  });
  if (!entry) throw new UserError("That entry is gone.");
  if (scrambleJournal(state, entry).scrambled) throw new UserError("You can't make sense of that entry right now.");
  // `?? ""` is not cosmetic: Prisma strips an `undefined` field from a where
  // clause entirely, so an omitted id would turn this into "update every
  // entry this user has" — same trap memories/actions.js#unstarNote guards
  // against for Note.
  const { count } = await prisma.journalEntry.updateMany({
    where: { id: id ?? "", discordUserId: session.discordUserId },
    data: fields,
  });
  if (count === 0) throw new UserError("That entry is gone.");
  revalidatePath("/memories");
}
export async function updateEntry(id, input) {
  return guarded(() => updateEntryImpl(id, input));
}

async function deleteEntryImpl(id) {
  const session = await requireSession();
  await prisma.journalEntry.deleteMany({ where: { id: id ?? "", discordUserId: session.discordUserId } });
  revalidatePath("/memories");
}
export async function deleteEntry(id) {
  return guarded(() => deleteEntryImpl(id));
}

async function togglePinImpl(id, pinned) {
  const session = await requireSession();
  const { count } = await prisma.journalEntry.updateMany({
    where: { id: id ?? "", discordUserId: session.discordUserId },
    data: { pinned: Boolean(pinned) },
  });
  if (count === 0) throw new UserError("That entry is gone.");
  revalidatePath("/memories");
}
export async function togglePin(id, pinned) {
  return guarded(() => togglePinImpl(id, pinned));
}
