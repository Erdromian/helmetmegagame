// What a character DID goes into the archive beside what they said: every verb,
// every Move, and what the GM and the engine did to them as a result
// (docs/systemdocs/ARCHIVE.md). The audit row is the record of all three, so an
// ACTION row is filed FROM it, by the two logAudit twins (./auditLog.js and
// web/lib/requests.js). That makes "a player action goes through logAudit" the
// whole rule, and db/test/archiveActions.test.js holds every raw
// auditLog.create in the repo to it.
//
// Written through the caller's transaction, so an action that rolls back never
// leaves a line saying it happened. An error inside a Postgres transaction
// aborts the whole of it, so everything that could make the insert fail is
// looked up first, and a row that cannot be filed is skipped rather than tried.
// Takes the client as a parameter, like every module db/index.js imports.

const { auditLine } = require("./oracleAudit");
const { currentGameId, resolveTurn } = require("./archive");

// Rows that are the GM's desk, the host's panel or the engine talking to
// itself. Never a character's act, even when the GM happens to have one.
const MACHINE_PREFIXES = [
  "gm_",
  "superadmin_",
  "staged_",
  "staging_",
  "system_tag_",
  "system:",
  "turn_",
  "lobby_",
  "game_",
  "late_party_",
  "late_join_",
  "threat_",
  "objective_",
  "admin_note_",
  "member_",
  "train_",
];

const MACHINE_TYPES = new Set([
  // Its own ArchiveKind already (CHARACTER_CREATED).
  "character_created",
  // The engine moving a character's things, not the character.
  "carry_drop_deferred",
  "carry_overflow_dropped",
  "hold_limit_dropped",
  "grant_expiry_deferred",
  "vending_hold_expired",
  "caving_auto_resolved",
  "access_revoke_incomplete",
  "ascension_cancelled",
  "charon_launched",
  "wages_paid",
  // A side effect of an act already filed: one mood row per listener of a
  // song, and the corpse smell's DM.
  "mood_soothed_play",
  "corpse_sense_ping",
  // The desk: saving a draft, reopening, a GM's proclamation.
  "decree_broadcast",
  "move_save",
  "move_unsolve",
  "caving_roll_saved",
  "caving_loot_undone",
  "combat_saved",
  "combat_solved",
  "combat_unsolved",
]);

// What the GM and the engine did TO a character as the result of something they
// did. Filed on the character it happened to, not on whoever pressed the button.
const OUTCOME_TYPES = new Set([
  "move_solve",
  "move_rejected",
  "caving_roll_resolved",
  "caving_loot_granted",
  "craft_yield_arrived",
  "gm_staged_tag_applied",
  // An above-skill heal's roll, read at the push: filed on the patient.
  "heal_gambit_resolved",
]);

// "actor" — file it on the acting player's character. "target" — on the
// character it happened to. null — not a character's act at all. Anything
// unlisted is "actor", so a new verb is archived without anybody remembering
// to add it here.
function archiveRoleOf(actionType) {
  const type = String(actionType ?? "");
  if (!type) return null;
  if (OUTCOME_TYPES.has(type)) return "target";
  if (MACHINE_TYPES.has(type)) return null;
  if (MACHINE_PREFIXES.some((p) => type.startsWith(p))) return null;
  return "actor";
}

const PERSON = { id: true, name: true, discordUserId: true, locationId: true };

// The acting player's character: the living one, else the newest (an act that
// killed its own actor still belongs to them). A GM or the engine has none.
async function actingCharacter(db, discordUserId) {
  if (!discordUserId || discordUserId.startsWith("system")) return null;
  const alive = await db.character.findFirst({ where: { discordUserId, status: "ALIVE" }, select: PERSON });
  if (alive) return alive;
  return db.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" }, select: PERSON });
}

// Where it happened, as the names the transcript groups a scene by. The audit
// row's own place first; the character's Location when it recorded none.
async function placeNames(db, { roomId, locationId }) {
  if (roomId) {
    const room = await db.room.findUnique({
      where: { id: roomId },
      select: { name: true, location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } } },
    });
    if (room) {
      return {
        zoneId: room.location?.zoneId ?? null,
        zoneName: room.location?.zone?.name ?? null,
        locationName: room.location?.name ?? null,
        threadName: room.name,
      };
    }
  }
  if (locationId) {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, zoneId: true, zone: { select: { name: true } } },
    });
    if (location) {
      return { zoneId: location.zoneId, zoneName: location.zone?.name ?? null, locationName: location.name, threadName: null };
    }
  }
  return { zoneId: null, zoneName: null, locationName: null, threadName: null };
}

