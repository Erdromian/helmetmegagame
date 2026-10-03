// WHAT A GM IS TOLD ABOUT A FACE: whether somebody is hooded, disguised or going by a public name,
// what the room reads them as, and the truth beside it (docs/systemdocs/STRANGERS.md §10, "What a GM
// sees"). Every GM surface that names a character asks here — the desk, the player desk, the Dev Panel,
// the chat aside, the dossier — so a hood reads the same on every one of them.
//
// A GM has no body, so this is never a viewer's read. Nobody is a stranger to a GM, a disguise fools no
// GM, and nothing here asks anybody's Friends list. It answers the one question no player can: what is
// this person hiding, and behind what.
//
// Two forms. `presentationOf(row)` is the LIVE look, worked out from what they hold and wear now.
// `stampPresentation(presentationOf(row))` is the same thing FROZEN onto a row at the moment they acted (Action,
// CombatParticipant, CavingRoll `presentedAs`), because a disguise lasts three turns and its tag is
// deleted once nobody holds it (db/index.js), so "what were they wearing when they filed this" cannot be
// worked out afterwards. A desk shows the frozen one and adds "now: …" when the live one differs.
//
// GM-ONLY. Nothing here may reach a player's or a spectator's payload: the presentation names the item
// over the face and the disguise under the hood, which is exactly what the room cannot see. Pure apart
// from the two loaders, which take `db` (prisma or a tx), the dm.js convention.

const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  deathMaskPiece,
  forcedNameFrom,
} = require("./presentedIdentity");
const { aliasRow, LOOK_SLUGS } = require("./concealedIdentity");
const { isDisguiseTag, disguiseJobFrom, jobsBySlug } = require("./disguises");
const { roleGroupHue } = require("./roleGroups");

const STAMP_VERSION = 1;

// What presentationOf needs, for a character loaded fresh: the held forced names, every concealing piece
// (equipped or not, since a corpse's remembered mask is no longer in its slot), and the tags that put a
// word in a stranger's alias ("Young Skinless Man"). The same shape as whosHere.js#PRESENT_SELECT, so a
// row from presentRows reads here too.
const GM_PRESENTATION_SELECT = {
  id: true,
  name: true,
  status: true,
  concealed: true,
  deathMaskTagId: true,
  age: true,
  gender: true,
  tags: {
    where: {
      quantity: { gt: 0 },
      OR: [{ tag: { forcedName: { not: null } } }, { tag: { concealsIdentity: true } }, { tag: { slug: { in: LOOK_SLUGS } } }],
    },
    select: { tagId: true, equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The first held Disguise Kit tag, hood or no hood. forcedNameFrom hides a disguise under a hood, which
// is right for the room and wrong for a GM, who still needs to know it is there.
function heldDisguiseTag(tags) {
  for (const entry of Array.isArray(tags) ? tags : []) {
    const tag = entry?.tag ?? entry;
    if (typeof tag?.forcedName !== "string" || !tag.forcedName.trim()) continue;
    return isDisguiseTag(tag) ? tag : null; // only the FIRST forced name counts, as forcedNameFrom has it
  }
  return null;
}

function jobOf(tag) {
  const name = typeof tag?.disguiseJob === "string" && tag.disguiseJob.trim() ? tag.disguiseJob.trim() : null;
  const slug = tag?.disguiseJobSlug ?? null;
  return name || slug ? { name, slug } : null;
}

// PURE. The live look, or null for a bare face. `row` is a character loaded with GM_PRESENTATION_SELECT
// (or whosHere.js#PRESENT_SELECT). The order is presentedIdentity's: a forced name, then a hood, then a
// dead body's mask, then their own face.
//
//   kind     "disguise" | "forced" | "hood" | "deathmask"
//   shownAs  what the room reads: "Sir Aldric Vask", "Beast", "a young man"
//   item     the piece over the face, for a hood or a death mask
//   job      { name, slug } the disguise claims, or null
//   under    the disguise a hood is hiding, or null; its job rides beside it as `underJob`
function presentationOf(row) {
  if (!row) return null;
  const tags = Array.isArray(row.tags) ? row.tags : [];

  // A corpse goes by its own name (death is not a disguise anybody keeps up), masked only by what it died in.
  if (row.status === "DEAD") {
    const mask = deathMaskPiece(row);
    return mask ? { kind: "deathmask", shownAs: aliasRow(row), item: mask.name ?? null, job: null, under: null } : null;
  }

  const forced = forcedNameFrom(tags, row);
  if (forced) {
    const disguise = heldDisguiseTag(tags);
    if (disguise) {
      return { kind: "disguise", shownAs: forced, item: null, job: disguiseJobFrom(tags, row), under: null };
    }
    return { kind: "forced", shownAs: forced, item: null, job: null, under: null };
  }

  const piece = concealmentFrom(tags);
  if (piece && (piece.forced || row.concealed)) {
    const hidden = heldDisguiseTag(tags); // forcedNameFrom said no, so a hood is over it if it is there
    return {
      kind: "hood",
      shownAs: aliasRow(row),
      item: piece.name ?? null,
      job: null,
      under: hidden ? hidden.forcedName.trim() : null,
      underJob: hidden ? jobOf(hidden) : null,
    };
  }
  return null;
}

// The estate a claimed job is painted in, for every presentation in `list` (mutated in place, returned).
// One query for any number of them.
async function withJobGroups(db, list) {
  const slugs = list.flatMap((p) => [p?.job?.slug, p?.underJob?.slug]).filter(Boolean);
  if (slugs.length === 0) return list;
  const jobs = await jobsBySlug(db, slugs);
  // A real seat's estate, and its name for a job typed as nothing but the slug.
  const filled = (job) => {
    const seat = job?.slug ? jobs.get(job.slug) : null;
    return seat ? { ...job, name: job.name ?? seat.name ?? null, group: roleGroupHue(seat.groupSlug) ?? null } : job;
  };
  for (const p of list) {
    if (!p) continue;
    if (p.job) p.job = filled(p.job);
    if (p.underJob) p.underJob = filled(p.underJob);
  }
  return list;
}

// Every live look for these ids: Map<characterId, presentation>, with nobody bare in it. One query for
// the characters and at most one for the jobs, however many there are, so a whole desk payload costs two.
async function loadPresentations(db, ids) {
  const list = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id))];
  if (list.length === 0) return new Map();
  const rows = await db.character.findMany({ where: { id: { in: list } }, select: GM_PRESENTATION_SELECT });
  const out = new Map();
  for (const row of rows) {
    const p = presentationOf(row);
    if (p) out.set(row.id, p);
  }
  await withJobGroups(db, [...out.values()]);
  return out;
}

