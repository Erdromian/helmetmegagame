// A FIGHT (docs/systemdocs/ATTACK.md, from Bascinet's Combat Overhaul.docx). Somebody presses Attack
// on several people, with several more asked along, and everyone in it is held where they stand. At
// that moment the game snapshots each of them — health, what they hold and wear, how good they are in
// a fight, whether they were on guard — and how far every character in the world is from here. Each
// writes what they do, rolls a hidden die, and a GM rules on the whole fight as one result.
//
// NOTHING HERE RESOLVES A FIGHT. The rolls are thrown and kept for the GM (db/lib/combatRoll.js) and
// never shown to a player. The ruling is the GM's, staged and pushed like a Gambit's.
//
// Takes `db` as a parameter and is deliberately NOT on the @lifeweb/db barrel (dm.js convention);
// require it by path. IT SENDS NOTHING: every write returns DM descriptors and `speak` lines, and the
// face sends them after the transaction commits (ARCHITECTURE.md §5). db/lib/verbs/combat.js is the
// rule half both faces share; this is the mechanism under it.
//
// THE ONE-FIGHT RULE is CombatParticipant.activeTurnId and its unique (characterId, activeTurnId): the
// insert is the claim, so two fights racing to pull one person in cannot both win. EVERY write that
// changes who is in a fight takes the fight's row FOR UPDATE first (lockCombat), so a join, a decline,
// a call-off and somebody leaving can never interleave on one fight.
//
// THE HOLD is the one intercept.js owns (Character.heldUntil/heldById/heldReason), so every surface that
// already refuses a held person's way out keeps working. It is re-derived from the participant rows by
// settleHold, never written by hand.
const { presentedStateFrom } = require("./examineSnapshot");
const { presentationOf, stampPresentation } = require("./gmPresentation");
const {
  IDENTITY_SELECT,
  HELD_REASON,
  FIGHT_REASONS,
  SAFE_HOLD_MS,
  seenBy,
  seenByMany,
  seenById,
  seenAs,
  identityOf,
} = require("./intercept");
const { slotList } = require("./peopleLine");
const { CONCEALMENT_TAG_FIELDS } = require("./presentedIdentity");
const { rollCombat, MAX_INTERVENE_DISTANCE } = require("./combatRoll");
const { loadGraph, distancesFrom, GIANT_TAG_SLUG } = require("./locationGraph");
const { STOWABLE_SLUGS } = require("./mounts");
const { accessSlugsOf, RING_ACCESS_TAG_FIELDS } = require("./rings");
const { turnEndsAt } = require("./turnClock");
const { movesOpen } = require("./turnGate");
const { combatBlock } = require("./combatGate");
const {
  inCombatMode,
  SURPRISED,
  INVITE_SURPRISED,
  TOO_FAR_TO_INTERVENE,
  ALREADY_FIGHTING,
  CALL_OFF_LOCKED,
  DESCRIBE_LOCKED,
  ATTACK_LOCKED,
  DESCRIPTION_LIMIT,
  DECLINED_ATTACKERS,
  AMBUSH_ENDED,
  listNames,
} = require("./combatMode");
const { COMPELLED_WRITE_PROMPT, COMPELLED_FIELD_LABEL, COMPELLED_NO_CALL_OFF } = require("./compulsionLines");
const { blockerFor, ACT } = require("./incapacitation");
const { DM_KIND } = require("./dmKinds");
const { DM_ACTION, dmAction } = require("./dmActions");
const { stopPerformances } = require("./performance");
const { SFX } = require("./sfx");
const { GUARD_LINES, guardsOf } = require("./guard");
const { capitalizeFirst: cap, withArticle, concealedAlias } = require("./concealedIdentity");

// Thirty minutes, Bascinet's number (the doc): after a call-off the attackers stay where they are "in
// case the defenders wish to counterattack".
const WITHDRAW_HOLD_MS = 30 * 60 * 1000;

// How many people one press may name, targets and collaborators together. Discord's select menu takes
// 25; a sanity bound, not a design statement.
const MAX_PICKS = 20;

// The DM buttons. Every one carries a PARTICIPANT id, never a character id: a custom_id is readable by
// whoever holds the message, and a character id there would unmask a hooded opponent (the old
// `atk:cancel:<targetCharacterId>` did exactly that).
const COMBAT_JOIN_PREFIX = "cbt:join:";
const COMBAT_DECLINE_PREFIX = "cbt:decline:";
const COMBAT_WRITE_PREFIX = "cbt:write:";
const COMBAT_DESCRIBE_PREFIX = "cbt:desc:";
const COMBAT_CALL_OFF_PREFIX = "cbt:calloff:";

// ─── What a fight loads ─────────────────────────────────────────────────────

// Everything the snapshot, the roll, the identity and the hold need, in one read. Held tags only — the
// quantity filter matches IDENTITY_SELECT's, so identityOf and presentedStateFrom agree on what is on
// them. The tag fields are the union of three consumers: the snapshot (tagId, equipped, expiresTurn,
// quantity, slug), the roll (slug, name, gambitBonus — db/lib/gambitModifier.js's trap), and the face
// (CONCEALMENT_TAG_FIELDS, forcedName).
const COMBAT_SELECT = {
  ...IDENTITY_SELECT,
  appearance: true,
  combatModeSinceTurn: true,
  mood: true,
  zoneId: true,
  heldUntil: true,
  heldReason: true,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      tagId: true,
      equipped: true,
      expiresTurn: true,
      quantity: true,
      tag: { select: { ...CONCEALMENT_TAG_FIELDS, slug: true, name: true, gambitBonus: true, forcedName: true } },
    },
  },
};

// What a PLAYER-facing read of a participant may select. Deliberately no die, rolls, modifiers or
// total: those are the GM's (db/test/combatPrivacy.test.js reads this).
const PUBLIC_PARTICIPANT_SELECT = {
  id: true,
  characterId: true,
  side: true,
  role: true,
  status: true,
  alert: true,
  callOffAt: true,
  joinedAt: true,
  character: { select: IDENTITY_SELECT },
};

// The snapshot a GM adjudicates from: what the room could see of them (examineSnapshot.js's payload —
// tags, what is worn, the ⬢, combat mode) plus the two things a roll reads that are not tags.
function snapshotOf(row) {
  return { ...presentedStateFrom(row), mood: Number(row.mood ?? 0) };
}

function otherSide(side) {
  return side === "ATTACKER" ? "DEFENDER" : "ATTACKER";
}

class CombatRefusal extends Error {
  constructor(message) {
    super(message);
    this.combatRefusal = true;
  }
}

function refuse(message) {
  throw new CombatRefusal(message);
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.combatRefusal) return { ok: false, error: err.message, dms: [], speak: [] };
    throw err;
  }
}

// An interactive transaction where there is one, the client itself where there is not (the fakes in
// db/test/, and a caller already inside a transaction).
function inTransaction(db, fn) {
  if (typeof db.$transaction === "function") return db.$transaction(fn, { timeout: 20000 });
  return fn(db);
}

// Serialises every write on one fight (the header). A no-op on a client with no raw SQL — the fakes.
async function lockCombat(tx, combatId) {
  if (typeof tx.$queryRaw !== "function") return;
  await tx.$queryRaw`SELECT id FROM "Combat" WHERE id = ${combatId} FOR UPDATE`;
}

// ─── Distance ───────────────────────────────────────────────────────────────