// The words of the Move a move_* row is about. Its audit row keeps only the
// Move's id (a withdrawn or rejected one keeps its words, the Move being gone),
// and a Move is the one act whose point is what the player wrote.
async function moveTextOf(db, actionType, details) {
  if (!String(actionType).startsWith("move_")) return null;
  const said = details.to ?? details.description;
  if (typeof said === "string" && said.trim()) return said.trim();
  if (!details.actionId) return null;
  const move = await db.action.findUnique({ where: { id: String(details.actionId) }, select: { description: true } });
  return move?.description?.trim() || null;
}

async function turnOf(db, turnId) {
  if (turnId) {
    const turn = await db.turn.findUnique({ where: { id: turnId }, select: { number: true, dayNumber: true } });
    if (turn) return turn;
  }
  return resolveTurn(db);
}

// One audit row -> at most one ACTION row. Returns the row, or null when the
// audit row is not a character's act or there is no game to file it in.
async function fileAuditInArchive(db, audit) {
  if (!audit?.actionType) return null;
  const role = archiveRoleOf(audit.actionType);
  if (!role) return null;

  const gameId = await currentGameId(db);
  if (!gameId) return null;

  let character;
  let target = null;
  if (role === "target") {
    if (!audit.targetCharacterId) return null;
    character = await db.character.findUnique({ where: { id: audit.targetCharacterId }, select: PERSON });
  } else {
    character = await actingCharacter(db, audit.actorDiscordUserId);
    if (character && audit.targetCharacterId && audit.targetCharacterId !== character.id) {
      target = await db.character.findUnique({ where: { id: audit.targetCharacterId }, select: PERSON });
    }
  }
  if (!character) return null;

  // Who pressed the button, in words the transcript can print. For an outcome
  // that is the GM or the game, never a Discord id; for anything else it is the
  // character.
  let actorName = character.name;
  if (role === "target" && audit.actorDiscordUserId !== character.discordUserId) {
    actorName = String(audit.actorDiscordUserId ?? "").startsWith("system") ? "The game" : "A GM";
  }

  const [turn, place] = await Promise.all([
    turnOf(db, audit.turnId),
    placeNames(db, {
      roomId: audit.roomId ?? null,
      locationId: audit.locationId ?? character.locationId ?? null,
    }),
  ]);

  const details = audit.details && typeof audit.details === "object" ? audit.details : {};
  const moveText = await moveTextOf(db, audit.actionType, details);
  const line = auditLine(
    { actionType: audit.actionType, actorDiscordUserId: audit.actorDiscordUserId, targetCharacterId: target?.id ?? (role === "target" ? character.id : null), details },
    {
      byDiscordUserId: new Map([[audit.actorDiscordUserId, actorName]]),
      byCharacterId: new Map(target ? [[target.id, target.name]] : role === "target" ? [[character.id, character.name]] : []),
    },
  );
  const content = moveText ? `${line} | "${moveText}"` : line;

  return db.archiveEntry.create({
    data: {
      kind: "ACTION",
      gameId,
      turnNumber: turn?.number ?? null,
      dayNumber: turn?.dayNumber ?? null,
      sentAt: audit.createdAt ?? new Date(),
      zoneId: place.zoneId,
      zoneName: place.zoneName,
      locationName: place.locationName,
      threadName: place.threadName,
      characterId: character.id,
      characterName: character.name,
      content,
      // Never a placeKey: every feed selects by it, and an action is not a line
      // anybody in the room heard.
      placeKey: null,
      source: "SYSTEM",
      action: {
        type: audit.actionType,
        details,
        actorName,
        targetId: target?.id ?? (role === "target" ? character.id : null),
        targetName: target?.name ?? (role === "target" ? character.name : null),
        locationName: place.locationName,
        ...(moveText ? { moveText } : {}),
      },
    },
  });
}

module.exports = { archiveRoleOf, fileAuditInArchive, MACHINE_PREFIXES, MACHINE_TYPES, OUTCOME_TYPES };
