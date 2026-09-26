// The bomb collar (docs/systemdocs/COLLAR.md).
//
// Three verbs over two kinds of tag. The LOOSE collar is an item; the SHUT one
// is a trait -- `general`, so no menu can hand it over, steal it or destroy it,
// but an ACCESSORY, so it sits on the equip board round the neck. Apply Collar
// spends the item to write the trait EQUIPPED, and db/lib/equipSlots.js
// #isLockedOn is what refuses Unequip. The Collar Key turns the trait back into
// an item, and the Exactor's remote sets it off.
//
// Every collar that has been locked on carries a GLYPH, and the glyph goes
// wherever the collar goes (db/lib/collarGlyphs.js says how). The remote lists
// collars by glyph, never by who is wearing them, which is the whole trick: a
// collar moved from one neck to another reads the same on the remote until
// the Exactor walks over and looks.
//
// Apply Collar has two doors, exactly as db/lib/bind.js does: a target who
// could stop you is ASKED (an Offer of kind COLLAR, on the shared button
// prefixes), and one who could not -- dead, or holding an INCAPACITATING tag --
// is collared on the spot. Yourself is a third door and needs no offer either;
// you are not asking anybody. All three end in applyCollar, so what wearing a
// collar means is written once.
//
// Unlock and Detonate ask nobody. That asymmetry is the point of the seat.
//
// Takes `prisma` as the first parameter and is NOT on the @lifeweb/db barrel;
// require it by path.
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { applyDeathToRow } = require("./characterDeath");
const { applyDeathTeardown } = require("./deathTeardown");
const { locationLine, zoneLine } = require("./placeLine");
const { SFX } = require("./sfx");
const { sendDm } = require("./dm");
const { createWithRetry } = require("./paperMint");
const { wornRingTokens } = require("./roomAccess");
const {
  COLLAR_ITEM_SLUG,
  COLLAR_LOCKED_SLUG,
  LOOSE_GLYPH_PREFIX,
  LOCKED_GLYPH_PREFIX,
  glyphFor,
  glyphIndexOf,
  glyphOf,
  looseSlugFor,
  lockedSlugFor,
  isLooseCollarSlug,
  isLockedCollarSlug,
  nextGlyphIndex,
  collarName,
} = require("./collarGlyphs");

const DETONATOR_SLUG = "remote-detonator";
const COLLAR_KEY_SLUG = "collar-key";

// Whose remote it is. The Exactor's ring carries this token (the `ring:` block
// in docs/roles.yaml, and docs/systemdocs/RINGS.md §3), so the remote answers
// to whoever has that ring on their finger. The ring is keyed like a door, not
// like the seat: somebody who steals the ring AND the remote can fire it, and
// the remote alone arms nobody.
const EXACTOR_RING_TOKEN = "exactors-key";

// What the dead player is told. Not the Rite of Judgement's line any more: a
// rite vaporizes, and a collar takes the head and leaves the rest.
const DETONATION_DEATH_REASON = "There was a click at your throat, and then nothing at all.";

// `location` and `zone` for the scene lines, `tags` for the collar check,
// `discordRoleId` for the teardown that applyDeathToRow is about to null.
const COLLAR_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  zoneId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  discordRoleId: true,
  location: { select: { id: true, name: true, discordChannelId: true } },
  zone: { select: { id: true, name: true, discordSummaryChannelId: true } },
  tags: { select: { tagId: true, tag: { select: { slug: true } } } },
};

// Either spelling of a collar in somebody's hands, or round a neck, as a
// Prisma Tag filter.
const LOOSE_COLLAR_WHERE = { OR: [{ slug: COLLAR_ITEM_SLUG }, { slug: { startsWith: LOOSE_GLYPH_PREFIX } }] };
const LOCKED_COLLAR_WHERE = { OR: [{ slug: COLLAR_LOCKED_SLUG }, { slug: { startsWith: LOCKED_GLYPH_PREFIX } }] };

