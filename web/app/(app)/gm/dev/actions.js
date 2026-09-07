"use server";

import { revalidatePath } from "next/cache";
import { isUnaffiliated, UNAFFILIATED_SLUG } from "@lifeweb/db/lib/factionConstants";
import { after } from "next/server";
import { parseConfigForm } from "@lifeweb/db/lib/gameConfigFields";
import { getGameConfig, getGameState, GAME_STATE_CREATE } from "@lifeweb/db/lib/gameState";
import { buildEpilogue } from "@lifeweb/db/lib/epilogue";
import { forgetGameId } from "@lifeweb/db/lib/archive";
import { forgetGameFloor } from "@lifeweb/db/lib/feedWipe";
import {
  prisma,
  advanceTurn as advanceTurnInDb,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncSpecialChannels,
  syncTagsFromYaml,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
} from "@lifeweb/db";
import { runChannelDoctor } from "@lifeweb/db/lib/channelDoctor";
import { postTurnsAnnouncement } from "@lifeweb/db/lib/turnAnnouncement";
import { pickTurnBanner, nextTurnBanner } from "@lifeweb/db/lib/turnBanner";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  deleteCharacterRole,
  revokeAccessForCharacters,
  updateGuildNickname,
  listGuildMembers,
  removeCursedRole,
  setTurnPingRole,
  sendDm,
} from "@/lib/discordGuild";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { rollCavingOnArrival } from "@lifeweb/db/lib/cavingPass";
import { validateTurretTable } from "@lifeweb/db/lib/depotTurret";
import { getFactionAncestorIds } from "@/lib/factionPermissions";
import { mintLetterFor, sealWithMark } from "@lifeweb/db/lib/paperMint";
import {
  canReadLetters,
  deliveryDm,
  replyButtonRow,
  GM_LETTER_SOURCE,
} from "@lifeweb/db/lib/bird";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { afterInventoryChange } from "@/lib/afterInventoryChange";

// The same ceiling the Write dialog puts on a player's sheet — a GM letter is
// a sheet of paper like any other, and a longer one would not fit the object.
const GM_LETTER_MAX = 2000;

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

// Every knob on GameConfig, parsed and clamped by the registry
// (db/lib/gameConfigFields.js) — the same list the form was rendered from, so
// a hand-posted field the registry does not name is simply never read.
export async function updateGameConfig(formData) {
  await requireSuperadmin();

  const current = await getGameConfig(prisma);
  await prisma.gameConfig.update({
    where: { id: 1 },
    data: parseConfigForm(formData, current),
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/store");
  revalidatePath("/play");
}

// The Depot's live state and its tuning, in one flat clamped allowlist —
// the same shape updateGameConfig uses, and for the same reason: a loop over
// formData keys would let a hand-posted field write a column nobody meant to
// expose.
//
// The turret table is the one field that can be REJECTED rather than clamped.
// A table that does not sum to 1 is not a preference, it is a broken die, and
// silently normalising it would hide a GM's typo behind subtly wrong odds for
// a month. validateTurretTable throws; the action swallows it into a returned
// error so the form can say so.
export async function updateDepot(formData) {
  await requireSuperadmin();

  let turretTable;
  const raw = str(formData, "turretTable");
  if (raw) {
    try {
      turretTable = JSON.parse(raw);
    } catch {
      return { error: "The turret table is not valid JSON." };
    }
    try {
      validateTurretTable(turretTable);
    } catch (err) {
      return { error: err.message };
    }
  }

  const fuelMax = Math.max(1, intOrZero(formData, "fuelMax"));

  await prisma.depot.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      // Live state.
      accountObols: Math.max(0, intOrZero(formData, "accountObols")),
      debtObols: Math.max(0, intOrZero(formData, "debtObols")),
      // Clamped to the tank the GM is saving in the same submit, not the one
      // that was there before — otherwise raising both at once silently loses
      // the fuel.
      generatorFuel: Math.max(0, Math.min(fuelMax, intOrZero(formData, "generatorFuel"))),
      merchantFace: str(formData, "merchantFace"),
      generatorOn: formData.get("generatorOn") === "on",
      turretArmed: formData.get("turretArmed") === "on",

      // Tuning.
      fuelMax,
      fuelBurnPerTurn: Math.max(0, intOrZero(formData, "fuelBurnPerTurn")),
      coalFuel: Math.max(0, intOrZero(formData, "coalFuel")),
      saltpeterFuel: Math.max(0, intOrZero(formData, "saltpeterFuel")),
      shuttleMaxTurns: Math.max(1, intOrZero(formData, "shuttleMaxTurns")),
      shuttleCooldown: Math.max(0, intOrZero(formData, "shuttleCooldown")),
      creditCapObols: Math.max(0, intOrZero(formData, "creditCapObols")),
      // Never zero: the ⬢-to-obol conversion divides by it.
      ...(turretTable ? { turretTable } : {}),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/depot");
}

// A raw superadmin correction to the current turn's day/phase, not a
// normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireSuperadmin();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    // A phase flip has to re-pick the banner, or a dusk turn keeps riding a
    // dawn plate. Saving the form unchanged leaves the picture alone, so this
    // doubles as the GM re-roll: switch the phase and switch it back.
    const banner =
      openTurnRecord.phase === phase && openTurnRecord.banner
        ? openTurnRecord.banner
        : await nextTurnBanner(prisma, phase);
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase, banner } });
  } else {
    await prisma.turn.create({
      data: { number, phase, banner: await nextTurnBanner(prisma, phase), status: "OPEN", gameDate: new Date() },
    });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// A pending note for the *next* turn, consumed by advanceTurn().
export async function updateNextTurn(formData) {
  await requireSuperadmin();

  const note = str(formData, "note").trim() || null;

  await prisma.gameState.upsert({
    where: { id: 1 },
    create: { ...GAME_STATE_CREATE, nextTurnNote: note },
    update: { nextTurnNote: note },
  });

  revalidatePath("/gm/dev");
}

// The Lifeweb's blood, as a raw override. Per-game state, so it lives beside
// the phase on the Game section rather than among the durable knobs.
export async function updateWorldState(formData) {
  await requireSuperadmin();

  await prisma.gameState.upsert({
    where: { id: 1 },
    create: GAME_STATE_CREATE,
    update: { lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))) },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
}

