// Who is Cursed — who may not make a new character at all until their last body
// is dealt with (web/app/(app)/character/createActions.js). It used to be a
// lesser thing, a re-roll narrowed to Migrant or Bum at six fewer points; from
// 2026-09-18 an unburied body simply stops you playing. NOT the watching seat,
// which is db/lib/ghost.js and reads no `buriedAt` at all: burial LIFTS this and
// leaves that seat alone. The two were one predicate until the split, so burying a body also evicted the player
// from the game they were still watching. Keep them apart. `cursed(player) := most recent body still lying in the
// world, and no living character` — MOST RECENT only, not any (CORPSES.md §6/§7, CHARACTERS.md §4).
// There is a third way out since 2026-09-20: the curse LAPSES on its own `CURSE_TURNS` turns after
// the death, counted off `Character.deathTurn` against the open turn's number, with the body still
// unburied. It is deliberately invisible — no countdown, no notice, no DM anywhere.
// Both halves are already columns: `Character.buriedAt` (BURY_CHARACTER/ENGRAVE_HEADSTONE, cleared on
// revive) and having an ALIVE character. `Character.cursedOverride` is a GM's thumb on the scale from
// the character dev panel: null means "work it out", true/false forces it.

const { isBody } = require("./bodies");
const { CURSE_TURNS } = require("./constants");

// The fields the rule reads. **Export and use it** — a caller that omits `buriedAt` from its own
// `select` gets `undefined`, not `null`, and the rule silently answers wrong (db/lib/channelDoctor.js
// is exactly that trap).
const CURSE_SELECT = {
  discordUserId: true,
  status: true,
  buriedAt: true,
  cursedOverride: true,
  createdAt: true,
  deathTurn: true,
};

// Newest first. `createdAt` is the only ordering a Character row carries.
const newestFirst = (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);

// The rule itself, over rows already in hand. PURE — no prisma, no await, since the three bulk call
// sites (GM roster desks, channel doctor) already loaded every Character row. `rows` must carry CURSE_SELECT's fields.
function cursedUserIds(rows, currentTurnNumber = null) {
  const byUser = new Map();
  for (const row of rows ?? []) {
    if (!row?.discordUserId) continue;
    const list = byUser.get(row.discordUserId);
    if (list) list.push(row);
    else byUser.set(row.discordUserId, [row]);
  }

  const cursed = new Set();
  for (const [discordUserId, characters] of byUser) {
    if (isCursedIn(characters, currentTurnNumber)) cursed.add(discordUserId);
  }
  return cursed;
}

// The same rule for one player's rows. Split out so the single-character answer and the bulk one cannot drift.
function isCursedIn(characters, currentTurnNumber = null) {
  const rows = [...(characters ?? [])].sort(newestFirst);

  // A GM's override wins over everything, including a living character. Most recently decided row wins.
  const override = rows.find((r) => r.cursedOverride !== null && r.cursedOverride !== undefined);
  if (override) return override.cursedOverride === true;

  if (rows.some((r) => r.status === "ALIVE")) return false;

  // `isBody`, not `!== "ALIVE"`: an ASLEEP character is out of play but left
  // nothing lying anywhere, so they are skipped over here entirely. The player
  // is past the ALIVE check above, so the respawn is already open to them —
  // this is only about whether something of theirs still needs burying, and
  // nothing does. db/lib/bodies.js, and ghost.js reads the same predicate.
  const latestBody = rows.find(isBody);
  if (!latestBody) return false;
  // `!buriedAt` rather than `=== null`: a caller that forgot the column defaults to "still lying
  // there", which costs a live player a ghost role rather than silently handing out full-points re-rolls.
  if (latestBody.buriedAt) return false;

  // And the third way out: the curse simply lapses CURSE_TURNS turns after the death, body still
  // lying where it fell. Nothing anywhere tells anybody this — a player past the count just finds
  // creation open again. A null `deathTurn` (every row written before the column, and any death
  // with no open turn) or a caller holding no turn number means NO clock, so the answer stays
  // "cursed" — the same fail-closed reading `!buriedAt` above is written with, since the cost of
  // guessing wrong the other way is a free re-roll over a fresh corpse.
  if (currentTurnNumber == null || latestBody.deathTurn == null) return true;
  return currentTurnNumber - latestBody.deathTurn < CURSE_TURNS;
}

// The query wrapper for call sites holding no rows (creation gates, dev panel). Takes `prisma` as a
// parameter, the db/lib/dm.js convention. One findMany, reduced in memory — never two counts, which
// can disagree across a bury committing between them. Pass `prisma`, not a transaction client: inside
// the character-creation transaction the new ALIVE row already exists, which would invert the answer.
async function isPlayerCursed(prisma, discordUserId) {
  if (!discordUserId) return false;
  const [rows, turn] = await Promise.all([
    prisma.character.findMany({ where: { discordUserId }, select: CURSE_SELECT }),
    // The lapse above needs the turn we are standing in. The open turn, not the newest: between
    // turns there is none, and a null reads as "no clock" rather than as turn 0, which would
    // expire every curse at once.
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  return isCursedIn(rows, turn?.number ?? null);
}

module.exports = { isPlayerCursed, isCursedIn, cursedUserIds, CURSE_SELECT };
