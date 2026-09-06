// Working a gate, on either face. The transactional flip and the keyed door's
// 24-hour hold used to live inside two Discord button handlers, so the Hall
// could only have carried a second copy of the rules about who may touch a
// portcullis. They live here, and the bot's handlers call them.
//
// Neither of these touches Discord. Redrawing the watchtower's starter row
// after a flip is a Discord-only follow-up, and it stays bot-side: the
// caller is handed back `locationIds` and does its own redraw. A NOTIFY the
// bot listened for would have been a second channel to keep alive for one
// message that only ever fires from a click the bot or the web already
// answered.
const { gateOperable, canToggleGate, endpoints, isHeldOpen, KEYED_OPEN_MS } = require("./locationGraph");

// `character` needs { id, locationId, role: { slug }, tags: [{ tag: { slug } }] }.
const GATE_CHARACTER_SELECT = {
  id: true,
  name: true,
  locationId: true,
  role: { select: { slug: true } },
  tags: { select: { tag: { select: { slug: true } } } },
};

// Returns { ok: true, opened, farName, locationIds } or { ok: false, error }.
// Every refusal is a sentence a player reads, so both faces say the same one.
async function toggleGate(prisma, { character, linkId, actorDiscordUserId }) {
  if (!character) return { ok: false, error: "You don't have a living character. ‡" };

  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  // Covers "not modular" — whatever a stale button claimed.
  if (!gateOperable(link)) return { ok: false, error: "There's no gate here to work. ‡" };
  // You have to be standing on one side of it.
  if (character.locationId !== link.aId && character.locationId !== link.bId) {
    return { ok: false, error: "You aren't standing at that gate. ‡" };
  }

  const allowed = canToggleGate(link, {
    tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
    roleSlug: character.role?.slug ?? null,
  });
  if (!allowed) return { ok: false, error: "The gate's mechanism doesn't answer to you. ‡" };

  const wantOpen = !link.isOpen;
  // The permission verdict above read a snapshot, and the flip must not trust
  // it across time: a re-sync can turn the edge into an ordinary
  // (non-modular) way, and two watchmen can click in the same second. Lock
  // the row, re-read, and re-run both predicates.
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
  if (outcome === "gone") return { ok: false, error: "There's no gate here to work. ‡" };
  if (outcome === "raced") return { ok: false, error: "Somebody just beat you to it. ‡" };

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? null,
      actionType: wantOpen ? "gate_opened" : "gate_closed",
      targetCharacterId: character.id,
      details: { linkId: link.id, between: [link.a.name, link.b.name], isOpen: wantOpen },
    },
  });

  const farName = endpoints(link, character.locationId).far.name;
  return {
    ok: true,
    opened: wantOpen,
    farName,
    // Both sides, for whichever face has an anchor to redraw.
    locationIds: [link.aId, link.bId],
    line: wantOpen ? `You open the way to ${farName}. ‡` : `You shut the way to ${farName}. ‡`,
  };
}

// The answer to "leave it open for the next 24 hours?" — the DM's Yes/No, and
// the Hall's Hold open button.
//
// Re-checked rather than trusted: the prompt was raised for a key-holder, but
// a DM is a durable surface and the key can change hands between the crossing
// and the answer. Whoever answers must still hold the key. "Leave it open" is
// a conditional updateMany against the window they were shown, so two people
// propping the same door in the same moment cannot stack two windows.
async function holdKeyedOpen(prisma, { discordUserId, linkId, hold }) {
  const link = await prisma.locationLink.findUnique({ where: { id: linkId }, include: { a: true, b: true } });
  if (!link?.keyed) return { ok: false, error: "There's no door here to hold. ‡" };
  const between = `${link.a.name} and ${link.b.name}`;

  if (!hold) return { ok: true, held: false, line: `You let the way between ${between} fall shut. ‡` };

  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, tags: { select: { tag: { select: { slug: true } } } } },
  });
  const holdsKey = (character?.tags ?? []).some((ct) => ct.tag?.slug === link.requiredTagSlug);
  if (!holdsKey) return { ok: false, error: "You no longer have what holds that open. ‡" };

  if (isHeldOpen(link)) {
    return { ok: false, error: `The way between ${between} is already being held open. ‡` };
  }

  const openUntil = new Date(Date.now() + KEYED_OPEN_MS);
  const claim = await prisma.locationLink.updateMany({
    where: { id: link.id, OR: [{ openUntil: null }, { openUntil: { lte: new Date() } }] },
    data: { openUntil },
  });
  if (claim.count === 0) return { ok: false, error: "Somebody just beat you to it. ‡" };

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
    line: `You leave the way between ${between} open. ‡`,
    note: "It stands open for 24 hours, and anyone can see and use it until then. ‡",
  };
}

module.exports = { GATE_CHARACTER_SELECT, toggleGate, holdKeyedOpen };
