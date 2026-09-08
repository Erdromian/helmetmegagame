// Shared template -> db/lib/desireGates.js projection. A DesireTemplate row
// stores requiresAnyRoleSlugs/requiresNotRoleSlugs as slug arrays (Role rows
// get pruned by db:sync-roles, so an FK would block that); the evaluator
// wants `{ slug, name }` objects so a locked reason can name the role.
//
// Every caller MUST go through this, not re-derive it inline: an unresolved
// slug is kept as `{ slug, name: slug }` rather than filtered out, because
// db/lib/desireGates.js treats an empty anyRoles/notRoles list as NO
// constraint — dropping the slug would silently open a role-gated Desire.
//
// Pure, takes no prisma handle: every caller hoists a single
// `role.findMany({ select: { slug: true, name: true } })` and passes the
// resulting slug -> role Map in, to avoid an N+1 per template.
export function projectDesireTemplateForGates(roleBySlug, template) {
  const resolveRole = (slug) => roleBySlug.get(slug) ?? { slug, name: slug };

  return {
    ...template,
    requiresAnyRoles: (template.requiresAnyRoleSlugs ?? []).map(resolveRole),
    requiresNotRoles: (template.requiresNotRoleSlugs ?? []).map(resolveRole),
  };
}

// Builds the roleBySlug Map a caller passes to projectDesireTemplateForGates
// above, for one or more templates at once. Pass every template that will be
// projected in this request so the single query covers all of them.
export async function loadRoleBySlugForTemplates(prisma, templates) {
  const slugs = new Set();
  for (const t of templates) {
    for (const s of t.requiresAnyRoleSlugs ?? []) slugs.add(s);
    for (const s of t.requiresNotRoleSlugs ?? []) slugs.add(s);
  }
  const roleRows = slugs.size
    ? await prisma.role.findMany({ where: { slug: { in: [...slugs] } }, select: { slug: true, name: true } })
    : [];
  return new Map(roleRows.map((r) => [r.slug, r]));
}

// Tag ids a desire may be gated on WITHOUT the gate being named back to the
// player. db/lib/desireGates.js states the rule: a locked reason must never
// name a hidden tag. Two sources, and the second is why this is not just the
// group query it used to be:
//
//   1. A group's key tag (Demoness, Cerberon — TagGroup.requiredTagId). The
//      whole category is meant to be invisible to outsiders.
//   2. Any SECRET tag. The Thanati Belief is the case that found this: it sits
//      in `general-beliefs` beside the public faiths, which carries no
//      requiredTag, so eleven cult Desires rendered to every player in the
//      game as "Locked by Thanati" — the exact leak the rule forbids.
//
// Moving the Belief into a gated group of its own was the obvious fix and the
// wrong one: db/lib/seatConflicts.js scopes exclusivity BY GROUP, so a Thanati
// out of `general-beliefs` could hold a second faith and the Rite of
// Conversion would stop stripping a convert's old one.
//
// Shared by every caller that evaluates the Desire catalog for a specific
// character; getting this wrong leaks a hidden roster straight into the
// catalog payload. devPanelData.js deliberately does NOT call this — it passes
// an empty Set instead, because that page is superadmin-only and nothing
// should be withheld from a GM's own view.
export async function computeHiddenDesireTagIds(prisma, heldTagIds) {
  const [gates, secrets] = await Promise.all([
    prisma.tagGroup.findMany({
      where: { requiredTagId: { not: null } },
      select: { requiredTagId: true },
    }),
    prisma.tag.findMany({
      where: { catalogVisibility: "SECRET" },
      select: { id: true },
    }),
  ]);
  const ids = [...gates.map((g) => g.requiredTagId), ...secrets.map((t) => t.id)];
  return new Set(ids.filter((id) => id && !heldTagIds.has(id)));
}
