// The Wanted tag as a thing the law hands out, rather than as a thing you buy
// at character creation. db/lib/wantedPoster.js is the PAPER — the three
// sheets that go up when somebody is born wanted — and it re-exports the two
// helpers below so its own callers did not have to move.
//
// The tag itself is `visible: named` (docs/tags.yaml), which is the whole
// point of it: the Cerberon know your FACE, so a hood or a Disguise Kit's
// false name takes it off a bystander's read. See db/lib/medicalVision.js.
//
// Takes `db` as a parameter where it queries, the db/lib/dm.js convention.

const WANTED_SLUG = "wanted";

// The Cerberon's own tag — a Censor, an Incarn, a Cerberus, a Squire all hold
// it (docs/roles.yaml). It is what opens Check Wanted.
const CERBERON_SLUG = "cerberon";

// Who may declare a warrant. The BADGE, not the role slug: every other button
// on the sheet gates on a tag, and this way the authority travels with the
// thing — including when it is looted off a body, which is a story the game
// should be able to tell.
const WARRANT_BADGE_SLUGS = Object.freeze([
  "censors-key",
  "sheriffs-badge",
  "cerberus-helmet",
]);

// `heldSlugs` is any iterable of slugs.
function isWanted(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(WANTED_SLUG);
}

function isCerberon(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return held.has(CERBERON_SLUG);
}

function canDeclareWarrant(heldSlugs) {
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  return WARRANT_BADGE_SLUGS.some((slug) => held.has(slug));
}

// Every living wanted man, by name. The parallel of listComrades()
// (db/lib/thanati.js) and it answers the same shape, so the notice rows on
// /character render it unchanged.
//
// It does NOT care who is currently hooded. This is the Cerberon reading
// their own warrant book, not an act of looking at somebody: a man does not
// fall off the list by pulling a hood up. That is exactly the distinction
// `visible: named` draws — the face is hidden, the record is not.
async function listWanted(db) {
  const rows = await db.character.findMany({
    where: { status: "ALIVE", tags: { some: { quantity: { gt: 0 }, tag: { slug: WANTED_SLUG } } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      roleTitle: true,
      role: { select: { name: true } },
    },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, role: c.roleTitle ?? c.role?.name ?? "" }));
}

module.exports = {
  WANTED_SLUG,
  CERBERON_SLUG,
  WARRANT_BADGE_SLUGS,
  isWanted,
  isCerberon,
  canDeclareWarrant,
  listWanted,
};
