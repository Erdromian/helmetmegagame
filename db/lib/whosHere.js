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
const crypto = require("node:crypto");
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { concealedAlias, withArticle } = require("./concealedIdentity");
const { isUnaffiliated } = require("./factionConstants");

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

// A hood needs a handle the page can send back without ever having been told
// who is under it. The token is an HMAC of the character id keyed with
// AUTH_SECRET, truncated: stable for as long as the secret is, opaque to the
// browser, and worthless anywhere but resolveHoodToken() below, which only
// ever looks at the people standing where the viewer is standing.
// With no AUTH_SECRET there is no key, and an HMAC under the empty one is
// something anybody holding a character id can compute for themselves — which
// would turn the token from a handle into an unmasking oracle. So there is no
// token at all in that case: the row still draws, and the eye on it gets the
// refusal resolveHoodToken already answers a bad token with.
function hoodToken(characterId) {
  if (!process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`hood:${characterId}`)
    .digest("hex")
    .slice(0, 32);
}

// `viewer` needs { id?, factionId, locationId } — an id is only used to keep
// the looker out of their own list, which the Discord readout never did and
// the web column wants (you are not one of the strangers in the room).
//
// Returns { named: [{ characterId, name, roleTitle, avatarVersion }],
// concealed: [{ alias, token }] }. `roleTitle` is null unless the viewer has earned
// it; `characterId` is null on nobody, because a name in this list is a
// person a dialog can act on.
async function whosHere(prisma, viewer, { locationId, includeSelf = true } = {}) {
  const where = locationId ?? viewer?.locationId ?? null;
  if (!where) return { named: [], concealed: [] };

  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: where },
    select: PRESENT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
  });

  // Concealed the same way the proxy decides it, not straight off the column:
  // a row still flagged concealed after the mask came off is speaking under
  // its own name, and listing it here as a stranger would be a lie the room
  // can check.
  const rows = present
    .filter((c) => includeSelf || c.id !== viewer?.id)
    .map((c) => {
      const piece = concealmentFrom(c.tags);
      return { ...c, forced: forcedNameFrom(c.tags), hidden: Boolean(piece && (piece.forced || c.concealed)) };
    });

  const named = rows
    .filter((c) => !c.hidden || c.forced)
    .map((c) => {
      const sameFaction =
        viewer?.factionId && c.factionId === viewer.factionId && !isUnaffiliated(c.faction) && c.roleTitle;
      return {
        characterId: c.id,
        name: c.forced ?? c.name,
        // No title under a forced name, for the reason at the top.
        roleTitle: c.forced ? null : sameFaction ? c.roleTitle : null,
        avatarVersion: c.updatedAt?.getTime?.() ?? null,
        self: c.id === viewer?.id,
      };
    });

  const concealed = rows
    .filter((c) => c.hidden && !c.forced)
    .map((c) => ({ alias: withArticle(concealedAlias(c).toLowerCase()), token: hoodToken(c.id) }));

  return { named, concealed };
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

module.exports = { PRESENT_SELECT, whosHere, whosHereLines, resolveHoodToken };
