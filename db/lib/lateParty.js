// LATE PARTIES: a superadmin-opened event (E:\Bascinet\V3\Lateparty.docx,
// docs/systemdocs/LATE-PARTIES.md). While one is live:
//
//   - character creation offers ONLY the party's fates. Every other fate is
//     locked, late joins included, and a party may name a fate the picker
//     normally hides (SPAWN_ONLY_FATE_SLUGS) as readily as an ordinary one;
//   - anybody without a living character may take one at once, whether or not
//     their body was buried -- the curse does not reach a party fate, not even
//     one a GM forced on (db/lib/curse.js stays pure; the gates skip it).
//
// A party's fate either has a number of slots or is UNLIMITED (`slots` null).
// The party runs until every limited fate is full, or -- with any unlimited
// fate in it -- until a superadmin ends it.
//
// LIVE IS DERIVED, never stored: `endedAt` null AND some fate with room. Room
// is counted off the Character rows carrying the party's id, dead or alive,
// the way every seat in the game is counted off who sits in it. A party that
// reopens an existing fate (five more Guards) is therefore counted apart from
// the Guards the game already had.
//
// ZERO REQUIRES, like db/lib/lateJoin.js: every function takes `prisma`/`tx`.
// It IS on the @lifeweb/db barrel; inside db/lib, require it by path.

// The picker's heading for a party's fates. It takes the place of the Special
// section and the seven buckets while the party is live.
const LATE_PARTY_GROUP = { slug: "late-party", name: "Late Party" };

// A GM typing 9999 by mistake should not open a party nobody can fill; blank
// is how you ask for unlimited.
const MAX_PARTY_SLOTS = 999;

// A fate's cap: its slots, or Infinity for an unlimited one.
function latePartyCap(fate) {
  return fate?.slots == null ? Infinity : fate.slots;
}

// Pure. Does any fate still have a chair? `seated` only -- a wizard hold that
// is later abandoned must not end a party that was never actually filled.
function partyHasRoom(fates) {
  return (fates ?? []).some((fate) => fate.role !== null && fate.seated < latePartyCap(fate));
}

// Pure. What a live party says about one fate: "none" (no party is live),
// "open" (it is one of the party's), or "locked" (a party is live and this is
// not one of its fates).
function latePartyGate(live, roleSlug) {
  if (!live) return "none";
  return live.fates.some((fate) => fate.roleSlug === roleSlug && fate.role) ? "open" : "locked";
}

// Pure. The GM's form, cleaned: known slugs only, each once, slots a whole
// number from 1 to MAX_PARTY_SLOTS or null for unlimited.
function normalizePartyFates(rows, knownSlugs) {
  const known = new Set(knownSlugs ?? []);
  const seen = new Set();
  const out = [];
  for (const row of rows ?? []) {
    const roleSlug = row?.roleSlug;
    if (!roleSlug || !known.has(roleSlug) || seen.has(roleSlug)) continue;
    seen.add(roleSlug);
    let slots = null;
    if (row.slots !== null && row.slots !== undefined && row.slots !== "") {
      const n = Math.trunc(Number(row.slots));
      if (!Number.isFinite(n) || n < 1) continue;
      slots = Math.min(MAX_PARTY_SLOTS, n);
    }
    out.push({ roleSlug, slots });
  }
  return out;
}

// The one open party row. At most one exists: startLateParty closes any
// other under a lock, and loadLiveParty closes one it finds filled.
function openParty(db) {
  return db.lateParty.findFirst({
    where: { endedAt: null },
    include: { fates: true },
    orderBy: { startedAt: "desc" },
  });
}

// A party's counts. Each fate: `{ roleSlug, role, slots, seated, held, taken }`,
// where `held` is live wizard holds on that fate by anybody but
// `excludeDiscordUserId` -- during a party, every new hold is a party hold,
// since nothing else can be reserved -- and `taken` is the two together. Pass
// `roles` (with startingLocation.zone) when the caller already has them.
async function loadPartyCounts(db, party, { excludeDiscordUserId = null, now = new Date(), roles = null } = {}) {
  const slugs = party.fates.map((f) => f.roleSlug);
  const roleRows =
    roles?.filter((r) => slugs.includes(r.slug)) ??
    (await db.role.findMany({
      where: { slug: { in: slugs } },
      include: { startingLocation: { include: { zone: true } } },
    }));
  const bySlug = new Map(roleRows.map((r) => [r.slug, r]));
  const roleIds = roleRows.map((r) => r.id);
  const others = excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {};
  const [seatedRows, heldRows] = await Promise.all([
    db.character.groupBy({ by: ["roleId"], where: { latePartyId: party.id }, _count: true }),
    roleIds.length === 0
      ? []
      : db.roleReservation.groupBy({
          by: ["roleId"],
          where: { roleId: { in: roleIds }, expiresAt: { gt: now }, ...others },
          _count: true,
        }),
  ]);
  const seatedById = new Map(seatedRows.map((r) => [r.roleId, r._count]));
  const heldById = new Map(heldRows.map((r) => [r.roleId, r._count]));

  return party.fates
    .map((fate) => {
      const role = bySlug.get(fate.roleSlug) ?? null;
      const seated = role ? seatedById.get(role.id) ?? 0 : 0;
      const held = role ? heldById.get(role.id) ?? 0 : 0;
      return {
        roleSlug: fate.roleSlug,
        // Null where db:sync-roles has not run, or the fate left the catalog.
        // Such a fate can seat nobody, so it never keeps a party live.
        role,
        slots: fate.slots,
        seated,
        held,
        taken: seated + held,
      };
    })
    .sort((a, b) => (a.role?.sortOrder ?? 1e9) - (b.role?.sortOrder ?? 1e9));
}

