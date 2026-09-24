// A gate is only a gate if it is the only way across.
//
// A modular gate (MAP.md §2a) shuts one edge. But a hop INSIDE a zone costs
// nothing, so if a second plain edge joins the same two zones, dropping the
// portcullis shuts nobody out: they walk to the other Location and cross
// there. That is exactly what the Fortress had — the Gatehouse opened onto the
// Residences (the gate), the Sanctuary AND the Graveyard, so the winch was
// scenery.
//
// Pure, no Prisma: the doctor runs it over LocationLink rows and the test suite
// over docs/zones.yaml, and the two must agree on what a bypass is.
//
// A way round that is LOCKED or HIDDEN is not a bypass — a key past the gate
// is authored on purpose (the Baron's lift, the Undercroft's pipes). A second
// MODULAR edge is not one either: that is two winches, each of which shuts its
// own way. Only a plain, tagless, unwinched edge between the same two zones
// counts.

/**
 * @param {Array<{ a: { zone: string, name: string }, b: { zone: string, name: string },
 *                 modular: boolean, requiredTagSlug: string|null }>} links
 *   every edge, in any order; a/b are its two ends. `zone` is whatever names a
 *   zone consistently (a slug, an id) and `name` is only for the report.
 * @returns {Array<{ gate: string, bypasses: string[] }>} one entry per
 *   zone-boundary gate that has at least one plain way round it. Labels are
 *   "A <-> B" from the ends' names.
 */
function findGateBypasses(links) {
  const label = (link) => `${link.a.name} <-> ${link.b.name}`;
  const boundary = (link) => (link.a.zone === link.b.zone ? null : [link.a.zone, link.b.zone].sort().join("|"));

  const plainByBoundary = new Map();
  for (const link of links) {
    const key = boundary(link);
    if (!key || link.modular || link.requiredTagSlug) continue;
    if (!plainByBoundary.has(key)) plainByBoundary.set(key, []);
    plainByBoundary.get(key).push(label(link));
  }

  const out = [];
  for (const link of links) {
    const key = boundary(link);
    if (!key || !link.modular) continue;
    const bypasses = plainByBoundary.get(key) ?? [];
    if (bypasses.length > 0) out.push({ gate: label(link), bypasses });
  }
  return out;
}

module.exports = { findGateBypasses };
