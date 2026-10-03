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
const { syncCharacterRoomAccess, withRingTokens } = require("./roomAccess");
const { ambientLine } = require("./ambientLine");
const { STEALTH_SLUG } = require("./constants");
const { sceneLineAt } = require("./scene");
const { settleCarry, deliverCarryDrop } = require("./carry");
const { applyArrivalMood } = require("./mood");
const { recordArrival } = require("./locationVisits");
const { dropCallsForCharacter } = require("./phone");
const { releaseHoldsForCharacter } = require("./vending");
const { stopPerformances } = require("./performance");
const { cancelWatchOnMove, releaseHeldBy, INTERCEPT_CANCELLED_DM } = require("./intercept");
const { cancelSearchOffersOnMove } = require("./search");
const { closeFightsFor } = require("./attack");
const { leaveCombatsFor, sendCombatDms } = require("./combat");
const { reconcileCorpses } = require("./corpseFollow");
const { LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY } = require("./zoneChannelSpec");
const { lightVantage, pruneVantages, vantagesFor } = require("./vantages");
const { linkBetween, endpoints, shouldPromptKeyed, travelOptions } = require("./locationGraph");
const { keyedPromptRow } = require("./locationAnchorRow");
const { aliasSubject } = require("./concealedIdentity");
const { clearPresence } = require("./strangers");
const { sendDm } = require("./dm");
const { rollTurretOnArrival, TURRET_DM } = require("./depotPass");
const { applyDeathTeardown } = require("./deathTeardown");
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

// One access write at a time per character, in this process. Two moves made
// close together each hand their Discord half to a queue of their own (the web
// runs each in its own after()), and before this the two queues interleaved: the
// OLDER move's writes could land last and undo the newer one. Walk A -> B, then
// straight back to A, and the late first move re-opened B as Here and set A
// mute — the player stood in A and could read it but not talk in it.
const accessChains = new Map();
function oneAtATime(characterId, work) {
  const run = (accessChains.get(characterId) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => {});
  accessChains.set(characterId, tail);
  tail.then(() => {
    if (accessChains.get(characterId) === tail) accessChains.delete(characterId);
  });
  return run;
}