function heldSlugs(character) {
  return new Set((character?.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

function wearsCollar(character) {
  return [...heldSlugs(character)].some(isLockedCollarSlug);
}

// Whether the ring on somebody's finger is the Exactor's. `ringTokens` is the
// worn, registered ring's access list (roomAccess.js#wornRingTokens, or
// rings.js#wornRingAccess off tags already loaded). A ring in a pocket opens
// nothing, so it works no remote either.
function wearsExactorsRing(ringTokens) {
  return [...(ringTokens ?? [])].includes(EXACTOR_RING_TOKEN);
}

// The Detonate button's whole gate: the remote in your hand, and the Exactor's
// ring on your finger.
function canWorkRemote(slugs, ringTokens) {
  return Boolean(slugs?.has(DETONATOR_SLUG)) && wearsExactorsRing(ringTokens);
}

// The same gate, re-read from the database for a server action or a Discord
// verb. Null when the remote answers, or the refusal to show.
async function remoteRefusal(prisma, characterId) {
  const held = await prisma.characterTag.count({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: DETONATOR_SLUG } },
  });
  if (!held) return "You don't have a detonator.";
  if (!wearsExactorsRing(await wornRingTokens(prisma, characterId))) return "The remote doesn't answer to you.";
  return null;
}

// Dead or helpless: no leave needed. bind.js's rule, read off the same derived
// set, so a tag that stops counting as incapacitating stops counting here too.
function needsNoConsent(target) {
  return target.status === "DEAD" || (target.tags ?? []).some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
}

// The gate Apply Collar re-runs at the answer. Unlike kissAuthority there is no
// covered-face rule: a hood over somebody's head does not stop a collar going
// round their neck, so `allowConcealed` is on the same way
// db/lib/search.js#searchAuthority has it.
function collarAuthority(actor, target) {
  if (!actor || !target) return "They aren't here.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  if (!isHere(actor, target, { allowConcealed: true })) return notHereMessage(target);
  if (target.status !== "ALIVE") return notHereMessage(target);
  return null;
}

async function requireTag(db, slug) {
  const tag = await db.tag.findUnique({ where: { slug } });
  if (!tag) throw new Error(`The ${slug} tag is missing from the catalog.`);
  return tag;
}

// --- Glyphs ---------------------------------------------------------------
//
// A marked collar is a minted row copied off its catalog row, the shape
// db/lib/customCraftMint.js clones with: `custom` so db:sync-tags never sees
// it, `ephemeral` so Restart Game sweeps it, and `customOfSlug` so anything
// asking "is this a collar?" by its origin still gets yes. Not stackable: two
// collars with the same glyph cannot exist.

function glyphDescription(glyph, { locked }) {
  return locked
    ? `You have a shock collar locked around your neck, with the glyph ${glyph} etched into the clasp. Only a key takes it off.`
    : `A collar that can be locked around someone's neck. The glyph ${glyph} is etched into the clasp.`;
}

function mintedCollarData(base, index, { locked }) {
  const glyph = glyphFor(index);
  return {
    slug: locked ? lockedSlugFor(index) : looseSlugFor(index),
    name: collarName(glyph, { locked }),
    description: glyphDescription(glyph, { locked }),
    custom: true,
    ephemeral: true,
    customOfSlug: base.slug,
    pointCost: 0,
    category: base.category,
    groupId: base.groupId ?? null,
    sprite: base.sprite,
    weightLbs: base.weightLbs,
    tradeable: base.tradeable,
    stackable: false,
    inspectVisibility: base.inspectVisibility,
    equippable: base.equippable,
    equipSlot: base.equipSlot,
    removable: base.removable,
    purchasable: false,
    purchasableAfterStart: false,
  };
}

// Hands out the next glyph. Minting the LOOSE row is what claims it, so two
// collars marked at the same moment collide on the slug and the loser takes
// the next one along. Runs outside any transaction, for the reason
// paperMint.js#createWithRetry gives.
async function claimGlyph(prisma) {
  const base = await requireTag(prisma, COLLAR_ITEM_SLUG);
  const taken = await prisma.tag.findMany({ where: { slug: { startsWith: LOOSE_GLYPH_PREFIX } }, select: { slug: true } });
  const start = nextGlyphIndex(taken.map((t) => t.slug));
  const tag = await createWithRetry(prisma, (attempt) => mintedCollarData(base, start + attempt, { locked: false }));
  if (!tag) throw new Error("Could not mark the collar.");
  return glyphIndexOf(tag.slug);
}

// One glyph's loose or locked row, minted the first time it is needed.
async function glyphTag(prisma, index, { locked }) {
  const slug = locked ? lockedSlugFor(index) : looseSlugFor(index);
  const found = await prisma.tag.findUnique({ where: { slug } });
  if (found) return found;
  const base = await requireTag(prisma, locked ? COLLAR_LOCKED_SLUG : COLLAR_ITEM_SLUG);
  return prisma.tag.upsert({ where: { slug }, update: {}, create: mintedCollarData(base, index, { locked }) });
}

// Shut round the neck, not sitting in a pocket: written equipped, and
// equipSlots.js#isLockedOn is what keeps it there. No slot check -- the
// ACCESSORY cap does not count a locked-on thing, and nothing else clashes
// with an accessory.
async function lockOn(tx, characterId, lockedTag) {
  const row = await addToStack(tx, characterId, lockedTag.id, 1, { source: "EVENT", stackable: false });
  await tx.characterTag.update({ where: { id: row.id }, data: { equipped: true, equippedQuantity: 1 } });
}

// Takes the collar off a neck, or reports that somebody else already did.
// deleteMany rather than a read-then-delete: two requests racing for the same
// collar both reach this line, and only one of them gets a count of 1.
async function takeOff(tx, characterId, tagId) {
  const { count } = await tx.characterTag.deleteMany({ where: { characterId, tagId } });
  return count > 0;
}

// Serializes everything that asks "is this neck already collared?" for one
// character, so two collars racing onto the same neck cannot both see it bare.
async function lockCharacterRow(tx, characterId) {
  await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${characterId} FOR UPDATE`;
}

// Marks every blank collar round a neck matching `where` (a Character filter).
// The catalog's `bomb-collar-locked` is a collar nobody has read yet — the
// Slave's starting collar, or one a GM granted by hand — and the remote can
// only list what has a glyph. Called when a Slave is made, when the remote is
// read, and before a key turns, so a glyph always exists by the time anybody
// could see it. Idempotent.
async function stampBlankCollars(prisma, where = {}) {
  const blank = await prisma.tag.findUnique({ where: { slug: COLLAR_LOCKED_SLUG }, select: { id: true } });
  if (!blank) return 0;
  const rows = await prisma.characterTag.findMany({
    where: { tagId: blank.id, quantity: { gt: 0 }, character: where },
    select: { characterId: true },
  });
  let stamped = 0;
  for (const { characterId } of rows) {
    const index = await claimGlyph(prisma);
    const locked = await glyphTag(prisma, index, { locked: true });
    const done = await prisma.$transaction(async (tx) => {
      await lockCharacterRow(tx, characterId);
      if (!(await takeOff(tx, characterId, blank.id))) return false;
      await lockOn(tx, characterId, locked);
      return true;
    });
    if (done) stamped += 1;
  }
  return stamped;
}

// The loose collars in somebody's hands, blank ones first: a fresh collar is
// the one you reach for unless you have a reason to pick a marked one.
async function looseCollarsHeld(prisma, characterId) {
  const rows = await prisma.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: LOOSE_COLLAR_WHERE },
    select: { tag: { select: { id: true, slug: true, name: true } } },
  });
  return rows.map((r) => r.tag).sort((a, b) => (glyphIndexOf(a.slug) ?? -1) - (glyphIndexOf(b.slug) ?? -1));
}

// Which collar Apply Collar spends: the one asked for, or the first in hand.
// Null when the actor holds none (or not that one).
async function pickLooseCollar(prisma, characterId, { slug = null, tagId = null } = {}) {
  const held = await looseCollarsHeld(prisma, characterId);
  if (tagId) return held.find((t) => t.id === tagId) ?? null;
  if (slug) return held.find((t) => t.slug === slug) ?? null;
  return held[0] ?? null;
}

// --- The three verbs ------------------------------------------------------

// Both doors of Apply Collar land here. Spends one loose collar off the actor
// and writes the locked collar with the SAME glyph onto the target -- a blank
// collar is marked here, on its way round the neck -- in one transaction, so
// a crash can never do one without the other.
//
// `actor` and `target` may be the SAME character (collaring yourself), which
// is why the drop and the add are ordered rather than run in parallel.
//
// Returns { ok: false, reason } when the neck is already taken or the collar
// has left the actor's hands; otherwise the effect, glyph included.
async function applyCollar(prisma, { actor, target, turn, collar, offerId = null }) {
  if (!collar || !isLooseCollarSlug(collar.slug)) return { ok: false, reason: "You don't have a collar." };
  const index = glyphIndexOf(collar.slug) ?? (await claimGlyph(prisma));
  const locked = await glyphTag(prisma, index, { locked: true });
  const glyph = glyphFor(index);
  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: locked.id,
    tagName: locked.name,
    glyph,
    ...(offerId ? { offerId, consented: true } : {}),
  };
  return prisma.$transaction(async (tx) => {
    await lockCharacterRow(tx, target.id);
    const already = await tx.characterTag.count({
      where: { characterId: target.id, quantity: { gt: 0 }, tag: LOCKED_COLLAR_WHERE },
    });
    if (already) return { ok: false, reason: `${target.name} already has a collar on.` };
    const inHand = await tx.characterTag.count({
      where: { characterId: actor.id, tagId: collar.id, quantity: { gt: 0 } },
    });
    if (!inHand) return { ok: false, reason: "You don't have that collar any more." };
    await dropCharacterTag(tx, actor.id, collar.id, 1);
    await lockOn(tx, target.id, locked);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_apply_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: effect,
      },
    });
    return { ok: true, ...effect };
  });
}

// Files the consent offer. Mirrors createBindOffer, including the duplicate
// guard -- a second ask in the same turn is refused rather than DMing twice.
// The collar being offered rides on the offer's `tagId`, so the accept locks on
// the collar the asker picked and not whichever one they happen to hold later.
async function createCollarOffer(prisma, { actor, target, turn, collar }) {
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };
  const duplicate = await prisma.offer.findFirst({
    where: { kind: "COLLAR", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };
  const offer = await prisma.offer.create({
    data: { kind: "COLLAR", turnId: turn.id, initiatorId: actor.id, responderId: target.id, tagId: collar?.id ?? null },
  });
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${actor.name}* wants to put a shock collar on you. Accept?`,
      components: offerButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id),
    },
  };
}

