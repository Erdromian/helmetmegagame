// What each rite DOES once it fires (docs/systemdocs/THANATI.md §4). One
// handler per rite key, run by db/lib/riteSweep.js AFTER the attempt is
// claimed and its floor ingredients eaten, on the top-level client rather than
// inside that transaction: a rite kills, revives, teleports and mints, and
// each of those is its own guarded write with Discord calls beside it — the
// posture of the turn engine's passes, not of a single form submit.
//
// Every line the room or a player hears is Bascinet's, verbatim and unsigned.
// A handler returns { result } for the attempt row, or { awaiting: "zone" }
// when the rite is not finished until the room answers (Panic).
//
// Takes `db` as a parameter, the db/lib/dm.js convention.
const { postMessage, createGuildRole, deleteGuildRole, addMemberRole, removeMemberRole, setGuildNickname, getGuildMember } = require("./discordRest");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");
const { sendDm } = require("./dm");
const { aliasSubject } = require("./concealedIdentity");
const { applyDeathToRow } = require("./characterDeath");
const { revokeAllCharacterAccess } = require("./accessSweep");
const { deleteCorpseFor } = require("./corpseMint");
const { pickRandomPublicRoom } = require("./roomStash");
const { characterRoleAppearance } = require("./characterRoleAppearance");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { grantTagSlugs, addToRoomStack, dropRoomTag, dropCharacterTag } = require("./tagWrites");
const { createWithRetry } = require("./paperMint");
const { resolveSeatConflicts } = require("./seatConflicts");
const { listObjectives, fulfillObjectives } = require("./objectives");
const { settleFearTag } = require("./fear");
const { normalizeChant, containsPhrase } = require("./rites");
const { BOUND_SLUG, onHallowedGround } = require("./riteIngredients");
const {
  THANATI_SLUG,
  SCRYING_EYE_SLUG,
  SHIMMERING_ROBES_SLUG,
  GHOUL_SLUG,
  SERVANT_SLUG,
  RAGE_SLUG,
  BULLET,
} = require("./thanati");

const FLESH_SLUG = "flesh-of-tzchernobog";
const STUPID_SLUG = "stupid";
const HUNGERLESS_SLUG = "hungerless";
// What a sacrifice or a Judgement leaves behind: the parts a body has
// (db/lib/mutilate.js's list). Bascinet's "the following items" list was not
// given; this is the standing organ list until it is.
const REMAINS_SLUGS = Object.freeze(["eye", "tongue", "hand", "foot", "stomach", "heart"]);
const ANIMATED_LINE = "This weapon is animated! It is indestructible, it cuts through armor, and it heals its targets whenever it harms someone.";

const log = (what) => (err) => console.error(`Rite: ${what} failed:`, err?.message ?? err);
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// ---- Lines -----------------------------------------------------------------

// The room hears one `-#` line, on Discord and on /play. `room` needs { id,
// name, discordThreadId }.
async function roomLine(db, room, text) {
  if (room?.discordThreadId) {
    await postMessage(room.discordThreadId, ambientLine(text)).catch(log(`room line (${room.name})`));
  }
  if (room?.id) await sceneLineAt(db, { roomId: room.id, text, signed: false });
}

// A Location's channel hears one line. `location` needs { id, name, discordChannelId }.
async function locationLine(db, location, text) {
  if (location?.discordChannelId) {
    await postMessage(location.discordChannelId, ambientLine(text)).catch(log(`location line (${location.name})`));
  }
  if (location?.id) await sceneLineAt(db, { locationId: location.id, text, signed: false });
}

async function dmParticipants(db, participants, text) {
  for (const p of participants) {
    if (!p.discordUserId) continue;
    await sendDm(db, p.discordUserId, text, { source: "rite" }).catch(log(`DM to ${p.name}`));
  }
}

// ---- Bodies ----------------------------------------------------------------

