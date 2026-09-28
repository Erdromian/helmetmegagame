// A place line that names people, rendered for one reader (docs/systemdocs/ATTACK.md §1). A fight's
// announcement names the fighters, and every reader must read them the way THEY know them — a hood by its
// alias, a stranger's face by what it looks like, a friend by name — the intercept.js#seenBy rule, applied
// to a line the whole place sees.
//
// `subjects` is { text, people }: `text` a template with {0}, {1}…, each person { id, name, alias, masked }.
// `name` is what somebody who knows them reads (their presented name: a hood's alias, a forced name, or
// their own); `alias` is what a stranger's face looks like ("a young man"); `masked` is a hood or a forced
// name, which everybody reads the same way. IMPORT-FREE and pure, so the feed lens (db/lib/strangers.js),
// the Discord relay (db/lib/combatAnnounce.js) and the tests all render with the one function.

// `viewerId` is the reader; `knows(id)` whether they have a Friends entry for somebody; `everyone` reads
// every face by name (a GM, or a reader with no character — the lens's own rule for those).
//
// A person marked `disguise` goes by a Disguise Kit's name (docs/systemdocs/STRANGERS.md §10), which a
// reader knows or not by the NAME, never by who wears it: `knowsName(name)` answers that, and a reader
// with none reads the alias.
function renderPeopleLine(subjects, { viewerId = null, knows = () => false, knowsName = () => false, everyone = false } = {}) {
  const people = Array.isArray(subjects?.people) ? subjects.people : [];
  const text = String(subjects?.text ?? "").replace(/\{(\d+)\}/g, (_match, index) => {
    const person = people[Number(index)];
    if (!person) return "somebody";
    if (person.disguise) {
      const reads = everyone || (viewerId && person.id === viewerId) || knowsName(person.name);
      return reads ? person.name : (person.alias ?? person.name);
    }
    if (everyone || person.masked || (viewerId && person.id === viewerId) || knows(person.id)) return person.name;
    return person.alias ?? person.name;
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "{1}", "{1} and {2}", "{1}, {2} and {3}" — a list of template slots starting at `from`.
function slotList(from, count) {
  const slots = Array.from({ length: count }, (_, i) => `{${from + i}}`);
  if (slots.length <= 1) return slots[0] ?? "";
  return `${slots.slice(0, -1).join(", ")} and ${slots[slots.length - 1]}`;
}

// Everybody a line names, for a lens that needs to know who to ask about.
function peopleIds(subjects) {
  return (Array.isArray(subjects?.people) ? subjects.people : []).map((p) => p?.id).filter(Boolean);
}

// The disguise names a line uses, for the same lens.
function disguiseNames(subjects) {
  return (Array.isArray(subjects?.people) ? subjects.people : []).filter((p) => p?.disguise && p.name).map((p) => p.name);
}

module.exports = { renderPeopleLine, slotList, peopleIds, disguiseNames };
