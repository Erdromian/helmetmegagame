// Who is standing at a Location, shared by the "Who's here?" button and
// Chat's people column. Names, plus the ESTATE a name is painted in — a role
// TITLE is still private, and no player ever reads another's off this list (the
// GM readout below is the one place it appears), but which of the six coloured
// groups somebody belongs to is public by design (db/lib/roleGroups.js), and
// the two buckets that are not coloured are exactly the ones holding every seat
// a look may not read. Concealed characters come back separately. A forced
// name (Tag.forcedName) outranks a real one and never joins the concealed list.
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom, presentedIdentity } = require("./presentedIdentity");
const { aliasRow, LOOK_SLUGS } = require("./concealedIdentity");
const { lastSightings } = require("./sightings");
const { UNBURIED_BODY_WHERE } = require("./presence");
const { hoodToken, performerKey } = require("./hoodToken");
const { hasEverPerformed } = require("./performance"); // leaf requires only; no cycle. // its own leaf to avoid a require cycle; re-exported below.
const { roleGroupHue } = require("./roleGroups");
const { knownSubjects, settlePresence, labelAliases } = require("./strangers");
const { disguiseNameFrom, readDisguises, disguiseRead, DISGUISE_STRANGER_FACE } = require("./disguises");
const { WITH_SIDES, opensOntoWhere, otherSides, roomAt, sidePresenceWhere } = require("./roomSides");