// The Accept click; the shape db/lib/dmAnswer.js#answerOffer hands both faces.
// The whole gate is re-run: an offer can sit unanswered for hours, in which
// either side can move, be collared by somebody else, or die.
async function acceptCollar(prisma, offer, responder) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: COLLAR_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: COLLAR_SELECT }),
  ]);
  const refuse = async (reason) => {
    await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return {
      ok: false,
      reason,
      dms: actor?.discordUserId
        ? [{ discordUserId: actor.discordUserId, content: `Your offer fell through: ${reason}` }]
        : [],
    };
  };
  if (!turn || turn.id !== offer.turnId) return refuse("That offer was for a turn that's over.");
  if (!actor || actor.status !== "ALIVE") return refuse("They aren't around any more.");
  if (!target || target.status !== "ALIVE") return refuse("You aren't in a state for that.");
  const refusal = collarAuthority(actor, target);
  if (refusal) return refuse(refusal);
  if (wearsCollar(target)) return refuse(`${target.name} already has a collar on.`);
  // Re-read the actor's own stock: they may have handed it away while waiting.
  // An offer from before collars carried a glyph has no tagId, and takes
  // whichever collar is in hand.
  const collar = await pickLooseCollar(prisma, actor.id, { tagId: offer.tagId ?? null });
  if (!collar) return refuse(`${actor.name} has no collar to put on you.`);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  const applied = await applyCollar(prisma, { actor, target, turn, collar, offerId: offer.id });
  if (!applied.ok) {
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: "CANCELLED", resolvedAt: new Date(), outcome: { collared: false } },
    });
    return {
      ok: false,
      reason: applied.reason,
      dms: actor.discordUserId
        ? [{ discordUserId: actor.discordUserId, content: `Your offer fell through: ${applied.reason}` }]
        : [],
    };
  }
  await prisma.offer.update({
    where: { id: offer.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { collared: true, glyph: applied.glyph } },
  });
  return {
    ok: true,
    collaredId: target.id,
    line: `You let ${actor.name} put a collar on you. It is marked ${applied.glyph}.`,
    dms: actor.discordUserId
      ? [
          {
            discordUserId: actor.discordUserId,
            content: `${target.name} let you put a collar on them. It is marked ${applied.glyph}.`,
          },
        ]
      : [],
  };
}

