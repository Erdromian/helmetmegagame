// The Town Gatehouse (Incarn and gates.docx, docs/systemdocs/GATEHOUSE.md):
// asking to pass the gate, the clerk's terminal that answers, the Magma button,
// and the Documents it prints. Both faces call these — Chat's dialogs and the
// bot's panels — so every rule and every refusal is written once.
//
// Everything returns `{ ok: true, … }` or `{ ok: false, error }` rather than
// throwing, the db/lib/depotCounter.js convention. What has to reach Discord
// after a write (a teleport's channel swap, a DM) is handed back as `after`
// and run by finishGatehouse(), so the web can run it in after() and the bot
// can simply await it.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel; require
// it by path.

const {
  GATEHOUSE_SLUG,
  SQUARE_SLUG,
  BRIDGE_SLUG,
  GATE_ROOM_SLUG,
  GATE_CONTROLS_ROOM_SLUG,
  GATEHOUSE_WINDOW_ROOM_SLUG,
  GATEHOUSE_KEY,
  DOCUMENTS_FEE_OBOLS,
  REQUEST_TEXT_MAX,
  DOCUMENT_FIELD_MAX,
  GATEHOUSE_TEXT: T,
} = require("./gatehouseText");
const { loadRoomsAt } = require("./roomSides");
const { roomAccessKeys, accessibleRooms } = require("./roomAccess");
const { blockerFor, ACT } = require("./incapacitation");
const { wornRing, wornRingAccess } = require("./rings");
const { isTradeable } = require("./tradeable");
const { isResourcesRow } = require("./resourceStack");
const { seenByIdMany, heldReasonFor } = require("./intercept");
const { dropCharacterTag } = require("./tagWrites");
const { characterParty, turnStamp } = require("./economyLedger");
const { openAccount, bumpBankAccount } = require("./bankAccounts");
const { ensurePin } = require("./acquaintances");
const { mintDocuments } = require("./paperMint");
const { cleanCustomText } = require("./customText");
const { applyDeathToRow } = require("./characterDeath");
const { applyDeathTeardown } = require("./deathTeardown");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { locationLine } = require("./placeLine");
const { sendDm } = require("./dm");
const { SFX } = require("./sfx");
const { recordArchiveEvent } = require("./archive");
const { logAudit } = require("./auditLog");

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

// A thrown refusal inside a transaction, so it rolls the whole thing back.
function refusal(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

const ACTOR_SELECT = {
  id: true,
  name: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  location: { select: { id: true, slug: true, name: true } },
  bankAccount: { select: { id: true } },
  tags: {
    select: {
      tagId: true,
      quantity: true,
      equipped: true,
      source: true,
      expiresTurn: true,
      tag: true,
    },
  },
};

// Alive, able to act, and in `roomSlug` as seen from where they stand — a room
// that opens onto more than one Location answers for whichever side they are
// on (db/lib/roomSides.js). Re-loaded on every press: a dialog and a Discord
// panel both outlive somebody walking off.
async function gateActor(prisma, discordUserId, roomSlug) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: ACTOR_SELECT,
  });
  if (!character) return fail(T.noCharacter);
  const [room] = await loadRoomsAt(prisma, character.locationId, { where: { slug: roomSlug } });
  if (!room) return fail(T.notHere);
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) return fail(T.cantAct(blocker.name));
  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return fail(T.noDoor);
  }
  return { ok: true, character, room };
}

// The clerk at the terminal: in Gate Controls, wearing a ring that carries the
// gatehouse token. A key in a pocket does not count — the ring is the gate.
async function clerkActor(prisma, discordUserId) {
  const actor = await gateActor(prisma, discordUserId, GATE_CONTROLS_ROOM_SLUG);
  if (!actor.ok) return actor;
  if (!wornRingAccess(actor.character.tags).includes(GATEHOUSE_KEY)) return fail(T.processNoRing);
  return actor;
}

