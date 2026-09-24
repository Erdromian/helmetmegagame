// The Discord half of ANY location change — the Travel button, the web's writers (creation, GM teleport, Bulk Move) and the staged "Relocate to" at the turn push all call this after their DB write has committed, never from inside it (see db/lib/stagedPush.js). Pure REST, so one implementation serves both faces. Deliberately NOT on the @lifeweb/db barrel, same reasoning as db/lib/dm.js — require it by path. Every call here is .catch-logged, never thrown; the channel doctor's post-turn pass is the safety net for anything a call here missed.
const {
  addMemberRole,
  removeMemberRole,
  putChannelOverwrite,
  deleteChannelOverwrite,
  postMessage,
  addThreadMember,
} = require("./discordRest");
const { DM_ACTION, dmAction } = require("./dmActions");
const { buildNarrowcastContext, computeNarrowcastAccess, SPECIAL_CHANNELS } = require("./specialChannels");
const { applyPendingInvites } = require("./threadInvites");
const { syncPartyMembership } = require("./partyChat");
const { conversationsFor } = require("./conversations");
const { notifyPresence } = require("./presenceNotify");
const { syncCharacterRoomAccess } = require("./roomAccess");
const { ambientLine } = require("./ambientLine");
const { STEALTH_SLUG } = require("./constants");
const { sceneLineAt } = require("./scene");
const { settleCarry, deliverCarryDrop } = require("./carry");
const {
  parkMountsIndoors,
  parkedMessage,
  dismountForNarrowWay,
  dismountedMessage,
} = require("./indoors");
const { applyArrivalMood } = require("./mood");
const { recordArrival } = require("./locationVisits");
const { dropCallsForCharacter } = require("./phone");
const { releaseHoldsForCharacter } = require("./vending");
const { stopPerformances } = require("./performance");
const { cancelWatchOnMove, releaseHeldBy, INTERCEPT_CANCELLED_DM } = require("./intercept");
const { cancelSearchOffersOnMove } = require("./search");
const { closeFightsFor } = require("./attack");
const { reconcileCorpses } = require("./corpseFollow");
const { LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY } = require("./zoneChannelSpec");
const { lightVantage, pruneVantages, vantagesFor } = require("./vantages");
const { linkBetween, endpoints, shouldPromptKeyed, travelOptions } = require("./locationGraph");
const { keyedPromptRow } = require("./locationAnchorRow");
const { aliasSubject } = require("./concealedIdentity");
const { sendDm } = require("./dm");
const { rollTurretOnArrival, TURRET_DM } = require("./depotPass");
const { applyDeathTeardown } = require("./deathTeardown");
const {
  railroadGibOnArrival,
  RAILROAD_DEATH_REASON,
  RAILROAD_LOCATION_LINE,
} = require("./railroad");
const { locationLine } = require("./placeLine");
const {
  rollGatehouseTurretOnArrival,
  GATEHOUSE_TURRET_DM,
} = require("./gatehouseTurret");
// The gun's own DM wording lives with each gun; naming the wound underneath it is the same job for both, so that half is shared.
const { turretDmFor } = require("./turretPass");
// Announcing carries its own DISCORD_TOKEN guard, so calling it beside the roll is safe even though the roll itself deliberately runs above that guard.
const { announceTurretBurst } = require("./turretBurst");

// Mirrors web/lib/discordGuild.js's PERM_VIEW_CHANNEL / PERM_SEND_MESSAGES — duplicated rather than imported because db/ cannot reach into web/.
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Reconciles a character's per-member overwrites on the narrowcast channels (#cerberon) against their CURRENT zone/tags. Same computation as web/lib/discordGuild.js#syncCharacterNarrowcastAccess, built on db/lib REST primitives instead of web's.
async function reconcileNarrowcastAccess(prisma, characterId, discordUserId) {
  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            await putChannelOverwrite(channelId, discordUserId, { allow: String(allow), type: 1 });
          } else {
            await deleteChannelOverwrite(channelId, discordUserId);
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err.message ?? err);
        }
      }),
  );
}

// Grant BEFORE revoke, deliberately: an interrupted swap leaves the player seeing two rooms for a moment (harmless, self-healing) rather than none (a lockout a player can't diagnose).
async function swapRole(discordUserId, fromRoleId, toRoleId, label) {
  if (toRoleId) {
    await addMemberRole(discordUserId, toRoleId).catch((err) =>
      console.error(`Move: failed to grant ${discordUserId} the ${label} role ${toRoleId}:`, err.message ?? err),
    );
  }
  if (fromRoleId && fromRoleId !== toRoleId) {
    await removeMemberRole(discordUserId, fromRoleId).catch((err) =>
      console.error(`Move: failed to remove ${discordUserId}'s ${label} role ${fromRoleId}:`, err.message ?? err),
    );
  }
}