// The key's half. The collar comes off the target and lands in the UNLOCKER's
// hands, not the freed person's -- an Exactor who unlocks a collar keeps it to
// use again, which is the whole reason a key is worth carrying. It keeps its
// glyph, which is what lets somebody who is not the Exactor put it on a
// different neck and have the remote none the wiser.
async function unlockCollar(prisma, { actor, target, turn }) {
  // A blank collar is marked before it comes off, so the loose one in the
  // unlocker's hand always has a glyph to carry.
  await stampBlankCollars(prisma, { id: target.id });
  const worn = await prisma.characterTag.findFirst({
    where: { characterId: target.id, quantity: { gt: 0 }, tag: { slug: { startsWith: LOCKED_GLYPH_PREFIX } } },
    select: { tagId: true, tag: { select: { slug: true } } },
  });
  if (!worn) return { ok: false, reason: `${target.name} doesn't have a collar on.` };
  const index = glyphIndexOf(worn.tag.slug);
  const loose = await glyphTag(prisma, index, { locked: false });
  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: loose.id,
    tagName: loose.name,
    glyph: glyphFor(index),
  };
  const done = await prisma.$transaction(async (tx) => {
    if (!(await takeOff(tx, target.id, worn.tagId))) return false;
    await addToStack(tx, actor.id, loose.id, 1, { source: "EVENT", stackable: false });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_unlock_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: effect,
      },
    });
    return true;
  });
  if (!done) return { ok: false, reason: `${target.name} doesn't have a collar on.` };
  return { ok: true, ...effect };
}