// A death by rite: the row (db/lib/characterDeath.js) and then the same
// Discord teardown the turn engine performs for an automatic death.
async function killByRite(db, character, { turn = null } = {}) {
  const roleId = character.discordRoleId;
  const { claimed, corpse } = await applyDeathToRow(db, character, { turn, content: `${character.name} died.` });
  if (!claimed) return null;
  const member = await getGuildMember(character.discordUserId).catch(() => null);
  await revokeAllCharacterAccess(db, character).catch(log(`revoke for ${character.name}`));
  if (roleId) await deleteGuildRole(roleId).catch(log(`role delete for ${character.name}`));
  if (member) {
    if (process.env.DISCORD_CURSED_ROLE_ID) {
      await addMemberRole(character.discordUserId, process.env.DISCORD_CURSED_ROLE_ID).catch(log(`Cursed for ${character.name}`));
    }
    await setGuildNickname(character.discordUserId, null).catch(log(`nickname for ${character.name}`));
    await sendDm(db, character.discordUserId, "You have died.", { source: "rite" }).catch(log(`death DM for ${character.name}`));
  }
  return corpse ?? null;
}

// The Rite of Reanimation's other half: the dead character stands up in the
// rite's room's Location as a Ghoul, and gets their Discord presence back the
// way a spawn does (db/lib/threatSpawn.js#applySpawnSideEffects).
async function reviveByRite(db, dead, { location, turnNumber }) {
  await db.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: dead.id },
      data: { status: "ALIVE", buriedAt: null, locationId: location.id, zoneId: location.zoneId },
    });
    await grantTagSlugs(tx, dead.id, [GHOUL_SLUG, SERVANT_SLUG, HUNGERLESS_SLUG], turnNumber);
  });
  await deleteCorpseFor(db, dead.id).catch(log(`corpse cleanup for ${dead.name}`));
  try {
    const { name, color } = characterRoleAppearance(dead.name);
    const role = await createGuildRole({ name, color, hoist: false, mentionable: true, permissions: "0" });
    await db.character.update({ where: { id: dead.id }, data: { discordRoleId: role.id } });
  } catch (err) {
    log(`role for ${dead.name}`)(err);
  }
  if (process.env.DISCORD_CURSED_ROLE_ID) {
    await removeMemberRole(dead.discordUserId, process.env.DISCORD_CURSED_ROLE_ID).catch(() => {});
  }
  await setGuildNickname(dead.discordUserId, dead.name).catch(() => {});
  await applyLocationMoveSideEffects(db, { characterId: dead.id, fromLocationId: null, toLocationId: location.id }).catch(
    log(`placement for ${dead.name}`),
  );
}

// 2–7 parts, 1–2 Flesh, 2–5 ⬢ — what a body comes apart into. `room` needs { id }.
async function spawnRemains(db, room, { flesh = true, resources = true } = {}) {
  const slugs = [...REMAINS_SLUGS, FLESH_SLUG];
  const tags = await db.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const byId = new Map(tags.map((t) => [t.slug, t.id]));
  const spawned = {};
  await db.$transaction(async (tx) => {
    const parts = rand(2, 7);
    for (let i = 0; i < parts; i += 1) {
      const slug = REMAINS_SLUGS[Math.floor(Math.random() * REMAINS_SLUGS.length)];
      if (!byId.has(slug)) continue;
      await addToRoomStack(tx, room.id, byId.get(slug), 1);
      spawned[slug] = (spawned[slug] ?? 0) + 1;
    }
    if (flesh && byId.has(FLESH_SLUG)) {
      const n = rand(1, 2);
      await addToRoomStack(tx, room.id, byId.get(FLESH_SLUG), n);
      spawned[FLESH_SLUG] = n;
    }
    if (resources) {
      const n = rand(2, 5);
      await tx.room.update({ where: { id: room.id }, data: { resources: { increment: n } } });
      spawned.resources = n;
    }
  });
  return spawned;
}

