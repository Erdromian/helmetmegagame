// Making the inside of a {kind:payload} token inert, before anything parses it.
//
// A token's payload is `[^}]+` — anything at all. So a character called
// `Bob *the Blade* Marley`, or an `{info:costs `5` ⬢}`, carries live Markdown
// into the middle of a token, remark-parse cuts the paragraph there, and
// remarkTokens.js — which needs the whole `{…}` inside one text node — never
// matches it. What the reader gets is a raw `{char:cmtt…` with an italic name
// beside it: a line that looks broken rather than a visibly unresolved one.
//
// Unlike a quote or a spoiler, a token is not something formatting belongs
// INSIDE. Its payload is an id, a name, a price — text to be read literally —
// so the fix is not to teach the pass to span siblings, it is to make sure the
// paragraph is never cut there at all. Every Markdown-active character inside a
// token gets a backslash, remark parses none of them, and remark hands the
// payload back as one text node with the backslashes gone.
//
// Done HERE, at render, rather than by writing the escapes into the row. What
// is STORED has to keep matching the visibility query in web/lib/feedAccess.js
// — a Prisma `contains` on `{char:<id>|` is how a mentioned player earns the
// right to read the row that mentions them (CHAT.md §5) — plus its JS twin,
// db/lib/characterMentions.js#mentionsCharacter. Escaping on the way in would
// have needed both of those, and every row already written, to agree on a new
// shape. This pass needs none of it, and it repairs the rows already in the
// database.
//
// This began life as escapeTokenBars in markdownPlugins.js, escaping the bar
// alone: remark-gfm splits a table ROW on bars at block level, before any of
// this runs, so `{char:cmtt…|Ada}` in a table cell was torn in half and printed
// its cuid at the reader. The bar is still in the set below for that reason;
// the rest are here for the splitting above. It lives in its own file, with no
// imports, so db/test/chatFormatting.test.js can load it with no build step.

const TOKEN = /\{\w+:[^}]*\}/;

// A run of backticks and whatever it closes over — an inline code span, and a
// fenced block too, since both are "a run of N backticks, then the same run
// again". Nothing inside one is escaped: a `{char:…|Ada}` written between
// backticks is somebody showing the syntax, and a backslash in front of the bar
// would be visible in what they are showing. (A four-space indented block is
// not recognised, which is a fair price — nobody writes one in a chat line.)
const CODE = /(`+)[\s\S]*?\1/;

// Every character that can begin a Markdown construct inside a run of text.
// `<` is in the set because `<b>` is raw inline HTML and `[` because `[x](y)`
// is a link; the rest are the emphasis, code and strikethrough marks. The
// backslash is first so escaping is idempotent — a token already escaped ends
// up exactly as it started, which matters because nothing guarantees this runs
// only once.
const ACTIVE = /[\\*_`~[\]<|]/g;

const escapeOne = (token) => token.replace(/\\(.)/g, "$1").replace(ACTIVE, "\\$&");

// Walked once, trying a token at each position BEFORE a code run, because the
// two can overlap and the token has to win: `{info:costs `5` gold}` holds a
// backtick pair of its own, and treating that as a code span would leave the
// token unescaped and cut in half — the exact bug this file exists to stop.
// A code run only gets its exemption when it STARTS outside a token, which is
// what somebody demonstrating the syntax actually types.
export default function escapeTokenSyntax(content) {
  if (typeof content !== "string" || !content.includes("{")) return content;

  const token = new RegExp(TOKEN.source, "y");
  const code = new RegExp(CODE.source, "y");
  let out = "";
  let at = 0;

  while (at < content.length) {
    token.lastIndex = at;
    const found = token.exec(content);
    if (found) {
      out += escapeOne(found[0]);
      at += found[0].length;
      continue;
    }

    code.lastIndex = at;
    const literal = code.exec(content);
    if (literal) {
      out += literal[0];
      at += literal[0].length;
      continue;
    }

    out += content[at];
    at += 1;
  }

  return out;
}