// Every living, placed character's distance from `locationId` when the fight starts, in Locations,
// through the ways each of them could actually walk (locationGraph.js#distancesFrom). Stored on the fight
// as { [characterId]: [hops, fromLocationId] }, hops capped at 4, which means too far to intervene.
// One read for the graph and one for everybody's door tokens — only the tags that can change an edge's
// verdict (a slug some way requires, `giant`, a mount or a Cart, or a worn ring) are loaded.
async function distanceSnapshot(db, locationId, now = new Date()) {
  const graph = await loadGraph(db);
  const required = [...new Set((graph.links ?? []).map((l) => l.requiredTagSlug).filter(Boolean))];
  const rows = await db.character.findMany({
    where: { status: "ALIVE", locationId: { not: null } },
    select: {
      id: true,
      locationId: true,
      tags: {
        where: {
          quantity: { gt: 0 },
          OR: [
            { tag: { slug: { in: [...required, GIANT_TAG_SLUG, ...STOWABLE_SLUGS] } } },
            { equipped: true, tag: { ringOfCharacterId: { not: null } } },
          ],
        },
        select: { equipped: true, tag: { select: RING_ACCESS_TAG_FIELDS } },
      },
    },
  });
  const travellers = rows.map((row) => ({ id: row.id, locationId: row.locationId, accessSlugs: accessSlugsOf(row.tags) }));
  const map = distancesFrom(graph, locationId, travellers, { maxHops: MAX_INTERVENE_DISTANCE + 1, now });
  const out = {};
  for (const [id, { hops, fromLocationId }] of map) out[id] = [hops, fromLocationId];
  return out;
}

// [hops, fromLocationId] for one character off a fight's stored map. Somebody not in it — dead or
// unplaced when it started, or created since — was nowhere near, so reads as too far.
function distanceOf(combat, characterId) {
  const entry = combat?.distances?.[characterId];
  if (!Array.isArray(entry)) return { hops: MAX_INTERVENE_DISTANCE + 1, fromLocationId: null };
  return { hops: Number(entry[0]), fromLocationId: entry[1] ?? null };
}

// ─── The hold ───────────────────────────────────────────────────────────────

// A fight holds until the turn ends — the push closes every fight left — and never shorter than a Safe
// stop, the fireWatches reasoning: a turn the cron has not closed on time would otherwise put the
// deadline in the past and hold nobody.
function fightHoldUntil(turn, now = new Date()) {
  const boundary = turnEndsAt(turn);
  const floor = new Date(now.getTime() + SAFE_HOLD_MS);
  return boundary && boundary > floor ? boundary : floor;
}

// Re-derive one person's hold from the fight they are actually in. It CLEARS or it RE-POINTS, never just
// clears: heldById names one opponent, and a brawl has several, so when one leaves the pointer moves to
// somebody really still there — otherwise the next "free everybody X was holding" (X walking off, X
// dying) frees the wrong person. A defender reads the sentence about being attacked; an invitee reads
// their own. A hold that is not a fight's (a Safe stop, withdrawing, a caught thief) is left alone when
// there is no fight to hold them.
async function settleHold(db, characterId, turn, now = new Date()) {
  const mine = await db.combatParticipant.findFirst({
    where: { characterId, activeTurnId: turn.id },
    select: { combatId: true, side: true, status: true },
  });
  if (!mine) {
    await db.character.updateMany({
      where: { id: characterId, heldReason: { in: FIGHT_REASONS } },
      data: { heldUntil: null, heldById: null, heldReason: null },
    });
    return { held: false };
  }
  const opponents = await db.combatParticipant.findMany({
    where: { combatId: mine.combatId, activeTurnId: turn.id, side: otherSide(mine.side), status: "JOINED" },
    select: { characterId: true, role: true },
    orderBy: { joinedAt: "asc" },
  });
  const opponent = opponents.find((o) => o.role === "INITIATOR") ?? opponents[0] ?? null;
  const reason =
    mine.status === "INVITED" ? HELD_REASON.INVITED : mine.side === "DEFENDER" ? HELD_REASON.ATTACK : HELD_REASON.ATTACKING;
  await db.character.updateMany({
    where: { id: characterId },
    data: { heldUntil: fightHoldUntil(turn, now), heldById: opponent?.characterId ?? null, heldReason: reason },
  });
  return { held: true };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// The fight somebody is in right now, or null. With the fight's own facts an ambush needs to recognise
// its own (intercept.js#fireWatches).
async function activeFightOf(db, characterId, turnId) {
  if (!characterId || !turnId) return null;
  return db.combatParticipant.findFirst({
    where: { characterId, activeTurnId: turnId },
    select: {
      id: true,
      combatId: true,
      side: true,
      status: true,
      combat: { select: { id: true, fromAmbush: true, ambushOwnerId: true, locationId: true } },
    },
  });
}

// Everyone at this Location in a fight right now — the ids, for a picker to say "In a fight".
async function fightingHere(db, locationId, turnId) {
  if (!locationId || !turnId) return new Set();
  const rows = await db.combatParticipant.findMany({
    where: { activeTurnId: turnId, combat: { locationId, turnId, endedAt: null } },
    select: { characterId: true },
  });
  return new Set(rows.map((r) => r.characterId));
}

// ─── The DMs ────────────────────────────────────────────────────────────────

function joinDeclineRow(participantId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `${COMBAT_JOIN_PREFIX}${participantId}`, label: "Join" },
        { type: 2, style: 2, custom_id: `${COMBAT_DECLINE_PREFIX}${participantId}`, label: "Decline" },
      ],
    },
  ];
}

