"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { acting, guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import {
  NOT_A_FIGHT,
  MAX_NAMES,
  MESSAGE_LIMIT,
  releaseHeldBy,
  anchorHolds,
  seenByMany,
  seenById,
  IDENTITY_SELECT,
} from "@lifeweb/db/lib/intercept";
import { setWatch, stopWatch } from "@lifeweb/db/lib/verbs/watch";

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
    if (blocker) throw new UserError(`You can't lay in wait — you're ${blocker.name}.`);
  }
  return { session, character };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// Everyone this character is holding right now, as the sheet draws them —
// by the face the room sees, never by their true name.
//
// Safe stops and caught pickpockets (THEFT.md §2g: a thief you felt at your
// pocket is held BY YOU for five minutes, and this is their Release button).
// Never a fight. Somebody you are holding because you attacked them is
// broken off from the Attack dialog, not let go from here: releaseHeldBy
// refuses an attack hold outright (docs/systemdocs/ATTACK.md §4), so listing
// one would draw a Let-them-go button whose only possible answer is "They're
// already free."
async function holdingRows(characterId) {
  const rows = await prisma.character.findMany({
    where: { heldById: characterId, heldUntil: { gt: new Date() }, ...NOT_A_FIGHT },
    select: IDENTITY_SELECT,
  });
  // Named as the holder would name them: a stranger is "a young man" (STRANGERS.md).
  const names = await seenByMany(prisma, characterId, rows);
  return rows.map((row, i) => ({ id: row.id, name: names[i] }));
}

async function loadInterceptImpl() {
  const { character } = await me();
  const watch = await prisma.interceptWatch.findUnique({
    where: { characterId: character.id },
    include: { location: { select: { name: true } } },
  });
  // A watch reads as no watch anywhere but where it was set. Moving deletes
  // the row (db/lib/locationMove.js), so this only catches one left behind by
  // a relocation that never ran the cancel — but the dialog must never draw a
  // watch that could not fire.
  const live = watch && anchorHolds(watch, character.locationId) ? watch : null;
  return {
    ok: true,
    limits: { names: MAX_NAMES, message: MESSAGE_LIMIT },
    watch: live
      ? {
          mode: live.mode,
          message: live.message ?? "",
          names: live.targetNames ?? [],
          anyConcealed: live.anyConcealed,
          anyPerson: live.anyPerson,
          outsideZoneOnly: live.outsideZoneOnly,
          autoSearch: live.autoSearch,
          place: live.location?.name ?? null,
        }
      : null,
    holding: await holdingRows(character.id),
  };
}

// The rule is db/lib/verbs/watch.js#setWatch, shared with Discord's /intercept set.
async function setInterceptImpl({
  mode,
  message,
  names,
  anyConcealed,
  anyPerson,
  outsideZoneOnly,
  autoSearch,
}) {
  const { session, character } = await me({ needs: ACT });
  const result = await setWatch(prisma, {
    character,
    discordUserId: session.discordUserId,
    input: { mode, message, names, anyConcealed, anyPerson, outsideZoneOnly, autoSearch },
    openTurn: await getOpenTurn(),
  });
  if (!result.ok) throw new UserError(result.error);
  revalidate();
  return { ok: true, line: result.line };
}

// The rule is db/lib/verbs/watch.js#stopWatch, shared with Discord's /intercept stop.
async function stopInterceptImpl() {
  const { session, character } = await me();
  const result = await stopWatch(prisma, {
    character,
    discordUserId: session.discordUserId,
    openTurn: await getOpenTurn(),
  });
  if (result.stopped) revalidate();
  return { ok: true, line: result.line };
}

// Letting somebody go early. releaseHeldBy's WHERE is the ownership check —
// only the person holding them can end it — so there is no separate lookup
// here to disagree with it. The DM twin of this button answers through
// db/lib/dmAnswer.js, so the two faces cannot drift.
async function releaseHeldImpl({ targetCharacterId }) {
  const { session, character } = await me();
  const freed = await releaseHeldBy(prisma, character.id, { targetId: targetCharacterId });
  if (freed.length === 0) throw new UserError("They're already free.");
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
      sendDm(target.discordUserId, "You've been let go. You can move again.").catch(() => {}),
    );
  }
  revalidate();
  return { ok: true, line: `You let ${await seenById(prisma, character.id, target.id)} go.` };
}

export async function loadIntercept() {
  return guarded(() => loadInterceptImpl());
}
export async function setIntercept(input) {
  return acting(() => setInterceptImpl(input ?? {}));
}
export async function stopIntercept() {
  return acting(() => stopInterceptImpl());
}
export async function releaseHeld(input) {
  return acting(() => releaseHeldImpl(input ?? {}));
}
