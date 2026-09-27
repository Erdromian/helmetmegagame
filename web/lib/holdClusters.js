// The Other lens's fight half (IMPORT-FREE, pure). Everything that pins somebody in place this turn: a
// fight (ATTACK.md), a Safe intercept that fired (INTERCEPT.md), a thief the room caught (THEFT.md §1e). An Ambush shows up here as an Attack.
// LEGACY since the Combat Overhaul: only pre-overhaul Attack rows reach this (docs/systemdocs/ATTACK.md §12).
// A row is ONE FIGHT, not one pairing — twelve Attack rows from one brawl cluster into one row.
export const ATTACK_INCLUDE = {
  attacker: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  // roleTitle on this side too: every member of a cluster draws the same person line.
  targetCharacter: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  location: { select: { name: true, zone: { select: { name: true } } } },
};

export const INTERCEPT_HIT_INCLUDE = {
  interceptor: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
  targetCharacter: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
};

// A caught Steal has no table of its own: the `steal` AuditLog row is the record, and its targetCharacter is the THIEF.
export const CAUGHT_STEAL_INCLUDE = {
  targetCharacter: { select: { id: true, name: true, discordUserId: true, updatedAt: true, roleTitle: true, zone: { select: { name: true } } } },
};

// Only the rows where the room saw it — a clean steal is nobody's business, a GM's included.
export const caughtStealWhere = (turnId) => ({ actionType: "steal", turnId, details: { path: ["unseen"], equals: false } });

// One person's line in a row's strip. REAL names, GM desk (COMBAT.md §5). `moves` comes from rows the page already built.
function personLine(c, role, { usernameById, catatonicIds, movesByCharacterId }) {
  return {
    characterId: c.id,
    name: c.name,
    avatarVersion: c.updatedAt.getTime(),
    catatonic: catatonicIds?.has(c.id) ?? false,
    roleTitle: c.roleTitle ?? "",
    discordUsername: usernameById.get(c.discordUserId) ?? c.discordUserId ?? "",
    role,
    moves: movesByCharacterId?.get(c.id) ?? [],
  };
}

// Connected components over a turn's Attack rows, so one fight is one row. Bucketed by Location FIRST
// (null locationId its own bucket — SetNull). Cancelled edges ride along: a fight called off still happened.
function attackClusters(attacks) {
  const buckets = new Map();
  for (const a of attacks) {
    const key = a.locationId ?? "";
    const list = buckets.get(key) ?? [];
    list.push(a);
    buckets.set(key, list);
  }

  const out = [];
  for (const list of buckets.values()) {
    // Union-find over character ids; sets are small, so find() skips path compression.
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      return r;
    };
    for (const a of list) {
      if (!parent.has(a.attackerId)) parent.set(a.attackerId, a.attackerId);
      if (!parent.has(a.targetCharacterId)) parent.set(a.targetCharacterId, a.targetCharacterId);
    }
    for (const a of list) {
      const ra = find(a.attackerId);
      const rb = find(a.targetCharacterId);
      if (ra !== rb) parent.set(ra, rb);
    }
    const byRoot = new Map();
    for (const a of list) {
      const root = find(a.attackerId);
      const edges = byRoot.get(root) ?? [];
      edges.push(a);
      byRoot.set(root, edges);
    }
    for (const edges of byRoot.values()) out.push(edges);
  }
  return out;
}

function attackClusterRow(edges, ctx) {
  const { usernameById, catatonicIds } = ctx;
  // Oldest first: title/id come off the edge that started the fight, so a new member doesn't mint a new id.
  const ordered = [...edges].sort((x, y) => x.createdAt - y.createdAt);
  const seed = ordered[0];
  const newest = ordered[ordered.length - 1];

  // Attackers first, then who they hold; being jumped outranks doing the jumping (settleHold, db/lib/attack.js).
  const people = new Map();
  for (const e of ordered) {
    if (!people.has(e.attackerId)) people.set(e.attackerId, personLine(e.attacker, "attacking", ctx));
  }
  for (const e of ordered) {
    const was = people.get(e.targetCharacterId);
    if (was) was.role = "held";
    else people.set(e.targetCharacterId, personLine(e.targetCharacter, "held", ctx));
  }
  const peopleList = [...people.values()];

  const kindLabel = ordered.some((e) => e.fromAmbush) ? "Ambush" : "Attack";
  const holding = ordered.some((e) => !e.cancelledAt);

  return {
    id: `hold:${seed.id}`,
    kind: kindLabel === "Ambush" ? "AMBUSH" : "ATTACK",
    kindLabel,
    characterId: seed.attackerId,
    characterName: seed.attacker.name,
    avatarVersion: seed.attacker.updatedAt.getTime(),
    catatonic: catatonicIds?.has(seed.attackerId) ?? false,
    discordUsername: usernameById.get(seed.attacker.discordUserId) ?? seed.attacker.discordUserId ?? "",
    roleTitle: seed.attacker.roleTitle ?? "",
    targetCharacterId: seed.targetCharacterId,
    targetName: seed.targetCharacter.name,
    extraCount: Math.max(0, peopleList.length - 2),
    // Where it happened first, the seat second — a fight is in the room it's in, not the attacker's seat.
    zoneName: seed.location?.zone?.name ?? seed.attacker.zone?.name ?? "",
    locationName: seed.location?.name ?? null,
    statusLabel: holding ? "Holding" : "Called off",
    people: peopleList,
    // One per pairing: cancelAttack's WHERE names two people and a turn.
    holds: ordered.map((e) => ({
      attackId: e.id,
      attackerId: e.attackerId,
      attackerName: e.attacker.name,
      targetId: e.targetCharacterId,
      targetName: e.targetCharacter.name,
      cancelled: Boolean(e.cancelledAt),
    })),
    searchText: peopleList.map((p) => p.name).join(" "),
    // The NEWEST edge, so a fight that just grew sorts as fresh rather than sinking to where it started.
    createdAtMs: newest.createdAt.getTime(),
  };
}