// Which way this character would be asking to go, from where they stand, or a refusal.
function directionFor(character, room) {
  const here = character.location?.slug;
  if (here === GATEHOUSE_SLUG) return { error: T.requestInside };
  if (room.slug === GATE_ROOM_SLUG && here === BRIDGE_SLUG) return { direction: "IN" };
  if (room.slug === GATEHOUSE_WINDOW_ROOM_SLUG && here === SQUARE_SLUG) return { direction: "OUT" };
  return { error: T.requestNotHere };
}

// What a character could hand over: tradeable, and never the ⬢ row, the
// Transfer dialog's own rule (web/lib/tagRequests.js#transferableTags).
function handable(tags) {
  return (tags ?? [])
    .filter((ct) => isTradeable(ct.tag) && !isResourcesRow(ct) && (ct.quantity ?? 0) > 0)
    .map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      quantity: ct.quantity ?? 1,
      stackable: Boolean(ct.tag.stackable),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// [{ tagId, quantity }] from a client, cleaned against what is actually held:
// duplicates merged, quantities clamped to the holding, anything not handable
// dropped. `strict` refuses instead of dropping, for a move that must happen
// exactly as asked.
function pickLines(raw, available, { strict = false } = {}) {
  const byId = new Map(available.map((row) => [row.tagId, row]));
  const wanted = new Map();
  for (const line of Array.isArray(raw) ? raw : []) {
    const tagId = String(line?.tagId ?? "");
    const quantity = Math.trunc(Number(line?.quantity ?? 1));
    if (!tagId || !Number.isInteger(quantity) || quantity < 1) continue;
    wanted.set(tagId, (wanted.get(tagId) ?? 0) + quantity);
  }
  const out = [];
  for (const [tagId, quantity] of wanted) {
    const row = byId.get(tagId);
    if (!row) {
      if (strict) return { error: tagId };
      continue;
    }
    if (strict && quantity > row.quantity) return { error: tagId, name: row.name };
    out.push({ tagId, name: row.name, quantity: Math.min(quantity, row.quantity) });
  }
  return { lines: out };
}

// An offer as it stands NOW: what was offered, cut down to what the asker still
// holds. The doc: "if the items are misplaced prior to that point, they become
// absent from the request."
function liveOffer(offered, askerTags) {
  const available = handable(askerTags);
  return pickLines(offered, available).lines;
}

function openTurn(prisma) {
  return prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
    .catch(() => null);
}

// ─── Request Passage ──────────────────────────────────────────────────────

/** What the Request Passage dialog draws: the way, the things to offer, a request already waiting. */
async function passageView(prisma, discordUserId, { roomSlug }) {
  const actor = await gateActor(prisma, discordUserId, roomSlug);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  const way = directionFor(character, room);
  if (way.error) return fail(way.error);
  const pending = await prisma.gatePassage.findFirst({
    where: { characterId: character.id, status: "PENDING" },
    select: { text: true, offered: true, direction: true },
  });
  return {
    ok: true,
    direction: way.direction,
    intro: way.direction === "IN" ? T.requestIntroIn : T.requestIntroOut,
    things: handable(character.tags),
    pending: pending
      ? { text: pending.text, offered: liveOffer(pending.offered, character.tags), direction: pending.direction }
      : null,
  };
}

/** Ask to pass. Nothing is taken; a request already waiting is replaced. */
async function requestPassage(prisma, discordUserId, { roomSlug, text: rawText, offered: rawOffered, turn = null } = {}) {
  const actor = await gateActor(prisma, discordUserId, roomSlug);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  const way = directionFor(character, room);
  if (way.error) return fail(way.error);

  const text = cleanCustomText(String(rawText ?? ""), REQUEST_TEXT_MAX);
  if (!text) return fail(T.requestNoText);
  const { lines } = pickLines(rawOffered, handable(character.tags));
  const offered = lines.map(({ tagId, quantity }) => ({ tagId, quantity }));

  await prisma.$transaction(async (tx) => {
    await tx.gatePassage.deleteMany({ where: { characterId: character.id, status: "PENDING" } });
    await tx.gatePassage.create({
      data: {
        characterId: character.id,
        direction: way.direction,
        text,
        offered,
        locationId: character.locationId,
        turnId: turn?.id ?? null,
      },
    });
    await logAudit(tx, {
      actorDiscordUserId: discordUserId,
      actionType: "gate_passage_requested",
      targetCharacterId: character.id,
      turnId: turn?.id ?? null,
      details: { direction: way.direction, text, offered: lines },
      place: { locationId: character.locationId, roomId: room.id },
    });
  });
  return { ok: true, line: T.requestSent };
}

// ─── Grant Passage ─────────────────────────────────────────────────────

// Every waiting request whose asker is still alive and still standing where
// they asked, with the asker's tags for the live offer. Leaving withdraws a
// request (locationMove.js#applyArrivalFacts), but a revive or a GM's move can
// skip that, and a stale row must never be approved or poured on.
async function pendingPassages(prisma, where = {}) {
  const rows = await prisma.gatePassage.findMany({
    where: { status: "PENDING", character: { status: "ALIVE" }, ...where },
    orderBy: { createdAt: "asc" },
    include: {
      character: {
        select: {
          id: true,
          name: true,
          discordUserId: true,
          discordRoleId: true,
          locationId: true,
          zoneId: true,
          heldUntil: true,
          heldReason: true,
          tags: { select: { tagId: true, quantity: true, equipped: true, tag: true } },
        },
      },
    },
  });
  return rows.filter((row) => !row.locationId || row.character.locationId === row.locationId);
}

/** The terminal's list: the requests, both ways, and the clerk's own things for the Approve screen. */
async function processView(prisma, discordUserId) {
  const actor = await clerkActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const rows = await pendingPassages(prisma);
  const names = await seenByIdMany(prisma, character.id, rows.map((r) => r.characterId));
  const shaped = rows.map((row, i) => ({
    id: row.id,
    direction: row.direction,
    who: names[i],
    text: row.text,
    offered: liveOffer(row.offered, row.character.tags),
    createdAt: row.createdAt.toISOString(),
  }));
  return {
    ok: true,
    into: shaped.filter((r) => r.direction === "IN"),
    outOf: shaped.filter((r) => r.direction === "OUT"),
    yours: handable(character.tags),
  };
}

// One stack from one hand to another, inside the caller's transaction. ONE
// ledger row for a priced ware (from the giver to the taker), booked on the
// drop; the landing writes the row by hand so it is not booked a second time.
async function handOver(tx, fromId, toId, line) {
  const held = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId: fromId, tagId: line.tagId } },
    include: { tag: true },
  });
  if (!held || held.quantity < line.quantity) return false;
  const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, fromId, line.tagId, line.quantity, {
    econ: { from: characterParty({ id: fromId }), to: characterParty({ id: toId }), reason: "TRANSFER" },
  });
  const landing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId: toId, tagId: line.tagId } },
  });
  // Always an increment, the Transfer dialog's landing rule
  // (web/lib/tagEffects.js#restoreCharacterTag): a second dagger handed to
  // somebody holding one is a second dagger, not a lost one.
  const n = line.quantity;
  if (landing) {
    const samePoison = !landing.poisonPayload || !poisonPayload || landing.poisonPayload === poisonPayload;
    await tx.characterTag.update({
      where: { id: landing.id },
      data: {
        quantity: landing.quantity + n,
        poisonedCount: samePoison ? landing.poisonedCount + poisonedTaken : landing.poisonedCount,
        poisonPayload: landing.poisonPayload ?? (samePoison ? poisonPayload : null),
        acquiredAt: new Date(),
      },
    });
  } else {
    await tx.characterTag.create({
      data: {
        characterId: toId,
        tagId: line.tagId,
        source: "EVENT",
        expiresTurn: held.expiresTurn ?? null,
        quantity: n,
        poisonedCount: Math.min(poisonedTaken, n),
        poisonPayload: poisonedTaken > 0 ? poisonPayload : null,
      },
    });
  }
  return true;
}

