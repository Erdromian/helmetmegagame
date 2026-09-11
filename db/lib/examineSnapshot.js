// What the room could SEE of a speaker, frozen onto the line they said.
//
// A look answers for the MOMENT you saw somebody, never for now. The name and
// the face have been frozen on the archive row for a long time
// (ArchiveEntry.concealedAlias, .presentedAvatarPath) and PROXYING.md §5a says
// so in words — but everything else on the readout was read live off the
// character, so a cultist could chat bare-faced in Town, walk two zones off,
// robe up, and every old line of his would show the robes to anybody who
// clicked the eye. This is the third frozen column, written by the same hand
// for the same reason.
//
// ONE RULE, and it decides every question this file answers:
//
//   Character-side frozen. Catalog-side live. Viewer-side live.
//
//   * Character-side — appearance, the name, held tags and which were worn,
//     faction, role, ⬢. What the room could see. Frozen here.
//   * Catalog-side — a tag's name, armour value, requirement, visibility.
//     Rules rather than disguise, and a rebalance should reach an old line.
//     Read live off Tag at look time (db/lib/examine.js#EXAMINE_TAG_SELECT).
//   * Viewer-side — the doctor's eye, Seductive, the officer's seat, a
//     Thanati's sight. The looker's own faculties, now. Never frozen; freezing
//     them would mean snapshotting the cross-product of every possible reader.
//
// The payload is deliberately compact, because it rides on every message row
// in the transcript:
//
//   { v: 1, n: name, a: appearance, r: roleTitle, s: resources,
//     f: factionId, c: concealed, t: [[tagId, 0|1, expiresTurn], …] }
//
// EVERY tag the character holds goes in, not a filtered subset. A forcedName
// or concealsIdentity tag is usually `visible: false`, and presentedIdentity()
// runs off subject.tags inside examineReadout — prune the hidden rows and a
// Beast's frozen line reads out under their real name. Health rows behind the
// doctor's eye are hidden too. Freezing the lot is simpler and it survives the
// next field somebody adds to the readout.
//
// Prisma-free except for loadPresentedState, which takes `prisma` as a
// parameter rather than requiring the barrel — the db/lib/dm.js convention.
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");

const SNAPSHOT_VERSION = 1;

// What a WRITER must load to build one. A superset of what loadForcedName and
// loadConcealment used to fetch separately, which is why db/lib/say.js can
// drop both for one call to loadPresentedState below.
//
// No `quantity` filter, on purpose: neither of those two loaders filtered one
// and neither does EXAMINE_SUBJECT_SELECT, so a zero-quantity row is visible
// to Examine today. Matching that exactly means no filter — anything else
// would be a behaviour change smuggled in under a bug fix.
const PRESENTED_STATE_SELECT = {
  name: true,
  appearance: true,
  roleTitle: true,
  resources: true,
  factionId: true,
  concealed: true,
  tags: {
    select: {
      tagId: true,
      equipped: true,
      expiresTurn: true,
      tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } },
    },
  },
};

// A character row loaded with PRESENTED_STATE_SELECT -> the payload. Pure.
function presentedStateFrom(character) {
  if (!character) return null;
  return {
    v: SNAPSHOT_VERSION,
    n: character.name ?? null,
    a: character.appearance ?? null,
    r: character.roleTitle ?? null,
    s: character.resources ?? null,
    f: character.factionId ?? null,
    c: Boolean(character.concealed),
    t: (character.tags ?? [])
      .filter((ct) => ct?.tagId)
      .map((ct) => [ct.tagId, ct.equipped ? 1 : 0, ct.expiresTurn ?? null]),
  };
}

// The payload back out of the column. NEVER throws and never guesses: an
// unknown version, a malformed blob or a plain null all return null, and the
// caller falls back to the live character — which is what every row did before
// this column existed. This is the one look path in the game, so a bad row has
// to degrade rather than 500.
function readPresentedState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.v !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.t)) return null;
  const tags = [];
  for (const entry of value.t) {
    if (!Array.isArray(entry)) continue;
    const [tagId, equipped, expiresTurn] = entry;
    if (typeof tagId !== "string" || !tagId) continue;
    tags.push({
      tagId,
      equipped: equipped === 1 || equipped === true,
      expiresTurn: Number.isInteger(expiresTurn) ? expiresTurn : null,
    });
  }
  return {
    name: typeof value.n === "string" ? value.n : null,
    appearance: typeof value.a === "string" ? value.a : null,
    roleTitle: typeof value.r === "string" ? value.r : null,
    resources: Number.isFinite(value.s) ? value.s : null,
    factionId: typeof value.f === "string" ? value.f : null,
    concealed: Boolean(value.c),
    tags,
  };
}

// A subject shaped exactly like db/lib/examine.js#EXAMINE_SUBJECT_SELECT, built
// out of the frozen state plus the live catalog. `live` is the character row —
// still needed for the three things that are not in-fiction state (`id`,
// `updatedAt` for the avatar cache-buster, `age`/`gender`).
//
// `tags` is REPLACED outright, never merged with the live list. A merge is
// exactly how the robes get back in.
//
// A tag since deleted from the catalog — a pruned row, a spent ephemeral, a
// torn-up Photo — simply drops out. That fails toward the look losing a detail
// rather than inventing one, and it is why the snapshot does not freeze tag
// names as a fallback: a name is catalog data, and catalog data comes live.
function rehydrateSubject({ live, state, tags = [], faction = null }) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return {
    ...live,
    name: state.name ?? live?.name ?? null,
    appearance: state.appearance,
    roleTitle: state.roleTitle,
    resources: state.resources,
    factionId: state.factionId,
    faction,
    concealed: state.concealed,
    tags: state.tags
      .map((row) => {
        const tag = byId.get(row.tagId);
        if (!tag) return null;
        // Drop the id again: EXAMINE_TAG_SELECT does not carry one, and a
        // subject that differs from the fetched shape is how a reader starts
        // depending on the difference.
        const { id, ...rest } = tag;
        return { equipped: row.equipped, expiresTurn: row.expiresTurn, tag: rest };
      })
      .filter(Boolean),
  };
}

// The one query a writer needs. Returns the payload plus the two identity
// answers derived from the SAME rows, so db/lib/say.js#prepareSpeech can drop
// its separate loadForcedName and loadConcealment calls — one query where
// there were two, and no chance of the three disagreeing about what somebody
// was holding.
async function loadPresentedState(prisma, characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: PRESENTED_STATE_SELECT,
  });
  if (!character) return { state: null, forcedName: null, concealment: undefined };
  return {
    state: presentedStateFrom(character),
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  };
}

module.exports = {
  presentedStateFrom,
  readPresentedState,
  rehydrateSubject,
  loadPresentedState,
};
