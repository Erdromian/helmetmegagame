// Strangers (docs/systemdocs/STRANGERS.md, from Bascinet's own Strangers.docx).
// Somebody you cannot put a name to is shown to you as what they look like,
// "a young man" or "an old woman". There are two reasons you might not be able
// to: their face is covered, or you have never met them (you have no Friends
// entry for them, db/lib/acquaintances.js). This module holds the three pieces
// that rule needs beyond the hood itself:
//
//   1. WHO YOU RECOGNISE. knownSubjects: one batched Friends lookup.
//   2. THE LABEL. Two people who look the same in one place are told apart by
//      a label, "on the left" or "hunched". It is the same for every observer,
//      so two people can agree which one they mean, and it is rolled again
//      when the person moves or covers or uncovers their face.
//      settlePresence and labelAliases.
//   3. THE CHAT LENS. A feed row is built once and sent to everyone reading a
//      place (web/lib/feedHub.js), so what each reader sees is decided here,
//      per reader, on the way out. lensRow puts a stranger's line under an
//      alias and adds the reader's own voice number, "a young man (3)".
//      Voice numbers are written by db/lib/memoryHearing.js#hearVoice.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel.

const crypto = require("node:crypto");
const { concealedAlias, isConcealedAlias, LOOK_TAGS_SELECT } = require("./concealedIdentity");
const { sceneSpeakerKey } = require("./hoodToken");
const { renderPeopleLine, peopleIds, disguiseNames } = require("./peopleLine");
const { skinlessIdsAmong, gruntify } = require("./skinless");
const { readDisguises, disguiseRead, DISGUISE_STRANGER_FACE: BLANK_PLAQUE } = require("./disguises");
const { roleGroupHue } = require("./roleGroups");

// Bascinet's list, lower-cased to sit mid-sentence: "a young man, hunched".
// "Infront" in the doc is "in front".
const STRANGER_LABELS = [
  "on the left",
  "on the right",
  "at the back",
  "in front",
  "behind",
  "head bowed",
  "fidgeting",
  "hunched",
  "scratching their chin",
  "looking away",
  "motionless",
];

// ------------------------------------------------------------ recognition

// Whether a bare face with no Friends entry reads as an alias at all: the GM's
// switch, GameConfig.anonymizeStrangers (STRANGERS.md §9). Off, everybody reads
// every uncovered face by name, and only a hood hides anyone. A missing row, or
// a fake with no gameConfig table, counts as on.
async function anonymizingStrangers(prisma) {
  if (typeof prisma?.gameConfig?.findUnique !== "function") return true;
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { anonymizeStrangers: true } });
  return config?.anonymizeStrangers !== false;
}

// Which of `subjectIds` the viewer has a Friends entry for, as a Set. Null means
// the stranger rule does not apply at all. That is the case when there is no
// viewer (a GM, the Discord readout), when the GM has switched the rule off,
// and when `prisma` has no acquaintance table, as in the unit tests' fakes.
async function knownSubjects(prisma, viewerId, subjectIds) {
  if (!viewerId || typeof prisma?.acquaintance?.findMany !== "function") return null;
  if (!(await anonymizingStrangers(prisma))) return null;
  const ids = [...new Set((subjectIds ?? []).filter((id) => id && id !== viewerId))];
  const known = new Set([viewerId]);
  if (ids.length === 0) return known;
  const rows = await prisma.acquaintance.findMany({
    where: { ownerId: viewerId, subjectId: { in: ids } },
    select: { subjectId: true },
  });
  for (const row of rows) known.add(row.subjectId);
  return known;
}

// --------------------------------------------------------------- labels

// Rolled lazily, by whoever looks first once a label is stale. Every path that
// can cover a face (the conceal switch, equipping, a stolen hood, a sack that
// forces it) would otherwise need its own hook, and this catches all of them
// with no list to keep up to date.
function presenceStale(row, hidden) {
  return !row.presenceLabel || !row.presenceNonce || row.presenceHidden !== hidden;
}

function freshNonce() {
  return crypto.randomBytes(8).toString("hex");
}

// Picks a label nobody else at the Location holds, and a label at random once
// all eleven are taken, since a crowded room has to repeat one.
function pickLabel(taken, random = Math.random) {
  const free = STRANGER_LABELS.filter((label) => !taken.has(label));
  const pool = free.length > 0 ? free : STRANGER_LABELS;
  return pool[Math.floor(random() * pool.length)];
}