// PURE. The look frozen for a row's `presentedAs` column: null for a bare face, which is also what every
// row written before the column reads as, so a reader falls back to the live look for both. A job's
// estate is not frozen: it is a fact about the seat, not the face, so a reader paints it with
// withJobGroups, the way the live look is painted.
function stampPresentation(presentation) {
  if (!presentation?.kind) return null;
  const stamp = { v: STAMP_VERSION, kind: presentation.kind, shownAs: presentation.shownAs ?? null };
  if (presentation.item) stamp.item = presentation.item;
  const job = (j) => ({ name: j.name ?? null, slug: j.slug ?? null });
  if (presentation.job) stamp.job = job(presentation.job);
  if (presentation.under) stamp.under = presentation.under;
  if (presentation.underJob) stamp.underJob = job(presentation.underJob);
  return stamp;
}

const KINDS = new Set(["disguise", "forced", "hood", "deathmask"]);

// The stamp back out of the column. NEVER throws: an unknown version or a malformed blob reads as no
// stamp, and the caller shows the live look rather than a 500.
function readStamp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.v !== STAMP_VERSION || !KINDS.has(value.kind)) return null;
  const text = (x) => (typeof x === "string" && x.trim() ? x : null);
  const job = (x) =>
    x && typeof x === "object" && (text(x.name) || text(x.slug))
      ? { name: text(x.name), slug: text(x.slug) }
      : null;
  return {
    kind: value.kind,
    shownAs: text(value.shownAs),
    item: text(value.item),
    job: job(value.job),
    under: text(value.under),
    underJob: job(value.underJob),
  };
}

// The stamp for one character, read inside the writer's own transaction, for the `presentedAs` column
// of the row it is about to create. Null for a bare face. A row that will not shape (a missing
// character, a tag in an odd state) reads as no stamp rather than throwing, since a Move must never be
// refused over its GM annotation. A database error inside a transaction still aborts that transaction
// whatever this catches, as any read there would.
async function presentationStamp(db, characterId) {
  if (!characterId) return null;
  try {
    const row = await db.character.findUnique({ where: { id: characterId }, select: GM_PRESENTATION_SELECT });
    return stampPresentation(presentationOf(row));
  } catch (err) {
    console.error("presentationStamp failed:", err?.message ?? err);
    return null;
  }
}

// Everything one GM payload needs to show looks: every live look for `ids`, and the estates of the jobs
// the frozen `stamps` (raw `presentedAs` values) claim. Two or three queries for a whole desk. Hand the
// result to lookPair for each row.
async function loadLooks(db, { ids = [], stamps = [] } = {}) {
  const now = await loadPresentations(db, ids);
  const slugs = stamps.map(readStamp).flatMap((p) => [p?.job?.slug, p?.underJob?.slug]).filter(Boolean);
  const jobs = await jobsBySlug(db, slugs);
  const groupBySlug = new Map([...jobs].map(([slug, seat]) => [slug, roleGroupHue(seat.groupSlug) ?? null]));
  return { now, groupBySlug };
}

// PURE. One row's two looks, ready for the page: `then`, frozen when they acted (null for a bare face or a
// row from before the stamp), and `now`, today's (null for a bare face). `stamp` is the raw
// `presentedAs` value, or undefined on a surface that has no moment to freeze (the inspector, a roster),
// which ships only `now`. `looks` is loadLooks's answer.
function lookPair(stamp, characterId, looks) {
  const now = looks?.now?.get(characterId) ?? null;
  if (stamp === undefined) return { now };
  const then = readStamp(stamp);
  const paint = (job) => (job?.slug && looks?.groupBySlug?.has(job.slug) ? { ...job, group: looks.groupBySlug.get(job.slug) } : job);
  if (then) {
    then.job = paint(then.job);
    then.underJob = paint(then.underJob);
  }
  return { then, now };
}

module.exports = {
  GM_PRESENTATION_SELECT,
  presentationOf,
  loadPresentations,
  loadLooks,
  lookPair,
  stampPresentation,
  readStamp,
  presentationStamp,
  withJobGroups,
  // The words live in a zero-require file so client components can have them too.
  ...require("./gmLookText"),
};