function interceptHitRow(h, ctx) {
  const { usernameById, catatonicIds } = ctx;
  return {
    id: h.id,
    kind: "INTERCEPT",
    kindLabel: "Intercept",
    characterId: h.interceptorId,
    characterName: h.interceptor.name,
    avatarVersion: h.interceptor.updatedAt.getTime(),
    catatonic: catatonicIds?.has(h.interceptorId) ?? false,
    discordUsername: usernameById.get(h.interceptor.discordUserId) ?? h.interceptor.discordUserId ?? "",
    roleTitle: h.interceptor.roleTitle ?? "",
    targetCharacterId: h.targetCharacterId,
    targetName: h.targetCharacter.name,
    extraCount: 0,
    zoneName: h.interceptor.zone?.name ?? "",
    locationName: null,
    // A Safe stop is two minutes and long over by the time a GM reads it; "Holding" would be a lie.
    statusLabel: "Stopped",
    people: [
      personLine(h.interceptor, "stopping", ctx),
      personLine(h.targetCharacter, "stopped", ctx),
    ],
    // No pairing to call off: the hold lapsed on its own clock before a GM got here.
    holds: [],
    searchText: `${h.interceptor.name} ${h.targetCharacter.name}`,
    createdAtMs: h.createdAt.getTime(),
  };
}

// One Steal the room noticed. Held by nobody, so there is nothing to call off; Holding while the five
// minutes run (`details.held` says the hold landed at all — a thief already in a fight keeps that one), Seen after.
// `ctx.now` and `ctx.caughtHoldMs` come from the page, which keeps this file import-free.
function caughtStealRow(a, ctx) {
  const { usernameById, catatonicIds, now, caughtHoldMs } = ctx;
  const thief = a.targetCharacter;
  const room = a.details?.roomName ?? "a stash";
  const holding =
    a.details?.held === true && now != null && caughtHoldMs != null && a.createdAt.getTime() + caughtHoldMs > now.getTime();
  return {
    id: `caught:${a.id}`,
    kind: "CAUGHT",
    kindLabel: "Caught stealing",
    characterId: thief.id,
    characterName: thief.name,
    avatarVersion: thief.updatedAt.getTime(),
    catatonic: catatonicIds?.has(thief.id) ?? false,
    discordUsername: usernameById.get(thief.discordUserId) ?? thief.discordUserId ?? "",
    roleTitle: thief.roleTitle ?? "",
    // The row's click opens its TARGET; the thief is the only person in it, so they are both ends.
    targetCharacterId: thief.id,
    targetName: room,
    extraCount: 0,
    zoneName: thief.zone?.name ?? "",
    locationName: null,
    statusLabel: holding ? "Holding" : "Seen",
    people: [personLine(thief, "caught", ctx)],
    holds: [],
    searchText: `${thief.name} ${room}`,
    createdAtMs: a.createdAt.getTime(),
  };
}

// `interceptHits` are Safe stops only — an Ambush files an Attack, so the two halves never overlap.
// `caughtSteals` are `steal` AuditLog rows loaded with caughtStealWhere and CAUGHT_STEAL_INCLUDE.
export function otherHoldRows(attacks, interceptHits, ctx, caughtSteals = []) {
  return [
    ...attackClusters(attacks).map((edges) => attackClusterRow(edges, ctx)),
    ...interceptHits.map((h) => interceptHitRow(h, ctx)),
    // A row whose thief has since been deleted has nobody to draw.
    ...caughtSteals.filter((a) => a.targetCharacter).map((a) => caughtStealRow(a, ctx)),
  ];
}
