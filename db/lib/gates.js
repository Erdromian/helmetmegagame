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
const { withRingTokens, roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { RING_ACCESS_TAG_FIELDS, wornRingAccess } = require("./rings");
const { anchorGateFor, remoteLeverFor, controlThing } = require("./gateControls");
const { GATEHOUSE_TEXT } = require("./gatehouseText");
const { recordArchiveEvent } = require("./archive");

// `character` needs { id, locationId }, and its tags with the ring's columns: a watchtower's winch
// asks nothing of the person pulling it (the room they clicked in already answered who they are),
// but the portcullis moves only for a ring carrying its token (db/lib/gateControls.js).
const GATE_CHARACTER_SELECT = {
  id: true,
  name: true,
  locationId: true,
  tags: { select: { equipped: true, tag: { select: RING_ACCESS_TAG_FIELDS } } },
};

// Every refusal is a sentence a player reads, so both faces say the same one.
async function toggleGate(prisma, { character, linkId, actorDiscordUserId }) {
  if (!character) return { ok: false, error: "You don't have a living character." };

  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  // Covers "not modular" — whatever a stale button claimed.
  if (!gateOperable(link)) return { ok: false, error: "There's no gate here." };

  // Three shapes of gate (db/lib/gateControls.js). A remote lever is pulled from its own room,
  // which stands at neither end, by anybody who can get in. An anchor gate is worked from either
  // end, but only by a worn ring carrying its token — anybody else is told nothing happens. The
  // rest are a watchtower's winch at one end, as before.
  const lever = remoteLeverFor(link);
  const anchor = anchorGateFor(link);
  let leverLocationId = null;
  let leverRoomId = null;
  if (lever) {
    const room = await prisma.room.findUnique({
      where: { slug: lever.roomSlug },
      select: { id: true, slug: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
    });
    if (!room || character.locationId !== room.locationId) {
      return { ok: false, error: "You aren't standing at that gate's lever." };
    }
    const keys = await roomAccessKeys(prisma, character.id);
    if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
      return { ok: false, error: "You can't get to that lever." };
    }
    leverLocationId = room.locationId;
    leverRoomId = room.id;
  } else if (character.locationId !== link.aId && character.locationId !== link.bId) {
    return { ok: false, error: "You aren't standing at that gate." };
  }
  if (anchor) {
    // Read off the ROW, never trusted from a caller's select — a ring taken off since the page
    // drew must not still work the gate.
    const tags = await prisma.characterTag.findMany({
      where: { characterId: character.id },
      select: { equipped: true, tag: { select: RING_ACCESS_TAG_FIELDS } },
    });
    if (!wornRingAccess(tags).includes(anchor.token)) return { ok: false, error: GATEHOUSE_TEXT.nothingHappens };
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
      // Where it was worked from: the lever's own room, or the end the clicker stood at.
      locationId: leverLocationId ?? character.locationId ?? null,
      roomId: leverRoomId,
      details: {
        linkId: link.id,
        between: [link.a.name, link.b.name],
        isOpen: wantOpen,
        actorName: character.name ?? null,
        ...(lever ? { lever: lever.roomSlug } : {}),
      },
    },
  });

  // The gatehouse's two gates go in the archive too, naming who worked them:
  // everything done at the controls is on the record. Never on a feed — the
  // room already heard the gate move, just not who moved it.
  if (lever || anchor) {
    const from = await prisma.location
      .findUnique({
        where: { id: leverLocationId ?? character.locationId },
        select: { zoneId: true, zone: { select: { name: true } } },
      })
      .catch(() => null);
    await recordArchiveEvent(prisma, {
      kind: "GATEHOUSE",
      character,
      zoneId: from?.zoneId ?? null,
      zoneName: from?.zone?.name ?? null,
      content: GATEHOUSE_TEXT.archiveGate(character.name, wantOpen, link.a.name, link.b.name),
    });
  }

  // A gate is a loud thing in a quiet barony, and until now only the person on the winch knew
  // it had moved. Everyone in earshot on either side hears it: the public rooms at both ends
  // and both Location channels. Best-effort and swallowed — the flip has already committed,
  // and a line nobody heard must never look like a gate that did not move.
  try {
    // "A gate" is right for a portcullis and wrong for the Den's basement
    // shutters, so a gate whose room named its control is announced by that
    // word instead (db/lib/placeAffordances.js#GATE_CONTROL_ROOMS).
    const control = lever?.control ?? anchor?.control ?? (await controlWordFor(prisma, [link.aId, link.bId]));
    const thing = controlThing(control) ?? "A gate";
    const text = wantOpen ? `${thing} opens.` : `${thing} closes.`;
    const sfx = wantOpen ? SFX.GATE_OPEN : SFX.GATE_SHUT;
    // A lever's own house hears it too — the doc's "in Gatehouse, Bridge and Square".
    const leverLocation = leverLocationId
      ? await prisma.location.findUnique({ where: { id: leverLocationId } })
      : null;
    const heardAt = [link.aId, link.bId, ...(leverLocation ? [leverLocation.id] : [])];
    // Sequential, not Promise.all: each of these posts to Discord, and a burst is how you
    // meet a rate limit (db/lib/soundBroadcast.js is sequential for the same reason).
    for (const room of await publicRoomsIn(prisma, heardAt)) {
      await roomLine(prisma, room, text, { sfx });
    }
    for (const location of [link.a, link.b, ...(leverLocation ? [leverLocation] : [])]) {
      await locationLine(prisma, location, text, { sfx });
    }
  } catch (err) {
    console.error("Gate line failed:", err?.message ?? err);
  }

  if (lever) {
    const thing = (controlThing(lever.control) ?? "The gate").toLowerCase();
    return {
      ok: true,
      opened: wantOpen,
      farName: null,
      // Both sides and the lever's house, for whichever face has an anchor or a starter to redraw.
      locationIds: [link.aId, link.bId, leverLocationId],
      line: wantOpen ? `You pull the lever, and ${thing} opens.` : `You pull the lever, and ${thing} closes.`,
    };
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
  // A worn ring's doors count (docs/systemdocs/RINGS.md).
  const holdsKey = character ? (await withRingTokens(prisma, character.id, character.tags)).has(link.requiredTagSlug) : false;
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
