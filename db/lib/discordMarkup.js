// Discord's angle-bracket vocabulary, as source strings.
//
// Discord renders `<t:1757700120:F>` as a time, `<@123>` as a name and
// `<:skull:1>` as a picture. Nothing else does. So the moment one of those
// strings is stored rather than merely sent — a DM row, an archive line — it
// has two readers, and the web is the one that sees the raw characters. That
// is not hypothetical: two lobby DMs shipped `<t:…:F>` into DirectMessage
//rows and every player read the literal tag in their thread.
//
// This file is THE single source of truth for what those tokens look like.
// web/app/components/remarkDiscord.js builds its RegExps from here, and
// db/test/discordMarkup.test.js scans the DM producers with the same ones, so
// the renderer and the guard can never disagree about the vocabulary.
//
// No requires in this file, ever — the same rule, and exactly the same reason,
// as dmKinds.js: it is imported by a client component, and one require of
// @lifeweb/db here would drag PrismaClient into the browser bundle and kill
// the route with a node:fs error carrying no digest.

// Copied from characterMentions.js's ROLE_RE rather than tightened to the
// real 17-20 digits. That file is the existing precedent, and a second,
// stricter opinion about snowflake width is a future disagreement for nothing.
const SNOWFLAKE = "\\d{5,32}";

// Every style Discord defines. `R` is the relative one — the only style whose
// text depends on when you look at it, which is why DiscordTime.js treats it
// separately.
const TIMESTAMP_STYLES = ["t", "T", "d", "D", "f", "F", "R"];
// Discord's own default for a bare `<t:E>`.
const DEFAULT_TIMESTAMP_STYLE = "f";

const DISCORD_MARKUP = Object.freeze({
  // <t:1757700120>  <t:1757700120:F>   epoch SECONDS, signed — pre-1970 is legal
  timestamp: { source: `<t:(-?\\d{1,15})(?::([${TIMESTAMP_STYLES.join("")}]))?>`, label: "a timestamp" },
  // <@&123>   a role: a character's name token, or a GM/zone role
  role: { source: `<@&(${SNOWFLAKE})>`, label: "a role mention" },
  // <@123>  <@!123>   a user; the `!` spelling is the legacy nickname form
  user: { source: `<@!?(${SNOWFLAKE})>`, label: "a user mention" },
  // <#123>   a channel or thread
  channel: { source: `<#(${SNOWFLAKE})>`, label: "a channel mention" },
  // <:name:123>  <a:name:123>   a custom emoji; the `a` prefix means animated
  emoji: { source: `<(a?):([A-Za-z0-9_]{2,32}):(${SNOWFLAKE})>`, label: "a custom emoji" },
  // @here  @everyone   a notification directive, not content
  ping: { source: "@(everyone|here)\\b", label: "a broadcast ping" },
});

// `role` is listed before `user` so it wins the overlap scan below. They
// cannot actually collide — `&` is neither `!` nor a digit — but the order
// costs nothing and removes the question.
const DISCORD_MARKUP_KINDS = Object.freeze(Object.keys(DISCORD_MARKUP));

// Angle-bracket text SHAPED like Discord markup. Deliberately loose, and
// deliberately NOT built from the vocabulary above: what the guard test fails
// on is a token this file does not know — a syntax Discord added, or a
// producer inventing one — and a pattern assembled from the known kinds could
// never find one by construction. `<sound:123456789012345678>` has to match
// here even though nothing above describes it.
//
// The shape is "optional short word, then one of Discord's three sigils, then
// no whitespace to the closing bracket". Prose and markup fall outside it:
// `a < b > c` has a space where the sigil must be, `<3` never closes, `<html>`
// and `</p>` carry no sigil. Autolinks are the one real collision, so
// `<https://…>` and `<mailto:…>` are excluded outright; a bare
// `<someone@example.com>` autolink would still trip it, which is a fair price
// for catching a syntax nobody has thought of yet.
//
// The body allows only what a real token contains — word characters, digits,
// colons and the mention sigils. No regex metacharacters. That is deliberate:
// the guard reads SOURCE, and this file and characterMentions.js both spell
// these patterns out as literals like `<@&(\\d{5,32})>`. A parenthesis means
// you are looking at a pattern, not at something a player will ever read.
const UNKNOWN_SHAPE = "<(?!https?://|mailto:)[A-Za-z]{0,10}[:@#][A-Za-z0-9_:.!&-]{1,64}>";

function reFor(kind, flags = "g") {
  const entry = DISCORD_MARKUP[kind];
  if (!entry) throw new Error(`Unknown Discord markup kind: ${kind}`);
  return new RegExp(entry.source, flags);
}

// Every Discord token in `text`, in source order:
//   [{ kind, raw, index, groups: [...] }]
// Each kind is run as its own RegExp and the hits merged by index, so there is
// no alternation and therefore no capture-group offset arithmetic to get
// wrong. Overlaps resolve to the kind declared first.
function findDiscordMarkup(text) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  for (const kind of DISCORD_MARKUP_KINDS) {
    const re = reFor(kind);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (found.some((f) => m.index < f.index + f.raw.length && f.index < m.index + m[0].length)) continue;
      found.push({ kind, raw: m[0], index: m.index, groups: m.slice(1) });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// The Discord-shaped tokens findDiscordMarkup could NOT classify. `[]` is the
// healthy answer, and the guard test asserts exactly that over every file that
// writes a DM.
function findUnknownMarkup(text) {
  if (typeof text !== "string" || !text) return [];
  const known = findDiscordMarkup(text);
  const unknown = [];
  const re = new RegExp(UNKNOWN_SHAPE, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (known.some((k) => k.index === m.index && k.raw === m[0])) continue;
    unknown.push({ raw: m[0], index: m.index });
  }
  return unknown;
}

module.exports = {
  DISCORD_MARKUP,
  DISCORD_MARKUP_KINDS,
  TIMESTAMP_STYLES,
  DEFAULT_TIMESTAMP_STYLE,
  reFor,
  findDiscordMarkup,
  findUnknownMarkup,
};