// A move's Location overwrites and zone role, written from where the character
// stands NOW rather than from the move that asked. `channelIds` and
// `zoneRoleIds` are what the move(s) touched, and they bound the work: each one
// is set to what the database says it should be — Here, watched, or closed —
// so a late or repeated call writes the truth and never an old snapshot of it.
//
// Here goes FIRST, ahead of every other call a move makes, because it is the
// one a player notices: until it lands they cannot see the street they walked
// into. Grant before revoke, as everywhere in this file.
//
// If they move again while this is writing, it goes round again with the new
// place, so the last write is always where they actually are. The channel
// doctor is still the net for anything a failed call leaves.
async function syncLocationAccess(prisma, characterId, { channelIds = [], zoneRoleIds = [] } = {}) {
  if (!process.env.DISCORD_TOKEN || !characterId) return;
  return oneAtATime(characterId, async () => {
    const touched = new Set(channelIds.filter(Boolean));
    const roles = new Set(zoneRoleIds.filter(Boolean));

    for (let pass = 0; pass < 3; pass++) {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: {
          id: true,
          discordUserId: true,
          locationId: true,
          status: true,
          discordMirrored: true,
          location: { select: { discordChannelId: true, zone: { select: { discordRoleId: true } } } },
        },
      });
      // Not mirrored holds no Discord access at all (CHAT.md §6), so there is nothing to write.
      if (!character?.discordUserId || !character.discordMirrored) return;
      const discordUserId = character.discordUserId;
      // Nor does anybody who isn't alive: a turret that killed them on arrival
      // has already had applyDeathTeardown take everything off, and re-opening
      // the street here would let a corpse go on reading the room it died in.
      // What the move touched is closed and nothing is opened.
      if (character.status !== "ALIVE") {
        for (const channelId of touched) await closeLocationTo(discordUserId, channelId);
        return;
      }
      const hereChannelId = character.location?.discordChannelId ?? null;

      // A failed lookup opens Here and touches nothing else, rather than reading
      // as "watching nothing" and putting out every street they can still see.
      const watched = await vantagesFor(prisma, character).catch((err) => {
        console.error(`Move: vantage lookup failed for ${characterId}:`, err.message ?? err);
        return null;
      });
      const watchedChannelIds = new Set((watched ?? []).map((v) => v.location?.discordChannelId).filter(Boolean));

      await openLocationTo(discordUserId, hereChannelId, LOCATION_MEMBER_ALLOW);
      for (const channelId of watched ? touched : []) {
        if (channelId === hereChannelId) continue;
        if (watchedChannelIds.has(channelId)) {
          await openLocationTo(discordUserId, channelId, LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY);
        } else {
          await closeLocationTo(discordUserId, channelId);
        }
      }

      // Only when the move crossed a zone — a role write is a call on the guild's
      // busiest bucket, and nothing about it changed otherwise.
      if (roles.size > 0) {
        const hereRoleId = character.location?.zone?.discordRoleId ?? null;
        await swapRole(discordUserId, null, hereRoleId, "zone");
        for (const roleId of roles) {
          if (roleId !== hereRoleId) await swapRole(discordUserId, roleId, null, "zone");
        }
        await reconcileNarrowcastAccess(prisma, characterId, discordUserId).catch((err) =>
          console.error(`Move: narrowcast reconcile failed for ${characterId}:`, err.message ?? err),
        );
      }

      // Still standing where we just wrote? Done. Moved on in the meantime? The
      // place we just opened is now one more thing to set right.
      const now = await prisma.character.findUnique({ where: { id: characterId }, select: { locationId: true } });
      if (!now || now.locationId === character.locationId) return;
      if (hereChannelId) touched.add(hereChannelId);
      const hereRoleId = character.location?.zone?.discordRoleId ?? null;
      if (roles.size > 0 && hereRoleId) roles.add(hereRoleId);
    }
  });
}

