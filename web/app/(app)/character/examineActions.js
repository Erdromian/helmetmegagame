"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { lastSightings } from "@lifeweb/db/lib/sightings";
import { examineRow } from "@lifeweb/db/lib/examineRow";
import { examineBlock } from "@lifeweb/db/lib/examineVision";

// Examine — looking at somebody you have HEARD. It moves nothing, costs
// nothing, spends no Move and can be done as often as you like, because
// reading a room is not an act, so it writes no audit row at all.
//
// This used to reach anybody standing where you stand, silent or not, on the
// argument that a guard on a gate should be able to size up a traveller
// without striking up a conversation first. That went the other way in the
// end: a silent stranger is a stranger, and standing in the same room as
// somebody should not hand you a reading of them. So it is now the same rule
// 🔍 has always had — the subject must have said something you heard, this
// turn (db/lib/sightings.js) — and what you get is what you heard, frozen at
// that line rather than re-read live. /conceal is unchanged and still gives
// the hood's impoverished read.
//
// The readout itself is db/lib/examine.js, shared with the reaction handler so
// the two surfaces cannot drift on the doctor's eye or what "visible" means.

// The looker, from the session and never from a posted id — a server action is
// a public endpoint.
async function looker() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // `equipped` and the Location's roof are here for examineVision.js: a
      // pair of spectacles only corrects your sight while you are wearing it,
      // and Sun Sensitivity only blinds you outdoors.
      tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
      location: { select: { indoors: true } },
    },
  });
  if (!me) throw new UserError("No living character.");
  return me;
}

// The vision gate, asked before either action below does any work. The greyed
// button on the sheet is a hint; this is the lock (see the metagaming note in
// web/app/components/actionRegistry.js).
async function blockedFromLooking(me) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { phase: true } });
  return examineBlock(me.tags, { phase: openTurn?.phase ?? null, indoors: me.location?.indoors ?? true });
}

// Who you can look at: everyone you have heard speak this turn, INCLUDING the
// concealed.
//
// This is the one people-picker on the sheet that is not a roster of who is
// standing here (db/lib/presence.js), and the divergence is deliberate twice
// over. Every other action acts ON someone, which means identifying them, so a
// hood takes you off the list — but looking at a hooded figure is the whole
// point of a hood, so a hood stays on this one, under its alias.
//
// And it is a list of who you have NOTICED rather than who is nearby, which is
// what stops the dialog being a presence oracle: opening it in a crowded room
// no longer enumerates the room.
//
// Fetched when the dialog opens rather than baked into the page render, so the
// list is current and the sheet never carries one of who is around you.
export async function peopleToExamine() {
  return guarded(async () => {
    const me = await looker();
    if (!me.locationId) return { people: [] };

    // Refused here as well as in examineCharacter(), so a blinded player never
    // gets a roster of who is standing around them as a consolation prize.
    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    // Everyone you have heard speak this turn, wherever you heard them —
    // which is not the same set as everyone standing here, and deliberately
    // so. The label and the hood flag come off the LINE, so somebody who
    // spoke bare-faced and has since pulled a mask on still lists under their
    // own name, and somebody who has been standing silently in a corner does
    // not list at all.
    const seen = await lastSightings(prisma, me);

    return {
      people: [...seen.entries()]
        .map(([id, sighting]) => ({ id, label: sighting.name, concealed: sighting.concealed }))
        .sort((a, b) => Number(a.concealed) - Number(b.concealed) || (a.label ?? "").localeCompare(b.label ?? "")),
    };
  });
}

// One look, at the line you heard them say. The seq is resolved server-side
// into a speaker, a hood and a readout (db/lib/examineRow.js), which is the
// same path 🔍 takes in Discord and both eyes take on /play — there is one
// implementation of these rules now, not three.
//
// The subject is re-resolved from the sighting rather than trusted from the
// dialog, so a posted id that names somebody you have never heard gets the
// same refusal as one that names nobody at all.
export async function examineCharacter(targetId) {
  return guarded(async () => {
    const me = await looker();

    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    const seen = await lastSightings(prisma, me);
    const sighting = seen.get(String(targetId ?? ""));
    if (!sighting) throw new UserError("You haven't heard them say anything. ‡");

    // looker() already selects exactly what examineRow wants — the two lists
    // are the same list, and VIEWER_SELECT is where it is written down.
    const result = await examineRow(prisma, me, sighting.seq);
    if (!result) throw new UserError("You can't see them.");
    if (result.blocked) throw new UserError(result.blocked);
    return { readout: result.readout };
  });
}
