"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { scrambleEntry } from "@lifeweb/db/lib/memoryScramble";
import { auth } from "@/lib/auth";
import { UserError, guarded } from "@/lib/actionResult";
import { loadMemoryViewer } from "@/lib/memories";

// The Friends section's three verbs (docs/systemdocs/MEMORIES.md §2c). Every
// entry is the owner's to rewrite however they like, true or not — the game
// never checks what a player writes here against the truth, and a look reads
// back exactly what they wrote. What IS enforced: the owner comes from the
// session's living character, never a posted id, and an entry the player
// currently sees as nonsense cannot be saved over.

const NAME_MAX = 80;
const ROLE_MAX = 60;
const NOTES_MAX = 2000;

async function requireOwner() {
  const session = await auth();
  if (!session?.discordUserId) throw new UserError("You need to be signed in.");
  const viewer = await loadMemoryViewer(session.discordUserId);
  if (!viewer.character) throw new UserError("You need a living character to remember anybody.");
  return viewer;
}

// A typed role that is exactly a seat's name files the entry under that seat's
// estate on the page. Anything else is still kept, word for word, and files
// under "Unknown".
async function roleSlugFor(roleText) {
  if (!roleText) return null;
  const role = await prisma.role.findFirst({
    where: { name: { equals: roleText, mode: "insensitive" } },
    select: { slug: true },
  });
  return role?.slug ?? null;
}

function clean({ name, roleText, notes }) {
  const cleanName = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  if (!cleanName) throw new UserError("Give them a name, even a made-up one.");
  return {
    name: cleanName,
    roleText: String(roleText ?? "").trim().replace(/\s+/g, " ").slice(0, ROLE_MAX) || null,
    notes: String(notes ?? "").trim().slice(0, NOTES_MAX),
  };
}

export async function createFriend(input) {
  return guarded(async () => {
    const { character } = await requireOwner();
    const fields = clean(input ?? {});
    // Never linked to a character: a hand-made entry is a name the player
    // wrote down, not a claim the game checks (schema.prisma, Acquaintance).
    await prisma.acquaintance.create({
      data: { ownerId: character.id, subjectId: null, source: "MANUAL", ...fields, roleSlug: await roleSlugFor(fields.roleText) },
    });
    revalidatePath("/memories");
  });
}

export async function updateFriend(id, input) {
  return guarded(async () => {
    const { character, state } = await requireOwner();
    const entry = await prisma.acquaintance.findFirst({
      where: { id: id ?? "", ownerId: character.id },
      select: { id: true, name: true, roleText: true, notes: true, roleSlug: true },
    });
    if (!entry) throw new UserError("That memory is gone.");
    if (scrambleEntry(state, entry).anyScrambled) throw new UserError("You can't make sense of that memory right now.");
    const fields = clean(input ?? {});
    // Keep the slug the game filled in while the role still says the same
    // thing; look it up again the moment the player types something else.
    const roleSlug = fields.roleText === entry.roleText ? entry.roleSlug : await roleSlugFor(fields.roleText);
    await prisma.acquaintance.update({ where: { id: entry.id }, data: { ...fields, roleSlug } });
    revalidatePath("/memories");
  });
}

export async function deleteFriend(id) {
  return guarded(async () => {
    const { character } = await requireOwner();
    // `?? ""`: Prisma drops an undefined field from a where clause, and an
    // omitted id would otherwise forget everybody at once.
    await prisma.acquaintance.deleteMany({ where: { id: id ?? "", ownerId: character.id } });
    revalidatePath("/memories");
  });
}
