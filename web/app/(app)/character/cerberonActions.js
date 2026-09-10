"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { grantTagSlugs } from "@lifeweb/db/lib/tagWrites";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import {
  WANTED_SLUG,
  CERBERON_SLUG,
  WARRANT_BADGE_SLUGS,
  warrantTargets,
  listWanted,
} from "@lifeweb/db/lib/wanted";

// The CERBERON section of the character panel: Arrest Warrant and Check
// Wanted. Same posture as thanatiActions.js — each one resolves the officer
// from the session, never from a posted id, and re-checks the tag the button's
// `show` already read, because a server action is a public endpoint and a
// hidden button is a hint, not a lock.

async function cerberon({ needsBadge = false } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  const allowed = needsBadge
    ? WARRANT_BADGE_SLUGS.some((slug) => slugs.has(slug))
    : slugs.has(CERBERON_SLUG);
  if (!allowed) throw new UserError("Not yours to press.");
  return { session, me, slugs };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// ---- Arrest Warrant --------------------------------------------------------
// A badge holder writes a name down and that man is Wanted.
//
// The name is TYPED rather than picked, the reasoning Engrave gives: a
// dropdown here would be a roster of everybody alive in Ravenheart, handed to
// anyone who opened the dialog. It is the whole name, too — first names repeat
// constantly, and a warrant sworn out against the wrong Jorren is not a thing
// the game should make easy. Either form counts, the full display name or the
// plain First Last, so an honorific the officer never learned is not a wall.
//
// A name TWO living men answer to warrants BOTH of them. This used to refuse
// and hand the job to a GM, which meant a Cerberon could not act at all on the
// two Alexander Ivanovs in the game — and the refusal was the wrong reading
// anyway: the law does not know which one it wants, so it wants both. The
// selection is warrantTargets() in db/lib/wanted.js, which is pure and tested.
//
// It costs NOTHING: no Move, no ⬢, no Routine filed. And it deliberately does
// NOT call postWantedPosters (db/lib/wantedPoster.js) — no paper goes up. The
// only way anyone finds out is by looking the man in the face, which is
// exactly what `visible: named` makes worth doing.
async function arrestWarrantRequestImpl({ name: rawName }) {
  const { session, me } = await cerberon({ needsBadge: true });

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // A composed name is not something Prisma can compare against, so the living
  // roster comes back and warrantTargets does the rest. It is a hundred rows
  // of four short columns; the query Engrave does is the same shape.
  const candidates = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      tags: { where: { tag: { slug: WANTED_SLUG } }, select: { id: true } },
    },
  });
  const { matched, targets, skippedSelf, alreadyWanted } = warrantTargets(candidates, typed, {
    selfId: me.id,
  });
  // Three refusals, and each has to say which of the three it is — "nobody by
  // that name" and "everybody who answers to it is already wanted" look
  // identical from the officer's side otherwise.
  if (matched === 0) throw new UserError("There's nobody with that name.");
  if (targets.length === 0) {
    // grantTagSlugs would no-op on a non-stackable tag already held, so this
    // is here to say so out loud rather than report a success that did
    // nothing.
    if (alreadyWanted > 0) throw new UserError("That person is already marked as wanted.");
    // Nothing left and nobody already wanted means the only match was the
    // officer themselves. A namesake would have survived the filter.
    if (skippedSelf > 0) throw new UserError("Swear it out on somebody else.");
    throw new UserError("There's nobody with that name.");
  }

  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    for (const target of targets) {
      await grantTagSlugs(tx, target.id, [WANTED_SLUG], openTurn?.number ?? null);
      // One row PER MAN, not one for the act. /gm/audit is read by target, so
      // a single row naming two people would leave the second man's sheet
      // with no record of why he is wanted.
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_arrest_warrant",
        targetCharacterId: target.id,
        turnId: openTurn?.id ?? null,
        details: {
          name: target.name,
          typed,
          by: me.name,
          // Only present when the name was ambiguous, so a GM reading the row
          // can see this man was caught by a namesake's warrant.
          ...(matched > 1 ? { answeringToThatName: matched } : {}),
        },
      });
    }
  });

  await afterInventoryChange(targets.map((t) => t.id));
  revalidate();
  const name = targets[0].name;
  return {
    ok: true,
    name,
    caught: targets.length,
    line:
      matched > 1
        ? `A warrant is out on ${name} — ${matched} men answer to that name.`
        : `A warrant is out on ${name}.`,
  };
}

// ---- Check Wanted ----------------------------------------------------------
// The warrant book, read as a notice under the officer's own cursor — the
// Recall Comrades shape exactly (thanatiActions.js). Costs nothing and spends
// no Move.
//
// It lists a hooded man the same as a bare-faced one, on purpose. This is a
// RECORD, not an act of looking: a name does not come off the book because
// somebody pulled a hood up. That is the whole point of the pairing — the book
// says Jorren Vask is wanted, the stranger in the Square reads as an unknown
// young man, and closing that gap is the game.
async function checkWantedImpl() {
  const { session, me } = await cerberon();
  const rows = await listWanted(prisma);
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_check_wanted",
    targetCharacterId: me.id,
    details: { wanted: rows.map((r) => r.name) },
  });
  revalidate();
  return {
    ok: true,
    // Names only. The role is a spoiler — see listWanted in db/lib/wanted.js.
    roster: rows.map((r) => ({ name: r.name })),
    line: rows.length ? "The warrant book." : "Nobody is wanted.",
  };
}

export async function arrestWarrantRequest(input) {
  return guarded(() => arrestWarrantRequestImpl(input ?? {}));
}
export async function checkWanted() {
  return guarded(() => checkWantedImpl());
}
