"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import {
  MAX_NAMES,
  MESSAGE_LIMIT,
  cleanMessage,
  cleanNames,
  releaseHeldBy,
  identityOf,
  seenAs,
  IDENTITY_SELECT,
} from "@lifeweb/db/lib/intercept";

// LAYING IN WAIT, from the character sheet (docs/systemdocs/INTERCEPT.md).
// Same posture as cerberonActions.js: the actor is resolved from the session
// and never from a posted id, every refusal is a UserError through guarded()
// (a production build redacts anything thrown out of a server action), and the
// dialog's own filtering is advisory — a server action is a public endpoint.
//
// Nothing here costs a Move, ⬢ or a per-turn ration. Setting a watch is free
// and open to everyone: it is a fact about nobody until somebody walks in.

async function me({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { ...IDENTITY_SELECT, heldUntil: true },
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    // A bound man whose ambush silently never fires files a support ticket; a
    // bound man told why does not. fireWatches checks this again at the moment
    // it would fire, which is the check that actually counts.
    if (blocker) throw new UserError(`You can't lay in wait — you're ${blocker.name}. ‡`);
  }
  return { session, character };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// Everyone this character is holding right now, as the sheet draws them —
// by the face the room sees, never by their true name.
async function holdingRows(characterId) {
  const rows = await prisma.character.findMany({
    where: { heldById: characterId, heldUntil: { gt: new Date() } },
    select: IDENTITY_SELECT,
  });
  return rows.map((row) => ({ id: row.id, name: seenAs(identityOf(row)) }));
}

async function loadInterceptImpl() {
  const { character } = await me();
  const watch = await prisma.interceptWatch.findUnique({ where: { characterId: character.id } });
  return {
    ok: true,
    limits: { names: MAX_NAMES, message: MESSAGE_LIMIT },
    watch: watch
      ? {
          mode: watch.mode,
          message: watch.message ?? "",
          names: watch.targetNames ?? [],
          anyConcealed: watch.anyConcealed,
          anyPerson: watch.anyPerson,
        }
      : null,
    holding: await holdingRows(character.id),
  };
}

async function setInterceptImpl({ mode, message, names, anyConcealed, anyPerson }) {
  const { session, character } = await me({ needs: ACT });

  const wantAmbush = mode === "AMBUSH";
  const anyone = Boolean(anyPerson);
  // "Any person" subsumes "any concealed person", so it is stored as the only
  // one — the dialog greys the other out, and this is what makes that true
  // rather than merely drawn.
  const concealed = anyone ? false : Boolean(anyConcealed);
  const targetNames = anyone ? [] : cleanNames(names);
  const clean = cleanMessage(message);

  if (!anyone && !concealed && targetNames.length === 0) {
    throw new UserError("Name somebody to watch for, or watch for anyone. ‡");
  }

  const data = {
    mode: wantAmbush ? "AMBUSH" : "SAFE",
    message: clean,
    targetNames,
    anyConcealed: concealed,
    anyPerson: anyone,
  };

  await prisma.$transaction(async (tx) => {
    await tx.interceptWatch.upsert({
      where: { characterId: character.id },
      create: { characterId: character.id, ...data },
      update: data,
    });
    // Written from the APPLIED values, never from what the client sent
    // (REQUESTS.md §2). One row per save, because the row is the only record
    // of what the watch said at the time — the watch itself is overwritten.
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_intercept_set",
      targetCharacterId: character.id,
      turnId: (await getOpenTurn())?.id ?? null,
      details: { ...data },
    });
  });

  revalidate();
  return {
    ok: true,
    line: wantAmbush ? "You lie in wait, ready to spring. ‡" : "You lie in wait. ‡",
  };
}

async function stopInterceptImpl() {
  const { session, character } = await me();
  const gone = await prisma.interceptWatch.deleteMany({ where: { characterId: character.id } });
  if (gone.count === 0) return { ok: true, line: "You weren't watching for anybody. ‡" };
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_intercept_set",
    targetCharacterId: character.id,
    turnId: (await getOpenTurn())?.id ?? null,
    details: { stopped: true },
  });
  revalidate();
  return { ok: true, line: "You stop watching the road. ‡" };
}

// Letting somebody go early. releaseHeldBy's WHERE is the ownership check —
// only the person holding them can end it — so there is no separate lookup
// here to disagree with it. The DM twin of this button answers through
// db/lib/dmAnswer.js, so the two faces cannot drift.
async function releaseHeldImpl({ targetCharacterId }) {
  const { session, character } = await me();
  const freed = await releaseHeldBy(prisma, character.id, { targetId: targetCharacterId });
  if (freed.length === 0) throw new UserError("They're already free. ‡");
  const target = freed[0];

  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_intercept_released",
    targetCharacterId: target.id,
    turnId: (await getOpenTurn())?.id ?? null,
    details: { name: target.name },
  });

  // Post-commit, and unattributed — they know perfectly well who had hold of
  // them, and the game does not need to confirm it (REQUESTS.md §3).
  if (target.discordUserId && target.status === "ALIVE") {
    after(() =>
      sendDm(target.discordUserId, "You've been let go. You can move again. ‡").catch(() => {}),
    );
  }
  revalidate();
  return { ok: true, line: `You let ${target.name} go. ‡` };
}

export async function loadIntercept() {
  return guarded(() => loadInterceptImpl());
}
export async function setIntercept(input) {
  return guarded(() => setInterceptImpl(input ?? {}));
}
export async function stopIntercept() {
  return guarded(() => stopInterceptImpl());
}
export async function releaseHeld(input) {
  return guarded(() => releaseHeldImpl(input ?? {}));
}