// advanceTurnInDb() hands back its Discord side effects as a thunk. That
// thunk goes to after(), not the request, since the message wipe can take
// minutes and a pending server action blocks client-side navigation.
export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  try {
    const { advanced, refused, previousTurn, newTurn, runSideEffects } = await advanceTurnInDb();

    if (refused === "NOT_RUNNING") {
      return { ok: false, error: "The game isn't running, so there is no turn to end. Start it from the Game section first." };
    }

    // Lost the race to the bot's cron or a second click; turn already advanced.
    if (!advanced) {
      revalidatePath("/gm/dev");
      revalidatePath("/", "layout");
      return { ok: true };
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_turn_forced",
        details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase },
      },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      runSideEffects().catch((err) => console.error("Turn side effects failed:", err)),
    );

    return { ok: true };
  } catch (err) {
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the turn advanced.
    console.error("Force advance turn failed:", err);
    return { ok: false, error: "Could not end the turn. Check the server logs." };
  }
}

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row, recreates GameState (phase CLOSED), clears every Discord channel,
// opens Turn 1/DAWN, reposts #turns, then re-syncs every YAML master in
// dependency order. Requires typing "WIPE" — no undo.
//
// GameConfig and PlayerPreference are deliberately NOT touched: the knobs a
// GM tuned and the priorities a player set are meant to outlive the game
// (docs/systemdocs/LOBBY.md §6).
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    return { ok: false, error: 'Type "WIPE" (all caps) to confirm.' };
  }

  try {
    // Snapshotted before the deletes — the only handle left on what to
    // clean up once the DB rows are gone.
    const [characters, members, state] = await Promise.all([
      prisma.character.findMany({
        select: { discordUserId: true, discordRoleId: true, turnPingOptIn: true },
      }),
      listGuildMembers(),
      prisma.gameState.findUnique({ where: { id: 1 }, include: { game: true } }),
    ]);

    // The game that is ending keeps its record (docs/systemdocs/LOBBY.md §7):
    // a reveal if it never got one, an end stamp, and its number. The next
    // game is a fresh row the new GameState points at.
    const oldGame = state?.game ?? null;
    if (oldGame && !oldGame.epilogue) {
      const epilogue = await buildEpilogue(prisma, { game: oldGame, state: { ...state, endedAt: new Date() } }).catch((err) => {
        console.error("Epilogue snapshot failed:", err);
        return null;
      });
      await prisma.game.update({
        where: { id: oldGame.id },
        data: { endedAt: oldGame.endedAt ?? new Date(), startedAt: oldGame.startedAt ?? state.startedAt, playerCount: oldGame.playerCount ?? state.playerCount, ...(epilogue ? { epilogue } : {}) },
      });
    }
    const lastNumber = (await prisma.game.aggregate({ _max: { number: true } }))._max.number ?? 0;
    const nextGame = await prisma.game.create({ data: { number: lastNumber + 1 } });
    const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
    const cursedMemberIds = cursedRoleId ? members.filter((m) => m.roles.includes(cursedRoleId)).map((m) => m.id) : [];

    // Ordered so dependents (Request, Desire, StagedMessage/Effect — required
    // FKs to Character/Turn) go before character/turn.deleteMany, or a
    // Postgres FK violation rolls back the whole transaction.
    await prisma.$transaction([
      prisma.note.deleteMany({}),
      prisma.action.deleteMany({}),
      prisma.desire.deleteMany({}),
      prisma.birdMessage.deleteMany({}),
      prisma.characterTag.deleteMany({}),
      // Structures: same reasoning as RoomTag below — Structure cascades from
      // Location, which the wipe never deletes, so it goes explicitly.
      // StructureWork first, since it has a required FK to Structure.
      prisma.structureWork.deleteMany({}),
      prisma.structure.deleteMany({}),
      // Link state back to its born values: a gate somebody shut, a keyed
      // door somebody propped — all play state.
      // Raw SQL because column-to-column isn't expressible in updateMany.
      // No anchor reposts needed: finishGameWipe re-syncs zones afterwards
      // and anchors hash their own gate state, so they self-heal there.
      prisma.$executeRaw`UPDATE "LocationLink" SET "isOpen" = "authoredOpen", "openUntil" = NULL`,
      // Anything pinned to a noticeboard (PAPERWORK.md). Before the tag sweep
      // below, or the FK from NoticePost.tagId blocks it.
      prisma.noticePost.deleteMany({}),
      // Room stashes (CARRY.md): the rows cascade from nothing the wipe
      // deletes, so they go explicitly and the ⬢ column is zeroed.
      prisma.roomTag.deleteMany({}),
      // Runtime-minted tags: crates, headstones, written paper, sealed
      // letters. GAME state that happened to be stored in the catalog, and it
      // has to go with the game.
      //
      // This closes a real leak rather than merely serving the new feature.
      // The wipe never touched the Tag table, and db:prune-tags skips every
      // `custom` row on purpose — so a crate or a headstone was a permanent
      // orphan accumulating across every game ever run. Only corpses escaped,
      // through corpseOfCharacterId's cascade, and they still do.
      //
      // `ephemeral` and not `custom`, deliberately: a GM's homebrew from
      // /gm/dev/tags is custom too and must SURVIVE a restart. Runs after the
      // holdings above so nothing references these rows.
      prisma.tag.deleteMany({ where: { ephemeral: true } }),
      prisma.room.updateMany({ data: { resources: 0 } }),
      // Factions are live game state now (FACTIONS.md), so a restart has to
      // undo the parts players wrote. Handshakes go with the characters they
      // named; every silo is un-pointed so db:sync-roles' null-fill floor can
      // seed the authored ones again; and a faction somebody FOUNDED in the
      // last game is deleted outright rather than lingering as a leaderless
      // ghost. Founded factions carry no Role rows, so nothing cascades into
      // the creation wizard.
      prisma.factionApplication.deleteMany({}),
      prisma.faction.updateMany({ data: { siloRoomId: null } }),
      prisma.auditLog.deleteMany({}),
      // Antagonist objectives are per-game state. The epilogue snapshot above
      // ran before this transaction opened, so it has already read them.
      prisma.objective.deleteMany({}),
      // Rites in progress die with the game; the chants cascade off them.
      prisma.riteAttempt.deleteMany({}),
      prisma.character.deleteMany({}),
      prisma.playerThread.deleteMany({}),
      prisma.playerThreadInvite.deleteMany({}),
      prisma.stagedMessage.deleteMany({}),
      prisma.stagedEffect.deleteMany({}),
      prisma.turn.deleteMany({}),
      prisma.directMessage.deleteMany({}),
      // The transcript is NOT wiped: it belongs to the old Game by its gameId
      // and stays readable on /archive under that game's number.
      // The lobby is per game; the preferences behind it are not.
      prisma.lobbyEntry.deleteMany({}),
      // Delete and recreate rather than reset a list of columns: a fresh row
      // cannot carry anything over, which the old allowlist provably could.
      prisma.gameState.deleteMany({}),
      prisma.gameState.create({ data: { id: 1, gameId: nextGame.id } }),
    ]);
    forgetGameId();
    // Chat reads past a finished game by seq (db/lib/feedWipe.js); drop
    // the memo so it empties now rather than in half a minute.
    forgetGameFloor();

    // After the character sweep above, so the FK from Character.factionId is
    // already gone and the delete cannot be blocked by a member.
    await prisma.faction.deleteMany({ where: { foundedById: { not: null } } });

    const firstTurn = await prisma.turn.create({
      data: { number: 1, phase: "DAWN", banner: pickTurnBanner("DAWN"), status: "OPEN", gameDate: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "superadmin_game_wipe",
        details: { characters: characters.length, cursedMembers: cursedMemberIds.length },
      },
    });

    // Created before the background work starts, so a dead container leaves
    // an unfinished report (finishedAt null) rather than a false success.
    const reportRow = await prisma.systemReport.create({
      data: { kind: "WIPE", actorDiscordUserId: session.discordUserId },
    });

    revalidatePath("/gm/dev");
    revalidatePath("/", "layout");

    after(() =>
      finishGameWipe(session.discordUserId, characters, cursedMemberIds, firstTurn, reportRow.id).catch(
        (err) => console.error("Game wipe side effects failed:", err),
      ),
    );

    return { ok: true, reportId: reportRow.id };
  } catch (err) {
    // No error.js boundary here; report in place rather than let Next's
    // generic error page hide whether the wipe happened.
    console.error("Game wipe failed:", err);
    return { ok: false, error: "Could not wipe the game. Check the server logs." };
  }
}

