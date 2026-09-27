// LATE JOINS: the seats a player may walk into after the game has started.
//
// A late join is not a threat spawn. A spawn is a GM picking one person and
// DMing them an offer (THREATS.md §4); a late join is the GM opening a door and
// letting whoever wants it walk through. The two share a shape -- a Role that
// the ordinary picker hides, kit from `starting_tags`, a seat count -- which is
// why the candidate roles below all sit in SPAWN_ONLY_FATE_SLUGS too. They are
// deliberately NOT the same switch: sometimes the GM wants to choose the people
// who play the Tribunal, and sometimes they want to open three chairs and let
// the room fill them.
//
// THE CURSE DOES NOT REACH HERE. db/lib/curse.js stops somebody with an
// unburied body making a new character; a late-join seat is exempt on purpose
// (isLateJoinRoleSlug is what createCharacter asks). A late join is not a
// second life in Ravenheart, it is somebody arriving from outside it, so the
// thing the curse is meant to cost -- your place in the town -- is not what is
// being handed out.
//
// ZERO REQUIRES, EVER, like db/lib/dmKinds.js and db/lib/resourceStack.js: the
// Dev Panel's table and the Bastard's Call reinforcements dialog are both
// client components, and one require of @lifeweb/db here would drag
// PrismaClient into the browser bundle. Every function below takes `prisma`/`tx`
// as a parameter instead. It IS on the @lifeweb/db barrel; inside db/lib,
// require it by path.

// Every role a GM may open as a late join, in the order the Dev Panel and the
// picker list them. Kept in code rather than a column for the reason
// db/lib/roleIds.js gives: fixed values that can never differ per environment,
// and a column would only add a way to drift from docs/roles.yaml.
const LATE_JOIN_ROLE_SLUGS = [
  "tribunal-ordinator",
  "tribune",
  "bastard",
  "bastard-infantry",
  "bastard-heavy-infantry",
  "bastard-rifleman",
  "bastard-healer",
  "bastard-engineer",
];

// The heading the picker puts them under. Not a db/lib/roleGroups.js bucket:
// those are social positions inside Ravenheart, and every one of these seats is
// somebody who is not from there. It sits ABOVE the buckets rather than among
// them.
const LATE_JOIN_GROUP = { slug: "special", name: "Special" };

function isLateJoinRoleSlug(slug) {
  return LATE_JOIN_ROLE_SLUGS.includes(slug);
}

// WHAT THE BASTARD MAY CALL IN, and what it costs. Prices are in ¢ (obols),
// paid in ¢ or in ⬢ at par -- one obol is one ⬢ (DEPOT.md §0) -- because
// reinforcements are bought, not manufactured. Calling one does not summon a
// body: it OPENS THE SEAT, and a real player takes it from the picker.
//
// Infantry is the floor and the rifleman the ceiling, which is the whole
// pricing argument: a man with a spear is cheap and a man with a working
// firearm, underground, in 1088, is not.
const REINFORCEMENTS = [
  { roleSlug: "bastard-infantry", name: "Infantry", price: 10 },
  { roleSlug: "bastard-heavy-infantry", name: "Heavy Infantry", price: 20 },
  { roleSlug: "bastard-healer", name: "Healer", price: 25 },
  { roleSlug: "bastard-engineer", name: "Engineer", price: 30 },
  { roleSlug: "bastard-rifleman", name: "Rifleman", price: 45 },
];

// At most this many seats may be opened by one click, so a fat-fingered
// quantity cannot open forty chairs before anybody notices.
const MAX_REINFORCEMENTS_PER_CALL = 5;

function reinforcementFor(roleSlug) {
  return REINFORCEMENTS.find((r) => r.roleSlug === roleSlug) ?? null;
}

// The tag that puts the Call reinforcements button on a sheet.
const BASTARD_TAG_SLUG = "bastard";

// The tag that puts the Sound horn button on a sheet (db/lib/deepBeastHorn.js).
const DEEP_BEAST_HORN_SLUG = "deep-beast-horn";

