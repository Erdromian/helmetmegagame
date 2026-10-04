"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { cleanFriend, cleanJournal, roleSlugFor } from "@/lib/memoryEdits";

// The Dev Panel's Memories tab writes (docs/systemdocs/MEMORIES.md §8). A GM
// may change anything in a character's memories: their Friends, their PIN,
// the player's Notes and Highlights, and the lines of today they heard.
//
// Two rules hold for every verb:
//
//   - SILENT. Nothing tells the player. A GM planting or wiping a memory is an
//     in-fiction act, and a "your sheet was edited" DM would give it away.
//   - AUDITED. One AuditLog row each, in the same transaction as the write, so
//     the Record tab and /gm/audit show who changed what.
//
// Every write is scoped by the character id, or by the account resolved from
// that character's row — never by an account id the client posted.

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");
  return session;
}

async function loadTarget(characterId) {
  const character = characterId
    ? await prisma.character.findUnique({
        where: { id: characterId },
        select: { id: true, name: true, discordUserId: true },
      })
    : null;
  if (!character) throw new UserError("That character no longer exists.");
  return character;
}

// Notes and Highlights live on the account. A character with none (a Bascinet
// NPC made by hand) has nowhere to keep them.
function accountOf(character) {
  if (!character.discordUserId) throw new UserError("This character has no player account.");
  return character.discordUserId;
}

function auditRow(session, actionType, characterId, details) {
  return prisma.auditLog.create({
    data: { actorDiscordUserId: session.discordUserId, actionType, targetCharacterId: characterId, details },
  });
}

function repaint(characterId) {
  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/memories");
}

// One verb's shell: gate, load, write, repaint. A plain function, not an
// export: a "use server" file may export nothing but async actions.
function gmMemoryVerb(input, fn) {
  return guarded(async () => {
    const session = await requireGm();
    const character = await loadTarget(input?.characterId);
    await fn({ session, character, input: input ?? {} });
    repaint(character.id);
  });
}

// ---- Friends ----------------------------------------------------------------

// A linked entry (`subjectId`) is one the character RECOGNISES: from now on
// they see that person's name rather than "a young man" (STRANGERS.md). Filed
// as SEED, as if they had always known them; an unlinked one is MANUAL, the
// same as a player's own hand-made entry.
export async function gmCreateFriend(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const fields = cleanFriend(input);
    let subjectId = null;
    if (input.subjectId) {
      if (input.subjectId === character.id) throw new UserError("A character can't be their own friend.");
      const subject = await prisma.character.findUnique({ where: { id: input.subjectId }, select: { id: true } });
      if (!subject) throw new UserError("That character no longer exists.");
      const existing = await prisma.acquaintance.findFirst({
        where: { ownerId: character.id, subjectId: subject.id },
        select: { name: true },
      });
      if (existing) throw new UserError(`They already remember them, as "${existing.name}". Edit that entry instead.`);
      subjectId = subject.id;
    }
    const data = {
      ownerId: character.id,
      subjectId,
      source: subjectId ? "SEED" : "MANUAL",
      ...fields,
      roleSlug: await roleSlugFor(fields.roleText),
    };
    await prisma.$transaction(async (tx) => {
      const row = await tx.acquaintance.create({ data, select: { id: true } });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "gm_memory_friend_added",
          targetCharacterId: character.id,
          details: { acquaintanceId: row.id, subjectId, ...fields },
        },
      });
    });
  });
}

export async function gmUpdateFriend(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const entry = await prisma.acquaintance.findFirst({
      where: { id: input.id ?? "", ownerId: character.id },
      select: { id: true, name: true, roleText: true, notes: true, roleSlug: true },
    });
    if (!entry) throw new UserError("That memory is gone.");
    const fields = cleanFriend(input);
    const roleSlug = fields.roleText === entry.roleText ? entry.roleSlug : await roleSlugFor(fields.roleText);
    await prisma.$transaction([
      prisma.acquaintance.update({ where: { id: entry.id }, data: { ...fields, roleSlug } }),
      auditRow(session, "gm_memory_friend_edited", character.id, {
        acquaintanceId: entry.id,
        from: { name: entry.name, roleText: entry.roleText, notes: entry.notes },
        to: fields,
      }),
    ]);
  });
}

export async function gmDeleteFriend(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const entry = await prisma.acquaintance.findFirst({
      where: { id: input.id ?? "", ownerId: character.id },
      select: { id: true, name: true, roleText: true, subjectId: true },
    });
    if (!entry) throw new UserError("That memory is gone.");
    await prisma.$transaction([
      prisma.acquaintance.delete({ where: { id: entry.id } }),
      auditRow(session, "gm_memory_friend_forgotten", character.id, entry),
    ]);
  });
}

// ---- Who am I? ----------------------------------------------------------------