// "Write your attack" for anyone alert; "Call off" for anyone on the attacking side — except a compelled
// Vampire, whose hunger won't let them (vampireCompulsion.js). Either may be missing, and a DM with neither
// carries no row at all.
function fightRow(participant) {
  const buttons = [];
  if (participant.alert) {
    buttons.push({ type: 2, style: 1, custom_id: `${COMBAT_WRITE_PREFIX}${participant.id}`, label: "Write your attack" });
  }
  if (participant.side === "ATTACKER" && !participant.compelled) {
    buttons.push({ type: 2, style: 4, custom_id: `${COMBAT_CALL_OFF_PREFIX}${participant.id}`, label: "Call off" });
  }
  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

const WRITE_PROMPT = "Write what you do in this fight. You can change it until Moves lock.";

// The line under anybody's fight DM: the prompt to write, or the surprise. The doc: "Characters who did not
// have combat mode enabled are informed that they are caught by surprise."
function promptLine(participant) {
  if (participant.compelled) return COMPELLED_WRITE_PROMPT;
  return participant.alert ? WRITE_PROMPT : SURPRISED;
}

// One DM, carrying the fight's buttons — the kind the web draws as its own row (DmThread.js).
function fightDm(character, participant, lines, extra = {}) {
  if (!character?.discordUserId) return null;
  return {
    discordUserId: character.discordUserId,
    content: [...lines, promptLine(participant)].join("\n"),
    kind: DM_KIND.NOTICE,
    components: fightRow(participant),
    meta: dmAction(DM_ACTION.COMBAT, participant.id),
    ...extra,
  };
}

// A collaborator is snapshotted and rolled the moment they are asked (participantData, at startCombat or
// springAmbush), exactly as a target is when the fight reaches them — so one out of combat mode is told now
// that joining means being caught by surprise, the same −3 and no attack to write (Bascinet, 2026-09-27).
function inviteDm(character, participant, lines) {
  if (!character?.discordUserId) return null;
  return {
    discordUserId: character.discordUserId,
    content: [...lines, ...(participant.alert ? [] : [INVITE_SURPRISED]), "You can't leave until you answer."].join("\n"),
    kind: DM_KIND.NOTICE,
    components: joinDeclineRow(participant.id),
    meta: dmAction(DM_ACTION.COMBAT_INVITE, participant.id),
  };
}

function notice(character, content, extra = {}) {
  if (!character?.discordUserId) return null;
  return { discordUserId: character.discordUserId, content, kind: DM_KIND.NOTICE, ...extra };
}

// Everybody's first line when a fight starts, each naming everybody else the way THEY would
// (seenBy — a hood is "a young man", a stranger what they look like).
async function startDms(db, { combat, parts, rowsById }) {
  const dms = [];
  const initiator = parts.find((p) => p.role === "INITIATOR");
  const targets = parts.filter((p) => p.role === "TARGET");
  const collaborators = parts.filter((p) => p.role === "COLLABORATOR");
  for (const p of parts) {
    const me = rowsById.get(p.characterId);
    const names = async (list) => listNames(await seenByMany(db, me.id, list.map((q) => rowsById.get(q.characterId))));
    const initiatorName = initiator ? await seenBy(db, me.id, rowsById.get(initiator.characterId)) : "somebody";
    if (p.role === "INITIATOR") {
      const lines = [
        combat.fromAmbush
          ? `You sprang your ambush on ${await names(targets)}. Neither side can move until the fight is over.`
          : `You attack ${await names(targets)}. Nobody in the fight can move until it's over.`,
      ];
      if (collaborators.length) lines.push(`You've asked ${await names(collaborators)} to join you.`);
      dms.push(fightDm(me, p, lines, { sfx: SFX.BLADE_DRAWN }));
    } else if (p.role === "TARGET") {
      const lines = combat.fromAmbush
        ? ["You were stopped on the road. It's an ambush! You can't move until the fight is over."]
        : [`${cap(initiatorName)} attacks you! You can't move until the fight is over.`];
      if (combat.openingMessage) lines.push(`» ${combat.openingMessage}`);
      dms.push(
        fightDm(me, p, lines, {
          sfx: SFX.HELD,
          // Who wrote the opening line, on record (the Intercept DM precedent). Never shown.
          authorDiscordUserId: combat.openingMessage ? (rowsById.get(initiator?.characterId)?.discordUserId ?? null) : null,
        }),
      );
    } else if (p.role === "COLLABORATOR") {
      dms.push(
        inviteDm(me, p, [
          combat.fromAmbush
            ? `${cap(initiatorName)}'s ambush has caught ${await names(targets)}, and they want you to join them on the attack.`
            : `${cap(initiatorName)} is attacking ${await names(targets)} and wants you to join them in the attack.`,
        ]),
      );
    }
  }
  return dms.filter(Boolean);
}

// ─── Starting a fight ───────────────────────────────────────────────────────

// Opens a fight. `initiatorId` and every id in the two lists must be standing at `locationId`, alive, and
// in no other fight; the caller has already checked the gates (combatBlock) unless this is involuntary (a
// Vampire's compulsion) or an ambush springing, neither of which a player chose at this moment.
// `compelled` marks the initiator's row as a Vampire's compulsion (vampireCompulsion.js): no Call off, and
// the GM desk's "MUST feed" line.
// Returns { ok, combat, dms, announce } or { ok: false, error }. `announce` is for the face to hand to
// combatAnnounce.js#announceFight after the commit.
function startCombat(
  db,
  {
    initiatorId,
    targetIds,
    collaboratorIds = [],
    turn,
    locationId,
    fromAmbush = false,
    openingMessage = null,
    compelled = false,
    now = new Date(),
  },
) {
  return attempt(async () => {
    if (!turn) refuse("No turn is open.");
    const targets = [...new Set((targetIds ?? []).filter(Boolean))].filter((id) => id !== initiatorId);
    const collabs = [...new Set((collaboratorIds ?? []).filter(Boolean))].filter(
      (id) => id !== initiatorId && !targets.includes(id),
    );
    if (targets.length === 0) refuse("Pick somebody to attack.");
    const ids = [initiatorId, ...targets, ...collabs];
    if (ids.length > MAX_PICKS + 1) refuse(`You can pick at most ${MAX_PICKS} people.`);

    const rows = await db.character.findMany({ where: { id: { in: ids } }, select: COMBAT_SELECT });
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row || row.status !== "ALIVE" || row.locationId !== locationId) {
        refuse(id === initiatorId ? "You have to be standing there to attack." : "Everyone you pick has to be here.");
      }
    }
    // Named generically: which of them is busy is for the room to see, not for the picker to confirm.
    const busy = await db.combatParticipant.findMany({
      where: { characterId: { in: ids }, activeTurnId: turn.id },
      select: { characterId: true },
    });
    if (busy.some((b) => b.characterId === initiatorId)) refuse(ALREADY_FIGHTING);
    if (busy.length) refuse("One of them is already in a fight.");

    const location = await db.location.findUnique({ where: { id: locationId }, select: { id: true, name: true, zoneId: true } });
    const distances = await distanceSnapshot(db, locationId, now);
    const data = (row, side, role, status) => participantData(row, { side, role, status, turnId: turn.id, now });
    const partRows = [
      { ...data(rowsById.get(initiatorId), "ATTACKER", "INITIATOR", "JOINED"), ...(compelled ? { compelled: true } : {}) },
      ...targets.map((id) => data(rowsById.get(id), "DEFENDER", "TARGET", "JOINED")),
      ...collabs.map((id) => data(rowsById.get(id), "ATTACKER", "COLLABORATOR", "INVITED")),
    ];

    const combat = await inTransaction(db, async (tx) => {
      const created = await tx.combat.create({
        data: {
          turnId: turn.id,
          locationId,
          locationName: location?.name ?? null,
          zoneId: location?.zoneId ?? null,
          fromAmbush: Boolean(fromAmbush),
          ambushOwnerId: fromAmbush ? initiatorId : null,
          openingMessage: openingMessage || null,
          distances,
          startedAt: now,
        },
      });
      // The claim. Anybody pulled into another fight since the check above makes this short, and the
      // whole fight rolls back rather than half-forming around them.
      const { count } = await tx.combatParticipant.createMany({
        data: partRows.map((p) => ({ ...p, combatId: created.id })),
        skipDuplicates: true,
      });
      if (count !== partRows.length) refuse("One of them is already in a fight.");
      for (const id of ids) await settleHold(tx, id, turn, now);
      return created;
    });

    await stopPerformances(db, ids, "attack").catch(() => {});
    const parts = await db.combatParticipant.findMany({
      where: { combatId: combat.id },
      select: { id: true, characterId: true, side: true, role: true, status: true, alert: true, compelled: true },
    });
    const dms = await startDms(db, { combat, parts, rowsById });
    // Anybody escorting somebody it just attacked steps in on their side (§6a). After the DMs above, so the
    // targets read "attacks you!" before "joins the fight on your side".
    dms.push(...(await escortsStepIn(db, { combatId: combat.id, turn, now })).dms);

    // The doc: confirming "announces their attack". Told to everybody standing there in the names THEY
    // know the fighters by (db/lib/combatAnnounce.js): the face picks its own words per reader. An ambush
    // makes no announcement: the road does not know it has been watched.
    const announce = fromAmbush
      ? null
      : {
          locationId,
          subjects: {
            text: `{0} attacks ${slotList(1, targets.length)}!`,
            people: [initiatorId, ...targets].map((id) => subjectOf(rowsById.get(id))),
          },
        };
    return { ok: true, combat, dms, speak: [], announce };
  });
}

// One fighter as a place line names them (./peopleLine.js): who they are to somebody who knows them, what
// they look like to somebody who does not, and whether a hood or a forced name makes that the same for
// everybody. `row` is a COMBAT_SELECT row (its tags are the held ones, as identityOf expects).
//
// A disguise is neither: its name reads only to somebody who can put it to the face (STRANGERS.md §10).
function subjectOf(row) {
  const presented = identityOf(row);
  const disguised = Boolean(presented?.disguised);
  return {
    id: row.id,
    name: seenAs(presented),
    alias: withArticle(concealedAlias(row).toLowerCase()),
    masked: Boolean(presented?.concealed || (presented?.forced && !disguised)),
    ...(disguised ? { disguise: true } : {}),
  };
}

