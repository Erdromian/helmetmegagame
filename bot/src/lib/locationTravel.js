const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  performLocationMove,
  freeMovesLeft,
  freeZoneMovesReason,
} = require("@lifeweb/db/lib/locationTravel");
const {
  ESCORT_SELECT,
  escortCandidates,
  escortAuthority,
  attach,
  detach,
  partyOf,
  createEscortOffer,
} = require("@lifeweb/db/lib/escort");
const { stowedMounts } = require("@lifeweb/db/lib/mounts");
const { applyLocationMoveSideEffects } = require("@lifeweb/db/lib/locationMove");
const { putChannelOverwrite } = require("@lifeweb/db/lib/discordRest");
const { LOCATION_MEMBER_ALLOW } = require("@lifeweb/db/lib/zoneChannelSpec");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");

// The gateway half of the Travel flow. Every rule and every database write
// lives in db/lib/locationTravel.js so the web app runs the identical ones;
// this file is the Discord vocabulary around it — the pickers and the REST
// side effects db/lib/locationMove.js owns.
//
// Custom ids, all "loc:"-namespaced (COMMANDS.md): loc:open (the #turns
// console button, unchanged since the zone rework and baked into consoles
// already posted), loc:pick, loc:bring, loc:confirm:{locationId},
// loc:cancel. The anchor buttons loc:who / loc:secret / loc:converse, and
// loc:gate:{linkId} for a modular gate — which rides on the watchtower's
// starter post rather than an anchor — are defined in
// db/lib/locationAnchorRow.js, because the sync posts them.

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

const PICK_ID = "loc:pick";
const BRING_ID = "loc:bring";
const CONFIRM_PREFIX = "loc:confirm:";
const CANCEL_ID = "loc:cancel";

// NOTHING is parked between clicks any more. The drag multi-select used to
// hold its picks in an in-memory Map for ten minutes, because Discord hands
// the Confirm button no memory of the select before it — a restart between
// the two clicks silently cost a player their passengers. An escort is a row
// on the follower now (Character.escortedById), so the select writes it
// immediately and Confirm reads it back from the database. The Map, its TTL
// and its three helpers are gone.

// The mover, loaded with exactly the shape performLocationMove and
// escortAuthority need — a partial row here would silently mis-authorize an
// escort. ESCORT_SELECT is the wider of the two shapes (it carries the
// faction relation the authority reads), so it is the one to load.
async function loadMover(discordUserId) {
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: ESCORT_SELECT,
  });
}