function summary(lines) {
  return (lines ?? []).map(({ name, quantity }) => ({ name, quantity }));
}

// The clerk's own ring, for the history's "wearing the Censor's Ring".
function ringName(tags) {
  return wornRing(tags)?.name ?? null;
}

// "Dagger, Obol ×8" — what moved, for the archive line.
function itemList(lines) {
  return (lines ?? []).map(({ name, quantity }) => (quantity > 1 ? `${name} ×${quantity}` : name)).join(", ");
}

// One line in the archive for something done at the controls. No placeKey, so
// it reaches no feed: the terminal keeps no log (the doc), and nobody standing
// in the room reads the clerk's decisions off the scene. recordArchiveEvent
// swallows its own failures — the thing already happened.
async function archiveGatehouse(prisma, clerk, content, turn) {
  const zone = clerk.zoneId
    ? await prisma.zone.findUnique({ where: { id: clerk.zoneId }, select: { name: true } }).catch(() => null)
    : null;
  await recordArchiveEvent(prisma, {
    kind: "GATEHOUSE",
    character: clerk,
    turn,
    zoneId: clerk.zoneId ?? null,
    zoneName: zone?.name ?? null,
    content,
  });
}

/**
 * Approve: move what the clerk chose between the offer and their own hands,
 * then take the asker through the gate — into the Square or out onto the
 * Bridge. `keep` is taken from the offer; `give` is handed from the clerk.
 */
