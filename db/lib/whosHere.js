// Who is standing at a Location, as both faces say it.
//
// The rule used to live only in bot/src/events/interactionCreate.js's
// "Who's here?" handler, so the Hall's people column could only ever have
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

// `viewer` needs { id?, factionId, locationId } — an id is only used to keep
// the looker out of their own list, which the Discord readout never did and
// the web column wants (you are not one of the strangers in the room).
//
// Returns { named: [{ characterId, name, roleTitle, avatarVersion }],
// concealed: [{ alias }] }. `roleTitle` is null unless the viewer has earned
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
    .map((c) => ({ alias: withArticle(concealedAlias(c).toLowerCase()) }));

  return { named, concealed };
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

module.exports = { PRESENT_SELECT, whosHere, whosHereLines };