// What a run of arrivals touched, per character, for syncLocationAccess: every
// street they left, entered or stopped watching, and the zone roles either side
// of any crossing that changed zone. A walk of eight hops is one call per
// character with the lot, so the place they ended up opens first instead of
// after seven streets they have already walked out of.
async function syncArrivalAccess(prisma, factsList) {
  const byCharacter = new Map();
  for (const facts of factsList ?? []) {
    if (!facts?.characterId) continue;
    if (!byCharacter.has(facts.characterId)) byCharacter.set(facts.characterId, { channelIds: [], zoneRoleIds: [] });
    const into = byCharacter.get(facts.characterId);
    into.channelIds.push(
      facts.toLocation?.discordChannelId,
      facts.fromLocation?.discordChannelId,
      ...(facts.droppedVantages ?? []).map((v) => v.location?.discordChannelId),
    );
    if (facts.fromLocation?.zoneId !== facts.toLocation?.zoneId) {
      into.zoneRoleIds.push(facts.fromLocation?.zone?.discordRoleId, facts.toLocation?.zone?.discordRoleId);
    }
  }
  for (const [characterId, touched] of byCharacter) {
    await syncLocationAccess(prisma, characterId, touched).catch((err) =>
      console.error(`Move: access sync failed for ${characterId}:`, err.message ?? err),
    );
  }
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
    where: { locationId, status: "ALIVE", discordMirrored: true },
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
  const tagSlugs = await withRingTokens(prisma, character.id, character.tags);
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

// Everything a location change must do in Discord once the DB write has landed: swap the location overwrite, announce a gate crossing, offer to hold a keyed way open, swap the zone role and reconcile narrowcast if the zone changed, then private-room membership and standing conversation invites wherever they now stand. `entry` is { characterId, fromLocationId, toLocationId } — zones are read from the locations, and the character row is re-read so a stale caller can't swap the wrong account.
// `walked` says the character got here ON FOOT, and only a walk leaves the place behind them lit (db/lib/vantages.js). It defaults to FALSE and the two travel callers opt in, so a GM teleport, a rite, a threat spawn, a staged "Relocate to", Xom and a first placement all leave nothing behind — you cannot keep watching a street you never walked out of.
async function applyArrivalFacts(prisma, { characterId, fromLocationId, toLocationId, walked = false }) {
  if (!characterId || !toLocationId) return null;
  if (fromLocationId === toLocationId) return null;

  // The map remembers. Here rather than in performLocationMove because this function is the one every writer of Character.locationId runs (§4 below) — a GM teleport, first placement, a rite and the turn's arrival pass all land here; hooking the mover instead would leave each a hole in somebody's map. Before the Discord guard for the same reason a narrow-way dismount is: knowing where you've been is a database fact and must not depend on there being a token to talk to Discord with.
  // Wrapped, because losing a node off a map must never wedge a move — /map's own loader re-records the character's current location on every open, so a drop here heals itself next time they look.
  await recordArrival(prisma, { id: characterId }, toLocationId).catch((err) => {
    console.error(`Move: recording the visit failed for ${characterId}:`, err.message ?? err);
  });

  // A new place is a new encounter (docs/systemdocs/STRANGERS.md). The label that
  // told this person apart from lookalikes is dropped, so the first look here
  // rolls a fresh one. Every voice number on them goes dark until they next
  // speak. Here for the reason everything else here is: every relocation runs it.
  await clearPresence(prisma, characterId).catch((err) => {
    console.error(`Move: clearing the stranger label failed for ${characterId}:`, err.message ?? err);
  });

  // A hold is a hand on a shoulder, and it ends when the holder leaves — HOWEVER they leave. performLocationMove already does this inside its own transaction for walking off (INTERCEPT.md §3); this is the same clear for being taken away instead. Idempotent, so the walking case running it twice costs one no-op update.
  if (fromLocationId) {
    await releaseHeldBy(prisma, characterId).catch((err) =>
      console.error(`Move: releasing holds failed for ${characterId}:`, err.message ?? err),
    );
    // The same clear for a FIGHT (docs/systemdocs/ATTACK.md §7). releaseHeldBy deliberately won't touch one — everybody in it is held, and only the participant rows know who is still fighting — so they are what gets ended here: this person is out of it, and if their side is left with nobody the fight is over and the rest go free.
    // Never the fight at the place they just arrived: that is the one an ambush or an escort's charge just put
    // them in (performLocationMove runs before this), not one they are leaving.
    await leaveCombatsFor(prisma, characterId, "moved", { unlessAt: toLocationId })
      .then((out) => sendCombatDms(prisma, out.dms))
      .catch((err) => console.error(`Move: leaving the fight failed for ${characterId}:`, err.message ?? err));
    // An old one-on-one Attack still live from the turn the overhaul deployed (db/lib/attack.js, legacy).
    await closeFightsFor(prisma, characterId).catch((err) =>
      console.error(`Move: closing fights failed for ${characterId}:`, err.message ?? err),
    );
  }

  // Walking out lets go of the phone in your hand and hangs up any call on it
  // (docs/systemdocs/PHONES.md §3). Here rather than in performLocationMove for
  // the reason every clear above gives: this is the writer EVERY relocation
  // runs, so a teleport, a staged Relocate and a rite hang up as surely as
  // walking does. Above the Discord guard, because a call ending is a database
  // fact and must not depend on there being a token. Behind `fromLocationId`,
  // because a Resync, a revive and a first placement are not moves, and a
  // Resync silently killing a live call would be exactly the INTERCEPT bug.
  //
  // The far end reads "The call hung up." and is left on a dead line; the side
  // that walked out hears nothing, because they are not there and the room they
  // left made no noise. A phone that was ringing in their hand goes on ringing.
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

  // A request to pass the gate is withdrawn by leaving (docs/systemdocs/GATEHOUSE.md: "If the
  // character moves to a different location, their request is deleted"). Here for the reason
  // every clear above gives, and behind `fromLocationId` for the same one. An approved request's
  // own trip through the gate is not caught: the row is resolved before the character moves.
  // Inline rather than a call into db/lib/gatehouse.js, which requires this file back.
  if (fromLocationId) {
    await prisma.gatePassage
      .deleteMany({ where: { characterId, status: "PENDING" } })
      .catch((err) => console.error(`Move: withdrawing the gate request failed for ${characterId}:`, err.message ?? err));
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

  // What walking in here does to the nerves is a DB fact too — before the Discord guard, so it lands whether or not
  // there's a token to talk to Discord with (docs/systemdocs/MOOD.md). No
  // per-turn ration on the arrival cost: a mount's two crossings are two real
  // arrivals. The Cathedral's relief rations itself inside.
  await applyArrivalMood(prisma, { characterId, fromLocationId, toLocationId }).catch((err) => {
    console.error(`Move: mood on arrival failed for ${characterId}:`, err.message ?? err);
  });

  // Walking into an armed turret. Before the Discord guard and the early return, same reason the mood on arrival is: being shot is a database fact and must not depend on there being a token to announce it with. Wrapped, because a gun malfunctioning must never wedge a move.
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

  // The Vampire's compulsion (db/lib/vampireCompulsion.js, VAMPIRE.md §4): a Bloodcrazed or Wight Vampire
  // walking in on somebody to feed on, or somebody to feed on walking in on one, starts the fight now. After
  // the presence NOTIFY, so the room already shows them standing here when the attack is announced. Not on a
  // first placement (`fromLocationId` null — creation, a revive, a GM resync): turn open catches those. A
  // turret may have killed them above; compelOnArrival re-reads them and skips the dead.
  if (fromLocationId && character?.status === "ALIVE") {
    const { compelOnArrival } = require("./vampireCompulsion");
    await compelOnArrival(prisma, { characterId, locationId: toLocationId }).catch((err) =>
      console.error(`Move: vampire compulsion failed for ${characterId}:`, err.message ?? err),
    );
  }

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
    droppedVantages,
  };
}

// The Discord half of an arrival — everything the token guard used to stand in
// front of, in the order it has always run. `facts` is what applyArrivalFacts
// returned; NULL means there was nothing to do, so there is nothing to tell.
//
// Every call in here is sequential and never Promise.all'd: Discord bans an IP
// for an hour after ten thousand invalid responses (ARCHITECTURE.md §5).
// Deferring this work moved WHEN it runs, never how fast.
//
// `access: false` is for a caller that already ran syncArrivalAccess over the
// whole list up front — a walk, or a party — so each arrival here skips it.
async function applyArrivalDiscord(prisma, facts, { access = true } = {}) {
  if (!facts) return;
  const {
    characterId,
    fromLocationId,
    toLocationId,
    character,
    toLocation,
    droppedWatch,
    searchesOff,
  } = facts;

  // The presence notify already went out with the facts, so a box with no token
  // and an account with nobody behind it both have simply nothing to say here.
  if (!process.env.DISCORD_TOKEN) return;
  if (!character?.discordUserId) return;
  const discordUserId = character.discordUserId;

  // The Location channel and the zone role, FIRST — before any DM, because a
  // player who has moved and cannot see where they are notices that before
  // anything else. syncLocationAccess catches its own failures, so nothing
  // after this line is lost to a Discord 5xx in it.
  if (access) await syncArrivalAccess(prisma, [facts]);

  // The watch this move just ended, told plainly — the delete happened above the guard, only the letter waits for a token.
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

  // Not mirrored to Discord holds this account out of every channel (CHAT.md §6), which syncLocationAccess above knows. Everything below still runs: the gate crossing is scenery the rest of the zone reads, the keyed-door offer and parked-mount note are DMs, and the carry, corpse and presence work is the database.
  await announceGateCrossing(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: gate announcement failed for ${characterId}:`, err.message ?? err),
  );

  await offerToHoldKeyed(prisma, character, fromLocationId, toLocation).catch((err) =>
    console.error(`Move: keyed-door offer failed for ${characterId}:`, err.message ?? err),
  );

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
  syncArrivalAccess,
  syncLocationAccess,
  materializeDiscordPresence,
  rehomeStandingCharacters,
  reconcileNarrowcastAccess,
  announceLevelFor,
};