// Brings the label and nonce up to date for everyone in `rows`, all of whom are
// standing at one Location. `hiddenOf(row)` says whether that person is hidden
// from everyone right now, so a change in it rolls a new label. It changes the
// rows in place and writes what it rolled.
//
// The write is conditional on the nonce it replaces. So when two readers race,
// one wins and the other takes the winner's roll instead of writing over it.
async function settlePresence(prisma, rows, hiddenOf, { random = Math.random } = {}) {
  if (typeof prisma?.character?.updateMany !== "function") return rows;
  const living = rows.filter((row) => row.status !== "DEAD");
  const stale = living.filter((row) => presenceStale(row, hiddenOf(row)));
  if (stale.length === 0) return rows;

  const taken = new Set(living.filter((row) => !stale.includes(row)).map((row) => row.presenceLabel).filter(Boolean));
  for (const row of stale) {
    const hidden = hiddenOf(row);
    const next = { presenceLabel: pickLabel(taken, random), presenceNonce: freshNonce(), presenceHidden: hidden };
    const { count } = await prisma.character.updateMany({
      where: { id: row.id, presenceNonce: row.presenceNonce ?? null },
      data: next,
    });
    if (count === 1) {
      Object.assign(row, next);
    } else {
      const winner = await prisma.character.findUnique({
        where: { id: row.id },
        select: { presenceLabel: true, presenceNonce: true, presenceHidden: true },
      });
      if (winner) Object.assign(row, winner);
    }
    if (row.presenceLabel) taken.add(row.presenceLabel);
  }
  return rows;
}

// Moving on clears the label, so the next look at the new place rolls one.
// Every voice number on the mover goes dark too, until they next speak
// (STRANGERS.md §4). Called from locationMove.js#applyArrivalFacts.
async function clearPresence(prisma, characterId) {
  if (!characterId) return;
  await prisma.character.updateMany({
    where: { id: characterId },
    data: { presenceLabel: null, presenceNonce: null, presenceHidden: null },
  });
  await prisma.voiceMemory.updateMany({ where: { subjectId: characterId, live: true }, data: { live: false } });
}

