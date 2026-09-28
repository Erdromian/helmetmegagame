"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  prisma,
  fateCapacity,
  isDynastyHead,
  isDynastyMember,
  normalizeAntagonistSlugs,
  parseStartingTag,
  isMerchantRole,
  setMerchantFace,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { dynastyLastName, propagateDynastyLastName } from "@/lib/dynasty";
import { isSuperadmin } from "@/lib/superadmin";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { readGameState, effectivePlayerCount } from "@lifeweb/db/lib/gameState";
import { mintSpawnRing } from "@lifeweb/db/lib/ringMint";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { seedStartingMap } from "@lifeweb/db/lib/mapMemory";
import { seedAcquaintances } from "@lifeweb/db/lib/acquaintances";
import { seedNukeBriefing } from "@lifeweb/db/lib/nukeBriefing";
import { issueSlaveContract } from "@lifeweb/db/lib/slaveContract";
import { stampBlankCollars, COLLAR_LOCKED_SLUG } from "@lifeweb/db/lib/collar";
import {
  isWanted,
  postWantedPosters,
  isDebtor,
  postDebtorNotices,
  DEBTOR_STARTING_OBOLS,
} from "@lifeweb/db/lib/wantedPoster";
import { addToStack, addToRoomStack } from "@lifeweb/db/lib/tagWrites";
import { OBOL_SLUG } from "@lifeweb/db/lib/depotState";
import { varyStartingPurse } from "@lifeweb/db/lib/startingVariance";
import { openStartingAccount } from "@lifeweb/db/lib/startingAccount";
import { turnStamp } from "@lifeweb/db/lib/economyLedger";
import {
  ensureCharacterRole,
  syncCharacterNarrowcastAccess,
  getGuildMember,
  isLeaderWhitelisted,
  isGm,
  onRoster,
  playtestRosterClosed,
} from "@/lib/discordGuild";
import { isPlayerCursed } from "@lifeweb/db/lib/curse";
import { lateJoinOpeningFor, lateJoinCapacity } from "@lifeweb/db/lib/lateJoin";
import { loadLiveParty, latePartyGate, partySeatUnderLock } from "@lifeweb/db/lib/lateParty";
import {
  computeBudget,
  isSpawnOnly,
  isRoleSelectable,
  tagsById as buildTagsById,
  effectiveTotalCost,
  negativeTagCount,
  negativeTagPoints,
  DEFAULT_MAX_DRAWBACK_TAGS,
  DEFAULT_MAX_DRAWBACK_POINTS,
  chainSiblingsToRemove,
  heldHigherTiers,
  requirementSatisfied,
  exclusiveConflict,
  conflictingTag,
  roleExcluded,
  CURSED_REFUSAL,
} from "@/lib/characterCreation";

import { reserveFate, releaseFate } from "@lifeweb/db/lib/fateReservation";
import { closeDeadchatTo } from "@lifeweb/db/lib/deadchat";
import { heldSeats } from "@lifeweb/db/lib/seatCount";
import { settleLobbyEntry, seatsAllocated } from "@lifeweb/db/lib/lobby";
import { recordArchiveEvent } from "@/lib/archive";
import {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  normalizeEarnedHonorific,
  GENDERS,
} from "@/lib/characterName";

// When somebody may make a character at all (LOBBY.md §1): while the game
// runs or has ended, or — for a GM — in any phase (the lobby's Skip button).
// A playtester does NOT skip ahead here — their bypass is the roster check below.
function creationOpen(phase, member) {
  if (phase === "RUNNING" || phase === "ENDED") return true;
  return isGm(member);
}

// While a late party is live, its fates are the only ones anybody may take.
const PARTY_LOCKED_REFUSAL = "A lateparty is mustering. Only its fates are open right now.";
// A MUSTER party is drawn, never picked from (db/lib/latePartyRaffle.js).
const MUSTER_REFUSAL = "A lateparty is mustering. Its fates are drawn at the end of the turn.";
// The party ended between picking a fate and confirming it. No "pick another":
// for somebody the curse still holds, there is no other.
const PARTY_OVER_REFUSAL = "The lateparty left before you finished.";