async function approvePassage(prisma, discordUserId, { passageId, keep = [], give = [], turn = null } = {}) {
  const actor = await clerkActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character: clerk, room } = actor;

  const [row] = await pendingPassages(prisma, { id: String(passageId ?? "") });
  if (!row) return fail(T.requestGone);
  const asker = row.character;
  if (asker.id === clerk.id) return fail(T.requestGone);
  // Through the gate is still a move: not out of a fight or an ambush, not
  // while they are bound or out cold. The turn lock only shuts the caves
  // (turnGate.js#travelLockReason), and the gate is all surface.
  if (heldReasonFor(asker) || blockerFor(asker.tags, ACT)) return fail(T.approveHeld);

  const offer = liveOffer(row.offered, asker.tags);
  const kept = pickLines(keep, offer, { strict: true });
  if (kept.error) return fail(T.approveTheyLackIt(kept.name ?? "that"));
  const given = pickLines(give, handable(clerk.tags), { strict: true });
  if (given.error) return fail(T.approveYouLackIt(given.name ?? "that"));

  const destination = await prisma.location.findUnique({
    where: { slug: row.direction === "IN" ? SQUARE_SLUG : BRIDGE_SLUG },
    select: { id: true, name: true, zoneId: true },
  });
  if (!destination) return fail(T.requestGone);
  const [who] = await seenByIdMany(prisma, clerk.id, [asker.id]);

  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.gatePassage.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: {
          status: "APPROVED",
          resolvedAt: new Date(),
          resolvedById: clerk.id,
          resolvedByName: clerk.name,
          resolvedByRing: ringName(clerk.tags),
          moved: { kept: summary(kept.lines), given: summary(given.lines) },
        },
      });
      if (claim.count === 0) throw refusal(T.requestGone);
      for (const line of kept.lines) {
        if (!(await handOver(tx, asker.id, clerk.id, line))) throw refusal(T.approveTheyLackIt(line.name));
      }
      for (const line of given.lines) {
        if (!(await handOver(tx, clerk.id, asker.id, line))) throw refusal(T.approveYouLackIt(line.name));
      }
      // Through the gate: a relocation, not a crossing, so it spends no Move.
      // The arrival is still announced as a manned gate's would be
      // (db/lib/locationMove.js#announceGateCrossing reads the edge).
      await tx.character.update({
        where: { id: asker.id },
        data: { locationId: destination.id, zoneId: destination.zoneId, escortedById: null },
      });
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "gate_passage_approved",
        targetCharacterId: asker.id,
        turnId: turn?.id ?? null,
        details: {
          passageId: row.id,
          direction: row.direction,
          askerName: asker.name,
          clerkName: clerk.name,
          ring: ringName(clerk.tags),
          kept: summary(kept.lines),
          given: summary(given.lines),
          from: asker.locationId,
          to: destination.id,
        },
        place: { locationId: clerk.locationId, roomId: room.id },
      });
    });
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }
  await archiveGatehouse(
    prisma,
    clerk,
    T.archiveApproved(clerk.name, asker.name, row.direction, itemList(kept.lines), itemList(given.lines)),
    turn,
  );

  return {
    ok: true,
    line: T.approvedLine(who, destination.name),
    touched: [clerk.id, asker.id],
    after: {
      moves: [{ characterId: asker.id, fromLocationId: asker.locationId, toLocationId: destination.id }],
      dms: [{ discordUserId: asker.discordUserId, text: T.approvedDm(destination.name) }],
    },
  };
}