const PRESENT_SELECT = {
  id: true,
  name: true,
  // GM-only: whosHereGm() below is the one reader. namedRows() never touches it.
  roleTitle: true,
  // The group, unlike the title, does reach a player — as the colour their name
  // is drawn in. roleGroupHue() decides which groups have one.
  role: { select: { groupSlug: true } },
  concealed: true,
  status: true,
  buriedAt: true,
  // What was over the face at the moment of death (Character.deathMaskTagId).
  // A corpse wears nothing — death unequips — so the living rule below would
  // name every masked body the moment it hit the floor.
  deathMaskTagId: true,
  age: true,
  gender: true,
  updatedAt: true,
  lastSeenAt: true,
  // The label that tells lookalikes apart and the nonce behind the token
  // (docs/systemdocs/STRANGERS.md §3), rolled by settlePresence below.
  presenceLabel: true,
  presenceNonce: true,
  presenceHidden: true,
  tags: {
    // Every concealing piece, equipped or not, rather than only the worn ones:
    // a corpse's remembered mask is by definition no longer in its slot, and
    // concealmentFrom() goes on ignoring the unequipped for everybody alive.
    // Plus the tags that put a word in a stranger's alias ("Young Skinless Man").
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { tag: { concealsIdentity: true } }, { tag: { slug: { in: LOOK_SLUGS } } }],
    },
    select: { tagId: true, equipped: true, tag: { select: { forcedName: true, slug: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The "online" badge's window — used the website or sent a Discord message
// in the last hour (Character.lastSeenAt, db/lib/characterActivity.js
// #touchLastSeen). Named rows only: a concealed/hooded person already
// deliberately withholds every identity-linked signal, and this one is no
// exception.
const ONLINE_WINDOW_MS = 60 * 60_000;
function isOnline(lastSeenAt, now = Date.now()) {
  return Boolean(lastSeenAt) && now - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

// What a dead body still has over its face, or null. The remembered tag has to
// be BOTH stamped and still held — a dangling id (the catalog pruned it, or
// somebody walked off with the helmet) reads as a bare face, which is the safe
// direction and the one that makes looting a mask off mean something.
function deathMaskPiece(row) {
  if (!row?.deathMaskTagId || !Array.isArray(row.tags)) return null;
  const held = row.tags.find((ct) => ct.tagId === row.deathMaskTagId);
  const tag = held?.tag;
  if (!tag?.concealsIdentity || !tag?.concealSprite) return null;
  // No `forced`: it means "a sack you cannot take off", and the dead branch
  // below decides hidden on the death mask's presence alone, so nothing would
  // read it. A field nothing reads is a field somebody trusts wrongly later.
  return { sprite: tag.concealSprite, name: tag.name ?? null, tagId: row.deathMaskTagId };
}

// The Disguise Kit name somebody alive is going by, or null (./disguises.js).
// A corpse goes by its own name: death is not a disguise anybody keeps up.
function disguiseOf(c) {
  return c.status === "DEAD" ? null : disguiseNameFrom(c.tags);
}

// Hidden from EVERYONE: a hood, or a masked corpse. Not a forced name, which is
// a name the whole room reads (PROXYING.md §5). This is what a label is rolled
// against, since it is the same for every observer.
function hiddenFromAll(c) {
  if (forcedNameFrom(c.tags)) return false;
  if (c.status === "DEAD") return Boolean(deathMaskPiece(c));
  const piece = concealmentFrom(c.tags);
  return Boolean(piece && (piece.forced || c.concealed));
}

// The one place "is this person hidden from this viewer" is decided; every
// readout and resolveHoodToken read it rather than asking again. `sightings`
// is a caller's own lastSightings Map; without one, `withSightings` decides whether to go and ask.
//
// Hidden has two causes now (docs/systemdocs/STRANGERS.md). One is a hood. The
// other is a face the viewer does not know: nobody in their Friends list. A
// `stranger` row is hidden for the second reason only, so it keeps its face
// and its estate colour. `known` is a caller's own knownSubjects Set.
async function presentRows(
  prisma,
  viewer,
  { locationId, includeSelf = true, includeDead = false, withSightings = false, sightings = null, known = undefined } = {},
) {
  const where = locationId ?? viewer?.locationId ?? null;
  if (!where) return [];

  const present = await prisma.character.findMany({
    // `includeDead` adds the UNBURIED dead, for the verbs that act on a body
    // (Loot, Engrave, Bury, Butcher). A buried one is out of the world and is
    // never here, the same rule hereWhere() keeps.
    where: {
      locationId: where,
      ...(includeDead
        ? { OR: [{ status: "ALIVE" }, UNBURIED_BODY_WHERE] }
        : { status: "ALIVE" }),
    },
    select: PRESENT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });

  const seenBy = sightings ?? (withSightings ? await lastSightings(prisma, viewer) : new Map());
  const knows = known !== undefined ? known : await knownSubjects(prisma, viewer?.id ?? null, present.map((c) => c.id));

  // Everybody's label, before anything reads one. Every row at the Location
  // takes part, so a new roll avoids labels already in use there. Putting on or
  // taking off a disguise rolls one too, so no token links the two faces.
  await settlePresence(prisma, present, (c) => hiddenFromAll(c) || Boolean(disguiseOf(c)));

  // What this viewer makes of every disguise here (docs/systemdocs/STRANGERS.md
  // §10). Only when there is somebody to recognise with: with nobody, a
  // disguise reads as the public forced name it always was.
  const worn = present.filter((c) => c.id !== viewer?.id).map(disguiseOf).filter(Boolean);
  const reads = knows !== null && worn.length > 0 ? await readDisguises(prisma, viewer?.id ?? null, worn) : null;

  // Concealed the same way the proxy decides it, not straight off the column.
  return present
    .filter((c) => includeSelf || c.id !== viewer?.id)
    .map((c) => {
      const dead = c.status === "DEAD";
      // A corpse wears nothing — death unequips — so concealmentFrom() answers
      // null for one however it died. What it wore is remembered instead
      // (Character.deathMaskTagId), and still DERIVED rather than trusted: the
      // mask counts only while the body also still HOLDS it, so looting the
      // helmet off unmasks the corpse with no second write anywhere.
      const deathPiece = dead ? deathMaskPiece(c) : null;
      const piece = deathPiece ?? concealmentFrom(c.tags);
      const forced = forcedNameFrom(c.tags);
      const live = dead ? Boolean(deathPiece) : Boolean(piece && (piece.forced || c.concealed));
      const self = c.id === viewer?.id;
      const sighted = self ? null : (seenBy.get(c.id) ?? null); // you have always seen yourself.
      // A DISGUISE is a face with a name only some viewers can put to it
      // (STRANGERS.md §10). It is always hidden, so it is always offered under a
      // token: the page never holds the wearer's id beside the name. The name
      // shows to a viewer who knows it; to anybody else it is a stranger.
      const wearing = disguiseOf(c);
      if (wearing && !self && knows !== null) {
        const read = disguiseRead(reads, wearing);
        // A sighting counts only for the line it points at, and only when that
        // line was said in this disguise: its frozen name is not one every
        // viewer read.
        const sighting = sighted?.disguised && sighted.name === wearing ? sighted : null;
        return {
          ...c,
          forced: null,
          disguise: { name: wearing, known: read.known, fooledAs: read.fooledAs, fooledGroup: read.fooledGroup },
          hidden: true,
          stranger: !read.known,
          seen: Boolean(sighting),
          sighting,
          self,
          livePiece: piece,
        };
      }
      // A line last heard in a disguise that is gone now says nothing about
      // this face, and its name is not one every viewer read.
      const sighting = sighted?.disguised ? null : sighted;
      const seen = self || Boolean(sighting);
      // A forced name is not hiding (PROXYING.md §5), so it never moves lists.
      const hooded = forced ? false : sighting ? sighting.concealed : live;
      // A face the viewer cannot put a name to. `knows` is null when there is no
      // viewer to recognise with, and then nobody is a stranger.
      const stranger = !hooded && !forced && !self && knows !== null && !knows.has(c.id);
      const hidden = hooded || stranger;
      return { ...c, forced, hidden, stranger, seen, sighting, self, livePiece: piece };
    });
}

// `viewer` needs { id?, locationId } — id keeps the looker out of
// their own list, which the Discord readout never did. `withSightings` gates
// the FACE and the eye (db/lib/sightings.js): on, a sighting REPLACES the live identity rather than decorating it.
async function whosHere(prisma, viewer, { withHoodIds = false, withAcross = false, ...options } = {}) {
  const sightings =
    options.sightings ?? (options.withSightings ? await lastSightings(prisma, viewer) : null);
  const rows = await presentRows(prisma, viewer, { ...options, sightings });

  // Who here has ever played an instrument, for the mute button (SOUND.md, "Performances").
  // Named rows only: a key on a hood would match the same person's key unhooded.
  const performed = await hasEverPerformed(prisma, rows.filter((c) => !c.hidden || c.forced).map((c) => c.id));
  const named = namedRows(rows, viewer, performed);
  const concealed = concealedRows(rows, { withTokens: true });

  // Across a modular gate: listed, but rows nothing can act on — no token on a
  // hood, and never in hoodIds below. Opt-in, so no picker can offer them.
  const result = { named, concealed };
  if (withAcross) {
    const locationId = options.locationId ?? viewer?.locationId ?? null;
    // Through a counter: everybody on the far side of a room this viewer is in (db/lib/roomSides.js).
    // The same rule as the gate — listed and inspectable, never in hoodIds, so no picker can offer them —
    // except Transfer's, which reaches them by an `across:` key (acrossRecipients below).
    result.rooms = (await crossRoomGroups(prisma, viewer, { locationId, sightings: sightings ?? new Map() })).map(
      (group) => ({
        roomId: group.roomId,
        roomName: group.roomName,
        locationId: group.locationId,
        locationName: group.locationName,
        named: namedRows(group.rows, viewer),
        concealed: concealedRows(group.rows, { withTokens: false, lookRefs: true }),
      }),
    );
    result.across = [];
    for (const far of await gateNeighbours(prisma, locationId)) {
      const farRows = await presentRows(prisma, viewer, { locationId: far.id, sightings: sightings ?? new Map() });
      result.across.push({
        locationId: far.id,
        locationName: far.name,
        named: namedRows(farRows, viewer),
        concealed: concealedRows(farRows, { withTokens: false }),
      });
    }
  }

  // SERVER-ONLY, opt-in: token -> character id, for placeMembers() to filter hoods before offering them.
  // Not an id on the concealed rows themselves — shipping one IS the unmasking.
  if (!withHoodIds) return result;
  const hoodIds = new Map();
  for (const c of rows) {
    if (c.hidden && !c.forced) hoodIds.set(hoodToken(c.id, c.presenceNonce), c.id);
  }
  return { ...result, hoodIds };
}

// The rooms that open onto more than one Location which this viewer is IN, and
// for each, the people on every other side who are in it too — standing at that
// side's Location and passing that side's gate (Multi-locational rooms.docx:
// "the Who's Here should display everyone who is present in the cross-locational
// room, from both locations"). Rows are presentRows' own, so hoods, strangers and
// labels are decided exactly as they are for the viewer's own street. Nobody
// from the viewer's own Location is repeated: they are in the main list, with
// their menu. `viewer` without an id (a GM's readout) sees every such room.
async function crossRoomGroups(prisma, viewer, { locationId, sightings = new Map() } = {}) {
  if (!locationId) return [];
  const rooms = await prisma.room.findMany({
    where: { AND: [opensOntoWhere(locationId), { retiredAt: null, sides: { some: {} } }] },
    include: { ...WITH_SIDES, location: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (rooms.length === 0) return [];

  // Lazily: roomAccess reaches Discord helpers this module has no other use for.
  const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
  const keys = viewer?.id ? await roomAccessKeys(prisma, viewer.id) : null;
  const rowsAt = new Map();
  const groups = [];
  for (const room of rooms) {
    const mine = roomAt(room, locationId);
    if (!mine) continue;
    if (keys && accessibleRooms([mine], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) continue;
    for (const farId of otherSides(room, locationId)) {
      const far = roomAt(room, farId);
      if (!far) continue;
      if (!rowsAt.has(farId)) rowsAt.set(farId, await presentRows(prisma, viewer, { locationId: farId, sightings }));
      let rows = rowsAt.get(farId).filter((c) => !c.self);
      if (far.kind === "PRIVATE") {
        const inside = await prisma.character.findMany({ where: sidePresenceWhere(far), select: { id: true } });
        const ids = new Set(inside.map((c) => c.id));
        rows = rows.filter((c) => ids.has(c.id));
      }
      const locationName =
        farId === room.locationId ? room.location?.name : room.sides.find((s) => s.locationId === farId)?.location?.name;
      groups.push({ roomId: room.id, roomName: room.name, locationId: farId, locationName: locationName ?? "", rows });
    }
  }
  return groups;
}

// Which person on the far side of a counter this token names, or null — for
// LOOKING only: the stranger's face (web/app/api/avatar/here) and /look. Never
// for a verb: db/lib/targetKey.js resolves through resolveHoodToken alone, so a
// token minted here reaches nobody an act could land on.
async function resolveCrossRoomRef(prisma, viewer, token, { sightings = null } = {}) {
  if (!token || !viewer?.locationId || !process.env.AUTH_SECRET) return null;
  const seen = sightings ?? (await lastSightings(prisma, viewer));
  for (const group of await crossRoomGroups(prisma, viewer, { locationId: viewer.locationId, sightings: seen })) {
    for (const c of group.rows) {
      if (c.hidden && !c.forced && hoodToken(c.id, c.presenceNonce) === token) {
        return { id: c.id, stranger: c.stranger, disguise: c.disguise ?? null };
      }
    }
  }
  return null;
}

// TRANSFER ACROSS A MULTI-LOCATIONAL ROOM. Every room that opens onto more than
// one Location lets you hand things to a person on its other side — the default,
// with no per-room switch: the Merchant's Counter (Depot Overhaul.docx, "items
// can be transferred to characters on either side") was first, and the Gate,
// the Gatehouse Window and the Meistery Window work the same way. The one verb
// that reaches across; every other verb on a person stays Location-grain
// (MAP.md §2d), and nothing else reads these two.
//
// The key is `across:<ref>`: a named row's character id, or a hooded one's
// token — which is minted exactly as the counter's lookRef is, so the picker
// never learns who is under a hood. `withAcross` rows are listed for anybody
// in the room, so a row here is somebody standing at the far side's Location
// who passes that side's gate.
async function acrossRecipients(prisma, viewer, { sightings = null } = {}) {
  if (!viewer?.locationId) return [];
  const seen = sightings ?? (await lastSightings(prisma, viewer));
  const out = [];
  for (const group of await crossRoomGroups(prisma, viewer, { locationId: viewer.locationId, sightings: seen })) {
    const alive = group.rows.filter((c) => c.status == null || c.status === "ALIVE");
    for (const row of namedRows(alive, viewer)) {
      out.push({ id: row.characterId, name: row.name, kind: "across", note: group.roomName });
    }
    for (const row of concealedRows(alive, { withTokens: false, lookRefs: true })) {
      if (row.lookRef) out.push({ id: row.lookRef, name: row.alias, kind: "across", note: group.roomName });
    }
  }
  return out;
}

// Who `ref` (the part after `across:`) names on the far side of a multi-locational
// room this viewer is in, or null. Resolved against the same rows the picker was built
// from, so a ref for somebody who has since walked off names nobody.
async function resolveAcrossRecipient(prisma, viewer, ref, { sightings = null } = {}) {
  if (!ref || !viewer?.locationId) return null;
  const seen = sightings ?? (await lastSightings(prisma, viewer));
  for (const group of await crossRoomGroups(prisma, viewer, { locationId: viewer.locationId, sightings: seen })) {
    for (const c of group.rows) {
      if (c.status != null && c.status !== "ALIVE") continue;
      const hooded = c.hidden && !c.forced;
      const match = hooded
        ? Boolean(process.env.AUTH_SECRET) && hoodToken(c.id, c.presenceNonce) === ref
        : c.id === ref;
      if (match) return { id: c.id, roomId: group.roomId, roomName: group.roomName };
    }
  }
  return null;
}

// Locations across a modular gate, read straight off the links (avoids a require cycle with locationGraph.js).
async function gateNeighbours(prisma, locationId) {
  if (!locationId) return [];
  const links = await prisma.locationLink.findMany({
    where: { modular: true, OR: [{ aId: locationId }, { bId: locationId }] },
    select: { aId: true, a: { select: { id: true, name: true } }, b: { select: { id: true, name: true } } },
  });
  return links.map((link) => (link.aId === locationId ? link.b : link.a)).filter(Boolean);
}

function namedRows(rows, viewer, performed = null) {
  return rows
    .filter((c) => !c.hidden || c.forced)
    .map((c) => {
      return {
        characterId: c.id,
        name: c.forced ?? c.sighting?.name ?? c.name, // the name you HOLD.
        avatarVersion: c.updatedAt?.getTime?.() ?? null,
        // A forced name wears its letter plaque, never the face behind it.
        avatarPath: c.forced ? presentedIdentity(c, { forcedName: c.forced }).avatarPath : (c.sighting?.avatarPath ?? null),
        unknownFace: false,
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
        self: c.self,
        online: isOnline(c.lastSeenAt),
        // Filtered HERE rather than in the browser, so an Outsider's bucket
        // never leaves the server at all. Null under a forced name: the name on
        // the row is not theirs, and painting it in their own estate would hand
        // back exactly what the Disguise Kit took away — the feed already hoods
        // a forced-name line (db/lib/archive.js#feedRowShape), and the two
        // lists have to agree.
        roleGroup: c.forced ? null : roleGroupHue(c.role?.groupSlug),
        // The mute handle — present only for somebody who has ever played, never for you.
        performerKey: performed?.has(c.id) && !c.self ? performerKey(c.id) : null,
      };
    });
}

// The order a list of hoods is shown in: by the alias the viewer reads, then
// by token. presentRows comes back sorted by REAL name, and hoods kept that
// order everywhere they were listed — so two "young man" rows always came out
// in their real names' alphabetical order, and a hood's place in a list said
// where its real name fell. `nameOf` and `idOf` read whatever shape the caller
// holds; the id never leaves this function.
function hoodOrder(list, nameOf, idOf) {
  return list
    .map((item) => ({ item, name: String(nameOf(item) ?? ""), token: hoodToken(idOf(item)) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
    .map((entry) => entry.item);
}

// The alias a hidden row is listed under. A hood reads the name it was last
// HEARD under, if any. A stranger never does: their sighting holds their real
// name, which is exactly what they are hidden behind.
//
// A disguise is listed under its name to a viewer who knows it, and as a
// stranger to anybody else: never under the sighting, whose name is the disguise's.
function hiddenAlias(c) {
  if (c.disguise) return c.disguise.known ? c.disguise.name : aliasRow(c, null);
  return aliasRow(c, c.sighting?.concealed ? c.sighting.name : null);
}

// The face a disguise shows this viewer: the portrait of the person it fools
// them into seeing, served per viewer by token (web/app/api/avatar/here); the
// letter plaque of a name they learned; the blank plaque to a stranger.
function disguiseFace(c, token) {
  if (c.disguise.fooledAs) return token ? `/api/avatar/here/${token}` : null;
  if (c.disguise.known) return presentedIdentity(c, { forcedName: c.disguise.name }).avatarPath;
  return DISGUISE_STRANGER_FACE;
}

// A hidden row's list name, with its label when another row here looks the
// same (docs/systemdocs/STRANGERS.md §3). Built over one list at a time, so a
// label shows only where it is needed to tell two people apart. Exported
// for the pickers that list the same people (web/lib/peopleHere.js).
function labelledAliases(rows) {
  const names = labelAliases(rows, hiddenAlias, (c) => c.presenceLabel);
  return new Map(rows.map((c, i) => [c.id, names[i]]));
}

// `lookRefs` is a multi-locational room's middle ground (crossRoomGroups): no
// token — so no verb's picker — but a `lookRef` a look may name them by, the
// stranger's face served under it, and the `across:` key Transfer alone takes.
function concealedRows(rows, { withTokens, lookRefs = false }) {
  const hooded = rows.filter((c) => c.hidden && !c.forced);
  const shown = labelledAliases(hooded);
  return hoodOrder(hooded, (c) => shown.get(c.id), (c) => c.id)
    .map((c) => {
      const token = hoodToken(c.id, c.presenceNonce);
      // What is over the face — the sprite says WHAT, never who (PROXYING.md §5) —
      // but only once you have watched them speak in it; unseen wears the question-mark plate.
      // A stranger has no hood, so the room sees their own face. It is served by
      // token (web/app/api/avatar/here), never by id, and only to somebody
      // standing here. Across a gate there is no token, so no face.
      const face = c.disguise
        ? disguiseFace(c, (withTokens || lookRefs) && token ? token : null)
        : c.stranger
          ? ((withTokens || lookRefs) && token ? `/api/avatar/here/${token}` : null)
          : c.self
            ? presentedIdentity(c, { concealment: c.livePiece }).avatarPath
            : (c.sighting?.avatarPath ?? null);
      // A disguise shows its face whether or not you have heard it speak: it is
      // not covered, only unfamiliar.
      const faceShown = c.stranger || c.disguise ? Boolean(face) : c.seen;
      return {
        alias: shown.get(c.id),
        token: withTokens ? token : null,
        ...(lookRefs ? { lookRef: token } : {}),
        avatarPath: faceShown ? face : null,
        unknownFace: c.stranger || c.disguise ? !face : !c.seen || Boolean(c.sighting?.unknownFace),
        seen: c.seen,
        sightingSeq: c.sighting?.seq ?? null,
        // A stranger's estate is as public as anyone's (db/lib/roleGroups.js).
        // A hood hides it. A disguise wears the estate of whoever it fools the
        // viewer into seeing, and none otherwise: it is not the wearer's own.
        roleGroup: c.disguise
          ? roleGroupHue(c.disguise.fooledGroup)
          : c.stranger
            ? roleGroupHue(c.role?.groupSlug)
            : null,
        stranger: Boolean(c.stranger),
        // A disguise this viewer can name reads as a name, not an alias, so a
        // readout lists it among the names (whosHereLines). The row's own name
        // already says as much, so the flag tells the page nothing new.
        named: Boolean(c.disguise?.known),
      };
    });
}

// WHO IS ACTUALLY STANDING THERE, for a GM: no sightings and no hood tokens.
// The role title is here and nowhere else — a GM reads it, a player never does.
// `presentedAs` is the alias the room sees, the one thing the player list can never tell them.
async function whosHereGm(prisma, locationId) {
  if (!locationId) return [];
  const rows = await presentRows(prisma, null, { locationId });
  return rows.map((c) => ({
    characterId: c.id,
    name: c.name,
    roleTitle: c.roleTitle ?? null,
    presentedAs: c.forced ?? (c.hidden ? aliasRow(c, null) : null), // forced name is not a hood (PROXYING.md §5).
    avatarVersion: c.updatedAt?.getTime?.() ?? null,
    online: isOnline(c.lastSeenAt),
  }));
}

// Which concealed character at the VIEWER's Location the token names, or
// null. Reads presentRows() rather than deciding for itself, so it can never disagree with the list that minted it.
async function resolveHoodToken(prisma, viewer, token, { sightings = null, includeDead = false } = {}) {
  if (!token || !viewer?.locationId) return null;
  // No key, no answer — the same reason hoodToken() above mints none.
  if (!process.env.AUTH_SECRET) return null;
  // `includeDead` is the CALLER's business, and it has to be, because it is the
  // verb that knows whether a body is a legal target: Loot allows one, Heal
  // does not. Off by default, so a token minted over a corpse resolves to
  // nobody for every verb that never asked for one.
  const rows = await presentRows(prisma, viewer, { withSightings: true, sightings, includeDead });
  for (const c of rows) {
    if (!c.hidden || c.forced) continue;
    if (hoodToken(c.id, c.presenceNonce) === token) return c.id;
  }
  return null;
}

// The other half of resolveHoodToken: is this character standing at the
// VIEWER's Location in a hood the viewer cannot see past? A plain id must never
// reach somebody the pickers only offer under a token — posting a suspect's id
// by hand and watching the verb land was a test of who is under the mask
// (db/lib/targetKey.js). Same presentRows answer, so the two never disagree.
async function hiddenFrom(prisma, viewer, characterId, { sightings = null, includeDead = false } = {}) {
  if (!characterId || !viewer?.locationId || characterId === viewer.id) return false;
  const rows = await presentRows(prisma, viewer, { withSightings: true, sightings, includeDead });
  const row = rows.find((c) => c.id === characterId);
  return Boolean(row && row.hidden && !row.forced);
}

// The Discord button's readout, built off the same rows so the channel and the page can never disagree.
function whosHereLines({ named, concealed, across = [], rooms = [] }) {
  const lines = [];
  // A disguise the viewer can name is listed with the names, not the aliases:
  // "Also here" beside a face they know would give it away.
  const names = [...named.map((c) => c.name), ...concealed.filter((c) => c.named).map((c) => c.alias)];
  const aliases = concealed.filter((c) => !c.named).map((c) => c.alias);
  if (names.length > 0) lines.push(`**Here:** ${names.join(" | ")}`);
  if (aliases.length > 0) lines.push(`**Also here:** ${aliases.join(" | ")}`);
  for (const group of across) {
    const people = [
      ...group.named.map((c) => c.name),
      ...group.concealed.map((c) => c.alias),
    ];
    if (people.length > 0) lines.push(`**${group.locationName}:** ${people.join(" | ")}`);
  }
  // Over a counter: the far side of a room that opens onto here too.
  for (const group of rooms) {
    const people = [...group.named.map((c) => c.name), ...group.concealed.map((c) => c.alias)];
    if (people.length > 0) lines.push(`**${group.roomName} · ${group.locationName}:** ${people.join(" | ")}`);
  }
  return lines;
}

module.exports = {
  PRESENT_SELECT,
  whosHere,
  whosHereGm,
  whosHereLines,
  resolveHoodToken,
  resolveCrossRoomRef,
  crossRoomGroups,
  acrossRecipients,
  resolveAcrossRecipient,
  hiddenFrom,
  hoodToken,
  presentRows,
  labelledAliases,
  ONLINE_WINDOW_MS,
  isOnline,
};