function participantData(row, { side, role, status, turnId, distance = null, from = null, now = new Date() }) {
  const alert = inCombatMode(row);
  const roll = rollCombat(row.tags, { mood: Number(row.mood ?? 0), alert, distance });
  return {
    characterId: row.id,
    side,
    role,
    status,
    activeTurnId: turnId,
    alert,
    snapshot: snapshotOf(row),
    snapshotAt: now,
    // GM only: hooded or disguised as they came in, and what as. The snapshot keeps tag ids, but a
    // disguise's tag goes once nobody holds it, so its name is written down here (gmPresentation.js).
    presentedAs: stampPresentation(presentationOf(row)),
    die: roll.die,
    rolls: roll.rolls,
    advantageSource: roll.advantageSource,
    modifiers: roll.modifiers,
    total: roll.total,
    distance,
    fromLocationId: from?.id ?? null,
    fromLocationName: from?.name ?? null,
    answeredAt: status === "INVITED" ? null : now,
    joinedAt: now,
  };
}

// ─── Joining, declining, intervening ────────────────────────────────────────

// A collaborator answers the invitation. `characterId` is the clicker, resolved server-side; the row's
// own characterId is the ownership check.
function answerInvite(db, { participantId, characterId, join, turn, now = new Date() }) {
  return attempt(async () => {
    if (!turn) refuse("No turn is open.");
    const gate = await movesOpen(db, { turn });
    if (!gate.ok) refuse(gate.reason === "LOCKED" ? ATTACK_LOCKED : gate.message);
    const combatId = (await db.combatParticipant.findUnique({ where: { id: participantId ?? "" }, select: { combatId: true } }))
      ?.combatId;
    if (!combatId) refuse("That fight is over.");
    // Joining is fighting, so it asks what intervening asks: somebody tied up or out cold since they were asked
    // can't come. Declining needs nothing — it only lets them go.
    if (join) {
      const row = await db.character.findUnique({ where: { id: characterId }, select: COMBAT_SELECT });
      if (!row || row.status !== "ALIVE") refuse("You can't do that now.");
      const stuck = blockerFor(row.tags, ACT);
      if (stuck) refuse(`You can't fight — you're ${stuck.name}.`);
    }
    const out = await inTransaction(db, async (tx) => {
      await lockCombat(tx, combatId);
      const p = await tx.combatParticipant.findUnique({
        where: { id: participantId },
        select: { id: true, characterId: true, status: true, side: true, alert: true, combat: { select: { endedAt: true } } },
      });
      if (!p || p.characterId !== characterId) refuse("That isn't yours to answer.");
      if (p.combat.endedAt || p.status !== "INVITED") refuse("That fight has moved on without you.");
      await tx.combatParticipant.update({
        where: { id: p.id },
        data: join ? { status: "JOINED", answeredAt: now } : { status: "DECLINED", answeredAt: now, activeTurnId: null },
      });
      await settleHold(tx, characterId, turn, now);
      const reopened = join ? await reopenIfSolved(tx, combatId, now) : false;
      return { ...p, status: join ? "JOINED" : "DECLINED", reopened };
    });

    const me = await db.character.findUnique({ where: { id: characterId }, select: IDENTITY_SELECT });
    const dms = [];
    const others = await liveParticipants(db, combatId, turn.id, { not: characterId });
    for (const other of others) {
      const name = await seenBy(db, other.character.id, me);
      if (join) {
        dms.push(notice(other.character, other.side === out.side ? `${cap(name)} joins you.` : `${cap(name)} joins the attack on you.`));
      } else if (other.side === out.side && other.status === "JOINED") {
        dms.push(notice(other.character, `${cap(name)} won't join you.`));
      }
    }
    // The DM carries the fight's buttons and the prompt to write; the line itself is the reply's, so it is not
    // said twice on Discord (where the reply and the DM land in the same place).
    if (join) dms.push(fightDm(me, out, []));
    return {
      ok: true,
      line: join ? "You join the fight." : "You decide not to get involved. You can go, but you can't help the attacker this turn.",
      reopened: out.reopened,
      dms: dms.filter(Boolean),
      speak: [],
    };
  });
}

// Somebody new came into a fight a GM had already ruled on (Bascinet, 2026-10-03): the ruling no longer covers
// everybody in it, so the Solved stamp comes off and the fight goes back to the top of the Combat lens, marked
// Reopened, for a GM to look over again. The Result box and anything staged stay as they were. Called inside
// the transaction that let them in, with the fight's row locked. Returns whether it reopened anything.
async function reopenIfSolved(tx, combatId, now = new Date()) {
  if (typeof tx.combat?.updateMany !== "function") return false;
  const { count } = await tx.combat.updateMany({
    where: { id: combatId, resolvedAt: { not: null } },
    data: { resolvedAt: null, resolvedByDiscordUserId: null, reopenedAt: now },
  });
  return count > 0;
}

// Everyone still in a fight, with their faces — for a notice that names somebody to each of them.
async function liveParticipants(db, combatId, turnId, { not = null } = {}) {
  return db.combatParticipant.findMany({
    where: { combatId, activeTurnId: turnId, ...(not ? { characterId: { not } } : {}) },
    select: { id: true, characterId: true, side: true, role: true, status: true, alert: true, character: { select: IDENTITY_SELECT } },
    orderBy: { joinedAt: "asc" },
  });
}