/** Deny: nothing moves, and the asker is told. */
async function denyPassage(prisma, discordUserId, { passageId, turn = null } = {}) {
  const actor = await clerkActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character: clerk, room } = actor;
  const [row] = await pendingPassages(prisma, { id: String(passageId ?? "") });
  if (!row) return fail(T.requestGone);
  const [who] = await seenByIdMany(prisma, clerk.id, [row.characterId]);

  const claim = await prisma.gatePassage.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: {
      status: "DENIED",
      resolvedAt: new Date(),
      resolvedById: clerk.id,
      resolvedByName: clerk.name,
      resolvedByRing: ringName(clerk.tags),
    },
  });
  if (claim.count === 0) return fail(T.requestGone);
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId,
    actionType: "gate_passage_denied",
    targetCharacterId: row.characterId,
    turnId: turn?.id ?? null,
    details: {
      passageId: row.id,
      direction: row.direction,
      askerName: row.character.name,
      clerkName: clerk.name,
      ring: ringName(clerk.tags),
    },
    place: { locationId: clerk.locationId, roomId: room.id },
  });
  await archiveGatehouse(prisma, clerk, T.archiveDenied(clerk.name, row.character.name, row.direction), turn);
  return {
    ok: true,
    line: T.deniedLine(who),
    after: { dms: [{ discordUserId: row.character.discordUserId, text: T.deniedDm }] },
  };
}

/**
 * Magma: kills and gibs everybody waiting to come IN. Never those asking to
 * leave. Once a turn, claimed on GameState before anybody dies, so a double
 * press cannot pour twice.
 */
async function pourMagma(prisma, discordUserId, { turn = null } = {}) {
  const actor = await clerkActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character: clerk, room } = actor;
  const current = turn ?? (await openTurn(prisma));
  if (!current?.id) return fail(T.magmaNoTurn);

  const waiting = await pendingPassages(prisma, { direction: "IN" });
  if (waiting.length === 0) return fail(T.magmaNobody);

  const claim = await prisma.gameState.updateMany({
    where: { id: 1, OR: [{ gatehouseMagmaTurnId: null }, { gatehouseMagmaTurnId: { not: current.id } }] },
    data: { gatehouseMagmaTurnId: current.id },
  });
  if (claim.count === 0) return fail(T.magmaOnce);

  const ring = ringName(clerk.tags);
  const killed = [];
  const dms = [];
  for (const row of waiting) {
    const asker = row.character;
    const settled = await prisma.gatePassage.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "MAGMA", resolvedAt: new Date(), resolvedById: clerk.id, resolvedByName: clerk.name, resolvedByRing: ring },
    });
    if (settled.count === 0) continue;
    // Captured before applyDeathToRow nulls it — the teardown still owes Discord this role's deletion.
    const roleId = asker.discordRoleId;
    const { claimed } = await applyDeathToRow(prisma, asker, {
      turn: current,
      gib: true,
      content: `${asker.name} died in the magma at the gate.`,
      cause: { kind: "player", actorDiscordUserId: discordUserId },
    });
    if (!claimed) continue;
    killed.push({ id: asker.id, name: asker.name });
    dms.push({ teardown: { ...asker, discordRoleId: roleId }, discordUserId: asker.discordUserId, text: `You have died.\n${T.magmaDeath}` });
  }

  await logAudit(prisma, {
    actorDiscordUserId: discordUserId,
    actionType: "gate_magma",
    targetCharacterId: clerk.id,
    turnId: current.id,
    details: { ring, clerkName: clerk.name, killed },
    place: { locationId: clerk.locationId, roomId: room.id },
  });
  if (killed.length > 0) {
    const names = killed.map((k) => k.name);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    await archiveGatehouse(prisma, clerk, T.archiveMagma(clerk.name, joined), current);
  }

  return {
    ok: true,
    line: T.magmaLine(killed.length),
    sfx: SFX.GIB,
    after: { deaths: dms, magmaAt: BRIDGE_SLUG },
  };
}