// Everything the wipe does outside the database, handed to after() rather
// than awaited. A step runner: every step is retried once, every failure is
// collected, and the run lands on the SystemReport row wipeGameData
// created, so the Dev Panel never claims success it can't know about.
async function finishGameWipe(actorDiscordUserId, characters, cursedMemberIds, firstTurn, reportId) {
  const steps = [];
  const failures = [];
  async function step(name, fn, { retries = 1 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const detail = await fn();
        steps.push({ name, ok: true, ...(detail !== undefined && detail !== null ? { detail } : {}) });
        return detail;
      } catch (err) {
        if (attempt === retries) {
          steps.push({ name, ok: false, message: err.message });
          failures.push({ step: name, message: err.message });
          console.error(`Game wipe step "${name}" failed:`, err);
          return null;
        }
      }
    }
    return null;
  }

  // First, while nothing has re-provisioned: strip every zone role and
  // stray member overwrite.
  await step("access sweep", () => revokeAccessForCharacters(characters));

  // Sequential, not Promise.all — 240+ simultaneous requests against two
  // per-guild rate-limit buckets is its own incident.
  for (const c of characters) {
    if (c.discordRoleId) {
      await step(`character role ${c.discordRoleId}`, () => deleteCharacterRole(c.discordRoleId));
    }
    await step(`nickname ${c.discordUserId}`, () => updateGuildNickname(c.discordUserId, null), {
      retries: 0,
    });
    if (c.turnPingOptIn) {
      await step(`turn-ping ${c.discordUserId}`, () => setTurnPingRole(c.discordUserId, false));
    }
  }

  for (const id of cursedMemberIds) {
    await step(`cursed ${id}`, () => removeCursedRole(id));
  }

  await step("full channel wipe", () => runFullChannelWipe(prisma));

  // After the wipe, never before: it bulk-deletes every #turns message.
  await step("turns console repost", () => postTurnsAnnouncement(prisma, firstTurn, null));

  // Dependency order: roles resolve a starting zone and validate
  // starting_tags; special channels' view grants name the zone roles.
  await step("zone sync", () => syncZonesFromYaml(prisma));
  await step("special channels sync", () => syncSpecialChannels(prisma));
  await step("tag sync", () => syncTagsFromYaml(prisma));
  await step("role sync", () => syncRolesFromYaml(prisma));
  await step("desire sync", () => syncDesiresFromYaml(prisma));
  await step("document sync", () => syncDocumentsFromYaml(prisma));

  // Backstop: whatever a retry above missed, the doctor finds and repairs.
  await step("channel doctor", () =>
    runChannelDoctor(prisma, { apply: true, scope: "cheap", actorDiscordUserId }),
  );

  const okSteps = steps.filter((s) => s.ok).length;
  await prisma.systemReport
    .update({
      where: { id: reportId },
      data: {
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: { steps: steps.length, okSteps, failedSteps: failures.length },
        failures,
      },
    })
    .catch((err) => console.error("Game wipe report write failed:", err));

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "superadmin_game_wipe_finished",
        details: { reportId, steps: steps.length, failed: failures.length },
      },
    })
    .catch((err) => console.error("Game wipe completion audit failed:", err));
}

