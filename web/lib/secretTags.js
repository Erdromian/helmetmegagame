// Which catalog rows a player's browser may be sent, when some of them are SECRET
// (Tag.catalogVisibility — antagonist and cave content). Pure; server-side callers
// only. The browser's own gate (web/lib/characterCreation.js#requirementSatisfied)
// decides what a menu DRAWS, but by then the row, its description and its
// "Requires: Demoness" have already crossed the wire — so the rows are cut here.
//
// A row is withheld when it sits behind a SECRET gate (its own requiredTag or its
// group's) the reader does not hold — the Demoness's abilities and the Vampire's
// boons sit in groups whose requiredTag is the seat tag itself — or when it is
// SECRET itself and no gate the reader holds opens it. A boon is SECRET too, so
// holding its gate is what shows it.

function hiddenFrom(tag, secretIds, shownIds) {
  if (shownIds.has(tag.id)) return false;
  const gates = [tag.requiredTagId, tag.group?.requiredTagId].filter(Boolean);
  if (gates.some((id) => secretIds.has(id) && !shownIds.has(id))) return true;
  return secretIds.has(tag.id) && !gates.some((id) => shownIds.has(id));
}

// `tags` less every row hiddenFrom() withholds. Rows need id, requiredTagId and
// group.requiredTagId. `allowedIds` are rows this reader is entitled to anyway:
// what they hold, and whatever the caller has its own reason to show (a role's
// kit on offer, a recipe they have found, a tag named in a paper they can read).
// A gate the list itself shows counts as open: Love in the Air sits behind
// Seductive, and a Demoness may put both in one cart. So it widens until nothing
// more opens — the chains are two or three links, so a few passes at most.
export function withoutSecrets(tags, secretIds, allowedIds = []) {
  const shown = new Set(allowedIds);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of tags) {
      if (shown.has(t.id) || hiddenFrom(t, secretIds, shown)) continue;
      shown.add(t.id);
      grew = true;
    }
  }
  return tags.filter((t) => shown.has(t.id));
}