// What the remote shows whoever wears the Exactor's ring: every collar round a
// living neck in their own zone, by glyph and nothing else. Who wears one is
// not the remote's to say -- the caller adds a name only for the people
// standing in front of them, where they can read the clasp themselves
// (web/app/(app)/character/actions/misc.js#readRemoteRequestImpl).
//
// The holder's own neck is left off: the remote is not how they die.
async function remoteReading(prisma, actor) {
  if (!actor?.zoneId) return [];
  const inRange = { status: "ALIVE", zoneId: actor.zoneId, id: { not: actor.id } };
  await stampBlankCollars(prisma, inRange);
  const rows = await prisma.characterTag.findMany({
    where: { quantity: { gt: 0 }, character: inRange, tag: { slug: { startsWith: LOCKED_GLYPH_PREFIX } } },
    select: { tag: { select: { slug: true } } },
  });
  return rows
    .map((r) => ({ slug: r.tag.slug, index: glyphIndexOf(r.tag.slug), glyph: glyphOf(r.tag.slug) }))
    .filter((r) => r.index != null)
    .sort((a, b) => a.index - b.index);
}

// The trigger. Reaches any collar round a living neck in the holder's zone,
// wherever in it the wearer stands -- a slave can still run, but only out of
// the zone. The wearer dies an ORDINARY death: the collar takes their head and
// nothing else, so there is a body where they fell with everything they were
// carrying still on it (docs/systemdocs/CORPSES.md). A collar that vaporized
// its wearer gave the Exactor every reason never to use it on a slave who ran
// off with something valuable.
//
// Two places hear it: the Location the wearer stood in, by name, and the
// zone's #summary, which hears the blast but not who it was.
//
// The actor is told the glyph and nothing else. If the wearer was standing in
// front of him he saw it happen; if not, he finds out who it was the way
// everybody else does. `targetId` is for the caller's own cache refresh and
// must never be sent on to the browser.
async function detonateCollar(prisma, { actor, collarSlug, turn }) {
  const glyph = glyphOf(collarSlug);
  if (!glyph || !isLockedCollarSlug(collarSlug)) return { ok: false, reason: "That isn't a collar the remote knows." };
  const silent = { ok: false, reason: `Collar ${glyph} doesn't answer.` };
  if (!actor?.zoneId) return silent;

  const target = await prisma.character.findFirst({
    where: {
      status: "ALIVE",
      zoneId: actor.zoneId,
      id: { not: actor.id },
      tags: { some: { quantity: { gt: 0 }, tag: { slug: collarSlug } } },
    },
    select: COLLAR_SELECT,
  });
  if (!target) return silent;
  const worn = target.tags.find((ct) => ct.tag.slug === collarSlug);

  // Captured before applyDeathToRow nulls the column -- the teardown still owes
  // Discord this role's deletion.
  const roleId = target.discordRoleId;
  // The collar goes with the head. Taken off FIRST, so the audit row is honest
  // about where it went and the corpse is not left wearing it.
  const gone = await prisma.$transaction(async (tx) => {
    if (!(await takeOff(tx, target.id, worn.tagId))) return false;
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_detonate_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: target.locationId ?? null,
        details: { targetCharacterId: target.id, targetName: target.name, glyph },
      },
    });
    return true;
  });
  // A key got there first.
  if (!gone) return silent;

  const { claimed } = await applyDeathToRow(prisma, target, {
    turn,
    content: `${target.name} was killed by their collar.`,
    cause: actor.discordUserId
      ? { kind: "player", actorDiscordUserId: actor.discordUserId }
      : { kind: "system", system: "collar" },
  });
  // Something else killed them between the lookup and here. The collar is
  // spent either way; nothing explodes twice.
  if (!claimed) return { ok: true, glyph, alreadyDead: true, targetId: target.id };

  const { member } = await applyDeathTeardown(prisma, { ...target, discordRoleId: roleId });
  if (member) {
    await sendDm(prisma, target.discordUserId, `You have died.\n${DETONATION_DEATH_REASON}`, {
      source: "collar",
    }).catch((err) => console.error(`detonation DM for ${target.name}:`, err?.message ?? err));
  }
  await locationLine(prisma, target.location, `${target.name}'s collar goes off, and takes their head with it.`, {
    sfx: SFX.BOOM,
  });
  const from = target.location?.name ? ` from ${target.location.name}` : "";
  await zoneLine(prisma, target.zone, `An explosion rings out${from}.`, { sfx: SFX.BOOM });
  return { ok: true, glyph, alreadyDead: false, targetId: target.id };
}

module.exports = {
  COLLAR_ITEM_SLUG,
  COLLAR_LOCKED_SLUG,
  DETONATOR_SLUG,
  COLLAR_KEY_SLUG,
  EXACTOR_RING_TOKEN,
  COLLAR_SELECT,
  DETONATION_DEATH_REASON,
  heldSlugs,
  wearsCollar,
  wearsExactorsRing,
  canWorkRemote,
  remoteRefusal,
  needsNoConsent,
  collarAuthority,
  stampBlankCollars,
  looseCollarsHeld,
  pickLooseCollar,
  applyCollar,
  createCollarOffer,
  acceptCollar,
  unlockCollar,
  remoteReading,
  detonateCollar,
};
