// The warning a party leader reads before a move that would leave somebody
// standing (MAP.md §3a), in one place so /chat, /map and the bot's picker cannot
// word it differently. Zero requires, on purpose: web/lib/travelCost.js imports
// it into a "use client" component, and one require of @lifeweb/db here would
// drag PrismaClient into the browser bundle.
//
// `entries` is [{ name, held }] — the name as the LEADER knows them
// (intercept.js#seenById), never the row's, and `held` for the one reason a
// leader is told out loud: somebody has hold of their friend, which is plain to
// see. Every other reason (the way refuses them, the Caving Die, wandered off)
// is "can't follow you this way" — never WHY, because naming a hidden way's
// refusal would announce that the way is there (MAP.md §2a).

// "A", "A and B", "A, B and C".
function listOf(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function capitalizeFirst(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Null when nobody would be left, so a caller can print it or not with no test of its own.
function leftBehindWarning(entries) {
  const list = (entries ?? []).filter((e) => e?.name);
  if (list.length === 0) return null;
  const stranded = list.filter((e) => !e.held).map((e) => e.name);
  const held = list.filter((e) => e.held).map((e) => e.name);
  const clauses = [];
  if (stranded.length > 0) clauses.push(`${capitalizeFirst(listOf(stranded))} can't follow you this way`);
  if (held.length > 0) clauses.push(`${stranded.length > 0 ? "s" : "S"}omebody has hold of ${listOf(held)}`);
  return `${clauses.join(", and ")}. You would leave them behind.`;
}

module.exports = { leftBehindWarning };