// Somebody who was not in the fight joins a side of it (the doc: "Characters who were not initially
// involved in combat may intervene and join the combat on either side"). Their roll carries the distance
// they came from — 1, 2 or 3 Locations away when it started; 4 or more is too late. Their snapshot is
// taken now, not when it started, and where they were is kept for the GM.
//
// `escortOfId` is the charge an escort stepped in for (§6a), kept on their row so the desk can say so.
// `standingHere` is for somebody the fight found where it is happening (an escort beside their charge when an
// ambush catches them): they came no distance, whatever the start-of-fight map said.
function intervene(
  db,
  { character, combatId, side, turn, line = "You join the fight.", escortOfId = null, standingHere = false, now = new Date() },
) {
  return attempt(async () => {
    if (side !== "ATTACKER" && side !== "DEFENDER") refuse("Pick a side.");
    const row = await db.character.findUnique({ where: { id: character.id }, select: COMBAT_SELECT });
    if (!row || row.status !== "ALIVE") refuse("You can't do that now.");
    const stuck = blockerFor(row.tags, ACT);
    if (stuck) refuse(`You can't fight — you're ${stuck.name}.`);
    const why = await combatBlock(db, { character: row, turn, locationId: row.locationId, now });
    if (why) refuse(why);
    const combat = await db.combat.findUnique({
      where: { id: combatId ?? "" },
      select: { id: true, turnId: true, locationId: true, endedAt: true, distances: true },
    });
    if (!combat || combat.endedAt || combat.turnId !== turn.id) refuse("That fight is over.");
    if (combat.locationId !== row.locationId) refuse("That fight isn't here.");
    // One row per person per fight (the unique on combatId+characterId), so somebody coming back into a fight
    // they were once part of takes their old row over as their new place in it:
    // - turned an invitation to THIS fight down: may not join its attackers after all, but may join its defenders
    //   (Bascinet, 2026-09-27);
    // - left it (taken away by a GM, a rite, a Relocate to) and come back: may join either side again (Bascinet,
    //   2026-10-03), with the same gates and the same distance rule as anybody else.
    // "Still in it" is the one-fight claim itself, `activeTurnId`, not the status: an invitee waiting to answer
    // holds it, and a row whose holder is out of the fight (declined, left, or put back on the record by the
    // 20261216000100 repair) does not.
    const earlier = await db.combatParticipant.findFirst({
      where: { combatId: combat.id, characterId: row.id },
      select: { id: true, status: true, activeTurnId: true },
    });
    if (earlier?.activeTurnId) refuse(ALREADY_FIGHTING);
    if (earlier?.status === "DECLINED" && side === "ATTACKER") refuse(DECLINED_ATTACKERS);
    const { hops, fromLocationId } = standingHere ? { hops: 0, fromLocationId: null } : distanceOf(combat, row.id);
    if (hops > MAX_INTERVENE_DISTANCE) refuse(TOO_FAR_TO_INTERVENE);
    const from = fromLocationId
      ? await db.location.findUnique({ where: { id: fromLocationId }, select: { id: true, name: true } })
      : null;
    const data = {
      ...participantData(row, { side, role: "INTERVENER", status: "JOINED", turnId: turn.id, distance: hops, from, now }),
      escortOfId: escortOfId ?? null,
    };

    let reopened = false;
    try {
      await inTransaction(db, async (tx) => {
        await lockCombat(tx, combat.id);
        const fresh = await tx.combat.findUnique({ where: { id: combat.id }, select: { endedAt: true } });
        if (fresh?.endedAt) refuse("That fight is over.");
        let count = 0;
        if (earlier) {
          // Whatever the old row said about how they were in it before goes: this is a new place in the fight.
          ({ count } = await tx.combatParticipant.updateMany({
            where: { id: earlier.id, activeTurnId: null },
            data: {
              ...data,
              cameBackFrom: earlier.status === "DECLINED" ? "DECLINED" : "LEFT",
              description: null,
              describedAt: null,
              callOffAt: null,
              leftAt: null,
              leftReason: null,
              compelled: false,
            },
          }));
        } else {
          ({ count } = await tx.combatParticipant.createMany({ data: [{ ...data, combatId: combat.id }], skipDuplicates: true }));
        }
        if (count !== 1) refuse(ALREADY_FIGHTING);
        await settleHold(tx, row.id, turn, now);
        // The other side may have had nobody to be held BY until now.
        for (const other of await tx.combatParticipant.findMany({
          where: { combatId: combat.id, activeTurnId: turn.id, characterId: { not: row.id } },
          select: { characterId: true },
        })) {
          await settleHold(tx, other.characterId, turn, now);
        }
        reopened = await reopenIfSolved(tx, combat.id, now);
      });
    } catch (err) {
      // The one-fight claim on the update path: pulled into another fight since the gate was asked. The unique
      // violation has already aborted (and so rolled back) the transaction; it is caught out here, never inside
      // it, where Postgres would refuse every statement after it (schema.prisma, CombatParticipant.activeTurnId).
      if (err?.code === "P2002") refuse(ALREADY_FIGHTING);
      throw err;
    }
    await stopPerformances(db, [row.id], "attack").catch(() => {});

    const mine = await db.combatParticipant.findFirst({
      where: { combatId: combat.id, characterId: row.id },
      select: { id: true, side: true, alert: true },
    });
    const dms = [];
    for (const other of await liveParticipants(db, combat.id, turn.id, { not: row.id })) {
      const name = await seenBy(db, other.character.id, row);
      dms.push(notice(other.character, other.side === side ? `${cap(name)} joins the fight on your side.` : `${cap(name)} joins the fight against you.`));
    }
    dms.push(fightDm(row, mine, [line], { sfx: SFX.BLADE_DRAWN }));
    return { ok: true, line, reopened, participantId: mine?.id ?? null, dms: dms.filter(Boolean), speak: [] };
  });
}

// ─── Escorts ────────────────────────────────────────────────────────────────

// Somebody escorting a person who is attacked steps in on their side (ATTACK.md §6a; Bascinet, 2026-09-30).
// It is an intervention like any other, through intervene() and every gate it asks — combat mode, the lock,
// ACT, one fight at a time, the distance rule — so an escort who could not have pressed Join the defenders
// is simply left out, and says nothing. Only the DEFENDERS pull their escorts in: a charge who attacks, or who
// was asked along, is not being attacked.
//
// Two ways in. `escortsStepIn` is the fight's own: everybody escorting one of its defenders who is standing
// here when it starts (or when an ambush adds somebody). `escortsArrive` is the escort's: they have just walked
// in (following, or on their own) and find their charge defending here. Both return { dms }.
async function escortsStepIn(db, { combatId, turn, now = new Date() }) {
  const out = { dms: [] };
  if (!combatId || !turn?.id || typeof db.character?.findMany !== "function") return out;
  const combat = await db.combat.findUnique({ where: { id: combatId }, select: { locationId: true, endedAt: true } });
  if (!combat || combat.endedAt) return out;
  const defenders = await db.combatParticipant.findMany({
    where: { combatId, activeTurnId: turn.id, side: "DEFENDER", status: "JOINED" },
    select: { characterId: true },
  });
  const inFight = await db.combatParticipant.findMany({
    where: { combatId, activeTurnId: turn.id },
    select: { characterId: true },
  });
  const guards = await guardsOf(db, defenders.map((d) => d.characterId), combat.locationId, {
    not: inFight.map((p) => p.characterId),
  });
  // Standing right there with their charge, so no distance — whatever the map taken when the fight started said
  // (an ambush's later catch can bring an escort who was far off when it first sprang).
  for (const guard of guards) {
    const step = await stepIn(db, { guardId: guard.id, chargeId: guard.guardingId, combatId, turn, now, standingHere: true });
    out.dms.push(...step);
  }
  return out;
}

async function escortsArrive(db, { characterIds, locationId, turn, now = new Date() }) {
  const out = { dms: [] };
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0 || !locationId || !turn?.id) return out;
  const guards = await db.character.findMany({
    where: { id: { in: ids }, status: "ALIVE", locationId, guardingId: { not: null } },
    select: { id: true, guardingId: true },
  });
  for (const guard of guards) {
    const charge = await db.combatParticipant.findFirst({
      where: {
        characterId: guard.guardingId,
        activeTurnId: turn.id,
        side: "DEFENDER",
        status: "JOINED",
        combat: { locationId, endedAt: null },
      },
      select: { combatId: true },
    });
    if (!charge) continue;
    out.dms.push(...(await stepIn(db, { guardId: guard.id, chargeId: guard.guardingId, combatId: charge.combatId, turn, now })));
  }
  return out;
}

// One escort into one fight, on the defending side. A refusal is swallowed: an escort who can't fight right
// now (bound, withdrawing, the turn locked, already in another fight, too far when it started) just isn't in
// it. One who does step in is written down like anybody pressing Join — the charge on their row for the desk,
// and the `request_attack_intervened` audit row the verb writes for a press (ATTACK.md §13).
async function stepIn(db, { guardId, chargeId, combatId, turn, now, standingHere = false }) {
  try {
    const name = await seenById(db, guardId, chargeId);
    const joined = await intervene(db, {
      character: { id: guardId },
      combatId,
      side: "DEFENDER",
      turn,
      line: GUARD_LINES.STEP_IN(name),
      escortOfId: chargeId,
      standingHere,
      now,
    });
    if (!joined.ok) return [];
    if (typeof db.auditLog?.create === "function") {
      // Required here, not at the top: auditLog.js reaches the archive modules, which this file must not load
      // on every require (the dm.js convention in the header).
      const { logAudit } = require("./auditLog");
      const guard = await db.character.findUnique({ where: { id: guardId }, select: { discordUserId: true } });
      await logAudit(db, {
        actorDiscordUserId: guard?.discordUserId ?? "system",
        actionType: "request_attack_intervened",
        targetCharacterId: guardId,
        turnId: turn.id,
        details: { combatId, side: "DEFENDER", escortOf: chargeId, ...(joined.reopened ? { reopened: true } : {}) },
      }).catch((err) => console.error("Escort: audit row failed:", err.message ?? err));
    }
    return joined.dms;
  } catch (err) {
    console.error(`Combat: escort ${guardId} stepping in failed:`, err.message ?? err);
    return [];
  }
}

// ─── Writing, calling off ───────────────────────────────────────────────────