/** Everything the terminal has decided, newest first. */
async function passageHistory(prisma, discordUserId) {
  const actor = await clerkActor(prisma, discordUserId);
  if (!actor.ok) return actor;
  const { character } = actor;
  const rows = await prisma.gatePassage.findMany({
    where: { status: { not: "PENDING" } },
    orderBy: { resolvedAt: "desc" },
    take: 100,
  });
  const ids = rows.flatMap((r) => [r.characterId, r.resolvedById]);
  const names = await seenByIdMany(prisma, character.id, ids);
  return {
    ok: true,
    rows: rows.map((row, i) => ({
      id: row.id,
      direction: row.direction,
      asked: row.direction === "IN" ? T.historyIn : T.historyOut,
      who: names[i * 2],
      text: row.text,
      outcome: T.outcome[row.status] ?? row.status,
      status: row.status,
      by: T.historyBy(row.resolvedById ? names[i * 2 + 1] : (row.resolvedByName ?? "somebody"), row.resolvedByRing),
      kept: row.moved?.kept ?? [],
      given: row.moved?.given ?? [],
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    })),
  };
}

// ─── Documentation ────────────────────────────────────────────────────────

/** The finger-prick: a request to be documented. */
async function submitDocumentation(prisma, discordUserId, { turn = null } = {}) {
  const actor = await gateActor(prisma, discordUserId, GATE_ROOM_SLUG);
  if (!actor.ok) return actor;
  const { character, room } = actor;
  if (character.bankAccount) return fail(T.documentAlready);
  const waiting = await prisma.gateDocumentation.findFirst({
    where: { characterId: character.id, status: "PENDING" },
    select: { id: true },
  });
  if (waiting) return fail(T.documentWaiting);
  await prisma.gateDocumentation.create({ data: { characterId: character.id } });
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId,
    actionType: "documentation_submitted",
    targetCharacterId: character.id,
    turnId: turn?.id ?? null,
    details: {},
    place: { locationId: character.locationId, roomId: room.id },
  });
  return { ok: true, line: T.documentDone };
}

/**
 * The Documents terminal: new submissions, and the register — everybody
 * with a ring, and everybody documented. Real names on the register, the
 * treasury's own ring register's posture (docs/systemdocs/STRANGERS.md §7); a
 * new submission is only blood, so it reads as whoever the clerk sees.
 */