export async function updateFaction(formData) {
  await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: can't already be an ancestor of its new parent.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  // A room id straight off the form. Validated by existence rather than
  // trusted, and "" clears the pointer.
  const siloRoomRaw = str(formData, "siloRoomId").trim();
  let siloRoomId = null;
  if (siloRoomRaw) {
    const room = await prisma.room.findUnique({ where: { id: siloRoomRaw }, select: { id: true } });
    if (!room) return;
    siloRoomId = room.id;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      parentFactionId,
      siloRoomId,
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Reassigns the faction's members to "Unaffiliated" before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || isUnaffiliated(faction)) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { slug: UNAFFILIATED_SLUG } });
  if (unaffiliated) {
    await prisma.character.updateMany({
      where: { factionId },
      data: { factionId: unaffiliated.id, isLeader: false },
    });
  }

  await prisma.faction.delete({ where: { id: factionId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_deleted",
      details: { factionId, name: faction.name },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// Moves a character into a faction and sets their seats, in one write.
// Deliberately not built out of the player-facing actions: those all check
// "is this your faction", which is the check a GM is here to skip.
export async function assignFactionMember(formData) {
  const session = await requireSuperadmin();

  const characterId = str(formData, "characterId");
  const factionId = str(formData, "factionId");
  if (!characterId || !factionId) return;

  const [character, faction] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId }, select: { id: true, name: true } }),
    prisma.faction.findUnique({ where: { id: factionId }, select: { id: true, name: true, slug: true } }),
  ]);
  if (!character || !faction) return;

  const makeLeader = str(formData, "isLeader") === "true" && !isUnaffiliated(faction);
  const makeTreasurer = str(formData, "isTreasurer") === "true" && !isUnaffiliated(faction);

  await prisma.$transaction(async (tx) => {
    // One Leader per faction, same rule setFactionLeader keeps.
    if (makeLeader) {
      await tx.character.updateMany({
        where: { factionId, isLeader: true },
        data: { isLeader: false },
      });
    }
    await tx.character.update({
      where: { id: characterId },
      data: { factionId, isLeader: makeLeader, isTreasurer: makeTreasurer },
    });
    // Whatever they had open elsewhere is moot once a GM has placed them.
    await tx.factionApplication.updateMany({
      where: { characterId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_assigned",
      targetCharacterId: characterId,
      details: { factionId, factionName: faction.name, isLeader: makeLeader, isTreasurer: makeTreasurer },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
  revalidatePath("/gm/players", "layout");
}

// --- The bomb ---------------------------------------------------------

// A GM's hand on the countdown, and the only safeguard the feature has: anyone
// holding the datacard and the device can start it, and this is what can stop
// it inside the two-turn window. Superadmin-gated like everything else on this
// panel.
//
// Defusing is deliberately not the same as a player's Disarm: it files no
// Request (there is nobody to review a GM) and it works whoever is holding
// what, including when the armer is dead or gone.
export async function defuseNukeAction() {
  const session = await requireSuperadmin();

  const state = await getGameState(prisma);
  if (state.nukeDetonatedTurn != null) {
    return { ok: false, error: "It already went off." };
  }
  if (state.nukeArmedTurn == null) {
    return { ok: false, error: "Nothing is armed." };
  }

  const wasFiringOn = state.nukeArmedTurn;
  await prisma.gameState.update({ where: { id: 1 }, data: { nukeArmedTurn: null } });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "nuke_defused",
        details: { wasFiringOn },
      },
    })
    .catch((err) => console.error("Nuke defuse audit log failed:", err));

  revalidatePath("/gm/dev");
  return { ok: true, wasFiringOn };
}

// --- Channel doctor + system reports ----------------------------------

// Runs in after() and lands on a SystemReport row; /gm/dev polls the
// latest report per kind, so the button returns immediately.
export async function runDoctorAction(formData) {
  const session = await requireSuperadmin();
  const apply = str(formData, "mode") === "repair";
  const scope = str(formData, "scope") === "full" ? "full" : "cheap";

  after(() =>
    runChannelDoctor(prisma, { apply, scope, actorDiscordUserId: session.discordUserId }).catch((err) =>
      console.error("Channel doctor action failed:", err),
    ),
  );

  revalidatePath("/gm/dev");
  return { ok: true };
}

// GM bulk move: relocate many characters to one Location at once. A raw
// relocation, not a travel — no Move cost, no Action, no adjacency check, and
// no cooldown stamp.
export async function bulkMoveCharacters(formData) {
  const session = await requireSuperadmin();

  const locationId = str(formData, "locationId");
  const characterIds = formData.getAll("characterIds").map(String).filter(Boolean);
  if (!locationId || characterIds.length === 0) {
    return { ok: false, error: "Pick a location and at least one character." };
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { zone: true },
  });
  if (!location) {
    return { ok: false, error: "That isn't a place a character can stand." };
  }

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, locationId: true, zoneId: true },
  });
  if (characters.length === 0) return { ok: false, error: "No living characters matched." };

  // The denormalization contract: locationId and zoneId are written together.
  await prisma.character.updateMany({
    where: { id: { in: characters.map((c) => c.id) } },
    // travelTo* cleared alongside: being put somewhere by a GM ends any walk
    // in progress, or db/lib/travelArrivalPass.js would undo this at Dawn.
    data: { locationId: location.id, zoneId: location.zoneId, travelToLocationId: null, travelTurnId: null },
  });

  const report = await prisma.systemReport.create({
    data: {
      kind: "BULK_MOVE",
      actorDiscordUserId: session.discordUserId,
      summary: { location: location.name, zone: location.zone?.name ?? null, characters: characters.length },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_bulk_move",
      details: {
        locationId: location.id,
        locationName: location.name,
        zoneId: location.zoneId,
        zoneName: location.zone?.name ?? null,
        characterIds: characters.map((c) => c.id),
      },
    },
  });

  after(async () => {
    const failures = [];
    for (const c of characters) {
      try {
        await applyLocationMoveSideEffects(prisma, {
          characterId: c.id,
          fromLocationId: c.locationId,
          toLocationId: location.id,
        });
      } catch (err) {
        failures.push({ step: "move", target: c.name, message: err.message });
        console.error(`Bulk move: Discord sync failed for ${c.name}:`, err);
      }
      // One Caving Die per arrival, same as walking in — keyed on the
      // LOCATION now. Outside the try above: a failed Discord sync still moved
      // the character.
      try {
        const cavingDm = await rollCavingOnArrival(
          prisma,
          { ...c, locationId: location.id, zoneId: location.zoneId },
          location,
        );
        if (cavingDm) await sendDm(cavingDm.discordUserId, cavingDm.content);
      } catch (err) {
        failures.push({ step: "caving", target: c.name, message: err.message });
        console.error(`Bulk move: caving arrival DM failed for ${c.name}:`, err);
      }
    }
    await prisma.systemReport
      .update({
        where: { id: report.id },
        data: { finishedAt: new Date(), ok: failures.length === 0, failures },
      })
      .catch((err) => console.error("Bulk move report write failed:", err));
  });

  revalidatePath("/gm/dev");
  return { ok: true, moved: characters.length };
}