// What they do in the fight. Alert participants only (the doc: those caught by surprise "will not be
// able to customise their combat action"), and only until the Move cutoff.
function describe(db, { participantId, characterId, text, turn, now = new Date() }) {
  return attempt(async () => {
    if (!turn) refuse("No turn is open.");
    const gate = await movesOpen(db, { turn });
    if (!gate.ok) refuse(gate.reason === "LOCKED" ? DESCRIBE_LOCKED : gate.message);
    const clean = String(text ?? "").trim();
    if (!clean) refuse("Write something first.");
    if (clean.length > DESCRIPTION_LIMIT) refuse(`That's too long — keep it under ${DESCRIPTION_LIMIT} characters.`);
    const p = await db.combatParticipant.findUnique({
      where: { id: participantId ?? "" },
      select: { id: true, characterId: true, status: true, alert: true, activeTurnId: true },
    });
    if (!p || p.characterId !== characterId) refuse("That isn't yours to write.");
    if (!p.activeTurnId || p.activeTurnId !== turn.id) refuse("That fight is over.");
    if (p.status !== "JOINED") refuse("Join the fight first.");
    if (!p.alert) refuse(SURPRISED);
    await db.combatParticipant.update({ where: { id: p.id }, data: { description: clean, describedAt: now } });
    return { ok: true, line: "Your attack is written. You can change it until Moves lock.", dms: [], speak: [] };
  });
}

// Everybody fighting on the attacking side has to press it (the doc). Until the last of them does,
// nobody leaves. When they have: the fight ends, the attackers stay put thirty minutes in case the
// defenders answer, the defenders go free, and everybody is told.
function callOff(db, { participantId, characterId, turn, now = new Date() }) {
  return attempt(async () => {
    if (!turn) refuse("No turn is open.");
    const gate = await movesOpen(db, { turn });
    if (!gate.ok) refuse(gate.reason === "LOCKED" ? CALL_OFF_LOCKED : gate.message);
    const combatId = (await db.combatParticipant.findUnique({ where: { id: participantId ?? "" }, select: { combatId: true } }))
      ?.combatId;
    if (!combatId) refuse("That fight is over.");

    const result = await inTransaction(db, async (tx) => {
      await lockCombat(tx, combatId);
      const p = await tx.combatParticipant.findUnique({
        where: { id: participantId },
        select: { id: true, characterId: true, side: true, status: true, activeTurnId: true, callOffAt: true, compelled: true },
      });
      if (!p || p.characterId !== characterId) refuse("That isn't yours to call off.");
      if (!p.activeTurnId) refuse("That fight is over.");
      if (p.side !== "ATTACKER" || p.status !== "JOINED") refuse("Only the attackers can call a fight off.");
      if (p.compelled) refuse(COMPELLED_NO_CALL_OFF);
      const already = Boolean(p.callOffAt);
      if (!already) await tx.combatParticipant.update({ where: { id: p.id }, data: { callOffAt: now } });
      const waiting = await tx.combatParticipant.count({
        where: { combatId, activeTurnId: turn.id, side: "ATTACKER", status: "JOINED", callOffAt: null },
      });
      if (waiting > 0) return { ended: false, waiting, already };
      const touched = await endCombatTx(tx, combatId, { reason: "CALLED_OFF", turn, now });
      return { ended: true, touched };
    });

    const dms = [];
    if (!result.ended) {
      // Told once: pressing it again (a second Discord button, the web after Discord) changes nothing, so it
      // says nothing new to the rest of their side.
      if (!result.already) {
        const me = await db.character.findUnique({ where: { id: characterId }, select: IDENTITY_SELECT });
        for (const other of await liveParticipants(db, combatId, turn.id, { not: characterId })) {
          if (other.side !== "ATTACKER" || other.status !== "JOINED") continue;
          dms.push(notice(other.character, `${cap(await seenBy(db, other.character.id, me))} wants to call off the fight.`));
        }
      }
      const more = result.waiting === 1 ? "1 more person" : `${result.waiting} more people`;
      return { ok: true, ended: false, line: `You want to call it off. Waiting on ${more} on your side.`, dms: dms.filter(Boolean), speak: [] };
    }
    dms.push(...calledOffDms(result.touched, { not: characterId }));
    const mine = result.touched.find((t) => t.characterId === characterId);
    return {
      ok: true,
      ended: true,
      line: endedLine(mine ?? {}, CALLED_OFF_ATTACKER),
      dms: dms.filter(Boolean),
      speak: [],
    };
  });
}

const CALLED_OFF_ATTACKER = "The attack has been called off. You can leave in 30 minutes.";
const CALLED_OFF_OTHERS = "The fight is called off. You can move again.";

// What everybody a called-off fight let go of is told: the attackers that they wait thirty minutes, everybody
// else that they are free. `not` is the one who pressed last, who reads their own line as the reply.
function calledOffDms(touched, { not = null } = {}) {
  return touched
    .filter((t) => t.characterId !== not)
    .map((t) => notice(t.character, endedLine(t, t.side === "ATTACKER" && t.status === "JOINED" ? CALLED_OFF_ATTACKER : CALLED_OFF_OTHERS)))
    .filter(Boolean);
}

// Ends a fight inside a transaction the caller holds (and has locked). Everybody still in it is let go
// of the fight; an invitation nobody answered becomes a decline. Holds follow the reason: a call-off
// leaves the attackers WITHDRAWING for thirty minutes and frees everybody else; any other end frees
// everybody. Returns who was in it at the end, with faces, for the caller's DMs.
async function endCombatTx(tx, combatId, { reason, turn, now = new Date() }) {
  const done = await tx.combat.updateMany({ where: { id: combatId, endedAt: null }, data: { endedAt: now, endReason: reason } });
  if (done.count === 0) return [];
  const touched = await tx.combatParticipant.findMany({
    where: { combatId, activeTurnId: { not: null } },
    select: { id: true, characterId: true, side: true, status: true, character: { select: IDENTITY_SELECT } },
  });
  // An ambush's fight ending ends the ambush too (Bascinet, 2026-09-27): its owner is told, and sets it again
  // if they still want to lie in wait. Without this the next arrival sprang a fresh fight, straight past the
  // gates a new attack asks.
  const ended = await cancelAmbushes(tx, [combatId]);
  for (const t of touched) t.ambushEnded = ended.has(t.characterId);
  await tx.combatParticipant.updateMany({
    where: { combatId, status: "INVITED" },
    data: { status: "DECLINED", answeredAt: now },
  });
  await tx.combatParticipant.updateMany({ where: { combatId, activeTurnId: { not: null } }, data: { activeTurnId: null } });
  for (const t of touched) {
    if (reason === "CALLED_OFF" && t.side === "ATTACKER" && t.status === "JOINED") {
      await tx.character.updateMany({
        where: { id: t.characterId },
        data: { heldUntil: new Date(now.getTime() + WITHDRAW_HOLD_MS), heldById: null, heldReason: HELD_REASON.WITHDRAWING },
      });
    } else {
      await settleHold(tx, t.characterId, turn, now);
    }
  }
  return touched;
}

// Cancels the Ambush watch behind each of these fights that sprang from one. Returns the owners whose watch
// was deleted. A no-op on a client with no watches — the fakes.
async function cancelAmbushes(db, combatIds) {
  const cancelled = new Set();
  if (typeof db.interceptWatch?.deleteMany !== "function" || combatIds.length === 0) return cancelled;
  const fights = await db.combat.findMany({
    where: { id: { in: combatIds }, fromAmbush: true, ambushOwnerId: { not: null } },
    select: { ambushOwnerId: true, locationId: true },
  });
  for (const f of fights) {
    const { count } = await db.interceptWatch.deleteMany({
      where: { characterId: f.ambushOwnerId, mode: "AMBUSH", locationId: f.locationId },
    });
    if (count) cancelled.add(f.ambushOwnerId);
  }
  return cancelled;
}