async function grantToFloor(db, room, slug, quantity = 1) {
  const tag = await db.tag.findUnique({ where: { slug }, select: { id: true } });
  if (!tag) throw new Error(`no ${slug} tag — run db:sync-tags`);
  await addToRoomStack(db, room.id, tag.id, quantity);
}

// ---- The handlers ----------------------------------------------------------

const EFFECTS = {
  async initial({ db, participants }) {
    const objectives = await listObjectives(db, { partyKey: "thanati" });
    const lines = objectives.map((o, i) => `Objective ${i + 1}: ${o.description}. ${o.done ? "Success!" : "Incomplete"}`);
    const text = ["These are the objectives of the cult.", ...lines].join(" ");
    await dmParticipants(db, participants, text);
    return { result: { told: participants.length, objectives: objectives.length } };
  },

  async conversion({ db, room, resolved, openTurn }) {
    const target = resolved.boundPerson;
    const thanati = await db.tag.findUnique({ where: { slug: THANATI_SLUG }, select: { id: true } });
    await db.$transaction(async (tx) => {
      await grantTagSlugs(tx, target.id, [THANATI_SLUG], openTurn?.number ?? null);
      if (thanati) await resolveSeatConflicts(tx, target.id, [thanati.id]);
      await fulfillObjectives(tx, { partyKey: "thanati", kinds: ["convert-character", "convert-leader"], targetCharacterId: target.id });
    });
    await sendDm(
      db,
      target.discordUserId,
      "This reality is cursed! You are now loyal to the Thanati and must follow the cult’s orders. Read your Documents for more information.",
      { source: "rite" },
    ).catch(log(`conversion DM to ${target.name}`));
    await roomLine(db, room, `${aliasSubject(target)}’s eyes widen as they begin to understand...`);
    return { result: { converted: target.name, characterId: target.id } };
  },

  async sacrifice({ db, room, resolved, openTurn }) {
    const victim = resolved.boundPerson;
    await fulfillObjectives(db, {
      partyKey: "thanati",
      kinds: ["sacrifice-living", "sacrifice-leader", "sacrifice-inquisitor-or-baron"],
      targetCharacterId: victim.id,
    });
    const corpse = await killByRite(db, victim, { turn: openTurn });
    // The body is not left whole: whatever room the corpse fell into, it is
    // taken apart there.
    const spawned = await spawnRemains(db, room);
    if (corpse?.tag) await deleteCorpseFor(db, victim.id).catch(log(`corpse cleanup for ${victim.name}`));
    await roomLine(db, room, "The sacrifice explodes into a puddle of organs and gore!");
    return { result: { sacrificed: victim.name, characterId: victim.id, spawned } };
  },

  async scrying({ db, room }) {
    await grantToFloor(db, room, SCRYING_EYE_SLUG, 1);
    await roomLine(db, room, "The food transforms into a cursed eyeball…");
    return { result: { yielded: SCRYING_EYE_SLUG } };
  },

  async possession({ db, room, resolved }) {
    const source = resolved.weapon;
    const animated = await createWithRetry(db, (attempt) => ({
      slug: `custom-animated-${source.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${attempt ? `-${attempt}` : ""}`,
      name: `${source.name} (Animated)`,
      description: `${source.description ?? ""} ${ANIMATED_LINE}`.trim(),
      category: source.category,
      groupId: source.groupId,
      pointCost: 0,
      custom: true,
      ephemeral: true,
      tradeable: source.tradeable,
      weightLbs: source.weightLbs,
      equippable: source.equippable,
      equipSlot: source.equipSlot,
      equipLayer: source.equipLayer,
      requiredTagId: source.requiredTagId,
      laborBonus: source.laborBonus ?? undefined,
      inspectVisibility: source.inspectVisibility,
      meleeArmor: source.meleeArmor,
      ballisticArmor: source.ballisticArmor,
      stackable: false,
      removable: false,
      purchasable: false,
      purchasableAfterStart: false,
    }));
    if (!animated) throw new Error("could not name the animated weapon");
    await db.$transaction(async (tx) => {
      await dropRoomTag(tx, room.id, source.id, 1);
      await addToRoomStack(tx, room.id, animated.id, 1);
    });
    await roomLine(db, room, `${source.name} shimmers brilliantly!`);
    return { result: { animated: animated.name, from: source.slug } };
  },

  async reanimation({ db, room, location, resolved, openTurn }) {
    const { dead } = resolved.corpse;
    await reviveByRite(db, dead, { location, turnNumber: openTurn?.number ?? null });
    await roomLine(db, room, "The corpse rises, ready to fight!");
    return { result: { risen: dead.name, characterId: dead.id } };
  },

  async stupidity({ db, room, resolved, openTurn }) {
    const { target, holder, tag } = resolved.photograph;
    await db.$transaction(async (tx) => {
      await grantTagSlugs(tx, target.id, [STUPID_SLUG], openTurn?.number ?? null);
      if (holder.kind === "room") await dropRoomTag(tx, holder.id, tag.id, 1);
      else await dropCharacterTag(tx, holder.id, tag.id, 1);
    });
    await roomLine(db, room, "The items evaporate into dust.");
    return { result: { target: target.name, characterId: target.id } };
  },

  async omniscience({ db, room, resolved, participants }) {
    const { target, holder, tag } = resolved.photograph;
    const subject = await db.character.findUnique({
      where: { id: target.id },
      select: { name: true, tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { name: true } } } } },
    });
    const names = (subject?.tags ?? []).map((ct) => ct.tag.name).sort((a, b) => a.localeCompare(b));
    const text = `Their name is ${subject?.name ?? target.name}.\nTheir tags are: ${names.length ? names.join(BULLET) : "Nothing."}`;
    await dmParticipants(db, participants, text);
    await db.$transaction(async (tx) => {
      if (holder.kind === "room") await dropRoomTag(tx, holder.id, tag.id, 1);
      else await dropCharacterTag(tx, holder.id, tag.id, 1);
    });
    await roomLine(db, room, "The items evaporate into dust.");
    return { result: { target: target.name, told: participants.length, tags: names.length } };
  },

  async summoning({ db, room, location }) {
    const bound = await db.tag.findUnique({ where: { slug: BOUND_SLUG }, select: { id: true } });
    const cultists = await db.character.findMany({
      where: { status: "ALIVE", tags: { some: { quantity: { gt: 0 }, tag: { slug: THANATI_SLUG } } } },
      select: { id: true, name: true, locationId: true, location: { select: { slug: true } } },
    });
    const moved = [];
    for (const c of cultists) {
      if (c.locationId === location.id || onHallowedGround(c.location)) continue;
      await db.$transaction(async (tx) => {
        await tx.character.update({ where: { id: c.id }, data: { locationId: location.id, zoneId: location.zoneId, travelToLocationId: null, travelTurnId: null } });
        if (bound) await dropCharacterTag(tx, c.id, bound.id);
      });
      await applyLocationMoveSideEffects(db, { characterId: c.id, fromLocationId: c.locationId, toLocationId: location.id }).catch(
        log(`summoning placement for ${c.name}`),
      );
      moved.push(c.name);
    }
    void room;
    return { result: { summoned: moved } };
  },

  async panic({ db, room }) {
    await roomLine(db, room, "The heart evaporates into dust. Name a zone.");
    return { awaiting: "zone", result: { awaiting: "zone" } };
  },

  async famine({ db, room }) {
    const factions = await db.faction.findMany({
      where: { siloRoomId: { not: null } },
      select: { name: true, siloRoom: { select: { id: true, resources: true } } },
    });
    const blighted = {};
    await db.$transaction(async (tx) => {
      for (const f of factions) {
        if (!f.siloRoom) continue;
        const take = Math.min(100, f.siloRoom.resources);
        if (take <= 0) continue;
        await tx.room.updateMany({ where: { id: f.siloRoom.id, resources: { gte: take } }, data: { resources: { decrement: take } } });
        blighted[f.name] = take;
      }
    });
    await roomLine(db, room, "The items evaporate into dust.");
    return { result: { blighted } };
  },

  async reflection({ db, room }) {
    await grantToFloor(db, room, SHIMMERING_ROBES_SLUG, 1);
    await roomLine(db, room, "These dark robes shimmer. They are nearly indestructible…");
    return { result: { yielded: SHIMMERING_ROBES_SLUG } };
  },

  async rage({ db, room, participants, openTurn }) {
    await db.$transaction(async (tx) => {
      for (const p of participants) await grantTagSlugs(tx, p.characterId, [RAGE_SLUG], openTurn?.number ?? null);
    });
    await roomLine(db, room, "The wine evaporates into dust.");
    return { result: { enraged: participants.map((p) => p.name) } };
  },

  async judgement({ db, resolved, openTurn }) {
    const { target, holder, tag } = resolved.photograph;
    const full = await db.character.findUnique({
      where: { id: target.id },
      select: { id: true, name: true, discordUserId: true, discordRoleId: true, locationId: true, zoneId: true, location: { select: { id: true, name: true, discordChannelId: true } } },
    });
    if (!full) throw new Error("the target is gone");
    await db.$transaction(async (tx) => {
      if (holder.kind === "room") await dropRoomTag(tx, holder.id, tag.id, 1);
      else await dropCharacterTag(tx, holder.id, tag.id, 1);
    });
    const corpse = await killByRite(db, full, { turn: openTurn });
    const where = corpse?.room ?? (await pickRandomPublicRoom(db, full.locationId));
    const spawned = where ? await spawnRemains(db, where, { flesh: false, resources: false }) : {};
    if (corpse?.tag) await deleteCorpseFor(db, full.id).catch(log(`corpse cleanup for ${full.name}`));
    await locationLine(db, full.location, `${full.name} explodes into mist!`);
    return { result: { judged: full.name, characterId: full.id, spawned } };
  },
};