// --- GM letters -------------------------------------------------------
//
// A letter from nobody in particular. It rides BirdMessage, which buys the
// reply window, the one-reply claim and the reply picker for free — see
// docs/systemdocs/BIRD.md §9 for the three places it branches from a player's
// Bird, and why.
// `prevState` first: the form reads the result through useActionState, since
// a fire-and-forget <form action={...}> has nowhere to report a refusal to.
export async function sendGmLetter(_prevState, formData) {
  const session = await requireSuperadmin();

  const senderName = str(formData, "senderName").trim().slice(0, 80);
  const recipientId = str(formData, "recipientId");
  const body = str(formData, "body").trim().slice(0, GM_LETTER_MAX);
  const sealed = str(formData, "sealed") === "on";
  const sealLabelText = str(formData, "sealLabel").trim().slice(0, 40);
  const sealMarkText = str(formData, "sealMark").trim().slice(0, 200);

  if (!senderName) return { ok: false, error: "Say who it's from." };
  if (!recipientId) return { ok: false, error: "Pick who it's for." };
  if (!body) return { ok: false, error: "Write something first." };
  if (sealed && !sealLabelText) return { ok: false, error: "Name the seal. It goes in the letter's title." };
  if (sealed && !sealMarkText) return { ok: false, error: "Say what the wax carries." };

  // The reply window is arrivalTurn + 1, so a letter sent between turns would
  // land already unanswerable. Refuse rather than send a mute one.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, error: "No turn is open. The bird waits for one." };

  const recipient = await prisma.character.findUnique({
    where: { id: recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!recipient) return { ok: false, error: "No such character." };
  // Unlike the picker, which lists the dead too (BIRD.md §2 — a list of the
  // living is a casualty report), the SEND refuses. A letter to a corpse would
  // mint paper onto a sheet nobody reads.
  if (recipient.status !== "ALIVE") return { ok: false, error: "They're past reading it." };

  const canReply = canReadLetters(recipient.tags);

  let letter = null;
  let birdMessageId = null;
  await prisma.$transaction(async (tx) => {
    letter = await mintLetterFor(tx, recipient.id, senderName, body);
    if (sealed) letter = await sealWithMark(tx, letter, { label: sealLabelText, mark: sealMarkText });

    const row = await tx.birdMessage.create({
      data: {
        // No sender Character — that is the whole loosening the gm_letters
        // migration bought.
        senderId: null,
        senderName,
        gmSenderDiscordUserId: session.discordUserId,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientDiscordUserId: recipient.discordUserId ?? null,
        // No zone guess. A GM already knows where everyone is standing, and a
        // GM letter reaches the Depths, which no bird will fly to.
        guessedZoneId: null,
        guessedZoneName: null,
        tagId: letter.id,
        tagName: letter.name,
        body: sealed ? null : body,
        delivered: true,
        arrivalTurnId: openTurn.id,
        replyDeadlineTurn: openTurn.number + 1,
      },
    });
    birdMessageId = row.id;

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_send_letter",
        targetCharacterId: recipient.id,
        // The letter IS the record, the same call the player Bird makes.
        reason: sealed ? `Sealed: ${letter.name}` : body.slice(0, MAX_REASON_LENGTH),
        details: { birdMessageId: row.id, senderName, sealed, tagId: letter.id, tagName: letter.name },
      },
    });
  });

  // Post-commit: a DM must never hold up or undo the write (ARCHITECTURE.md
  // §5). One row on the recipient's thread — the desk keys a conversation on
  // the PLAYER's id, so that is where a GM reads the exchange back. `content`
  // stays what the player actually received; the letter itself rides in meta,
  // and DmThread.js renders the card from that.
  notifyCharacter(recipient, deliveryDm({ senderName, letterName: letter.name }), {
    authorDiscordUserId: session.discordUserId,
    components: canReply ? replyButtonRow(birdMessageId) : undefined,
    source: GM_LETTER_SOURCE,
    meta: {
      birdMessageId,
      senderName,
      letterName: letter.name,
      letterBody: body,
      sealed,
      sealMark: sealed ? sealMarkText : null,
    },
  });

  await afterInventoryChange([recipient.id]);
  revalidatePath("/gm/dev");
  revalidatePath("/gm/players");
  return {
    ok: true,
    message: canReply
      ? `${letter.name} is on ${recipient.name}'s sheet. They can answer it until turn ${openTurn.number + 1}.`
      : `${letter.name} is on ${recipient.name}'s sheet. They can't read, so there's no Reply button.`,
  };
}
