// Who is IN a place — a Conversation's members, a private Room's guests — as
// the viewer is entitled to see them. db/lib/whosHere.js answers the same
// question for a Location; these two lists never did: they shipped
// Character.id beside the name, so the strip named a hooded member outright
// — /api/avatar/<id> is ungated, so handing the browser the id IS the leak.
// A second function rather than a third argument to whosHere, since
// membership is not presence: a member may be standing anywhere. Flat list,
// not whosHere's named/concealed pair — a hood is still a seat. A concealed
// row carries `characterId: null` and a `token` instead (hoodToken, an HMAC
// under AUTH_SECRET). SIGHTINGS ARE AN ARGUMENT, not a query made here —
// whosHere.js reaches conversations.js, which is this module's own caller.
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { aliasRow, LOOK_SLUGS } = require("./concealedIdentity");
const { hoodToken } = require("./hoodToken");
const { knownSubjects, labelAliases } = require("./strangers");
const { roleGroupHue } = require("./roleGroups");
const {
  disguiseNameFrom,
  disguiseJobFrom,
  jobsBySlug,
  readDisguises,
  disguiseRead,
  fooledFace,
  DISGUISE_STRANGER_FACE,
} = require("./disguises");

// Columns and tags presentedIdentity reads — whosHere's PRESENT_SELECT minus
// the role title, since a members strip prints no Role.
const MEMBER_SELECT = {
  id: true,
  name: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  // A stranger keeps their estate colour (docs/systemdocs/STRANGERS.md), and the
  // label and nonce come from whosHere's roll (db/lib/strangers.js).
  role: { select: { groupSlug: true } },
  presenceLabel: true,
  presenceNonce: true,
  tags: {
    // Plus the tags that put a word in a stranger's alias ("Young Skinless Man").
    where: {
      OR: [
        { tag: { forcedName: { not: null } } },
        { equipped: true, tag: { concealsIdentity: true } },
        { tag: { slug: { in: LOOK_SLUGS } } },
      ],
    },
    select: { equipped: true, tag: { select: { forcedName: true, slug: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// `characterIds` in join order, preserved rather than re-sorted. `sightings`
// is the Map db/lib/sightings.js#lastSightings returns, supplied by the
// caller to avoid a second identical query; omit it and every hood reads as
// unseen. The sighting rule is whosHere's, unchanged: it gates the FACE — a
// mask is drawn only for somebody who watched them speak in it this turn
// (PROXYING.md §5a). `gm` is the host's view: every row comes back under its
// real name with `presentedAs` saying what the room actually sees, same
// answer as db/lib/whosHere.js#whosHereGm.
//
// A member the viewer has no Friends entry for is hidden the same way a hood
// is, under an alias, but keeps their face (served by token) and estate
// colour (docs/systemdocs/STRANGERS.md). `known` is a caller's own
// knownSubjects Set; omit it and it is looked up.
async function presentedMembers(prisma, characterIds, viewer, { sightings = null, gm = false, known = undefined } = {}) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  const people = await prisma.character.findMany({
    where: { id: { in: ids }, status: "ALIVE" },
    select: MEMBER_SELECT,
  });
  const byId = new Map(people.map((person) => [person.id, person]));

  const seenBy = sightings ?? new Map();
  const knows = gm ? null : known !== undefined ? known : await knownSubjects(prisma, viewer?.id ?? null, ids);

  // Dead members drop out — a conversation is a corner of a room, not a roster.
  const members = ids.map((id) => byId.get(id)).filter(Boolean);
  // A disguise is named only to a viewer who knows the name (STRANGERS.md §10),
  // and always goes under a token, as it does in Who's here.
  const disguiseOf = (person) =>
    knows !== null && person.id !== viewer?.id ? disguiseNameFrom(person.tags) : null;
  const worn = members.map(disguiseOf).filter(Boolean);
  const reads = worn.length > 0 ? await readDisguises(prisma, viewer?.id ?? null, worn) : null;
  // The jobs those disguises claim, for the colour they are seen in.
  const jobs = await jobsBySlug(prisma, members.filter(disguiseOf).map((person) => disguiseJobFrom(person.tags)));
  const isHooded = (person) =>
    !forcedNameFrom(person.tags) && Boolean(concealmentFrom(person.tags) && (concealmentFrom(person.tags).forced || person.concealed));
  const isStranger = (person) =>
    knows !== null && person.id !== viewer?.id && !forcedNameFrom(person.tags) && !isHooded(person) && !knows.has(person.id);
  // Labels for the lookalikes in THIS strip, the way Who's here labels its own list.
  const hiddenMembers = members.filter((person) => isHooded(person) || isStranger(person) || disguiseOf(person));
  const aliasOf = (person) => {
    const wearing = disguiseOf(person);
    if (wearing) return disguiseRead(reads, wearing).known ? wearing : aliasRow(person, null);
    const sighting = person.id === viewer?.id ? null : (seenBy.get(person.id) ?? null);
    return aliasRow(person, isHooded(person) && sighting?.concealed ? sighting.name : null);
  };
  const labelled = labelAliases(hiddenMembers, aliasOf, (person) => person.presenceLabel);
  const shownAlias = new Map(hiddenMembers.map((person, i) => [person.id, labelled[i]]));

  return members
    .map((person) => {
      const piece = concealmentFrom(person.tags);
      const forced = forcedNameFrom(person.tags);
      const self = person.id === viewer?.id;
      const sighting = self ? null : (seenBy.get(person.id) ?? null);
      const seen = self || Boolean(sighting);
      // Forced name is not hiding (PROXYING.md §5): named openly, only the portrait swaps for the letter plaque.
      const hidden = isHooded(person);
      const stranger = !gm && isStranger(person);

      if (gm) {
        return {
          characterId: person.id,
          token: null,
          name: person.name,
          avatarPath: null,
          avatarVersion: person.updatedAt?.getTime?.() ?? null,
          unknownFace: false,
          concealed: false,
          // What the room sees.
          presentedAs: forced ?? (hidden ? aliasRow(person, null) : null),
        };
      }

      const token = hoodToken(person.id, person.presenceNonce);
      const wearing = disguiseOf(person);
      if (wearing) {
        const read = disguiseRead(reads, wearing);
        // Whose face the viewer takes it for (when the wearer looks like them), the plaque of a name
        // they can read, or a stranger's blank one.
        const face = fooledFace(read, person)
          ? token
            ? `/api/avatar/here/${token}`
            : null
          : read.known
            ? presentedIdentity(person, { forcedName: wearing }).avatarPath
            : DISGUISE_STRANGER_FACE;
        const job = jobs.get(disguiseJobFrom(person.tags)) ?? null;
        return {
          characterId: null,
          token,
          name: shownAlias.get(person.id),
          avatarPath: face,
          avatarVersion: null,
          unknownFace: !face,
          concealed: true,
          stranger: !read.known,
          // The claimed job's estate, the same for everybody (STRANGERS.md §10).
          roleGroup: roleGroupHue(job?.groupSlug),
        };
      }
      if (stranger) {
        // Their own face, fetched by token so no id reaches the browser.
        return {
          characterId: null,
          token,
          name: shownAlias.get(person.id),
          avatarPath: token ? `/api/avatar/here/${token}` : null,
          avatarVersion: null,
          unknownFace: !token,
          concealed: true,
          stranger: true,
          roleGroup: roleGroupHue(person.role?.groupSlug),
        };
      }

      if (!hidden) {
        const shown = presentedIdentity(person, { forcedName: forced });
        return {
          characterId: person.id,
          token: null,
          name: forced ?? person.name,
          // null means "own face, ask /api/avatar".
          avatarPath: forced ? shown.avatarPath : null,
          avatarVersion: person.updatedAt?.getTime?.() ?? null,
          unknownFace: false,
          concealed: false,
        };
      }

      // The id never leaves the server for a hood: `/api/avatar/<id>` takes an id and returns a face.
      const face = self
        ? presentedIdentity(person, { concealment: piece }).avatarPath
        : (sighting?.avatarPath ?? null);
      return {
        characterId: null,
        token,
        name: shownAlias.get(person.id) ?? aliasRow(person, sighting?.name),
        avatarPath: seen ? face : null,
        avatarVersion: null,
        unknownFace: !seen || Boolean(sighting?.unknownFace),
        concealed: true,
      };
    });
}

// One name, for a sentence (`/add`/`/remove`'s "X was added"). Falls back to
// a bare description rather than throwing: a refusal nobody can read is worse than a vague one.
async function presentedNameOf(prisma, characterId, viewer, options) {
  const [row] = await presentedMembers(prisma, [characterId], viewer, options);
  return row?.name ?? "somebody";
}

// The other half of the hood handle: which of THESE characters a token names.
// Resolves only inside the list it was minted from, so a token can name
// somebody in a room you're in and nobody anywhere else. Same shape as
// whosHere.js#resolveHoodToken, scoped to a place's roster. The token carries
// the member's presence nonce, so it is read here too (db/lib/hoodToken.js).
async function resolveMemberToken(prisma, characterIds, token) {
  if (!token || !Array.isArray(characterIds) || characterIds.length === 0) return null;
  const rows = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { id: true, presenceNonce: true },
  });
  for (const row of rows) {
    // hoodToken answers null with no AUTH_SECRET; `null===null` would else match the first id, defeating the whole mechanism.
    const minted = hoodToken(row.id, row.presenceNonce);
    if (minted && minted === token) return row.id;
  }
  return null;
}

module.exports = {
  presentedMembers,
  presentedNameOf,
  resolveMemberToken,
};