// ---- The Rite of Panic's answer --------------------------------------------

// The room named a place. Zones first, then Locations, whole-word containment
// the way a chant is matched. Everyone alive there goes straight to the top of
// the dial. Returns what was struck, or null when the line named nothing.
async function answerPanic(db, { attempt, content }) {
  const text = normalizeChant(content);
  if (!text) return null;
  const [zones, locations] = await Promise.all([
    db.zone.findMany({ select: { id: true, name: true } }),
    db.location.findMany({ select: { id: true, name: true, zoneId: true } }),
  ]);
  const zone = zones.find((z) => containsPhrase(text, normalizeChant(z.name)));
  const location = zone ? null : locations.find((l) => containsPhrase(text, normalizeChant(l.name)));
  if (!zone && !location) return null;

  const struck = await db.character.findMany({
    where: { status: "ALIVE", ...(zone ? { zoneId: zone.id } : { locationId: location.id }) },
    select: { id: true, name: true },
  });
  for (const c of struck) {
    await db.$transaction(async (tx) => {
      await tx.character.update({ where: { id: c.id }, data: { fear: 100 } });
      await settleFearTag(tx, c.id, {});
    }).catch(log(`panic for ${c.name}`));
  }
  await db.riteAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "FIRED",
      firedAt: new Date(),
      result: { ...(attempt.result ?? {}), haunted: zone?.name ?? location?.name, struck: struck.map((c) => c.name) },
    },
  });
  return { place: zone?.name ?? location?.name, struck: struck.length };
}

module.exports = { EFFECTS, roomLine, locationLine, dmParticipants, killByRite, reviveByRite, spawnRemains, answerPanic, REMAINS_SLUGS };