// "A", "A and B", "A, B and C".
function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// `from` is the mover's current location (null on a first placement, which is
// arrival rather than travel and costs nothing). The option description is
// the whole cost model in one line: a step inside the zone is free on a
// cooldown, an edge that leaves the zone spends the Move.
function buildLocationSelectRow(locations, from) {
  const shown = locations.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(PICK_ID)
    .setPlaceholder("Choose where to go…")
    .addOptions(
      shown.map((location) => ({
        label: location.name.slice(0, 100),
        value: location.id,
        description: (from
          ? location.zoneId === from.zoneId
            ? "Same zone"
            : `Into ${location.zone?.name ?? "another zone"} — free, or your Move and a day's walk ‡`
          : `${location.zone?.name ?? "Somewhere"} ‡`
        ).slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Who you are taking with you — the Discord twin of the party rack on /play.
// Null when nobody here can be brought: an empty select menu is rejected by
// Discord, and a disabled one just asks a question with no answer.
//
// Unlike the drag select this replaces, it is NOT bound to a destination and
// it does not have to be re-answered before every hop. It sets the party, and
// the party persists. It is pre-ticked with whoever is already following, so
// deselecting somebody is how you put them down.
function buildBringRow(candidates) {
  const shown = candidates.slice(0, MENU_OPTION_LIMIT);
  if (shown.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(BRING_ID)
    .setPlaceholder("Who comes with you?")
    .setMinValues(0)
    .setMaxValues(shown.length)
    .addOptions(
      shown.map((candidate) => ({
        label: candidate.name.slice(0, 100),
        value: candidate.id,
        default: candidate.attached,
        description: (candidate.verdict === "ASK"
          ? "You'd have to ask them ‡"
          : `${candidate.reason ?? "comes with you"} ‡`
        ).slice(0, 100),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Applies a Bring select. Anyone ticked who needs consent gets an Offer DM
// instead of being attached; everybody else attaches on the spot, and
// everybody untricked is put down. Returns { attached, asked, dropped, dms }
// so the caller can say what happened in one line.
async function applyBring(mover, pickedIds, turn) {
  const picked = new Set(pickedIds);
  const candidates = await escortCandidates(prisma, mover, turn?.number ?? null);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out = { attached: [], asked: [], dropped: [], dms: [] };

  for (const row of await partyOf(prisma, mover.id)) {
    if (!picked.has(row.id)) {
      await detach(prisma, row.id);
      out.dropped.push(row.name);
    }
  }

  for (const id of picked) {
    const candidate = byId.get(id);
    // A picker is a hint; this is the lock. Somebody who walked off between
    // the menu being drawn and it being answered simply isn't taken.
    if (!candidate || candidate.attached) continue;
    if (candidate.verdict === "ASK") {
      if (!turn) continue;
      const target = await prisma.character.findUnique({ where: { id }, select: ESCORT_SELECT });
      if (!target || !escortAuthority(mover, target, turn.number)) continue;
      const offer = await createEscortOffer(prisma, { actor: mover, target, turn });
      if (offer.ok) {
        out.asked.push(target.name);
        out.dms.push(offer.dm);
      }
      continue;
    }
    if (await attach(prisma, mover.id, id)) out.attached.push(candidate.name);
  }
  return out;
}

function buildConfirmRow(locationId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${locationId}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

// Executes a validated move. performLocationMove owns the rules and the
// writes; everything below is the Discord work it deliberately leaves to its
// caller, run per moved character and never allowed to throw — a failed role
// swap must not make a committed move look refused. The channel doctor
// reconciles whatever a miss here leaves.
async function performMove(character, targetLocation) {
  const result = await performLocationMove(prisma, character, targetLocation);
  if (!result.ok) return result;

  // Followers the way would not take. They have already been detached and are
  // still standing where they were; both sides are owed a word, and the
  // leader's must not say WHY — naming a hidden crawl's refusal would
  // announce that the crawl is there (MAP.md §2a).
  for (const entry of result.leftBehind ?? []) {
    if (character.discordUserId) {
      await sendDm(
        prisma,
        character.discordUserId,
        entry.reason === "edge"
          ? `*You can't move ${entry.character.name} through here. They stay behind.* ‡`
          : `*${entry.character.name} isn't with you any more.* ‡`,
        { kind: DM_KIND.QUIET },
      ).catch(() => {});
    }
    if (entry.character.status === "ALIVE" && entry.character.discordUserId) {
      await sendDm(
        prisma,
        entry.character.discordUserId,
        `*${character.name} went on without you.* ‡`,
        { kind: DM_KIND.QUIET },
      ).catch(() => {});
    }
  }

  // A paid crossing is a day on the road: nobody has moved yet, so there are
  // no roles to swap and no Caving Die to roll — db/lib/travelArrivalPass.js
  // does all of it at the next turn advance (MAP.md §3). The one thing owed
  // now is a word to the passengers, who did not press anything.
  if (result.deferred) {
    for (const entry of result.travelers) {
      if (entry.character.id === character.id) continue;
      if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
      await sendDm(
        prisma,
        entry.character.discordUserId,
        `*${character.name} is taking you to ${targetLocation.name}. You'll get there next turn.* ‡`,
        { kind: DM_KIND.QUIET },
      ).catch((err) =>
        console.error(`Drag DM to ${entry.character.discordUserId} failed:`, err.message ?? err),
      );
    }
    return result;
  }

  // Sequential on purpose: each entry is a handful of REST calls, and firing
  // a whole dragged party's worth at once is the shape that trips the
  // invalid-response breaker (db/lib/discordRest.js).
  for (const entry of result.moved) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: entry.character.id,
      fromLocationId: entry.fromLocationId,
      toLocationId: entry.toLocationId,
      // Only ever computed for the mover themselves — performLocationMove
      // checks the mover's own equipped mount against the edge, never a
      // dragged passenger's.
      dismounted: entry.character.id === character.id ? result.dismounted : undefined,
    }).catch((err) =>
      console.error(`Move side effects failed for ${entry.character.name}:`, err.message ?? err),
    );
  }

  // The Caving Die's "on arrival" trigger — see db/lib/locationTravel.js and
  // docs/systemdocs/CAVING.md. Null on any zone that isn't a cave level, or
  // if the character had already rolled for this turn some other way.
  for (const entry of result.moved) {
    if (!entry.cavingDm) continue;
    await sendDm(prisma, entry.cavingDm.discordUserId, entry.cavingDm.content).catch((err) =>
      console.error(`Caving arrival DM to ${entry.cavingDm.discordUserId} failed:`, err.message ?? err),
    );
  }

  // Being carried off is the one thing that happens to a player without them
  // pressing anything, so it is the one thing that has to be told. Corpses
  // and departed accounts are skipped. db/lib/dm.js#sendDm writes the "»".
  for (const entry of result.moved) {
    if (entry.character.id === character.id) continue;
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      prisma,
      entry.character.discordUserId,
      `*${character.name} brought you along to ${targetLocation.name}.* ‡`,
      { kind: DM_KIND.QUIET },
    ).catch((err) =>
      console.error(`Drag DM to ${entry.character.discordUserId} failed:`, err.message ?? err),
    );
  }

  return result;
}

// A rejoining player comes back with every role stripped by Discord AND with
// their Location overwrite swept by the guildMemberRemove path, so this is a
// pure re-grant with nothing to move away from — the same shape Revive uses
// (CHARACTERS.md §5b). Gateway-side because guildMemberAdd already holds the
// member; the Location half is REST, because an overwrite is a channel edit
// rather than a member edit.
async function restoreStandingRoles(member, character) {
  // A "web only" character holds no Discord access on purpose, so a rejoin
  // restores nothing (docs/systemdocs/CHAT.md §6). Their sight of the game is
  // /play, which never went away.
  if (character.webOnly) return;

  const zoneRoleId = character.zone?.discordRoleId ?? null;
  if (zoneRoleId) {
    await member.roles
      .add(zoneRoleId)
      .catch((err) =>
        console.error(
          `Failed to grant ${member.id} the ${character.zone?.name ?? "zone"} role:`,
          err.message,
        ),
      );
  }

  const channelId = character.location?.discordChannelId ?? null;
  if (channelId) {
    await putChannelOverwrite(channelId, member.id, {
      allow: String(LOCATION_MEMBER_ALLOW),
      type: 1,
    }).catch((err) =>
      console.error(
        `Failed to reopen ${character.location?.name ?? "location"} to ${member.id}:`,
        err.message,
      ),
    );
  }
}

module.exports = {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  buildConfirmRow,
  performMove,
  restoreStandingRoles,
  freeMovesLeft,
  freeZoneMovesReason,
  stowedMounts,
};