// Every candidate's row, whether or not a GM has ever touched it -- a seat
// nobody has opened is `enabled: false, slots: 0`, not a missing row, so the
// Dev Panel's table and the picker both iterate one list.
//
// `taken` is counted the way every other seat count is (seatHolderStatuses):
// a dead late-joiner still holds the chair unless the role is one of the two
// that reopen. Pass the Role rows in so the caller's own query is reused.
async function loadLateJoinRoles(prisma, { roles = null } = {}) {
  const roleRows =
    roles ??
    (await prisma.role.findMany({
      where: { slug: { in: LATE_JOIN_ROLE_SLUGS } },
      include: { startingLocation: { include: { zone: true } } },
    }));
  const bySlug = new Map(roleRows.map((role) => [role.slug, role]));

  const [settings, counts] = await Promise.all([
    prisma.lateJoinRole.findMany({ where: { roleSlug: { in: LATE_JOIN_ROLE_SLUGS } } }),
    prisma.character.groupBy({
      by: ["roleId"],
      where: {
        status: { in: ["ALIVE", "DEAD"] },
        roleId: { in: roleRows.map((r) => r.id) },
      },
      _count: { _all: true },
    }),
  ]);
  const settingBySlug = new Map(settings.map((s) => [s.roleSlug, s]));
  const takenByRoleId = new Map(counts.map((c) => [c.roleId, c._count._all]));

  return LATE_JOIN_ROLE_SLUGS.map((slug) => {
    const role = bySlug.get(slug) ?? null;
    const setting = settingBySlug.get(slug) ?? null;
    return {
      roleSlug: slug,
      // Null where db:sync-roles has not run yet. The Dev Panel says so rather
      // than hiding the row, since "the seat is missing" is the answer a GM
      // needs; the picker drops it, having nothing to draw.
      role,
      enabled: setting?.enabled ?? false,
      slots: setting?.slots ?? 0,
      taken: role ? takenByRoleId.get(role.id) ?? 0 : 0,
    };
  });
}

// What the picker may actually show: open, with a Role behind it and a seat
// left in it.
function openLateJoinRows(rows) {
  return rows.filter((row) => row.enabled && row.role && row.taken < row.slots);
}

// Opens `count` more seats on a role and turns it on. Used by the Bastard's
// Call reinforcements button; the Dev Panel SETS a number instead (a GM saying
// "three of these" means three, not three more).
async function openLateJoinSlots(tx, roleSlug, count = 1) {
  const add = Math.max(0, Math.trunc(count ?? 0));
  if (!add || !isLateJoinRoleSlug(roleSlug)) return null;
  return tx.lateJoinRole.upsert({
    where: { roleSlug },
    create: { roleSlug, enabled: true, slots: add },
    update: { enabled: true, slots: { increment: add } },
  });
}

// One role's late-join answer, for the two creation gates: is this seat open,
// and how many chairs does it have. Null for a role that is not a candidate at
// all, which is what both callers test -- "not a late join" and "a late join
// nobody opened" are different refusals.
async function lateJoinOpeningFor(tx, roleSlug) {
  if (!isLateJoinRoleSlug(roleSlug)) return null;
  const row = await tx.lateJoinRole.findUnique({ where: { roleSlug } });
  return { enabled: row?.enabled ?? false, slots: row?.slots ?? 0 };
}

// A late join's seat cap. A seat that is switched off has none, however many
// chairs were left sitting in the row from the last time it was on -- which is
// what makes the Dev Panel's checkbox a real closed door rather than a label.
function lateJoinCapacity(opening) {
  return opening?.enabled ? opening.slots : 0;
}

async function setLateJoinRole(tx, roleSlug, { enabled, slots }) {
  if (!isLateJoinRoleSlug(roleSlug)) return null;
  const count = Math.max(0, Math.min(999, Math.trunc(slots ?? 0)));
  const on = Boolean(enabled);
  return tx.lateJoinRole.upsert({
    where: { roleSlug },
    create: { roleSlug, enabled: on, slots: count },
    update: { enabled: on, slots: count },
  });
}

module.exports = {
  LATE_JOIN_ROLE_SLUGS,
  LATE_JOIN_GROUP,
  isLateJoinRoleSlug,
  REINFORCEMENTS,
  MAX_REINFORCEMENTS_PER_CALL,
  reinforcementFor,
  BASTARD_TAG_SLUG,
  DEEP_BEAST_HORN_SLUG,
  loadLateJoinRoles,
  openLateJoinRows,
  openLateJoinSlots,
  lateJoinOpeningFor,
  lateJoinCapacity,
  setLateJoinRole,
};