// The live party, or null. `{ party, fates }` -- see loadPartyCounts.
//
// A party found FULL is closed here and now, `endedBy` null meaning "it
// filled". Without that stamp a filled party could come back to life later --
// a GM deleting one of its characters, or giving one another fate, drops the
// count below the slots again and would silently lock creation for everybody.
// A filled party is over, whatever happens to the people it made.
async function loadLiveParty(db, options = {}) {
  const party = await openParty(db);
  if (!party) return null;
  const fates = await loadPartyCounts(db, party, options);
  if (partyHasRoom(fates)) return { party, fates };
  await db.lateParty.updateMany({ where: { id: party.id, endedAt: null }, data: { endedAt: new Date(), endedBy: null } });
  return null;
}

// For the two creation transactions, under the Role row lock they already
// hold: SHARE-lock the party row, so a superadmin ending it mid-wizard wins
// (their UPDATE waits for us, and we for it) without every party creation
// queueing behind every other -- the Role lock already keeps each fate's count
// honest. Answers this fate's cap and how many chairs are spoken for. Null
// means the party is over or no longer names this fate -- the caller refuses.
async function partySeatUnderLock(tx, partyId, role, { excludeDiscordUserId = null, now = new Date() } = {}) {
  await tx.$queryRaw`SELECT id FROM "LateParty" WHERE id = ${partyId} FOR SHARE`;
  const fate = await tx.latePartyFate.findUnique({
    where: { partyId_roleSlug: { partyId, roleSlug: role.slug } },
    include: { party: { select: { endedAt: true } } },
  });
  if (!fate || fate.party.endedAt) return null;
  const others = excludeDiscordUserId ? { discordUserId: { not: excludeDiscordUserId } } : {};
  const [seated, held] = await Promise.all([
    tx.character.count({ where: { latePartyId: partyId, roleId: role.id } }),
    tx.roleReservation.count({ where: { roleId: role.id, expiresAt: { gt: now }, ...others } }),
  ]);
  return { cap: latePartyCap(fate), held: seated + held };
}

// Opens a party. Any party still open is closed by the same hand first, under
// the GameState row lock, so two superadmins pressing Start at once cannot
// leave two open. `fates` must already be normalizePartyFates' output.
async function startLateParty(tx, { fates, by }) {
  await tx.$queryRaw`SELECT id FROM "GameState" WHERE id = 1 FOR UPDATE`;
  const now = new Date();
  await tx.lateParty.updateMany({ where: { endedAt: null }, data: { endedAt: now, endedBy: by } });
  return tx.lateParty.create({
    data: { startedBy: by, fates: { create: fates.map(({ roleSlug, slots }) => ({ roleSlug, slots })) } },
    include: { fates: true },
  });
}

// Ends the open party, filled or not. Returns how many rows it closed (0 or 1).
async function endLateParty(tx, { by }) {
  await tx.$queryRaw`SELECT id FROM "GameState" WHERE id = 1 FOR UPDATE`;
  const { count } = await tx.lateParty.updateMany({
    where: { endedAt: null },
    data: { endedAt: new Date(), endedBy: by },
  });
  return count;
}

// The DM a new party sends to everybody playersWithoutLivingCharacter names.
function latePartyMessage(origin) {
  return `A late party is mustering. You can make a new character now, whether or not your body has been buried: ${origin}/character`;
}

// Who a new party is announced to: every player with a character and none of
// them alive -- the dead, and the asleep.
async function playersWithoutLivingCharacter(db) {
  const rows = await db.character.findMany({ select: { discordUserId: true, status: true } });
  const living = new Set(rows.filter((r) => r.status === "ALIVE").map((r) => r.discordUserId));
  return [...new Set(rows.map((r) => r.discordUserId))].filter((id) => id && !living.has(id));
}

module.exports = {
  LATE_PARTY_GROUP,
  MAX_PARTY_SLOTS,
  latePartyCap,
  partyHasRoom,
  latePartyGate,
  normalizePartyFates,
  loadPartyCounts,
  loadLiveParty,
  partySeatUnderLock,
  startLateParty,
  endLateParty,
  latePartyMessage,
  playersWithoutLivingCharacter,
};
