// Who is standing at a Location, as both faces say it.
//
// The rule used to live only in bot/src/events/interactionCreate.js's
// "Who's here?" handler, so Chat's people column could only ever have
// been a second opinion about who you can see. It is one function now, and
// the button calls it.
//
// Named characters first, with their Role for a fellow member of a REAL
// faction — the same rule the 🔍 inspect gate uses, because a Role is
// same-faction knowledge and not Silo authority (FACTIONS.md §4a). Concealed
// characters come back separately and only as what a stranger could tell at a
// glance. A forced name (Tag.forcedName) outranks both: it lands in `named`
// with NO role — a Role is as identifying as a name — and never in the
// concealed list, even if Character.concealed is still on underneath.
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } = require("./presentedIdentity");
const { concealedAlias, withArticle } = require("./concealedIdentity");
const { isUnaffiliated } = require("./factionConstants");
const { lastSightings } = require("./sightings");
// The hood handle moved to its own leaf so presentedMembers.js can mint one
// without dragging this file's sightings -> feedAccess -> conversations chain
// round in a circle. Re-exported below, because every caller found it here.
const { hoodToken } = require("./hoodToken");

const PRESENT_SELECT = {
  id: true,
  name: true,
  roleTitle: true,
  factionId: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  faction: { select: { name: true, slug: true } },
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// Everyone standing here, each already decided to be hidden or not. Both
// readouts below are shaped from this and neither re-decides it: hoodsHere()
// has to land on exactly the people whosHere() puts in `concealed`, or the
// same person is a stranger in one list and a name in the other, in the same
// viewport.
//
// `sightings` is a caller's own lastSightings Map, for one that has already
// paid for it — db/lib/presentedMembers.js takes it the same way. Without one,
// `withSightings` decides whether to go and ask.
async function presentRows(
  prisma,
  viewer,
  { locationId, includeSelf = true, withSightings = false, sightings = null } = {},
) {
  const where = locationId ?? viewer?.locationId ?? null;
  if (!where) return null;

  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: where },
    select: PRESENT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });

  // Sightings first, because they decide which list somebody lands in. A
  // caller holding one already passes it rather than paying for a second
  // identical answer — the same posture db/lib/presentedMembers.js takes.
  const seenBy = sightings ?? (withSightings ? await lastSightings(prisma, viewer) : new Map());

  // Concealed the same way the proxy decides it, not straight off the column:
  // a row still flagged concealed after the mask came off is speaking under
  // its own name, and listing it here as a stranger would be a lie the room
  // can check.
  return present
    .filter((c) => includeSelf || c.id !== viewer?.id)
    .map((c) => {
      const piece = concealmentFrom(c.tags);
      const forced = forcedNameFrom(c.tags);
      const live = Boolean(piece && (piece.forced || c.concealed));
      const self = c.id === viewer?.id;
      // You have always seen yourself. Nobody should have to speak to learn
      // what they look like.
      const sighting = self ? null : (seenBy.get(c.id) ?? null);
      const seen = self || Boolean(sighting);
      // A forced name is not hiding (PROXYING.md §5), so it never moves lists —
      // and it is the one identity a sighting cannot speak for, since say.js
      // writes a Beast's own name into concealedAlias beside a hood's.
      const hidden = forced ? false : sighting ? sighting.concealed : live;
      return { ...c, forced, hidden, seen, sighting, self, livePiece: piece };
    });
}

// The alias a hood is listed under: what you last heard them called if you
// heard them at all, lower-cased into a description rather than a name.
function aliasOf(row) {
  return withArticle((row.sighting?.name ?? concealedAlias(row)).toLowerCase());
}