// Creates a character from the wizard's Confirm step. Everything posted is
// re-derived and re-checked. The seat-cap recheck closes a real race (Prisma
// READ COMMITTED); the `FOR UPDATE` row lock on Role actually serializes it.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is GM-granted only — not read here.
  const rawHonorific = formData.get("honorific");
  const postedGender = formData.get("gender")?.toString();
  const gender = GENDERS.includes(postedGender) ? postedGender : "NEUTRAL"; // closed enum, junk lands as NEUTRAL
  const firstName = part("firstName", NAME_LIMITS.firstName);
  let lastName = part("lastName", NAME_LIMITS.lastName); // not const: a locked-seat role overwrites this below
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  const postedRoleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);
  // Consent for secretly-assigned antagonist seats; normalizeAntagonistSlugs
  // keeps junk slugs out. Whitelisted boxes are dropped below.
  const postedOptIns = formData.getAll("antagonistOptIns");

  if (!firstName) return { error: "Your character needs a first name." };
  // One word each — the wizard gates this too, but the form can be hand-posted.
  if (/\s/.test(firstName) || /\s/.test(lastName ?? "")) {
    return { error: "First and last names are one word each." };
  }

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    redirect("/character");
  }

  // A LATE PARTY (db/lib/lateParty.js), read once. While one is live it locks
  // every fate but its own, so a lobby seat from the roll is not honoured
  // either -- the party is the whole menu.
  const party = await loadLiveParty(prisma, { excludeDiscordUserId: discordUserId });

  // A seat from the roll, inside its window, is the role regardless of what
  // was posted (LOBBY.md §4). The whitelist gate is skipped for it. The curse
  // is NOT — see below. An entry whose role has since left the catalog is no assignment at
  // all — treating it as one would lift the gates below for the form's role.
  // A seat a late party's muster DREW is honoured always, party live or not:
  // it was handed out, and it carries the party's exemptions with it.
  const seatEntry = await prisma.lobbyEntry.findFirst({
    where: { discordUserId, status: "ASSIGNED", expiresAt: { gt: new Date() }, assignedRoleId: { not: null } },
    select: { id: true, assignedRoleId: true, latePartyId: true },
  });
  const assignedEntry = seatEntry && (seatEntry.latePartyId || !party) ? seatEntry : null;
  const drawnPartyId = assignedEntry?.latePartyId ?? null;
  const roleId = assignedEntry?.assignedRoleId ?? postedRoleId;
  if (!roleId) return { error: "Pick a role before confirming." };

  const [role, config, state, member, openTurn, cursed] = await Promise.all([
    prisma.role.findUnique({
      where: { id: roleId },
      include: {
        startingZone: true,
        startingLocation: { include: { zone: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    getGuildMember(discordUserId, 0), // always fresh: a gate must not refuse on a stale roles list
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    // A database question now, not a Discord role (db/lib/curse.js). Read
    // here rather than inside the transaction below, which would always answer no once the ALIVE row exists.
    isPlayerCursed(prisma, discordUserId),
  ]);
  if (!role) return { error: "That role no longer exists." };

  // A LATE JOIN (db/lib/lateJoin.js) is a spawn-only seat the GM has opened to
  // whoever wants it. Read once, here, and then used for three separate
  // answers below: it lets the seat past the spawn-only refusal, past the
  // curse, and it replaces fateCapacity() as the cap inside the transaction.
  const lateJoin = await lateJoinOpeningFor(prisma, role.slug);
  const lateJoinSeats = lateJoinCapacity(lateJoin);
  const openLateJoin = lateJoinSeats > 0;

  // Launch gate: the game running (or ended) AND this member approved — the
  // real enforcement boundary, not the wizard's UI. Superadmin bypasses both.
  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !creationOpen(state?.phase, member)) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !onRoster(member, { playtestMode: playtestRosterClosed(config) })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }

  // A party fate is let past the spawn-only refusal and the curse below, and
  // its cap is the party's slots. Any other fate is shut while the party is
  // live; only a superadmin makes one anyway, as they can everything else. A
  // MUSTER party is not picked from at all: the drawn seat above is the only
  // way into it.
  const partyGate = drawnPartyId ? "drawn" : latePartyGate(party, role.slug);
  if (partyGate !== "drawn" && party?.party.mode === "MUSTER" && !bypass) return { error: MUSTER_REFUSAL };
  if (partyGate === "locked" && !bypass) return { error: PARTY_LOCKED_REFUSAL };
  const partyId = drawnPartyId ?? (partyGate === "open" ? party.party.id : null);
  const partyFate = Boolean(partyId);

  // Never pickable — the picker not listing these is a hint, not a lock. A
  // late join the GM has opened is one exception, a late party's fate the other.
  if (isSpawnOnly(role) && !openLateJoin && !partyFate) {
    return assignedEntry
      ? { error: "Your assigned seat can only be spawned by a GM." }
      : { error: "That role isn't open to anyone." };
  }

  // Split so each rejection gets its own message.
  const leaderWhitelisted = bypass || isLeaderWhitelisted(member);
  if (!assignedEntry && role.requiresWhitelist && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }

  // An unburied body is a full stop, not a narrowed menu (db/lib/curse.js). It
  // used to leave Migrant and Bum open at six fewer points; now nobody gets
  // made until the corpse is dealt with. A roll seat is no exemption — that
  // window belongs to the lobby, long before anybody has died.
  // A late-join seat is exempt, on purpose: what the curse costs you is your
  // place in Ravenheart, and this is somebody arriving from outside it. A late
  // party's fate is exempt too, even from a curse a GM forced on: the party is
  // the free respawn (LATE-PARTIES.md).
  if (!bypass && cursed && !openLateJoin && !partyFate) {
    return { error: CURSED_REFUSAL };
  }

  if (!assignedEntry && !isRoleSelectable({ role, leaderWhitelisted })) {
    return { error: "That role isn't available to you." };
  }

  const antagonistOptIns = normalizeAntagonistSlugs(postedOptIns, { whitelisted: leaderWhitelisted });

  // Dynasty seats wear the Baron's last name, never what was typed. Null until a Baron exists.
  if (isDynastyMember(role.slug)) lastName = await dynastyLastName();
  const effectiveGender = role.lockedGender ?? gender; // dynasty seats fix gender too

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost non-purchasable tag or a mastery tag the wizard
  // never offered. Both fall out of the count check below.
  const selected = tagIds.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagIds }, purchasable: true, mastery: false },
        include: { group: { select: { requiredTagId: true } } }, // the hidden-category gate requirementSatisfied() checks below
      })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  // Role tags come from the catalog by SLUG (Role.startingTagSlugs, resolved
  // by db:sync-roles). An entry may carry a count — "obol x5" — parsed out
  // for lookup and kept beside it, since a `slug: { in: [...] }` set lookup
  // would collapse a repeated slug. See db/lib/startingTags.js.
  const startingWanted = new Map();
  for (const entry of role.startingTagSlugs) {
    const { slug, quantity } = parseStartingTag(entry);
    startingWanted.set(slug, (startingWanted.get(slug) ?? 0) + quantity);
  }
  // The purse is the middle of a range: rolled within 10% once, here, for this
  // character (db/lib/startingVariance.js).
  varyStartingPurse(startingWanted);
  const startingTags = startingWanted.size
    ? await prisma.tag.findMany({ where: { slug: { in: [...startingWanted.keys()] } } })
    : [];

  // A word this character has no claim to lands as null, not a failed create.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: [...selected, ...startingTags].map((t) => t.slug),
    roleSlug: role.slug,
    gender: effectiveGender,
  });
  const name = formatCharacterName({ honorific, firstName, title: null, lastName });

  // The full catalog, not just what's selected/granted, so a chain walk
  // (parentTagId) never dead-ends on an ancestor the client didn't send.
  const allTags = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      pointCost: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const byId = buildTagsById(
    allTags.map((t) => ({ ...t, conflictsWithIds: t.conflictsWith.map((c) => c.id) })),
  );
  const grantedIds = startingTags.map((t) => t.id);

  // Guards against submitting two chain tiers at once, or a tier below one the role already grants.
  for (const tag of selected) {
    if (chainSiblingsToRemove(tag, byId, tagIds).length > 0) {
      return { error: "You can only hold one tier of the same skill chain." };
    }
    if (heldHigherTiers(tag, byId, grantedIds).length > 0) {
      return { error: "Your role already grants a higher tier of that skill chain." };
    }
  }

  // Seats that may never hold a tag at all (Tag.excludedRoleSlugs) — the menu drops these rows entirely.
  for (const tag of selected) {
    if (roleExcluded(tag, role.slug)) {
      return { error: `A ${role.name} can't take ${tag.name}.` };
    }
  }

  // Prerequisites: requiredTag plus the hidden-category group gate must be satisfied by something granted or selected.
  const heldOrSelectedIds = [...grantedIds, ...tagIds];
  for (const tag of selected) {
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      return { error: "One of those tags is missing a prerequisite." };
    }
  }

  // One exclusive Belief per character — checked against role-granted starting tags too.
  for (const tag of selected) {
    const conflict = exclusiveConflict(tag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} and ${conflict.name} can't be held at the same time.` };
    }
  }

  // Named conflict pairs (Sober vs Addiction). Reads byId, not the bare `tag` — `selected` omits conflictsWith.
  for (const tag of selected) {
    const catalogTag = byId.get(tag.id) ?? tag;
    const conflict = conflictingTag(catalogTag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} conflicts with ${conflict.name}.` };
    }
  }

  // Both drawback ceilings (TAGS.md §4a), checked separately so a refusal
  // names which one stopped the build. Each counts only bought tags.
  const maxDrawbacks = config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS;
  const drawbackCount = negativeTagCount(selected);
  if (drawbackCount > maxDrawbacks) {
    return {
      error: `You picked ${drawbackCount} drawbacks and can take at most ${maxDrawbacks}.`,
    };
  }

  const maxDrawbackPoints = config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS;
  const drawbackPoints = negativeTagPoints(selected);
  if (drawbackPoints > maxDrawbackPoints) {
    return {
      error: `Your drawbacks claim back ${drawbackPoints} points and you can claim at most ${maxDrawbackPoints}.`,
    };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role });
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // Union bought + granted tags, refunding nothing (already budget-checked).
  // A tag with a catalog duration must arrive already stamped.
  const tagIdsToGrant = new Map();
  for (const tag of startingTags) {
    const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
    const quantity = tag.stackable ? (startingWanted.get(tag.slug) ?? 1) : 1; // count only means anything on a stackable tag
    tagIdsToGrant.set(tag.id, { source: "GM_GRANT", expiresTurn, quantity });
  }
  for (const tag of selected) {
    if (!tagIdsToGrant.has(tag.id)) {
      const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
      tagIdsToGrant.set(tag.id, { source: "POINT_BUY", expiresTurn, quantity: 1 });
    }
    // A purchased higher tier replaces a role-granted lower tier of the same chain.
    for (const lowerId of chainSiblingsToRemove(tag, byId, grantedIds)) {
      tagIdsToGrant.delete(lowerId);
    }
  }

  // Hoisted above the transaction so the obol grant and the poster/notice fan-out both read one variable.
  const heldSlugs = [...selected, ...startingTags]
    .filter((t) => tagIdsToGrant.has(t.id))
    .map((t) => t.slug);
  // The shape travelOptions wants (db/lib/locationGraph.js). Nothing is
  // equipped at creation, so `equipped: false` is the whole truth.
  const heldTagRows = heldSlugs.map((slug) => ({ equipped: false, tag: { slug } }));

  // Off by default, no checkbox: a fresh character starts on the web only,
  // and picks up Discord later from the Bio card if they want it
  // (db/lib/discordMirroring.js#setDiscordMirrored). discordMirroredChangedAt
  // stays null so switching it on right away costs no cooldown.

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The lock that actually closes the race — see the header comment.
      // heldSeats counts seated characters plus others' holds/assignments; the caller's own are left out.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
      let held;
      let cap;
      if (partyFate) {
        // A party fate counts only the characters the party made, against
        // the party's slots -- re-read under the party's own row lock, so a
        // superadmin ending it mid-wizard wins. A DRAWN seat was handed out
        // already, so it stands even if the party has ended since: it is
        // checked against the slots only while there is a party to check.
        const seat = await partySeatUnderLock(tx, partyId, role, { excludeDiscordUserId: discordUserId });
        if (!seat && !drawnPartyId) throw new Error("PARTY_OVER");
        held = seat?.held ?? 0;
        cap = seat?.cap ?? Infinity;
      } else {
        held = await heldSeats(tx, role, {
          excludeDiscordUserId: discordUserId,
          countReservations: seatsAllocated(state?.phase),
        });
        // A late join's cap is the GM's number of chairs, not a share of the
        // roster — re-read under the lock, since a GM closing the door between
        // the check above and here must win.
        cap = openLateJoin
          ? lateJoinCapacity(await lateJoinOpeningFor(tx, role.slug))
          : fateCapacity(role, effectivePlayerCount(config, state));
      }
      if (held >= cap) {
        throw new Error("ROLE_FULL");
      }
      // Release the caller's own hold in the same transaction.
      await releaseFate(tx, discordUserId);

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific,
          firstName,
          title: null,
          lastName,
          name,
          gender: effectiveGender,
          age,
          discordMirrored: false, // set before placement runs, so applyLocationMoveSideEffects sees it already off and grants nothing (CHAT.md §6a)
          roleId: role.id,
          roleTitle: role.name,
          // Denormalization contract: every writer of locationId writes
          // location.zoneId in the same statement.
          locationId: role.startingLocationId ?? null,
          zoneId: role.startingLocation?.zoneId ?? null,
          tagPoints: budget - spent,
          antagonistOptIns,
          latePartyId: partyId,
        },
      });

      await tx.characterTag.createMany({
        data: [...tagIdsToGrant].map(([tagId, { source, expiresTurn, quantity }]) => ({
          characterId: character.id,
          tagId,
          source,
          expiresTurn,
          quantity: quantity ?? 1,
        })),
      });

      // Any assigned seat this player held is spent by this character (db/lib/lobby.js#settleLobbyEntry).
      await settleLobbyEntry(tx, discordUserId, character.id);

      // Keeps the same answer, so a later game opens with it ticked already (LOBBY.md §2).
      await tx.playerPreference.upsert({
        where: { discordUserId },
        create: { discordUserId, antagonistOptIns },
        update: { antagonistOptIns },
      });

      // The Merchant (or the Exactor) advanced him half; the paper says the rest (db/lib/wantedPoster.js#DEBTOR_STARTING_OBOLS).
      if (isDebtor(heldSlugs)) {
        const obolTag = await tx.tag.findUnique({
          where: { slug: OBOL_SLUG },
          select: { id: true, stackable: true },
        });
        if (obolTag) {
          await addToStack(tx, character.id, obolTag.id, DEBTOR_STARTING_OBOLS, {
            source: "EVENT",
            stackable: obolTag.stackable,
          });
        }
      }

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { error: `${role.name} was taken while you were deciding. Pick another role.` };
    }
    if (err.message === "PARTY_OVER") {
      return { error: PARTY_OVER_REFUSAL };
    }
    throw err;
  }

  // Discord side effects, best-effort. Placement is one call — the shared
  // location fan-out swaps the zone/location roles, reconciles narrowcast
  // access and private-room membership. Personal role is separate — a mentionable name token, grants nothing.
  await ensureCharacterRole(created).catch(() => {});
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch(() => {});
  }
  // The map this seat wakes up with (db/lib/mapMemory.js). After the
  // transaction, so travelOptions reads the tags just granted, and after placement.
  await seedStartingMap(prisma, { ...created, tags: heldTagRows }, role.slug, heldSlugs).catch(() => {});
  // The people this seat already knows, and everyone who already knows this
  // seat (db/lib/acquaintances.js), plus the ATM PIN.
  await seedAcquaintances(prisma, created.id).catch((err) => console.error("seedAcquaintances failed:", err));
  // A leader's note about where the bomb is (docs/systemdocs/NUKE.md §4). Best-effort, like the line above.
  await seedNukeBriefing(prisma, created.id).catch((err) => console.error("seedNukeBriefing failed:", err));

  // Somebody who arrives already Wanted has three posters go up in the same breath (db/lib/wantedPoster.js). Best-effort.
  if (isWanted(heldSlugs)) {
    await postWantedPosters(
      prisma,
      { ...created, zoneName: role.startingLocation?.zone?.name ?? null },
      openTurn,
    ).catch((err) => console.error("postWantedPosters failed:", err));
  }
  // Same shape for Debtor, in the Merchant's rooms or the Exactor's Den by which Debtor tag it is.
  if (isDebtor(heldSlugs)) {
    await postDebtorNotices(prisma, { ...created, zoneName: role.startingLocation?.zone?.name ?? null }, openTurn, heldSlugs)
      .catch((err) => console.error("postDebtorNotices failed:", err));
  }
  // The Slave's papers (db/lib/slaveContract.js). Keyed on the ROLE, not a tag:
  // the contract is what the seat is, and a collar can be taken off somebody who
  // was never sold. Best-effort like the posters above — a character who arrives
  // without their paperwork is a GM fix, not a failed creation.
  if (role.slug === "slave") {
    await issueSlaveContract(prisma, created)
      .catch((err) => console.error("issueSlaveContract failed:", err));
  }
  // A collar that starts round somebody's neck gets its glyph now, so the
  // wearer can read it off their own sheet from turn one (COLLAR.md §2). Keyed
  // on the TAG, not the role, for the reason the contract above gives in
  // reverse. Best-effort: the Exactor's remote marks anything this missed.
  if (heldSlugs.includes(COLLAR_LOCKED_SLUG)) {
    await stampBlankCollars(prisma, { id: created.id })
      .catch((err) => console.error("stampBlankCollars failed:", err));
  }
  if (!created.locationId) await syncCharacterNarrowcastAccess(created.id).catch(() => {});
  // UNCONDITIONAL, and it must stay that way. The old line was `if (cursed)`, back when one
  // predicate answered both questions. A player who buried their body is no longer cursed but IS
  // still a ghost, so a `cursed` guard here would leave them holding a Deadchat seat while alive.
  // Neither curse nor ghost needs a write — the new ALIVE row is already the answer to both.
  await closeDeadchatTo(prisma, discordUserId).catch(() => {});

  // The Depot account this seat opens with, and what is already in it — from
  // docs/roles.yaml's `bank_account:` and `starting_account:`
  // (db/lib/syncRoles.js).
  //
  // It used to open EMPTY, always, on the argument that a seeded balance would
  // be a claim with nothing behind it in the Vault. That is answered by
  // stocking the Vault as the balances are handed out: the balance is rolled
  // within 10% of `startingAccountObols`, and puts GameConfig.vaultReservePercent
  // of itself into the Vault as coin (25% by default, the Baron's excluded), all
  // in one transaction — db/lib/startingAccount.js. So the Vault holds that
  // share of what the town opened with. `npm run db:audit-vault-backing` reads
  // the two side by side.
  //
  // Only the starting cast stocks it: a seat Start Game rolled, built inside
  // its window. A late party's drawn seat, a late join, a second life or a role
  // off the open menu opens with its balance and adds nothing to the Vault.
  //
  // Best-effort, in the side-effect block rather than the create transaction:
  // a character with no account can open one at the counter in one click, and
  // failing a whole character creation over a bank is the wrong trade.
  if (role.bankAccountClass) {
    const startingCast = Boolean(assignedEntry && !assignedEntry.latePartyId);
    await openStartingAccount(prisma, { character: created, role, config, openTurn, startingCast })
      .catch((err) => console.error("Opening a bank account failed:", err));
  }

  // The seat's signet ring (docs/systemdocs/RINGS.md): engraved with their
  // initials, on their finger, registered to the seat's doors and linked to the
  // account opened just above. After that account, so the ring links to it
  // rather than opening a second. Its doors are new entitlements the placement
  // sync above could not see, so room access is recomputed once it is on.
  // Best-effort like the account — a ringless character is a GM fix, not a
  // failed creation.
  await mintSpawnRing(prisma, created, role, { turnNumber: openTurn?.number ?? null })
    .then((ring) => (ring ? syncCharacterRoomAccess(prisma, created) : null))
    .catch((err) => console.error("Minting the seat's ring failed:", err));

  // The Depot's turret spares exactly one face — he knows his own name here.
  // Set once and never resynced: concealing himself later still gets him
  // shot, which is the design (DEPOT.md §0f).
  if (isMerchantRole(role.slug)) {
    await setMerchantFace(prisma, created.name).catch(() => {});
  }

  // A new Baron renames every living family member. Best-effort — must not cost this create.
  if (isDynastyHead(role.slug)) {
    await propagateDynastyLastName(created.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        zone: role.startingLocation?.zone?.name ?? null,
        location: role.startingLocation?.name ?? null,
        budget,
        spent,
        purchased: selected.map((t) => t.name),
        antagonistOptIns,
      },
    },
  });

  await recordArchiveEvent({
    kind: "CHARACTER_CREATED",
    character: created,
    zoneId: created.zoneId ?? null,
    zoneName: role.startingLocation?.zone?.name ?? null,
    turn: openTurn,
    content: `${created.name} arrived in Ravenheart as ${role.name}.`,
  });

  revalidatePath("/", "layout");
  redirect("/character");
}

// Slides the reservation hold's expiry on each wizard Next. Re-checks the same gates createCharacter does.
export async function reserveFateAction(roleId) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in to hold a role." };
  const discordUserId = session.discordUserId;
  if (!roleId) return { error: "Pick a role before continuing." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { error: "You already have a character." };
  }

  const [role, config, state, member] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    getGuildMember(discordUserId, 0), // always fresh
  ]);
  if (!role) return { error: "That role no longer exists." };

  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !creationOpen(state?.phase, member)) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !onRoster(member, { playtestMode: playtestRosterClosed(config) })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }
  // The late party's lock and exceptions, exactly as createCharacter makes them.
  const party = await loadLiveParty(prisma, { excludeDiscordUserId: discordUserId });
  // A drawn seat never gets here: the wizard opens past the Role step for it,
  // so there is no hold to take.
  const partyGate = latePartyGate(party, role.slug);
  if (party?.party.mode === "MUSTER" && !bypass) return { error: MUSTER_REFUSAL };
  if (partyGate === "locked" && !bypass) return { error: PARTY_LOCKED_REFUSAL };
  const partyFate = partyGate === "open";
  // Same late-join exception createCharacter makes, for the same reason: a
  // seat the GM has opened is pickable, and the curse does not reach it.
  const openLateJoin = lateJoinCapacity(await lateJoinOpeningFor(prisma, role.slug)) > 0;
  if (isSpawnOnly(role) && !openLateJoin && !partyFate) {
    return { error: "That role isn't open to anyone." };
  }
  const leaderWhitelisted = bypass || isLeaderWhitelisted(member);
  if (role.requiresWhitelist && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }
  // Same full stop as createCharacter: a cursed player must not hold a seat
  // they can never fill.
  if (!bypass && !openLateJoin && !partyFate && (await isPlayerCursed(prisma, discordUserId))) {
    return { error: CURSED_REFUSAL };
  }
  if (!isRoleSelectable({ role, leaderWhitelisted })) {
    return { error: "That role isn't available to you." };
  }

  // Before Start Game a pick holds nothing (db/lib/lobby.js#seatsAllocated).
  if (!seatsAllocated(state?.phase)) return { ok: true, expiresAt: null };
  const result = await reserveFate(prisma, discordUserId, roleId, effectivePlayerCount(config, state), {
    partyId: partyFate ? party.party.id : null,
  });
  if (result.reason === "PARTY_OVER") {
    return { error: PARTY_OVER_REFUSAL };
  }
  if (!result.ok) {
    return { error: `${role.name} was taken while you were deciding. Pick another role.` };
  }
  return { ok: true, expiresAt: result.expiresAt };
}