// A line for somebody a fight just let go, with the ambush's end added for its owner.
function endedLine(t, line) {
  return t.ambushEnded ? `${line}\n${AMBUSH_ENDED}` : line;
}

// A GM ends a fight from the Combat lens. Everybody goes free at once — no thirty minutes (Bascinet,
// 2026-09-27) — and is told.
async function endCombatAsGm(db, { combatId, turn, now = new Date() }) {
  return attempt(async () => {
    const touched = await inTransaction(db, async (tx) => {
      await lockCombat(tx, combatId);
      return endCombatTx(tx, combatId, { reason: "GM", turn, now });
    });
    if (touched.length === 0) refuse("That fight is already over.");
    const dms = touched.map((t) => notice(t.character, endedLine(t, "The fight is over. You can move again."))).filter(Boolean);
    return { ok: true, dms, speak: [] };
  });
}

// ─── Leaving, and the push ──────────────────────────────────────────────────

// Somebody left the fight without choosing to: relocated (a GM's teleport, a Bulk Move, a staged Relocate
// to, a rite) or dead. They are out of it; the fight stays on the desk for the GM. If that leaves either side
// with nobody fighting on it, the fight is over and everyone else goes free (Bascinet, 2026-09-27). If it
// leaves the attackers with only people who have already pressed Call off, the call-off they were waiting on
// is complete, and it ends the way a call-off ends. Returns DMs for the people freed; the callers send them
// (sendCombatDms).
//
// `unlessAt` is where they have just arrived. Every relocation runs this (locationMove.js#applyArrivalFacts),
// and that includes a WALK: somebody who walked into an ambush, or an escort who walked in behind their charge,
// is put into the fight here by performLocationMove before the arrival facts run. A fight at the place they
// arrived is the one they came into, never one they are leaving — without this they were thrown straight back
// out of it, and the GM's desk showed them as having left.
async function leaveCombatsFor(db, characterId, reason = "moved", { unlessAt = null } = {}) {
  if (!characterId) return { left: 0, dms: [] };
  const turn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, startedAt: true, endsAt: true, turnLengthHours: true } });
  if (!turn) return { left: 0, dms: [] };
  const mine = await db.combatParticipant.findFirst({
    where: { characterId, activeTurnId: turn.id },
    select: { id: true, combatId: true, combat: { select: { locationId: true } } },
  });
  if (!mine) return { left: 0, dms: [] };
  if (unlessAt && mine.combat?.locationId === unlessAt) return { left: 0, dms: [] };
  const now = new Date();
  const out = await inTransaction(db, async (tx) => {
    await lockCombat(tx, mine.combatId);
    await tx.combatParticipant.updateMany({
      where: { id: mine.id, activeTurnId: { not: null } },
      data: { status: "LEFT", activeTurnId: null, leftAt: now, leftReason: reason },
    });
    await settleHold(tx, characterId, turn, now);
    const still = await tx.combatParticipant.findMany({
      where: { combatId: mine.combatId, activeTurnId: turn.id },
      select: { characterId: true, side: true, status: true, callOffAt: true },
    });
    const joined = still.filter((p) => p.status === "JOINED");
    const sideEmpty = !joined.some((j) => j.side === "ATTACKER") || !joined.some((j) => j.side === "DEFENDER");
    if (sideEmpty) return { reason: "SIDE_EMPTY", touched: await endCombatTx(tx, mine.combatId, { reason: "SIDE_EMPTY", turn, now }) };
    const attackers = joined.filter((j) => j.side === "ATTACKER");
    if (attackers.length > 0 && attackers.every((a) => a.callOffAt)) {
      return { reason: "CALLED_OFF", touched: await endCombatTx(tx, mine.combatId, { reason: "CALLED_OFF", turn, now }) };
    }
    // Still going: re-point anybody whose hold named the one who left — an invitee waiting to answer too.
    for (const p of still) await settleHold(tx, p.characterId, turn, now);
    return { reason: null, touched: [] };
  });
  const dms =
    out.reason === "CALLED_OFF"
      ? calledOffDms(out.touched)
      : out.touched.map((t) => notice(t.character, endedLine(t, "The fight is over. You can move again."))).filter(Boolean);
  return { left: 1, dms };
}