// The alias each row is shown under, with its label added when two or more rows
// in the same list share an alias. On its own, somebody is just "a young man":
// there is nobody to tell them apart from.
function labelAliases(rows, aliasOf, labelOf) {
  const counts = new Map();
  for (const row of rows) {
    const alias = aliasOf(row);
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  return rows.map((row) => {
    const alias = aliasOf(row);
    const label = labelOf(row);
    return (counts.get(alias) ?? 0) > 1 && label ? `${alias}, ${label}` : alias;
  });
}

// ------------------------------------------------------------- chat lens

// The real speaker of a shaped feed row, carried beside it for the lens and
// never sent. A non-enumerable symbol: JSON.stringify skips it, and a spread
// copy drops it. So a row that reaches a browser without passing through
// lensRow still carries no id.
//
// From the global registry, not a plain Symbol(): the web app can load this
// module more than once (the feed hub is a process-wide singleton built by
// whichever route got there first), and two copies minting their own symbol
// would not see each other's speaker. That happened, and a stranger's line
// went out under their real name.
const SPEAKER = Symbol.for("bascinet.feed.speaker");

function attachSpeaker(shaped, characterId) {
  if (shaped && characterId) {
    Object.defineProperty(shaped, SPEAKER, { value: characterId, enumerable: false });
  }
  return shaped;
}

// Who may read a shaped row, when not everybody at its place (a telephone's two
// voices, PHONES.md §6): `{ only, except }`, each a character id or null. Hidden
// the same way the speaker is and for a sharper reason — an id on a room row
// would say who is holding the phone. From the global registry for the reason
// SPEAKER gives.
const AUDIENCE = Symbol.for("bascinet.feed.audience");

function attachAudience(shaped, { only = null, except = null } = {}) {
  if (shaped && (only || except)) {
    Object.defineProperty(shaped, AUDIENCE, { value: { only, except }, enumerable: false });
  }
  return shaped;
}

/**
 * Whether this reader may see this row at all. A GM reads everything; a row
 * with no audience is for the whole place. A reader with no character (a
 * ghost, the lobby) never reads a row meant for one person, and does read one
 * that is only kept from somebody.
 */
function readsRow(row, { characterId = null, gm = false } = {}) {
  const audience = row?.[AUDIENCE];
  if (!audience || gm) return true;
  if (audience.only && audience.only !== characterId) return false;
  if (audience.except && audience.except === characterId) return false;
  return true;
}

// A line that names people per reader (./peopleLine.js), on the same kind of hidden symbol and for the
// same reason: the template carries every real name in it, and must never reach a browser. The lens
// renders it into `content` for each reader. From the global registry for the reason SPEAKER gives.
const SUBJECTS = Symbol.for("bascinet.feed.subjects");

function attachSubjects(shaped, subjects) {
  if (shaped && subjects && typeof subjects === "object") {
    Object.defineProperty(shaped, SUBJECTS, { value: subjects, enumerable: false });
  }
  return shaped;
}

// That the row's alias is a Disguise Kit's name (ArchiveEntry.disguised), which the lens names per
// reader (STRANGERS.md §10). Hidden for a plainer reason than the others: a visible flag would tell
// every reader that the name on the line is false. From the global registry for the reason SPEAKER gives.
const DISGUISED = Symbol.for("bascinet.feed.disguised");

function attachDisguised(shaped, disguised) {
  if (shaped && disguised) {
    Object.defineProperty(shaped, DISGUISED, { value: true, enumerable: false });
  }
  return shaped;
}

function isDisguisedRow(row) {
  return Boolean(row?.alias) && Boolean(row?.[DISGUISED]);
}

// The row's own characterId is the fallback. A bare-faced row carries it anyway,
// so a row that somehow lost its symbol is still judged rather than waved
// through under a name the reader may not know. A hooded row has none, and
// its alias is already safe.
function speakerOf(row) {
  return row?.[SPEAKER] ?? row?.characterId ?? null;
}

// A reader's view of the feed. `characterId` is who is reading. `gm` sees every
// row as it was built, real names and the stable key the GM's key ring reads.
// A reader with no character (a ghost, somebody in the lobby) recognises
// everybody, as they did before this existed, but still never gets a stable
// key for a hood.
function createLens(prisma, { characterId = null, gm = false } = {}) {
  const facts = new Map(); // speaker id -> { known, voice, age, gender, tags }
  // THE SKINLESS (db/lib/skinless.js): which speakers grunt, and whether this
  // reader is one of them and so hears the words. Read here, beside the rest,
  // because it is the same question: what this reader makes of this speaker.
  const grunters = new Set();
  let readerSkinless = false;
  // What this reader makes of each disguise name on the rows (./disguises.js#readDisguises). `null`
  // until something is read, and after a read that came back null (the rule is off): every name known.
  const disguises = new Map();
  let disguisesOff = false;

  async function prepareGrunts(rows) {
    const speakers = [
      ...new Set(
        (rows ?? [])
          .filter((row) => row?.source !== "SYSTEM")
          .map(speakerOf)
          .filter((id) => id && id !== characterId),
      ),
    ];
    if (speakers.length === 0) return;
    const skin = await skinlessIdsAmong(prisma, characterId ? [...speakers, characterId] : speakers);
    if (characterId) readerSkinless = skin.has(characterId);
    for (const id of speakers) {
      if (skin.has(id)) grunters.add(id);
      else grunters.delete(id);
    }
  }

  // Reads what this reader knows about every speaker in `rows`. It asks again
  // every time, since a line may have just taught a name or a voice.
  async function prepare(rows) {
    if (gm) return;
    // Everybody but a GM, the characterless included: a ghost hears grunts too.
    await prepareGrunts(rows);
    if (!characterId) return;
    // The disguise names on these lines, read against this reader's Friends list. Asked again every
    // time, since a line may have just taught one.
    const worn = [
      ...new Set([
        ...(rows ?? []).filter(isDisguisedRow).map((row) => row.alias),
        ...(rows ?? []).flatMap((row) => disguiseNames(row?.[SUBJECTS])),
      ]),
    ];
    if (worn.length > 0) {
      const reads = await readDisguises(prisma, characterId, worn);
      disguisesOff = reads === null;
      for (const [name, read] of reads ?? []) disguises.set(name, read);
    }
    // The speakers, and everybody a line names (a fight's announcement): the lens asks about both.
    const named = (rows ?? []).flatMap((row) => peopleIds(row?.[SUBJECTS]));
    const ids = [...new Set([...(rows ?? []).map(speakerOf), ...named].filter((id) => id && id !== characterId))];
    if (ids.length === 0) return;
    const [anonymizing, known, voices, people] = await Promise.all([
      anonymizingStrangers(prisma),
      prisma.acquaintance.findMany({ where: { ownerId: characterId, subjectId: { in: ids } }, select: { subjectId: true } }),
      prisma.voiceMemory.findMany({
        where: { ownerId: characterId, subjectId: { in: ids } },
        select: { subjectId: true, number: true, live: true },
      }),
      // The tags that put a word in the alias ("Young Skinless Man").
      prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true, age: true, gender: true, tags: LOOK_TAGS_SELECT } }),
    ]);
    const knownIds = new Set(known.map((row) => row.subjectId));
    const voiceOf = new Map(voices.map((row) => [row.subjectId, row]));
    const person = new Map(people.map((row) => [row.id, row]));
    for (const id of ids) {
      facts.set(id, {
        // With the rule switched off, every face is one the reader can name.
        known: !anonymizing || knownIds.has(id),
        voice: voiceOf.get(id) ?? null,
        age: person.get(id)?.age ?? null,
        gender: person.get(id)?.gender ?? null,
        tags: person.get(id)?.tags ?? [],
      });
    }
  }

  // Null for a row this reader may not see at all (readsRow): every surface
  // drops those rather than drawing them.
  const apply = (row) =>
    readsRow(row, { characterId, gm })
      ? lensRow(row, { characterId, gm, facts, grunters, readerSkinless, disguises: disguisesOff ? null : disguises })
      : null;

  async function all(rows) {
    const visible = (rows ?? []).filter((row) => readsRow(row, { characterId, gm }));
    await prepare(visible);
    return visible.map(apply);
  }

  return { prepare, apply, all, characterId, gm };
}

