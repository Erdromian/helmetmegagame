// Who is Cursed — the one answer, read from the database.
//
// Cursed is the re-roll penalty: your next character may only be a Migrant or
// a Bum, and it is built with six fewer points (web/lib/characterCreation.js's
// CURSED_ROLE_SLUGS and CURSED_POINT_PENALTY). It is NOT the ghost seat — that
// is a Discord role and lives in db/lib/ghostAccess.js. The two used to be one
// object, which is how a rite kill that failed to write a single Discord role
// handed a player a full-points unrestricted re-roll.
//
//     cursed(player) := their most recent body is still lying in the world,
//                       and they have no living character.
//
// **Most recent**, not "any". A player who leaves several bodies behind is
// answering for the last one only, which is what the Discord role did — any
// bury, engrave or re-roll cleared it outright. Counting every body instead
// would be a rules change: someone whose corpse was destroyed (butchered, or
// exploded by a Rite of Sacrifice) could never bury it, and would be locked to
// Bum or Migrant at −6 for the rest of the game.
//
// Both halves are already columns, so there is no `cursed` field to keep in
// step with anything:
//
//   - `Character.buriedAt` is stamped by BURY_CHARACTER and by
//     ENGRAVE_HEADSTONE, and cleared on a revive. Those are exactly the events
//     the rules say lift the curse (docs/systemdocs/CORPSES.md §7).
//   - having an ALIVE character ends it, because the curse is not meant to
//     outlast the Bum or Migrant it forced (docs/systemdocs/CHARACTERS.md §4).
//
// Two things fall out of that shape rather than needing code. Butchering a
// body destroys the corpse without burying it, so `buriedAt` stays null and
// the player stays cursed — which CORPSES.md §6 requires and which nothing
// used to enforce. And a body nobody can reach can still be answered with
// Engrave, which stamps the same column.
//
// `Character.cursedOverride` is a GM's thumb on the scale, from the character
// dev panel: null means "work it out", true or false forces it. It replaces
// the GM adding or removing the Discord role by hand, which moving the truth
// into the database took away.

// The fields the rule reads. **Export and use it** — a caller that hand-rolls
// a narrower `select` and omits `buriedAt` gets `undefined`, which is not
// `null`, and the rule then quietly answers the wrong thing with no error
// anywhere. db/lib/channelDoctor.js selects its characters explicitly and is
// exactly that trap.
const CURSE_SELECT = {
  discordUserId: true,
  status: true,
  buriedAt: true,
  cursedOverride: true,
  createdAt: true,
};

// Newest first. `createdAt` is the only ordering a Character row carries.
const newestFirst = (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);

// The rule itself, over rows already in hand. PURE — no prisma, no await.
//
// That is deliberate: the three call sites that want this in bulk (both GM
// roster desks and the channel doctor) have already loaded every Character
// row, so a query helper would add a round trip to each of them to fetch what
// they are holding.
//
// `rows` must carry CURSE_SELECT's fields.
function cursedUserIds(rows) {
  const byUser = new Map();
  for (const row of rows ?? []) {
    if (!row?.discordUserId) continue;
    const list = byUser.get(row.discordUserId);
    if (list) list.push(row);
    else byUser.set(row.discordUserId, [row]);
  }

  const cursed = new Set();
  for (const [discordUserId, characters] of byUser) {
    if (isCursedIn(characters)) cursed.add(discordUserId);
  }
  return cursed;
}

// The same rule for one player's rows. Split out so the single-character
// answer and the bulk one cannot drift.
function isCursedIn(characters) {
  const rows = [...(characters ?? [])].sort(newestFirst);

  // A GM's override wins over everything, including a living character — the
  // narrative curse it replaces could be laid on anyone. Most recently
  // decided row wins, so a later call overrules an earlier one.
  const override = rows.find((r) => r.cursedOverride !== null && r.cursedOverride !== undefined);
  if (override) return override.cursedOverride === true;

  if (rows.some((r) => r.status === "ALIVE")) return false;

  const latestBody = rows.find((r) => r.status !== "ALIVE");
  if (!latestBody) return false;
  // `!buriedAt` rather than `=== null`: a caller that forgot the column in its
  // select lands on "still lying there", which costs a live player nothing but
  // a ghost role the doctor will take back off them. The other direction would
  // silently hand out full-points re-rolls, which is the bug this file exists
  // to end.
  return !latestBody.buriedAt;
}

// The query wrapper, for the call sites holding no rows — the creation gates
// and the dev panel. Takes `prisma` as a parameter, the db/lib/dm.js
// convention: requiring db/index.js back from inside db/lib/ resolves to a
// partial exports object.
//
// Named `isPlayerCursed`, not `isCursed`, on purpose: web/lib/discordGuild.js
// used to export `isCursed(member)` and a same-named `isCursed(prisma, id)`
// would be an argument-order landmine for anything not yet converted.
//
// One findMany, reduced in memory — never two counts, which can disagree
// across a bury committing between them. Pass `prisma`, not a transaction
// client: inside web/app/(app)/character/createActions.js's creation
// transaction the new ALIVE row already exists, so the answer there is always
// false and the budget check would invert.
async function isPlayerCursed(prisma, discordUserId) {
  if (!discordUserId) return false;
  const rows = await prisma.character.findMany({
    where: { discordUserId },
    select: CURSE_SELECT,
  });
  return isCursedIn(rows);
}

module.exports = { isPlayerCursed, isCursedIn, cursedUserIds, CURSE_SELECT };