// Best-effort send for a caller with no DM plumbing of its own (the move and death hooks). Needs a
// Discord token; without one the DMs are simply not sent, the database facts stand either way.
async function sendCombatDms(db, dms) {
  if (!process.env.DISCORD_TOKEN || !Array.isArray(dms) || dms.length === 0) return;
  const { sendDm } = require("./dm");
  for (const dm of dms) {
    const { discordUserId, content, ...opts } = dm;
    await sendDm(db, discordUserId, content, opts).catch((err) =>
      console.error(`Combat: DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }
}

// The push closes every fight left on the turn it ends. Nobody is told the fight is over — the push itself
// is the news, and the holds lapse on the turn's own clock — except an ambush's owner, whose ambush ends
// with it (`notices`, sent with the push's other DMs). An invitation still unanswered counts as declined
// (Bascinet, 2026-09-27).
async function closeCombatsAtPush(db, turn, now = new Date()) {
  if (!turn?.id) return { closed: 0, notices: [] };
  const open = await db.combat.findMany({ where: { turnId: turn.id, endedAt: null }, select: { id: true } });
  if (open.length === 0) return { closed: 0, notices: [] };
  const ids = open.map((c) => c.id);
  const owners = await cancelAmbushes(db, ids);
  const ownerRows = owners.size
    ? await db.character.findMany({ where: { id: { in: [...owners] } }, select: { discordUserId: true } })
    : [];
  const notices = ownerRows.filter((r) => r.discordUserId).map((r) => ({ discordUserId: r.discordUserId, content: AMBUSH_ENDED }));
  await db.combatParticipant.updateMany({ where: { combatId: { in: ids }, status: "INVITED" }, data: { status: "DECLINED", answeredAt: now } });
  await db.combatParticipant.updateMany({ where: { combatId: { in: ids }, activeTurnId: { not: null } }, data: { activeTurnId: null } });
  await db.combat.updateMany({ where: { id: { in: ids }, endedAt: null }, data: { endedAt: now, endReason: "TURN_ENDED" } });
  return { closed: ids.length, notices };
}

// ─── Ambush ─────────────────────────────────────────────────────────────────

// An Ambush watch caught somebody (intercept.js#fireWatches). The first catch of the turn opens a fight
// with the watch's owner as its initiator and the arrival as its target, inviting the collaborators the
// watch named who are still standing here. Every later catch is added to that same fight as a target,
// snapshotted as they walk in, with no distance rule (the doc). Ungated: the watch was set when the
// gates were asked, and the lock already stops anybody arriving.
async function springAmbush(db, { watch, arrivalId, turn, locationId, now = new Date() }) {
  const ownerId = watch.characterId;
  const live = await db.combat.findFirst({
    where: { turnId: turn.id, fromAmbush: true, ambushOwnerId: ownerId, locationId, endedAt: null },
    select: { id: true, openingMessage: true, fromAmbush: true },
  });
  if (!live) {
    const collaborators = await db.character.findMany({
      where: { id: { in: (watch.collaboratorIds ?? []).filter((id) => id !== ownerId && id !== arrivalId) }, status: "ALIVE", locationId },
      select: { id: true },
    });
    const busy = new Set(
      (
        await db.combatParticipant.findMany({
          where: { characterId: { in: collaborators.map((c) => c.id) }, activeTurnId: turn.id },
          select: { characterId: true },
        })
      ).map((b) => b.characterId),
    );
    return startCombat(db, {
      initiatorId: ownerId,
      targetIds: [arrivalId],
      collaboratorIds: collaborators.map((c) => c.id).filter((id) => !busy.has(id)),
      turn,
      locationId,
      fromAmbush: true,
      openingMessage: watch.message || null,
      now,
    });
  }

  return attempt(async () => {
    const row = await db.character.findUnique({ where: { id: arrivalId }, select: COMBAT_SELECT });
    if (!row || row.status !== "ALIVE" || row.locationId !== locationId) refuse("They're gone.");
    const data = participantData(row, { side: "DEFENDER", role: "TARGET", status: "JOINED", turnId: turn.id, now });
    await inTransaction(db, async (tx) => {
      await lockCombat(tx, live.id);
      const fresh = await tx.combat.findUnique({ where: { id: live.id }, select: { endedAt: true } });
      if (fresh?.endedAt) refuse("That fight is over.");
      const { count } = await tx.combatParticipant.createMany({ data: [{ ...data, combatId: live.id }], skipDuplicates: true });
      if (count !== 1) refuse(ALREADY_FIGHTING);
      await settleHold(tx, row.id, turn, now);
      // A new target in a fight a GM already ruled on: back to the desk with it (reopenIfSolved).
      await reopenIfSolved(tx, live.id, now);
    });
    await stopPerformances(db, [row.id], "attack").catch(() => {});
    const mine = await db.combatParticipant.findFirst({
      where: { combatId: live.id, characterId: row.id },
      select: { id: true, side: true, alert: true },
    });
    const dms = [];
    const lines = ["You were stopped on the road. It's an ambush! You can't move until the fight is over."];
    if (live.openingMessage) lines.push(`» ${live.openingMessage}`);
    dms.push(fightDm(row, mine, lines, { sfx: SFX.HELD }));
    for (const other of await liveParticipants(db, live.id, turn.id, { not: row.id })) {
      const name = await seenBy(db, other.character.id, row);
      dms.push(
        notice(other.character, other.side === "ATTACKER" ? `${cap(name)} walked into your ambush.` : `${cap(name)} walked into the ambush too.`),
      );
    }
    dms.push(...(await escortsStepIn(db, { combatId: live.id, turn, now })).dms);
    return { ok: true, dms: dms.filter(Boolean), speak: [] };
  });
}

// ─── What a player reads ────────────────────────────────────────────────────

// The viewer's own fight, as they may see it: who is on which side (by the face they know them by),
// their own standing in it, and what they can do. NEVER the rolls — they are the GM's.
async function combatViewFor(db, viewerId, turn) {
  if (!viewerId || !turn?.id) return null;
  const mine = await db.combatParticipant.findFirst({
    where: { characterId: viewerId, activeTurnId: turn.id },
    select: {
      id: true,
      side: true,
      role: true,
      status: true,
      alert: true,
      description: true,
      callOffAt: true,
      compelled: true,
      combat: {
        select: {
          id: true,
          locationName: true,
          startedAt: true,
          fromAmbush: true,
          participants: {
            where: { activeTurnId: turn.id },
            select: PUBLIC_PARTICIPANT_SELECT,
            orderBy: { joinedAt: "asc" },
          },
        },
      },
    },
  });
  if (!mine) return null;
  const gate = await movesOpen(db, { turn });
  const locked = !gate.ok;
  const everyone = mine.combat.participants;
  const names = await seenByMany(db, viewerId, everyone.map((p) => p.character));
  // No keys and no ids: nothing on this card acts on a person — every button names the viewer's own
  // participant row — so the browser is handed names and nothing else.
  const person = (p, i) => ({
    name: names[i],
    role: p.role,
    status: p.status,
    me: p.characterId === viewerId,
  });
  const listed = everyone.map((p, i) => ({ p, view: person(p, i) }));
  const waitingOn = everyone.filter((p) => p.side === "ATTACKER" && p.status === "JOINED" && !p.callOffAt).length;
  // Who asked you along, for an invitation: the fight's initiator (an ambush's owner), by the face you know them
  // by — the same name their invitation DM used (startDms).
  const initiatorAt = everyone.findIndex((p) => p.role === "INITIATOR");
  return {
    combatId: mine.combat.id,
    participantId: mine.id,
    locationName: mine.combat.locationName,
    startedAt: mine.combat.startedAt,
    fromAmbush: mine.combat.fromAmbush,
    side: mine.side,
    role: mine.role,
    status: mine.status,
    alert: mine.alert,
    inviter: mine.status === "INVITED" && initiatorAt >= 0 ? names[initiatorAt] : null,
    description: mine.description ?? "",
    calledOff: Boolean(mine.callOffAt),
    locked,
    canAnswer: mine.status === "INVITED" && !locked,
    canDescribe: mine.alert && mine.status === "JOINED" && !locked,
    canCallOff: mine.side === "ATTACKER" && mine.status === "JOINED" && !mine.callOffAt && !mine.compelled && !locked,
    // Only ever the viewer's OWN compulsion, and as the words to show rather than a flag: nobody else's
    // view says it, and no client bundle carries the sentence (compulsionLines.js).
    prompt: mine.compelled ? { label: COMPELLED_FIELD_LABEL, line: COMPELLED_WRITE_PROMPT, noCallOff: COMPELLED_NO_CALL_OFF } : null,
    waitingOn,
    attackers: listed.filter(({ p }) => p.side === "ATTACKER").map(({ view }) => view),
    defenders: listed.filter(({ p }) => p.side === "DEFENDER").map(({ view }) => view),
  };
}

// The fights going on where the viewer stands — the choice the Attack button offers first (the doc:
// "prompts the character as to whether they wish to join one side of the combat or stage another").
async function combatsHere(db, viewer, turn) {
  if (!viewer?.locationId || !turn?.id) return [];
  const fights = await db.combat.findMany({
    where: { turnId: turn.id, locationId: viewer.locationId, endedAt: null },
    select: {
      id: true,
      startedAt: true,
      participants: {
        where: { activeTurnId: turn.id, status: "JOINED" },
        select: { side: true, character: { select: IDENTITY_SELECT } },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: { startedAt: "asc" },
  });
  const turnedDown = new Set(
    fights.length
      ? (
          await db.combatParticipant.findMany({
            where: { characterId: viewer.id, status: "DECLINED", combatId: { in: fights.map((f) => f.id) } },
            select: { combatId: true },
          })
        ).map((r) => r.combatId)
      : [],
  );
  const out = [];
  for (const fight of fights) {
    const names = await seenByMany(db, viewer.id, fight.participants.map((p) => p.character));
    out.push({
      combatId: fight.id,
      // They turned this one down: its attackers are shut to them, its defenders are not.
      declined: turnedDown.has(fight.id),
      attackers: fight.participants.map((p, i) => (p.side === "ATTACKER" ? names[i] : null)).filter(Boolean),
      defenders: fight.participants.map((p, i) => (p.side === "DEFENDER" ? names[i] : null)).filter(Boolean),
    });
  }
  return out;
}

module.exports = {
  WITHDRAW_HOLD_MS,
  DESCRIPTION_LIMIT,
  MAX_PICKS,
  COMBAT_JOIN_PREFIX,
  COMBAT_DECLINE_PREFIX,
  COMBAT_WRITE_PREFIX,
  COMBAT_DESCRIBE_PREFIX,
  COMBAT_CALL_OFF_PREFIX,
  COMBAT_SELECT,
  PUBLIC_PARTICIPANT_SELECT,
  WRITE_PROMPT,
  distanceSnapshot,
  distanceOf,
  settleHold,
  activeFightOf,
  fightingHere,
  listNames,
  startCombat,
  answerInvite,
  intervene,
  describe,
  callOff,
  endCombatAsGm,
  leaveCombatsFor,
  sendCombatDms,
  closeCombatsAtPush,
  springAmbush,
  escortsStepIn,
  escortsArrive,
  combatViewFor,
  combatsHere,
  participantData,
};
