// Working a gate, on either face — shared so Chat and the bot's button handlers don't carry two
// copies of the rules about who may touch a portcullis. Redrawing the watchtower's starter row
// after a flip stays bot-side, since the caller is handed back `locationIds` and does its own
// redraw: that is the CALLER's side effect, and each face does it differently.
//
// Saying that a gate moved is not. Both sides of it hear the same sentence, so it is said here
// rather than twice — which is also why this file now posts, where it used to leave Discord
// alone entirely.
const { gateOperable, endpoints, isHeldOpen, KEYED_OPEN_MS } = require("./locationGraph");
const { publicRoomsIn } = require("./gateEcho");
const { roomLine, locationLine } = require("./placeLine");
const { SFX } = require("./sfx");
const { gateControlIn } = require("./placeAffordances");

// `character` needs { id, locationId }. Working a gate reads nothing else — the winch is in the
// watchtower, so the room they clicked in already answered who they are.
const GATE_CHARACTER_SELECT = {
  id: true,
  name: true,
  locationId: true,
};

// Every refusal is a sentence a player reads, so both faces say the same one.
async function toggleGate(prisma, { character, linkId, actorDiscordUserId }) {
  if (!character) return { ok: false, error: "You don't have a living character." };

  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  // Covers "not modular" — whatever a stale button claimed.
  if (!gateOperable(link)) return { ok: false, error: "There's no gate here." };
  if (character.locationId !== link.aId && character.locationId !== link.bId) {
    return { ok: false, error: "You aren't standing at that gate." };
  }

  const wantOpen = !link.isOpen;
  // The checks above read a snapshot; the flip must not trust it across time — a re-sync can turn
  // the edge into an ordinary way, and two watchmen can click in the same second. Lock, re-read, re-run.
  let outcome = "flipped";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LocationLink" WHERE "id" = ${link.id} FOR UPDATE`;
    const fresh = await tx.locationLink.findUnique({ where: { id: link.id } });
    if (!gateOperable(fresh)) {
      outcome = "gone";
      return;
    }
    if (fresh.isOpen !== link.isOpen) {
      outcome = "raced";
      return;
    }
    await tx.locationLink.update({ where: { id: link.id }, data: { isOpen: wantOpen } });
  });
  if (outcome === "gone") return { ok: false, error: "There's no gate here to work." };
  if (outcome === "raced") return { ok: false, error: "Somebody just beat you to it." };

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? null,
      actionType: wantOpen ? "gate_opened" : "gate_closed",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], isOpen: wantOpen },
    },
  });

  // A gate is a loud thing in a quiet barony, and until now only the person on the winch knew
  // it had moved. Everyone in earshot on either side hears it: the public rooms at both ends
  // and both Location channels. Best-effort and swallowed — the flip has already committed,
  // and a line nobody heard must never look like a gate that did not move.
  try {
    // "A gate" is right for a portcullis and wrong for the Den's basement
    // shutters, so a gate whose room named its control is announced by that
    // word instead (db/lib/placeAffordances.js#GATE_CONTROL_ROOMS).
    const control = await controlWordFor(prisma, [link.aId, link.bId]);
    const thing = control ? `The ${control.toLowerCase()}` : "A gate";
    const text = wantOpen ? `${thing} opens.` : `${thing} closes.`;
    const sfx = wantOpen ? SFX.GATE_OPEN : SFX.GATE_SHUT;
    // Sequential, not Promise.all: each of these posts to Discord, and a burst is how you
    // meet a rate limit (db/lib/soundBroadcast.js is sequential for the same reason).
    for (const room of await publicRoomsIn(prisma, [link.aId, link.bId])) {
      await roomLine(prisma, room, text, { sfx });
    }
    for (const location of [link.a, link.b]) {
      await locationLine(prisma, location, text, { sfx });
    }
  } catch (err) {
    console.error("Gate line failed:", err?.message ?? err);
  }

  const farName = endpoints(link, character.locationId).far.name;
  return {
    ok: true,
    opened: wantOpen,
    farName,
    // Both sides, for whichever face has an anchor to redraw.
    locationIds: [link.aId, link.bId],
    line: wantOpen ? `You open the way to ${farName}.` : `You shut the way to ${farName}.`,
  };
}

// The word the rooms at either end of this edge use for the thing that moves,
// or null for an ordinary gate. One query over both ends, because an edge is
// worked from exactly one room and it may be at either of them.
async function controlWordFor(prisma, locationIds) {
  const rooms = await prisma.room.findMany({
    where: { locationId: { in: locationIds } },
    select: { slug: true },
  });
  for (const room of rooms) {
    const control = gateControlIn(room.slug);
    if (control) return control;
  }
  return null;
}

// The answer to "leave it open for the next 24 hours?" — the DM's Yes/No, and Chat's Hold open button.
// Re-checked rather than trusted: a DM is durable and the key can change hands between the crossing
// and the answer, so whoever answers must still hold it. A conditional updateMany against the window
// they were shown means two people propping the same door in the same moment can't stack two windows.
async function holdKeyedOpen(prisma, { discordUserId, linkId, hold }) {
  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  if (!link?.keyed) return { ok: false, error: "There's no door here." };
  const between = `${link.a.name} and ${link.b.name}`;

  if (!hold) return { ok: true, held: false, line: `You closed the way between ${between}.` };

  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, tags: { select: { tag: { select: { slug: true } } } } },
  });
  const holdsKey = (character?.tags ?? []).some((ct) => ct.tag?.slug === link.requiredTagSlug);
  if (!holdsKey) return { ok: false, error: "You can no longer open that." };

  if (isHeldOpen(link)) {
    return { ok: false, error: `The way between ${between} is already being held open.` };
  }

  const openUntil = new Date(Date.now() + KEYED_OPEN_MS);
  const claim = await prisma.locationLink.updateMany({
    where: { id: link.id, OR: [{ openUntil: null }, { openUntil: { lte: new Date() } }] },
    data: { openUntil },
  });
  if (claim.count === 0) return { ok: false, error: "Somebody just beat you to it." };

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId ?? null,
      actionType: "keyed_way_held_open",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], openUntil: openUntil.toISOString() },
    },
  });

  return {
    ok: true,
    held: true,
    line: `You leave the way between ${between} open.`,
    note: "It stands open for 24 hours. Anyone can see and use it until then.",
  };
}

module.exports = { GATE_CHARACTER_SELECT, toggleGate, holdKeyedOpen };