// `viewer` needs { id?, factionId, locationId } — an id is only used to keep
// the looker out of their own list, which the Discord readout never did and
// the web column wants (you are not one of the strangers in the room).
//
// Returns { named: [{ characterId, name, roleTitle, avatarVersion, seen, ... }],
// concealed: [{ alias, token, seen, ... }] }. `roleTitle` is null unless the
// viewer has earned it; `characterId` is null on nobody in `named`, because a
// name in this list is a person a dialog can act on.
//
// `withSightings` is what gates the FACE and the eye (db/lib/sightings.js).
// Off, every row reads as unseen and this behaves as it always did — which is
// what Discord's Who's here? button wants, since it prints text with no faces
// in it and would pay for two queries it throws away. The web column turns it
// on.
//
// With it on, a sighting REPLACES the live identity rather than decorating it.
// That is what puts somebody who chatted bare-faced and then masked up in
// private into `named` under their real name: which list a person lands in is
// decided by the identity you actually hold, not by what is over their face at
// this instant. A hood put on after you heard them speak does not protect them
// from you until the turn rolls.
async function whosHere(prisma, viewer, options = {}) {
  const rows = await presentRows(prisma, viewer, options);
  if (!rows) return { named: [], concealed: [] };

  const named = rows
    .filter((c) => !c.hidden || c.forced)
    .map((c) => {
      const sameFaction =
        viewer?.factionId && c.factionId === viewer.factionId && !isUnaffiliated(c.faction) && c.roleTitle;
      return {
        characterId: c.id,
        // The name you HOLD: what you last heard them called, or what they are
        // called now if you have not heard them at all.
        name: c.forced ?? c.sighting?.name ?? c.name,
        // No title under a forced name, for the reason at the top.
        roleTitle: c.forced ? null : sameFaction ? c.roleTitle : null,
        avatarVersion: c.updatedAt?.getTime?.() ?? null,
        // A forced name wears its letter plaque, never the face behind it —
        // a Beast listed beside their own portrait would give the whole thing
        // away. Null for everyone else, who look like themselves: the client
        // asks /api/avatar for a face it is allowed to see.
        avatarPath: c.forced ? presentedIdentity(c, { forcedName: c.forced }).avatarPath : (c.sighting?.avatarPath ?? null),
        unknownFace: false,
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
        self: c.self,
      };
    });

  const concealed = rows
    .filter((c) => c.hidden && !c.forced)
    .map((c) => {
      // What is over the face, so the room sees the helm rather than a letter
      // box. Identical for every wearer of the item, which is the point —
      // the sprite says WHAT, never who (PROXYING.md §5).
      //
      // But only once you have watched them speak in it. Standing in a room is
      // public; the mask is not, and drawing it for anybody who walks in
      // announced a cult meeting to the first person through the door. Unseen,
      // the row keeps its live alias and wears the question-mark plate.
      const face = c.self
        ? presentedIdentity(c, { concealment: c.livePiece }).avatarPath
        : (c.sighting?.avatarPath ?? null);
      return {
        // The column's own styling either way. ArchiveEntry.concealedAlias is
        // frozen Title Case ("Young Person"), because it is a NAME on a line;
        // a row in a list of who is standing here is a description, and reads
        // "a young person". Taking the frozen string raw made the same hood
        // change wording the moment you heard it speak.
        alias: aliasOf(c),
        token: hoodToken(c.id),
        avatarPath: c.seen ? face : null,
        unknownFace: !c.seen || Boolean(c.sighting?.unknownFace),
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
      };
    });

  return { named, concealed };
}

// SERVER-ONLY. The same people whosHere() puts in `concealed`, but WITH their
// character ids beside the handle.
//
// It exists because two callers have to filter hoods by id before they can
// offer them: db/lib/../web/app/(app)/chat/actions.js#placeMembers drops
// anybody already in the conversation or holding a key to the room, and
// web/lib/peoplePools.js builds Transfer's recipient list. Neither can do that
// against `concealed`, which withholds the id on purpose — and both were
// otherwise going to re-ask the presence question a second way.
//
// NEVER hand a row of this to a browser. `/api/avatar/<id>` takes an id and
// answers with a face, so shipping one IS the unmasking; `token` is the half
// that crosses the wire, and resolveHoodToken() below is how it comes back.
async function hoodsHere(prisma, viewer, options = {}) {
  const rows = await presentRows(prisma, viewer, options);
  if (!rows) return [];
  return rows
    .filter((c) => c.hidden && !c.forced)
    .map((c) => ({ id: c.id, alias: aliasOf(c), token: hoodToken(c.id) }));
}

// The other half of the token: which concealed character standing at the
// VIEWER's own Location it names, or null. Recomputed over the people who are
// actually there right now, so a token minted in a room somebody has since
// left resolves to nothing — the co-presence rule is the gate, exactly as it
// is for looking at anyone else.
async function resolveHoodToken(prisma, viewer, token) {
  if (!token || !viewer?.locationId) return null;
  // No key, no answer — the same reason hoodToken() above mints none.
  if (!process.env.AUTH_SECRET) return null;
  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: viewer.locationId },
    select: { id: true, concealed: true, tags: PRESENT_SELECT.tags },
  });
  for (const c of present) {
    const piece = concealmentFrom(c.tags);
    if (!piece || !(piece.forced || c.concealed)) continue;
    if (forcedNameFrom(c.tags)) continue;
    if (hoodToken(c.id) === token) return c.id;
  }
  return null;
}

// The one-or-two-line readout the Discord button answers with, built off the
// same rows so the channel and the page can never disagree.
function whosHereLines({ named, concealed }) {
  const lines = [];
  if (named.length > 0) {
    lines.push(`**Here:** ${named.map((c) => (c.roleTitle ? `${c.name}, ${c.roleTitle}` : c.name)).join(" | ")}`);
  }
  if (concealed.length > 0) lines.push(`**Also here:** ${concealed.map((c) => c.alias).join(" | ")}`);
  return lines;
}

module.exports = { PRESENT_SELECT, whosHere, hoodsHere, whosHereLines, resolveHoodToken, hoodToken };
