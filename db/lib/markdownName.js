// A name dropped into text that is read as Markdown: a notice, a scene line,
// a DM, a Discord post. A Lavish meal is named "*Caviar*" (db/lib/meals.js),
// and those asterisks are part of the name — unescaped, Markdown eats them as
// emphasis and the reader sees an italic "Caviar" with no marks at all.
// Same set as web/app/components/tokenEscape.js, backslash first so escaping
// twice is harmless. Plain text and JSX (TagName.js, a chip, a UserError) take
// the raw name; this is only for text a Markdown renderer will read.
//
// Zero requires, ever: the browser imports this too.

const ACTIVE = /[\\*_`~[\]<|]/g;

function markdownName(name) {
  if (name == null) return "";
  return String(name).replace(/\\(.)/g, "$1").replace(ACTIVE, "\\$&");
}

module.exports = { markdownName };
