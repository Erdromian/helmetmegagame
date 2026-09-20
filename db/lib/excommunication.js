// The Bishop's Excommunicate verb (web/app/(app)/character/bishopActions.js).
//
// TWO things make one excommunication, and they are always written together:
// the `excommunicated` tag on the target, which is what everybody sees and
// what db/lib/gambitModifier.js charges the -1 for, and an Excommunication
// row, which is the only record of WHO laid it. The tag alone could not
// answer the cap, the Bishop's list, or the rule that only the Bishop who
// laid a mark may lift it — CharacterTag has no "granted by" column.
//
// No prisma import, so both faces take it by subpath; the one function that
// needs a client is handed one, the way db/lib/wanted.js does it.

const { matchesTypedName } = require("./characterName");

// The office, as a tag. docs/roles.yaml hands it to the bishop role beside
// Chaplain, and every gate here reads the tag rather than the role — the same
// move db/lib/confession.js makes, and the only one docs/tags.yaml can express
// (`requiredTag` takes a tag slug; there is no required-role field).
const BISHOP_SLUG = "bishop";

// The mark itself.
const EXCOMMUNICATED_SLUG = "excommunicated";

// Bought, Bishop-only, and worth one more seat. Nothing else raises the cap.
const DEPRIVER_SLUG = "depriver";

// Who may be excommunicated at all. A belief tag (docs/tags.yaml), so this is
// a claim about what somebody believes, not about any role they hold.
const POST_CHRISTIAN_SLUG = "post-christian";

// One person. Two holding Depriver. Deliberately a function rather than a
// constant plus an if: the cap is shown to the Bishop as "{n}/{cap} people
// excommunicated" and enforced server-side, and those two must never disagree.
const BASE_CAP = 1;

function holds(heldSlugs, slug) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(slug);
}

function isBishop(heldSlugs) {
  return holds(heldSlugs, BISHOP_SLUG);
}

function excommunicationCap(heldSlugs) {
  return BASE_CAP + (holds(heldSlugs, DEPRIVER_SLUG) ? 1 : 0);
}

// Who a typed name lands on. Pure and DB-free so db/test/ can hold it down
// without a database, the shape db/lib/wanted.js's targets functions use.
// Unlike a warrant, an ambiguous name is a REFUSAL rather than a mark on
// everybody who answers to it: the cap makes each one precious, and there is
// no undo that does not spend a Bishop's afternoon.
//
// `candidates` are living characters carrying `tags` narrowed to the
// post-christian tag, and `excommunicationBorne` — whether somebody has
// already laid a mark on them.
function excommunicateTarget(candidates, typed, { selfId = null } = {}) {
  const matched = (candidates ?? []).filter((c) => matchesTypedName(c, typed));
  const notMe = matched.filter((c) => c.id !== selfId);
  if (notMe.length !== 1) return { target: null, reason: "invalid" };
  const target = notMe[0];
  if (target.excommunicationBorne) return { target: null, reason: "invalid" };
  if (!(target.tags?.length ?? 0)) return { target: null, reason: "not-post-christian" };
  return { target, reason: null };
}

// What the Bishop's dialog lists and lifts from: the marks THIS Bishop laid,
// oldest first, so the list does not reshuffle under a click.
async function listExcommunications(db, bishopId) {
  const rows = await db.excommunication.findMany({
    where: { bishopId },
    orderBy: { createdAt: "asc" },
    select: { targetCharacter: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.targetCharacter.id, name: r.targetCharacter.name }));
}

module.exports = {
  BISHOP_SLUG,
  EXCOMMUNICATED_SLUG,
  DEPRIVER_SLUG,
  POST_CHRISTIAN_SLUG,
  isBishop,
  excommunicationCap,
  excommunicateTarget,
  listExcommunications,
};