// The infoterminal PIN (RINGS.md §5). Four digits, nothing else.
export async function gmSetPin(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const pin = String(input.pin ?? "").trim();
    if (!/^\d{4}$/.test(pin)) throw new UserError("A PIN is exactly 4 digits.");
    const before = await prisma.character.findUnique({ where: { id: character.id }, select: { pin: true } });
    if (before?.pin === pin) return;
    await prisma.$transaction([
      prisma.character.update({ where: { id: character.id }, data: { pin } }),
      auditRow(session, "gm_memory_pin_set", character.id, { from: before?.pin ?? null, to: pin }),
    ]);
  });
}

// ---- Notes (the Journal) ----------------------------------------------------

// `forCharacter` files the note on THIS character (JournalEntry.characterId,
// the way the bomb's note is, NUKE.md §4): it never follows the player to
// their next one. Without it the note is the account's, like one the player
// wrote themselves.
export async function gmCreateNote(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const discordUserId = accountOf(character);
    const fields = cleanJournal(input);
    await prisma.$transaction(async (tx) => {
      const row = await tx.journalEntry.create({
        data: { discordUserId, ...fields, characterId: input.forCharacter ? character.id : null },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "gm_memory_note_added",
          targetCharacterId: character.id,
          details: { journalEntryId: row.id, forCharacter: Boolean(input.forCharacter), title: fields.title },
        },
      });
    });
  });
}

// The notes this tab may touch: the account's own, and the ones filed on this
// character. A note the game wrote into one of the player's OTHER characters
// is not this character's memory.
function noteScope(character, id) {
  return { id: id ?? "", discordUserId: accountOf(character), OR: [{ characterId: null }, { characterId: character.id }] };
}

export async function gmUpdateNote(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const entry = await prisma.journalEntry.findFirst({ where: noteScope(character, input.id), select: { id: true, title: true, body: true } });
    if (!entry) throw new UserError("That entry is gone.");
    const fields = cleanJournal(input);
    await prisma.$transaction([
      prisma.journalEntry.update({ where: { id: entry.id }, data: fields }),
      auditRow(session, "gm_memory_note_edited", character.id, {
        journalEntryId: entry.id,
        from: { title: entry.title, body: entry.body },
        to: { title: fields.title, body: fields.body },
      }),
    ]);
  });
}

export async function gmPinNote(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const entry = await prisma.journalEntry.findFirst({ where: noteScope(character, input.id), select: { id: true } });
    if (!entry) throw new UserError("That entry is gone.");
    const pinned = Boolean(input.pinned);
    await prisma.$transaction([
      prisma.journalEntry.update({ where: { id: entry.id }, data: { pinned } }),
      auditRow(session, "gm_memory_note_pinned", character.id, { journalEntryId: entry.id, pinned }),
    ]);
  });
}

export async function gmDeleteNote(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const entry = await prisma.journalEntry.findFirst({ where: noteScope(character, input.id), select: { id: true, title: true, body: true } });
    if (!entry) throw new UserError("That entry is gone.");
    await prisma.$transaction([
      prisma.journalEntry.delete({ where: { id: entry.id } }),
      auditRow(session, "gm_memory_note_deleted", character.id, { journalEntryId: entry.id, title: entry.title, body: entry.body }),
    ]);
  });
}

// ---- Highlights ---------------------------------------------------------------

const HIGHLIGHT_MAX = 4000;

export async function gmUpdateHighlight(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const note = await prisma.note.findFirst({
      where: { id: input.id ?? "", discordUserId: accountOf(character) },
      select: { id: true, content: true },
    });
    if (!note) throw new UserError("That highlight is gone.");
    const content = String(input.content ?? "").trim().slice(0, HIGHLIGHT_MAX);
    if (!content) throw new UserError("A highlight needs some text. Remove it instead.");
    await prisma.$transaction([
      prisma.note.update({ where: { id: note.id }, data: { content } }),
      auditRow(session, "gm_memory_highlight_edited", character.id, { noteId: note.id, from: note.content, to: content }),
    ]);
  });
}

export async function gmDeleteHighlight(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    const note = await prisma.note.findFirst({
      where: { id: input.id ?? "", discordUserId: accountOf(character) },
      select: { id: true, characterName: true, content: true },
    });
    if (!note) throw new UserError("That highlight is gone.");
    await prisma.$transaction([
      prisma.note.delete({ where: { id: note.id } }),
      auditRow(session, "gm_memory_highlight_removed", character.id, {
        noteId: note.id,
        characterName: note.characterName,
        content: note.content,
      }),
    ]);
  });
}

// ---- Memories of the day ----------------------------------------------------

// Takes one line out of what this character heard today. The line itself stays
// in the archive and in the room: everybody else who was there still heard it.
export async function gmForgetLine(input) {
  return gmMemoryVerb(input, async ({ session, character, input }) => {
    let seq;
    try {
      seq = BigInt(input.seq);
    } catch {
      throw new UserError("That line is gone.");
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.heardLine.deleteMany({ where: { characterId: character.id, seq } });
      if (count === 0) throw new UserError("That line is gone.");
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "gm_memory_line_forgotten",
          targetCharacterId: character.id,
          details: { seq: String(seq) },
        },
      });
    });
  });
}