// The Location half of a move, and the reason a Location wears no Discord role: one per-member overwrite on the channel, never a role. Spends none of the guild's 250 roles — see db/lib/zoneChannelSpec.js.
// Two masks now, not one: LOCATION_MEMBER_ALLOW for the street you stand in, LOCATION_VANTAGE_ALLOW + LOCATION_VANTAGE_DENY for one you walked out of and are still watching (db/lib/vantages.js). The watcher needs the deny, not just a smaller allow — @everyone would otherwise hand back thread-send and reactions. Same call either way; a PUT replaces both halves, so walking back in clears the deny.
async function openLocationTo(discordUserId, channelId, allow, deny = 0n) {
  if (!channelId) return;
  await putChannelOverwrite(channelId, discordUserId, {
    allow: String(allow),
    deny: String(deny),
    type: 1,
  }).catch((err) =>
    console.error(`Move: failed to open ${channelId} to ${discordUserId}:`, err.message ?? err),
  );
}

async function closeLocationTo(discordUserId, channelId) {
  if (!channelId) return;
  await deleteChannelOverwrite(channelId, discordUserId).catch((err) =>
    console.error(`Move: failed to close ${channelId} to ${discordUserId}:`, err.message ?? err),
  );
}

// Everything Discord needs to know to put a character back where they already stand: the Location overwrite, zone role, narrowcast, private-room threads, conversations, and standing invites. This is the "Play on Discord too" switch turning ON (db/lib/discordMirroring.js, CHAT.md §6), built on the SAME four helpers a move uses — swapLocationOverwrite, swapRole, reconcileNarrowcastAccess, syncCharacterRoomAccess — rather than a second copy; there's no origin, so every call is a pure grant. Best-effort throughout, like every other call in this file — anything that fails is the channel doctor's next pass to repair, which it can now do because it knows the flag.
async function materializeDiscordPresence(prisma, character) {
  if (!process.env.DISCORD_TOKEN) return;
  if (!character?.discordUserId || !character.locationId) return;
  const discordUserId = character.discordUserId;

  const location = await prisma.location.findUnique({
    where: { id: character.locationId },
    include: { zone: true },
  });
  if (!location) return;

  await openLocationTo(discordUserId, location.discordChannelId ?? null, LOCATION_MEMBER_ALLOW);
  await swapRole(discordUserId, null, location.zone?.discordRoleId ?? null, "zone");

  // The fog of war comes back on too. Vantage rows are a database fact and survived the switch being on (db/lib/vantages.js); this is the Discord half catching up, so the places they walked through earlier this turn are where they left them rather than dark until the next move.
  const vantages = await vantagesFor(prisma, { id: character.id, locationId: character.locationId }).catch((err) => {
    console.error(`Discord mirror on: vantage lookup failed for ${character.id}:`, err.message ?? err);
    return [];
  });
  for (const vantage of vantages) {
    await openLocationTo(discordUserId, vantage.location?.discordChannelId ?? null, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY);
  }
  await reconcileNarrowcastAccess(prisma, character.id, discordUserId).catch((err) =>
    console.error(`Discord mirror on: narrowcast reconcile failed for ${character.id}:`, err.message ?? err),
  );
  await syncCharacterRoomAccess(prisma, character).catch((err) =>
    console.error(`Discord mirror on: room access sync failed for ${character.id}:`, err.message ?? err),
  );

  // Conversations are a DB row and Discord's member list is its projection (db/lib/conversations.js), so the rows survived the switch being on and this is the projection catching up. Location-filtered for the same reason /add is: Discord sheds a thread member who cannot see the parent.
  const conversations = await conversationsFor(prisma, character.id, {
    locationId: character.locationId,
  }).catch((err) => {
    console.error(`Discord mirror on: conversation lookup failed for ${character.id}:`, err.message ?? err);
    return [];
  });
  for (const conversation of conversations) {
    await addThreadMember(conversation.threadId, discordUserId).catch((err) =>
      console.error(
        `Discord mirror on: failed to re-add ${character.id} to conversation ${conversation.threadId}:`,
        err.message ?? err,
      ),
    );
  }

  await applyPendingInvites(prisma, character).catch((err) =>
    console.error(`Discord mirror on: thread invite pass failed for ${character.id}:`, err.message ?? err),
  );
}