async function documentsView(prisma, discordUserId) {
  const actor = await gateActor(prisma, discordUserId, GATE_CONTROLS_ROOM_SLUG);
  if (!actor.ok) return actor;
  const { character } = actor;

  const pendingRows = await prisma.gateDocumentation.findMany({
    where: { status: "PENDING", character: { status: "ALIVE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, characterId: true, createdAt: true },
  });
  const pendingNames = await seenByIdMany(prisma, character.id, pendingRows.map((r) => r.characterId));

  const [rings, documented, roles] = await Promise.all([
    prisma.tag.findMany({
      where: { ringOfCharacterId: { not: null }, ringRegisteredAt: { not: null } },
      select: {
        ringOfCharacterId: true,
        ringRoleSlugs: true,
        ringBankAccount: { select: { holderName: true, fingerprint: true } },
      },
    }),
    prisma.gateDocumentation.findMany({
      where: { status: "APPROVED", character: { status: "ALIVE" } },
      select: { characterId: true, name: true, occupation: true, fingerprint: true },
    }),
    prisma.role.findMany({ select: { slug: true, name: true } }),
  ]);
  const roleName = new Map(roles.map((r) => [r.slug, r.name]));
  const living = new Map(
    (
      await prisma.character.findMany({
        where: { id: { in: rings.map((r) => r.ringOfCharacterId) }, status: "ALIVE" },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );

  const register = [];
  const seen = new Set();
  for (const ring of rings) {
    const name = living.get(ring.ringOfCharacterId);
    if (!name || seen.has(ring.ringOfCharacterId)) continue;
    seen.add(ring.ringOfCharacterId);
    register.push({
      key: `ring:${ring.ringOfCharacterId}`,
      name: ring.ringBankAccount?.holderName || name,
      occupation: ring.ringRoleSlugs.map((s) => roleName.get(s) ?? s).join(", ") || null,
      fingerprint: ring.ringBankAccount?.fingerprint ?? null,
      kind: T.registerRing,
    });
  }
  for (const doc of documented) {
    register.push({
      key: `doc:${doc.characterId}`,
      name: doc.name,
      occupation: doc.occupation,
      fingerprint: doc.fingerprint,
      kind: T.registerDocuments,
    });
  }
  register.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    pending: pendingRows.map((row, i) => ({ id: row.id, who: pendingNames[i], createdAt: row.createdAt.toISOString() }),
    ),
    register,
  };
}

/**
 * Approve a submission: the clerk writes the name and the occupation. Opens a
 * treasury account under that name owing the processing fee, and prints the
 * Documents — with the account and the PIN on them — into the clerk's hands.
 * Once a character: refused while they hold an account at all, until the
 * Meister closes it.
 */
async function approveDocumentation(prisma, discordUserId, { submissionId, name: rawName, occupation: rawOccupation, turn = null } = {}) {
  const actor = await gateActor(prisma, discordUserId, GATE_CONTROLS_ROOM_SLUG);
  if (!actor.ok) return actor;
  const { character: clerk, room } = actor;
  const name = cleanCustomText(String(rawName ?? ""), DOCUMENT_FIELD_MAX);
  const occupation = cleanCustomText(String(rawOccupation ?? ""), DOCUMENT_FIELD_MAX);
  if (!name || !occupation) return fail(T.needBoth);

  const submission = await prisma.gateDocumentation.findFirst({
    where: { id: String(submissionId ?? ""), status: "PENDING", character: { status: "ALIVE" } },
    select: { id: true, characterId: true, character: { select: { id: true, name: true, bankAccount: { select: { id: true } } } } },
  });
  if (!submission) return fail(T.submissionGone);
  if (submission.character.bankAccount) return fail(T.alreadyHasAccount);

  await ensurePin(prisma, submission.characterId);
  const pin = (await prisma.character.findUnique({ where: { id: submission.characterId }, select: { pin: true } }))?.pin;

  let fingerprint = null;
  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.gateDocumentation.updateMany({
        where: { id: submission.id, status: "PENDING" },
        data: { status: "APPROVED", resolvedAt: new Date(), resolvedById: clerk.id, name, occupation },
      });
      if (claim.count === 0) throw refusal(T.submissionGone);
      const exists = await tx.bankAccount.findUnique({ where: { characterId: submission.characterId }, select: { id: true } });
      if (exists) throw refusal(T.alreadyHasAccount);

      const account = await openAccount(tx, { id: submission.characterId, name }, { turnNumber: turn?.number ?? null });
      fingerprint = account.fingerprint;
      await bumpBankAccount(
        tx,
        account.id,
        -DOCUMENTS_FEE_OBOLS,
        { holderName: account.holderName, econ: { reason: "DOCUMENTS_FEE", ...turnStamp(turn) } },
        { floor: -DOCUMENTS_FEE_OBOLS },
      );
      await tx.gateDocumentation.update({ where: { id: submission.id }, data: { fingerprint } });
      await mintDocuments(tx, clerk.id, {
        name: T.documentsName(name),
        text: T.documentsText({ name, occupation, fingerprint, pin: pin ?? "----" }),
        accountId: account.id,
      });
      // The audit log and the archive keep the record the terminal does not (the doc).
      await logAudit(tx, {
        actorDiscordUserId: discordUserId,
        actionType: "documents_issued",
        targetCharacterId: submission.characterId,
        turnId: turn?.id ?? null,
        details: {
          name,
          occupation,
          fingerprint,
          realName: submission.character.name,
          clerkId: clerk.id,
          clerkName: clerk.name,
          ring: ringName(clerk.tags),
          feeObols: DOCUMENTS_FEE_OBOLS,
        },
        place: { locationId: clerk.locationId, roomId: room.id },
      });
    });
  } catch (err) {
    if (err?.userMessage) return fail(err.userMessage);
    throw err;
  }
  await archiveGatehouse(prisma, clerk, T.archiveDocuments(clerk.name, submission.character.name, name, occupation), turn);

  return { ok: true, line: T.printedLine(name), touched: [clerk.id] };
}

/** Deny a submission. The blood is struck off, and its giver is told. */
async function denyDocumentation(prisma, discordUserId, { submissionId, turn = null } = {}) {
  const actor = await gateActor(prisma, discordUserId, GATE_CONTROLS_ROOM_SLUG);
  if (!actor.ok) return actor;
  const { character: clerk, room } = actor;
  const submission = await prisma.gateDocumentation.findFirst({
    where: { id: String(submissionId ?? ""), status: "PENDING" },
    select: { id: true, characterId: true, character: { select: { discordUserId: true, name: true } } },
  });
  if (!submission) return fail(T.submissionGone);
  const claim = await prisma.gateDocumentation.updateMany({
    where: { id: submission.id, status: "PENDING" },
    data: { status: "DENIED", resolvedAt: new Date(), resolvedById: clerk.id },
  });
  if (claim.count === 0) return fail(T.submissionGone);
  await logAudit(prisma, {
    actorDiscordUserId: discordUserId,
    actionType: "documentation_denied",
    targetCharacterId: submission.characterId,
    turnId: turn?.id ?? null,
    details: { realName: submission.character.name, clerkName: clerk.name, ring: ringName(clerk.tags) },
    place: { locationId: clerk.locationId, roomId: room.id },
  });
  await archiveGatehouse(prisma, clerk, T.archiveDocumentsDenied(clerk.name, submission.character.name), turn);
  return {
    ok: true,
    line: T.deniedSubmission,
    after: { dms: [{ discordUserId: submission.character.discordUserId, text: T.deniedSubmissionDm }] },
  };
}

// ─── After a write ────────────────────────────────────────────────────────

/**
 * The Discord half of a gatehouse write: an approved asker's channel swap and
 * arrival, the DMs, the deaths' teardown and the magma's line at the Bridge.
 * Best-effort and sequential (ARCHITECTURE.md §5); the write has committed.
 */
async function finishGatehouse(prisma, after) {
  if (!after) return;
  const log = (what) => (err) => console.error(`Gatehouse: ${what} failed:`, err?.message ?? err);
  for (const move of after.moves ?? []) {
    await applyLocationMoveSideEffects(prisma, move).catch(log("the move through the gate"));
  }
  for (const death of after.deaths ?? []) {
    const { member } = await applyDeathTeardown(prisma, death.teardown).catch((err) => {
      log("a magma death's teardown")(err);
      return { member: false };
    });
    if (member && death.discordUserId) {
      await sendDm(prisma, death.discordUserId, death.text, { source: "gatehouse" }).catch(log("a death DM"));
    }
  }
  for (const dm of after.dms ?? []) {
    if (!dm.discordUserId) continue;
    await sendDm(prisma, dm.discordUserId, dm.text, { source: "gatehouse" }).catch(log("a DM"));
  }
  if (after.magmaAt) {
    const bridge = await prisma.location.findUnique({ where: { slug: after.magmaAt } }).catch(() => null);
    if (bridge) await locationLine(prisma, bridge, T.magmaPlace, { sfx: SFX.GIB }).catch(log("the magma line"));
  }
}

module.exports = {
  passageView,
  requestPassage,
  processView,
  approvePassage,
  denyPassage,
  pourMagma,
  passageHistory,
  submitDocumentation,
  documentsView,
  approveDocumentation,
  denyDocumentation,
  finishGatehouse,
  // For tests.
  pickLines,
  liveOffer,
  handable,
};