// One row as this reader should see it. Pure: `lens.facts` was filled by prepare.
function lensRow(row, lens) {
  if (!row) return row;
  const id = speakerOf(row);
  const out = { ...row };
  // A line that names people is told in the names this reader knows them by. A GM and a reader with no
  // character read every face by name — the rule the speaker half below follows for them too.
  const subjects = row[SUBJECTS];
  if (subjects) {
    out.content = renderPeopleLine(subjects, {
      viewerId: lens.characterId ?? null,
      everyone: Boolean(lens.gm) || !lens.characterId,
      knows: (subjectId) => Boolean(lens.facts?.get(subjectId)?.known),
      knowsName: (name) => disguiseRead(lens.disguises, name).known,
    });
  }
  if (!id || lens.gm) return out;
  // Your own lines keep the key your page compares against (self.speakerKey).
  if (id === lens.characterId) return out;
  // A Skinless's words reach only another Skinless; everyone else hears grunts,
  // the same grunts on every surface, seeded by the line (db/lib/skinless.js).
  if (row.source !== "SYSTEM" && lens.grunters?.has(id) && !lens.readerSkinless) {
    out.content = gruntify(row.content ?? "", Number(row.seq) || 0);
  }

  const disguised = isDisguisedRow(row);
  const hooded = !disguised && Boolean(row.alias) && isConcealedAlias(row.alias);
  const forced = !disguised && Boolean(row.alias) && !hooded;
  const sceneKey = () => sceneSpeakerKey(id, row.placeKey, row.turnNumber);

  // A forced name is the name everyone sees (PROXYING.md §5). It only loses the
  // stable key, which would follow them from scene to scene.
  if (forced) return { ...out, speakerKey: sceneKey() };
  // A disguise's name is read by whoever can put it to the face (§10): nobody to recognise with, the
  // rule switched off, a reader who learned the name, or one it fools. The one it fools sees the
  // face of the person they take the wearer for, served per reader by the line's own face route.
  if (disguised) {
    const read = lens.characterId ? disguiseRead(lens.disguises, row.alias) : { known: true, fooledAs: null };
    if (read.known) {
      const shown = { ...out, speakerKey: sceneKey() };
      if (read.fooledAs && row.seq) {
        shown.avatarPath = `/api/avatar/line/${row.seq}`;
        shown.avatarVersion = null;
        shown.unknownFace = false;
        // Painted in the estate the reader knows that person by, as their own lines are.
        shown.roleGroup = roleGroupHue(read.fooledGroup);
      }
      return shown;
    }
  }
  // Nobody to recognise with: hoods stay hoods, faces stay named.
  if (!lens.characterId) return hooded ? { ...out, speakerKey: sceneKey() } : out;

  const fact = lens.facts?.get(id) ?? null;
  // An unrecognised disguise is a stranger's face, whoever is wearing it.
  const stranger = disguised || (!hooded && !fact?.known);
  if (!hooded && !stranger) return out;

  const alias = hooded ? row.alias : concealedAlias(fact ?? {});
  const voice = fact?.voice?.live ? fact.voice.number : null;
  out.name = voice ? `${alias} (${voice})` : alias;
  out.speakerKey = sceneKey();
  if (stranger) {
    // The face stays: a stranger is not hiding it. It is fetched by line, never
    // by id, so the browser holds nothing that names them. The estate colour
    // stays too, as it does in Who's here.
    out.characterId = null;
    out.alias = alias;
    out.avatarPath = row.seq ? `/api/avatar/line/${row.seq}` : null;
    out.avatarVersion = null;
    out.unknownFace = !row.seq;
    // A disguise is not the wearer's own face, and the room did not see their estate on it.
    if (disguised) {
      out.avatarPath = BLANK_PLAQUE;
      out.unknownFace = false;
      out.roleGroup = null;
    }
  }
  return out;
}