// A Location moved into another zone under the people standing in it — the place editor's Zone control (DEV-PANEL.md §Zones). The database half is one updateMany on Character.zoneId, done by the caller; this is the Discord half for everyone left standing there: the zone role swapped and narrowcast reconciled, the same two calls a crossing makes when it changes zone (applyArrivalDiscord), and best-effort like everything else here — a miss is the channel doctor's next pass. The Location channel itself moves category through the mirror queue, not here.
async function rehomeStandingCharacters(prisma, { locationId, fromRoleId, toRoleId }) {
  if (!process.env.DISCORD_TOKEN) return;
  const rows = await prisma.character.findMany({
    // ALIVE only: a body keeps its locationId, and its player's account must not get a zone role back (the doctor's rule is the living alone), nor lose the one their new character is standing in.
    where: { locationId, status: "ALIVE", discordMirrored: true, discordUserId: { not: null } },
    select: { id: true, discordUserId: true },
  });
  for (const row of rows) {
    await swapRole(row.discordUserId, fromRoleId ?? null, toRoleId ?? null, "zone");
    await reconcileNarrowcastAccess(prisma, row.id, row.discordUserId).catch((err) =>
      console.error(`Zone change: narrowcast reconcile failed for ${row.id}:`, err.message ?? err),
    );
  }
}

// What a crossing actually says, once the traveller's own tags have had their say. Pure and exported so the rule is testable without a database (db/lib/inspectVision.js posture). Stealth takes the announcement down ONE step rather than silencing every gate — you can be quiet, but not quiet past somebody reading your papers.
// unmanned (CONCEALED) -> NONE (nobody was watching); manned (TRUE_NAME) -> CONCEALED (what a passer-by saw, not your papers). So a stealthy traveller at the Fortress gatehouse lands where an ordinary one lands at the Town gates, and at the Town gates they vanish. NONE stays NONE: a gate that announces nothing cannot announce less.
const STEALTH_DOWNGRADE = { TRUE_NAME: "CONCEALED", CONCEALED: "NONE" };

function announceLevelFor(linkAnnounce, characterTags = []) {
  if (linkAnnounce === "NONE") return "NONE";
  const stealthy = (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === STEALTH_SLUG);
  if (!stealthy) return linkAnnounce;
  return STEALTH_DOWNGRADE[linkAnnounce] ?? linkAnnounce;
}

// A gate crossing, announced in the destination zone's #summary as game narration, not the character speaking — a plain bot message, NOT postAsCharacter, since a webhook post under the traveller's own name would defeat the unmanned form. A manned gate has a Cerberus reading papers (true name, /conceal doesn't help); an unmanned one records what a passer-by saw ("An old woman"), never the name behind it.
// Derived from the edge rather than passed in, so every writer of Character.locationId gets this for free — a GM's teleport onto a non-adjacent location finds no link and announces nothing, which is right.
async function announceGateCrossing(prisma, character, fromLocationId, toLocation) {
  if (!fromLocationId) return;
  const channelId = toLocation.zone?.discordSummaryChannelId ?? null;
  if (!channelId) return;

  const link = await linkBetween(prisma, fromLocationId, toLocation.id);
  if (!link || link.announce === "NONE") return;

  const announce = announceLevelFor(link.announce, character.tags);
  if (announce === "NONE") return;

  const who = announce === "TRUE_NAME" ? character.name : aliasSubject(character);
  if (!who) return;
  const said = `${who} has entered ${toLocation.name}.`;
  await postMessage(channelId, ambientLine(said));
  // Chat's half of the same crossing (db/lib/scene.js), beside the post.
  await sceneLineAt(prisma, { zoneId: toLocation.zone?.id ?? toLocation.zoneId, text: said });
}

// The offer to hold a keyed door open behind you. Only the key-holder is asked, and only while the way is shut (see shouldPromptKeyed). Deliberately a DM rather than a channel post: the whole point of a keyed way is that it's usually secret, and asking in the open would tell the room it exists.
// The 24 hours aren't started here — this only poses the question; the button handler in bot/src/events/interactionCreate.js stamps openUntil, so a player who never answers leaves the door shut, the safe default.
async function offerToHoldKeyed(prisma, character, fromLocationId, toLocation) {
  if (!fromLocationId) return;
  const link = await linkBetween(prisma, fromLocationId, toLocation.id);
  const tagSlugs = (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean);
  if (!shouldPromptKeyed(link, { tagSlugs })) return;

  const far = endpoints(link, toLocation.id).far;
  await sendDm(
    prisma,
    character.discordUserId,
    `The way between ${far.name} and ${toLocation.name} is open behind you. Leave it open for the next 24 hours?\n` +
      `-# While it stands open, anyone can see it and follow you through.`,
    { components: keyedPromptRow(link.id), meta: dmAction(DM_ACTION.KEYED_WAY, link.id), source: "bot_auto" },
  );
}

