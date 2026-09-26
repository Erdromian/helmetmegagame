"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { CONCEALMENT_TAG_FIELDS } from "@lifeweb/db/lib/presentedIdentity";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { acting, UserError } from "@/lib/actionResult";
import { auth } from "@/lib/auth";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { isDaylight } from "@lifeweb/db/lib/turnClock";
import { SFX } from "@lifeweb/db/lib/sfx";
import { writePaper as writePaperVerb, sealLetter as sealLetterVerb, readHeldPaper } from "@lifeweb/db/lib/verbs/paper";

// Writing and sealing. See docs/systemdocs/PAPERWORK.md. NEITHER FILES A REQUEST (same call equipActions.js makes): writing costs nothing, spends no Move, and a Request per sentence would drown /gm/turns and /gm/audit at 100+ players — a GM just reads the tag's text, which every GM surface already renders.
// Breaking a seal IS a Request (destroys something, must be undoable) and lives in requestActions.js with the rest of Consume.

// `needs` (db/lib/incapacitation.js): the four writing actions pass ACT — a pen needs a hand. readMyPaper does not: reading isn't acting, and whether the eyes work is db/lib/reading.js's question.
async function requireWriter({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never a posted id: a server action is a public endpoint, and an id on the wire would let anyone write on anyone's sheet.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      updatedAt: true,
      location: { select: { indoors: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          equipped: true,
          tag: {
            select: {
              id: true,
              slug: true,
              name: true,
              paperKind: true,
              paperText: true,
              paperAuthor: true,
              sealMark: true,
              forcedName: true,
              ...CONCEALMENT_TAG_FIELDS,
            },
          },
        },
      },
    },
  });
  if (!character) redirect("/character");

  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
  }

  return {
    session,
    character,
    where: { daylight: isDaylight(), indoors: character.location?.indoors ?? true },
  };
}

function revalidateAll() {
  revalidatePath("/character");
}

// The rules are db/lib/verbs/paper.js's, shared with Discord's /paper write|seal|read.
async function writePaperImpl({ tagId, text, title }) {
  const { character } = await requireWriter({ needs: ACT });
  const result = await writePaperVerb(prisma, { character, tagId, text, title });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  // The scratch of a pen finishing a page (sfx.js).
  return { name: result.name, tagId: result.tagId, sfx: SFX.WRITE };
}

async function sealLetterImpl({ tagId, stampTagId, title }) {
  const { character } = await requireWriter({ needs: ACT });
  const result = await sealLetterVerb(prisma, { character, tagId, stampTagId, title });
  if (!result.ok) throw new UserError(result.error);
  await afterInventoryChange(result.touched);
  revalidateAll();
  return { name: result.name, sfx: SFX.WRITE };
}

// --- public surface ---------------------------------------------------

export async function writePaper(input) {
  return acting(() => writePaperImpl(input));
}

export async function sealLetter(input) {
  return acting(() => sealLetterImpl(input));
}

// The text of a paper the caller can read, for the Write dialog's box. Composed through paperDescription so a reader who's since gone blind or left their spectacles gets the same refusal here as everywhere.
export async function readMyPaper(rawTagId) {
  const { character } = await requireWriter();
  const result = await readHeldPaper(prisma, { character, tagId: rawTagId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, text: result.text, paper: result.paper, kind: result.kind };
}
