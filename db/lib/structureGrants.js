// What a structure GIVES the ground it stands on: one Location attribute, named
// by `placement.grants` (the Noticeboard's `noticeboard`, the Field Kitchen's
// `kitchen`). The finished structure sets the very attribute docs/zones.yaml
// authors, so no reader of that attribute has to know a structure exists —
// which is the whole reason this is stored rather than derived: the readers
// are on both faces and most of them hold nothing but a Location row.
//
// Two writers, and they are the only two: a build finishing, and a GM's
// Destroy. Damage does not revoke — a damaged board is still a board.
//
// An AUTHORED structure (docs/zones.yaml `structures:`) is seeded already
// standing by worldSeed.js and never passes through grantOnFinish, so its
// Location authors the attribute as well; db/test/buildings.test.js holds the
// two lists together.
//
// Takes the caller's transaction, so the grant and the structure commit as
// one. Off the barrel, like structures.js.

const { placementOf } = require("./structures");
const { destroyNoticesAt } = require("./noticeboard");

async function grantedKey(tx, typeSlug) {
  const type = await tx.tag.findUnique({ where: { slug: typeSlug ?? "" }, select: { placement: true } });
  return placementOf(type)?.grants ?? null;
}

async function setAttribute(tx, locationId, key, on) {
  const row = await tx.location.findUnique({ where: { id: locationId }, select: { attributes: true } });
  if (!row) return;
  const attributes = { ...(row.attributes ?? {}) };
  if (on) attributes[key] = true;
  else delete attributes[key];
  await tx.location.update({ where: { id: locationId }, data: { attributes } });
}

// A build just finished. Returns the attribute it granted, or null. The caller
// enqueues the Location's mirror job AFTER its commit — that is what redraws
// the Discord anchor, where the Noticeboard button lives.
async function grantOnFinish(tx, site) {
  const key = await grantedKey(tx, site.typeSlug);
  if (!key) return null;
  await setAttribute(tx, site.locationId, key, true);
  return key;
}

// A structure that was standing has just been destroyed. Takes back what it
// granted, and what depended on it: a board takes every notice pinned to it.
// Returns `{ key, noticesDestroyed }`, or null for a type that grants nothing.
async function revokeOnDestroy(tx, site) {
  const key = await grantedKey(tx, site.typeSlug);
  if (!key) return null;
  await setAttribute(tx, site.locationId, key, false);
  const noticesDestroyed = key === "noticeboard" ? await destroyNoticesAt(tx, site.locationId) : undefined;
  return { key, noticesDestroyed };
}

module.exports = { grantOnFinish, revokeOnDestroy };