// Everything a location change must do in Discord once the DB write has landed: swap the location overwrite, announce a gate crossing, offer to hold a keyed way open, swap the zone role and reconcile narrowcast if the zone changed, then private-room membership and standing conversation invites wherever they now stand. `entry` is { characterId, fromLocationId, toLocationId, dismounted } — zones are read from the locations, and the character row is re-read so a stale caller can't swap the wrong account.
// `dismounted` is optional: names db/lib/locationTravel.js#performLocationMove already unequipped for a way too narrow to ride or push through, if this move came from there — see the comment below on why that has to happen inside performLocationMove's own transaction rather than here.
// `walked` says the character got here ON FOOT, and only a walk leaves the place behind them lit (db/lib/vantages.js). It defaults to FALSE and the two travel callers opt in, so a GM teleport, a rite, a threat spawn, a staged "Relocate to", Xom and a first placement all leave nothing behind — you cannot keep watching a street you never walked out of.
async function applyArrivalFacts(prisma, { characterId, fromLocationId, toLocationId, dismounted, walked = false }) {
  if (!characterId || !toLocationId) return null;
  if (fromLocationId === toLocationId) return null;

  // The map remembers. Here rather than in performLocationMove because this function is the one every writer of Character.locationId runs (§4 below) — a GM teleport, first placement, a rite and the turn's arrival pass all land here; hooking the mover instead would leave each a hole in somebody's map. Before the Discord guard for the same reason parking a mount is: knowing where you've been is a database fact and must not depend on there being a token to talk to Discord with.
  // Wrapped, because losing a node off a map must never wedge a move — /map's own loader re-records the character's current location on every open, so a drop here heals itself next time they look.
  await recordArrival(prisma, { id: characterId }, toLocationId).catch((err) => {
    console.error(`Move: recording the visit failed for ${characterId}:`, err.message ?? err);
  });

  // A hold is a hand on a shoulder, and it ends when the holder leaves — HOWEVER they leave. performLocationMove already does this inside its own transaction for walking off (INTERCEPT.md §3); this is the same clear for being taken away instead. Idempotent, so the walking case running it twice costs one no-op update.
  if (fromLocationId) {
    await releaseHeldBy(prisma, characterId).catch((err) =>
      console.error(`Move: releasing holds failed for ${characterId}:`, err.message ?? err),
    );
    // The same clear for a FIGHT (docs/systemdocs/ATTACK.md). releaseHeldBy deliberately won't touch one — both sides are held, and only the row knows whether either is still in another — so the row is what gets ended here, unpicking both holds on its way out.
    await closeFightsFor(prisma, characterId).catch((err) =>
      console.error(`Move: closing fights failed for ${characterId}:`, err.message ?? err),
    );
  }

  // A phone goes back on its cradle when the person holding it walks out
  // (docs/systemdocs/PHONES.md). Here rather than in performLocationMove for
  // the reason every clear above gives: this is the writer EVERY relocation
  // runs, so a teleport, a staged Relocate and a rite hang up as surely as
  // walking does. Above the Discord guard, because a call ending is a database
  // fact and must not depend on there being a token. Behind `fromLocationId`,
  // because a Resync, a revive and a first placement are not moves, and a
  // Resync silently killing a live call would be exactly the INTERCEPT bug.
  //
  // The far end hears "The person hung up"; the side that walked out hears
  // nothing, because they are not there and the room they left made no noise.
  if (fromLocationId) {
    await dropCallsForCharacter(prisma, characterId).catch((err) =>
      console.error(`Move: hanging up the phone failed for ${characterId}:`, err.message ?? err),
    );
    // A song stays in the Location it was played in (SOUND.md, "Performances").
    await stopPerformances(prisma, [characterId], "moved").catch((err) =>
      console.error(`Move: stopping the song failed for ${characterId}:`, err.message ?? err),
    );
    // And you let go of the vending machine when you walk away from it
    // (VENDING.md). Here for the reason the phone is: every relocation runs
    // this writer. THE FLOAT IS NOT TOUCHED — walking out is not pressing Step
    // away, so coin left in the slot stays there for the next customer. The
    // minute sweep is the backstop, because the hook list is never finished.
    await releaseHoldsForCharacter(prisma, characterId, "moved").catch((err) =>
      console.error(`Move: releasing the vending machine failed for ${characterId}:`, err.message ?? err),
    );
  }

  // Laying in wait ends the moment you leave the place you were waiting in (docs/systemdocs/INTERCEPT.md §1). Here rather than in performLocationMove because this is the writer every relocation runs — a teleport, Bulk Move, a staged Relocate to and a rite all break the anchor as surely as walking does. Above the Discord guard, same recordArrival reasoning: the watch is a database fact and must not survive on a box with no token.
  // `fromLocationId` has to be set. Three callers pass null for something that is NOT a move — a GM's Discord resync, a revive, and a character's first placement — cancelling on those would have a GM pressing Resync silently end a player's ambush.
  const droppedWatch = fromLocationId
    ? await cancelWatchOnMove(prisma, characterId).catch((err) => {
        console.error(`Move: cancelling the watch failed for ${characterId}:`, err.message ?? err);
        return null;
      })
    : null;

  // A pending search dies the same way, and for the same reasons (docs/systemdocs/SEARCH.md §5):
  // here rather than in performLocationMove because this is the writer every relocation runs, above
  // the Discord guard because the offer dying is a database fact and only the letter waits for a
  // token, and behind `fromLocationId` because a Resync, a revive and a first placement are not moves.
  // It fires for EITHER party — a search is two people standing in one place, and which of them left
  // does not change that. Returns descriptors; the DMs go out below the guard with the rest.
  const searchesOff = fromLocationId
    ? await cancelSearchOffersOnMove(prisma, characterId).catch((err) => {
        console.error(`Move: cancelling pending searches failed for ${characterId}:`, err.message ?? err);
        return [];
      })
    : [];

  // Before the Discord guard below, because this is a DB change that must happen whether or not there's a token to talk to Discord with. Also before the settle further down, so the settle sees the reduced cap and grants Overburdened in the same pass (docs/systemdocs/CARRY.md §3).
  const parked = await parkMountsIndoors(prisma, characterId, toLocationId).catch((err) => {
    console.error(`Move: parking mounts failed for ${characterId}:`, err.message ?? err);
    return [];
  });

  // The other trigger for the same thing: a way too narrow for what they had out. `performLocationMove` already does this itself, inside its own transaction, so a mount that doesn't survive a crossing can never bank the extra free move it buys (MAP.md §2c) — the caller passes those names straight through as `dismounted`, skipping a redo that would only ever find nothing left to unequip. A caller with no such result (a GM teleport, a rite, a spawn — none of which cross a graph edge) leaves it undefined and gets the independent check below, a no-op unless there really is a matching onFoot link.
  const dismountedNames =
    dismounted ??
    (fromLocationId
      ? await linkBetween(prisma, fromLocationId, toLocationId)
          .then((link) => dismountForNarrowWay(prisma, characterId, link))
          .catch((err) => {
            console.error(`Move: dismounting for a narrow way failed for ${characterId}:`, err.message ?? err);
            return [];
          })
      : []);


  // What walking in here does to the nerves is a DB fact too, same as parking
  // a mount above — before the Discord guard, so it lands whether or not
  // there's a token to talk to Discord with (docs/systemdocs/MOOD.md). No
  // per-turn ration on the arrival cost: a mount's two crossings are two real
  // arrivals. The Cathedral's relief rations itself inside.
  await applyArrivalMood(prisma, { characterId, fromLocationId, toLocationId }).catch((err) => {
    console.error(`Move: mood on arrival failed for ${characterId}:`, err.message ?? err);
  });

  // Walking into an armed turret. Before the Discord guard and the early return, same reason parking a mount is: being shot is a database fact and must not depend on there being a token to announce it with. Wrapped, because a gun malfunctioning must never wedge a move.
  // Both guns are asked, because a move only ever arrives in one place: each checks the destination slug first and costs a single indexed read to say no. See db/lib/turretPass.js on why the armed check is a thunk.
  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { number: true, id: true },
  });
  const turrets = [
    { roll: rollTurretOnArrival, dms: TURRET_DM, label: "depot" },
    { roll: rollGatehouseTurretOnArrival, dms: GATEHOUSE_TURRET_DM, label: "gatehouse" },
  ];
  for (const turret of turrets) {
    const shot = await turret.roll(prisma, { characterId, toLocationId, turn: openTurn }).catch((err) => {
      console.error(`Move: ${turret.label} turret failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (!shot) continue;
    if (shot.discordUserId && shot.kind !== "graze") {
      await sendDm(prisma, shot.discordUserId, turretDmFor(turret.dms, shot)).catch((err) =>
        console.error(`Move: turret DM failed for ${characterId}:`, err.message ?? err),
      );
    }
    // A kill on arrival happens outside the turn engine, so the side-effect thunk that tears every other death down never sees it. Done here instead, and only here — the turn-end sweep's kills are carried up to db/index.js as `deaths` rather than torn down inline.
    if (shot.death) {
      await applyDeathTeardown(prisma, shot.death).catch((err) =>
        console.error(`Move: death teardown failed for ${characterId}:`, err.message ?? err),
      );
    }

    // The noise carries whatever the roll was — a graze is still a machinegun going off, and a zone that only hears the shots that land can never learn to stay out of the yard.
    await announceTurretBurst(prisma, shot.locationId).catch((err) =>
      console.error(`Move: turret burst failed for ${characterId}:`, err.message ?? err),
    );
  }

  // Walking into a rail tunnel with the train in it (db/lib/railroad.js). Here
  // for the reason the turrets are here: a kill on arrival is a database fact
  // and must not wait on there being a token to announce it with. `fromLocationId`
  // gates it, so a teleport, a spawn, a rite and a first placement cross no edge
  // and can never die to this. Wrapped, because the train must never wedge a
  // move that has already committed.
  //
  // AFTER the commit and not inside performLocationMove's transaction, on
  // purpose: the crossing really happened and stays paid, and applyDeathToRow
  // fires a pile of un-tx'd writes — including a reincarnate that recurses back
  // through this very function — which has no business nested in a move.
  const hit = await railroadGibOnArrival(prisma, {
    characterId,
    fromLocationId,
    toLocationId,
    turn: openTurn,
  }).catch((err) => {
    console.error(`Move: the railroad failed for ${characterId}:`, err.message ?? err);
    return null;
  });
  if (hit?.death) {
    await applyDeathTeardown(prisma, hit.death).catch((err) =>
      console.error(`Move: railroad death teardown failed for ${characterId}:`, err.message ?? err),
    );
    if (hit.death.discordUserId) {
      await sendDm(prisma, hit.death.discordUserId, `You have died. ${RAILROAD_DEATH_REASON}`).catch((err) =>
        console.error(`Move: railroad DM failed for ${characterId}:`, err.message ?? err),
      );
    }
    const where = await prisma.location
      .findUnique({ where: { id: toLocationId }, select: { id: true, name: true, discordChannelId: true } })
      .catch(() => null);
    await locationLine(prisma, where, RAILROAD_LOCATION_LINE(hit.death.name)).catch((err) =>
      console.error(`Move: railroad line failed for ${characterId}:`, err.message ?? err),
    );
    // Everything below here is owed to a LIVING arrival — the zone role, the
    // narrowcast seat, room access, pending invites, party membership. The
    // teardown above has just revoked all of it, so running on would hand a
    // dead sheet its threads back.
    return null;
  }

  const [fromLocation, toLocation, character] = await Promise.all([
    fromLocationId ? prisma.location.findUnique({ where: { id: fromLocationId }, include: { zone: true } }) : null,
    prisma.location.findUnique({ where: { id: toLocationId }, include: { zone: true } }),
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        locationId: true,
        status: true,
        concealed: true,
        age: true,
        gender: true,
        discordMirrored: true,
        tags: { select: { tag: { select: { slug: true } } } },
      },
    }),
  ]);
  if (!toLocation) return null;

  // THE FOG OF WAR (db/lib/vantages.js). Above the Discord guard below, same reasoning as recordArrival: what a character can still see is a database fact, and the web reads it whether or not there is a token to talk to Discord with.
  // ONE STEP. A light stays on only while the place is still directly next door to where they now stand, so walking on past somewhere puts it out — what they watched two streets back is no longer theirs to read. The zone has nothing to do with it either way: walking out through a gate leaves the street behind them lit exactly as any other single step would.
  // Nothing lit, nothing to work out. A count first because the prune's question — which of the destination's neighbours am I watching — costs a walk of the link graph to answer, and most arrivals are somebody's first step of the turn with no lights on at all. Cheaper than the graph, and it heals a stale row the same way, since a leftover from yesterday still counts.
  const watching = await prisma.vantage.count({ where: { characterId } }).catch(() => 0);

  // travelOptions, not linksFor, for locationVisits.js's reason: a hidden crawl they lack the tag for is not a way, so it can't hold a light. `listed` survives a hold and a caving hold on purpose — a hand on your shoulder stops you walking, it doesn't close your eyes.
  // Everything no longer next door goes dark, and the survivors are re-anchored to where they now stand. Run for EVERY arrival, however they got here: a teleport across the map finds nothing adjacent and lands in the dark, which is what leaving the zone used to do by a longer road. It also puts out any light on the destination itself — it is Here now, and Here is never a row.
  let droppedVantages = [];
  if (watching) {
    try {
      const neighbours = await travelOptions(prisma, character ?? { id: characterId }, toLocationId);
      droppedVantages = await pruneVantages(prisma, characterId, {
        anchorLocationId: toLocationId,
        keepLocationIds: neighbours.map((row) => row.location.id),
      });
    } catch (err) {
      console.error(`Move: pruning vantages failed for ${characterId}:`, err.message ?? err);
    }
  }
  if (walked && fromLocationId) {
    // They just walked the link, so the street behind them is next door by construction and the prune above would have kept it.
    await lightVantage(prisma, {
      characterId,
      fromLocationId,
      toLocationId,
      anchorLocationId: toLocationId,
      turnId: openTurn?.id ?? null,
    }).catch((err) => console.error(`Move: lighting the vantage failed for ${characterId}:`, err.message ?? err));
  }

  // No token is still a move, and neither is an account with nobody behind it:
  // the database says where they stand and what they can still watch, so the
  // web's place list has to be told either way (CHAT.md §3). Said here, at the
  // end of the facts, rather than once per guard below — it is a Postgres
  // NOTIFY and not a Discord call, so it costs the same whoever is arriving,
  // and putting it here is what makes every open /chat tab hear about the move
  // NOW instead of whenever Discord has finished being told.
  await notifyPresence(prisma, characterId);

  // Everything above this line is the game: where they stand, what they can
  // see, what let go of them, what shot at them. It is committed and durable.
  //
  // What is left is the TELLING — channel access, roles, threads, the gate
  // lines, the DMs — and it is HANDED BACK rather than done, exactly the way
  // performLocationMove hands back its own (ARCHITECTURE.md §4). The web's
  // mover runs it in after(), so a player is never made to wait on a
  // rate-limited Discord call to find out they moved. A caller with no response
  // to hold open just runs applyLocationMoveSideEffects below and notices
  // nothing.
  return {
    characterId,
    fromLocationId,
    toLocationId,
    walked,
    character,
    fromLocation,
    toLocation,
    droppedWatch,
    searchesOff,
    parked,
    dismountedNames,
    droppedVantages,
  };
}

// The Discord half of an arrival — everything the token guard used to stand in
// front of, in the order it has always run. `facts` is what applyArrivalFacts
// returned; NULL means either there was nothing to do or a railroad death has
// already taken this sheet's threads away, and in both cases there is nothing
// to tell.
//
// Every call in here is sequential and never Promise.all'd: Discord bans an IP
// for an hour after ten thousand invalid responses (ARCHITECTURE.md §5).
// Deferring this work moved WHEN it runs, never how fast.
async function applyArrivalDiscord(prisma, facts) {
  if (!facts) return;
  const {
    characterId,
    fromLocationId,
    toLocationId,
    walked,
    character,
    fromLocation,
    toLocation,
    droppedWatch,
    searchesOff,
    parked,
    dismountedNames,
    droppedVantages,
  } = facts;

  // The presence notify already went out with the facts, so a box with no token
  // and an account with nobody behind it both have simply nothing to say here.
  if (!process.env.DISCORD_TOKEN) return;
  if (!character?.discordUserId) return;
  const discordUserId = character.discordUserId;

  // The watch this move just ended, told plainly — the delete happened above the guard, only the letter waits for a token. FIRST of the DMs, ahead of the channel work below, because swapLocationOverwrite/swapRole are unguarded and every caller swallows this function's throw — a Discord 5xx down there and the owner would never hear their watch was gone.
  if (droppedWatch?.cancelled) {
    await sendDm(prisma, discordUserId, INTERCEPT_CANCELLED_DM).catch((err) =>
      console.error(`Move: intercept-cancelled DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }

  // The searchers whose offer this move just killed. Each goes to a DIFFERENT
  // person than the one moving, so these are addressed descriptors rather than
  // `discordUserId` — and they ride here, beside the letter above, for the same
  // reason: the cancel already happened, only the telling waits for a token.
  for (const dm of searchesOff) {
    await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
      console.error(`Move: search-cancelled DM to ${dm.discordUserId} failed:`, err.message ?? err),
    );
  }

  // Not mirrored to Discord holds this account out of every channel, so the Discord half of standing somewhere is simply not done for them (CHAT.md §6). Everything else below still runs: the gate crossing is scenery the rest of the zone reads, the keyed-door offer and parked-mount note are DMs, and the carry, corpse and presence work is the database.
  // Grant BEFORE revoke, deliberately: an interrupted swap leaves the player seeing two streets for a moment (harmless, self-healing) rather than none (a lockout a player can't diagnose).
  if (character.discordMirrored) {
    await openLocationTo(discordUserId, toLocation.discordChannelId ?? null, LOCATION_MEMBER_ALLOW);

    if (fromLocation && fromLocation.discordChannelId !== toLocation.discordChannelId) {
      if (walked) {
        // They walked: the street behind them stays open, mute — one step back is always still next door, whichever side of a zone boundary it sits on. A DOWNGRADE, not a delete: the same one REST call the old revoke cost.
        await openLocationTo(discordUserId, fromLocation.discordChannelId ?? null, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY);
      } else {
        // Carried, teleported or relocated: they never walked out of it, so it closes.
        await closeLocationTo(discordUserId, fromLocation.discordChannelId ?? null);
      }
    }

    // Everything this step put out of range, told to Discord. One call per light; a character carries a handful at most, since a turn buys a handful of Moves.
    for (const vantage of droppedVantages) {
      await closeLocationTo(discordUserId, vantage.location?.discordChannelId ?? null);
    }
  }

  await announceGateCrossing(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: gate announcement failed for ${characterId}:`, err.message ?? err),
  );

  await offerToHoldKeyed(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: keyed-door offer failed for ${characterId}:`, err.message ?? err),
  );

  if (character.discordMirrored && fromLocation?.zoneId !== toLocation.zoneId) {
    await swapRole(discordUserId, fromLocation?.zone?.discordRoleId ?? null, toLocation.zone?.discordRoleId ?? null, "zone");
    await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
      console.error(`Move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
    );
  }

  if (parked.length > 0) {
    await sendDm(prisma, discordUserId, parkedMessage(parked, toLocation.name)).catch((err) =>
      console.error(`Move: parked-mount DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }
  if (dismountedNames.length > 0) {
    await sendDm(prisma, discordUserId, dismountedMessage(dismountedNames)).catch((err) =>
      console.error(`Move: dismount DM to ${discordUserId} failed:`, err.message ?? err),
    );
  }

  // Settle carry BEFORE room access: arriving somewhere with a public room is what lets a deferred overflow drop finally land (db/lib/carry.js), and that drop can take a private-room key off the sheet, so membership has to be recomputed from the post-drop holdings.
  const carry = await settleCarry(prisma, characterId).catch((err) => {
    console.error(`Move: carry settle failed for ${characterId}:`, err.message ?? err);
    return null;
  });

  // A MOVE cannot change what this character is ENTITLED to, and thread membership follows entitlement now rather than presence (db/lib/roomAccess.js). What a move changes is guest rows, spent by walking out — `guestsOnly` sweeps those and makes no Discord calls in the ordinary case, which is what stopped Discord narrating "… added <name> to the thread" into every room on every arrival.
  // A FIRST PLACEMENT is the exception and gets the full recompute: `null` fromLocationId means nobody walked, a character being put on the map for the first time (created, spawned into a threat seat, or GM-relocated from nowhere) — nothing else would ever add them to their threads, since the mover no longer does and a tag change might not come for days. Getting this wrong is silent: a new Cerberus simply never sees the Dungeons.
  await syncCharacterRoomAccess(prisma, { ...character, locationId: toLocationId }, {
    guestsOnly: Boolean(fromLocationId),
  }).catch((err) =>
    console.error(`Move: room access sync failed for ${characterId}:`, err.message ?? err),
  );

  // Any body this character was carrying has just moved with them, and NOTHING WROTE A TAG to say so — only their own locationId changed. This is the one hook the whole corpse-as-handle design depends on; a push from a tag writer could never catch it. See db/lib/corpseFollow.js.
  await reconcileCorpses(prisma).catch((err) =>
    console.error(`Move: corpse follow failed for ${characterId}:`, err.message ?? err),
  );
  if (carry?.drop) {
    await deliverCarryDrop(prisma, carry).catch((err) =>
      console.error(`Move: carry drop delivery failed for ${characterId}:`, err.message ?? err),
    );
  }
  await applyPendingInvites(prisma, { ...character, locationId: toLocationId }).catch((err) =>
    console.error(`Move: thread invite pass failed for ${characterId}:`, err.message ?? err),
  );

  // The party thread follows the leader (db/lib/partyChat.js). Cheap no-op for
  // anyone not leading anybody: syncPartyMembership returns early on an empty
  // party. If this character is a leader, currentLocationId gets refreshed and
  // members' visibility follows.
  await syncPartyMembership(prisma, characterId).catch((err) =>
    console.error(`Move: party sync failed for ${characterId}:`, err.message ?? err),
  );

  // The feet moved, so the web's place list did too: every open /chat tab of this character re-asks db/lib/feedAccess.js#placesFor (CHAT.md §3).
  await notifyPresence(prisma, characterId);
}

// The two halves together, for every caller with no response to hold open: a GM
// teleport, a first placement, a rite, the turn's arrival pass, and the whole of
// bot/. Their behaviour is unchanged — this is the function they always called.
async function applyLocationMoveSideEffects(prisma, args) {
  await applyArrivalDiscord(prisma, await applyArrivalFacts(prisma, args));
}

module.exports = {
  applyLocationMoveSideEffects,
  applyArrivalFacts,
  applyArrivalDiscord,
  materializeDiscordPresence,
  rehomeStandingCharacters,
  reconcileNarrowcastAccess,
  announceLevelFor,
};