// Who a KEPT copy of a line is filed under — a Highlight (web/lib/starNote.js)
// — and the face kept beside it. `row` is the ArchiveEntry as stored, `shown`
// the same row through the keeper's own lens. Pure.
//
// A line said under a hood or a forced name keeps that name and the face the
// room saw. A bare face the keeper could not name keeps the alias the lens
// gave them and NO face: the chat fetches a stranger's face by line
// (/api/avatar/line/<seq>), which answers only while the keeper can still
// read the line, and a Highlight is kept long after that. Somebody the keeper
// knows keeps their name; the page draws their face from the id.
function keptSpeaker(row, shown) {
  // A disguise the keeper could not put a name to is kept as the stranger they saw, with no face.
  if (row?.concealedAlias && row.disguised && shown?.alias && shown.alias !== row.concealedAlias) {
    return { name: shown.alias, avatarPath: null };
  }
  if (row?.concealedAlias) return { name: row.concealedAlias, avatarPath: row.presentedAvatarPath ?? null };
  if (shown?.alias) return { name: shown.alias, avatarPath: null };
  return { name: row?.characterName ?? null, avatarPath: null };
}

// A typing notice as this reader should see it. `event` comes from the hub with
// the real id, the presented name, whether that name hides them (`hidden`), and
// the alias their face would give. The id is swapped for a scene key whenever
// the name is an alias, since the browser keys its list on it.
//
// A disguise always types under a scene key, since its real id beside its false name is the unmasking.
// `disguiseKnown` is whether this reader can put the disguise's name to the face (./disguises.js); false
// shows the alias instead.
function lensTyping(event, { characterId = null, gm = false, known = null, disguiseKnown = true } = {}) {
  const base = { placeKey: event.placeKey, characterId: event.characterId, name: event.name };
  if (gm) return base;
  const scene = sceneSpeakerKey(event.characterId, event.placeKey, "typing");
  if (event.hidden) return { ...base, characterId: scene };
  if (event.disguised) {
    return characterId && !disguiseKnown ? { ...base, characterId: scene, name: event.alias } : { ...base, characterId: scene };
  }
  if (event.forced || !characterId || !known || known.has(event.characterId)) return base;
  return { ...base, characterId: scene, name: event.alias };
}

module.exports = {
  STRANGER_LABELS,
  anonymizingStrangers,
  knownSubjects,
  presenceStale,
  pickLabel,
  settlePresence,
  clearPresence,
  labelAliases,
  SPEAKER,
  attachSpeaker,
  speakerOf,
  AUDIENCE,
  attachAudience,
  SUBJECTS,
  attachSubjects,
  DISGUISED,
  attachDisguised,
  isDisguisedRow,
  readsRow,
  createLens,
  lensRow,
  keptSpeaker,
  lensTyping,
};
