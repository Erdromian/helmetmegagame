// What part of a chat line was SAID out loud: the words inside quotation marks
// (docs/systemdocs/STRANGERS.md §4). Everything else in a line is narration,
// an emote like *nods at the door*, and nobody hears a voice in that.
//
// Pure, no requires. It is the server's copy of the rule the browser tints
// speech with (web/app/components/remarkChat.js, SPEECH), so what a reader
// sees coloured as speech is what the game counts as speech:
//
//   - straight or curly marks, opening on " or “ and closing on " or ”;
//   - the opening mark must be followed by a real character, since a lone "
//     mid-sentence is punctuation;
//   - no line break inside, so one unmatched quote cannot swallow the rest of
//     a message. There is no length cap: a speech is as long as it is;
//   - two marks with nothing between them are not a quote.
//
// Inline `code` is literal text, the same as in the browser.

const OPEN = /["“]/g;
const CLOSE = /["”]/g;
const FORBIDDEN = /["“”\n]/;

// Backtick runs blanked to spaces of the same length, so indexes still line up.
function withoutCode(text) {
  return text.replace(/`[^`\n]*`/g, (run) => " ".repeat(run.length));
}

// The quoted spans of `text`, marks stripped, in order.
function spokenSpans(text) {
  if (typeof text !== "string" || !text) return [];
  const source = withoutCode(text);
  const spans = [];
  let from = 0;
  while (from < source.length) {
    OPEN.lastIndex = from;
    const open = OPEN.exec(source);
    if (!open) break;
    const start = open.index + 1;
    // Must open onto a real character.
    if (start >= source.length || /\s/.test(source[start])) {
      from = start;
      continue;
    }
    CLOSE.lastIndex = start;
    const close = CLOSE.exec(source);
    const inner = close ? source.slice(start, close.index) : "";
    if (!close || FORBIDDEN.test(inner) || inner.length < 1) {
      // An opener with no partner is just a character; carry on looking.
      from = start;
      continue;
    }
    spans.push(text.slice(start, close.index));
    from = close.index + 1;
  }
  return spans;
}

// The spoken words alone, one span per line so a sentence never runs from one
// quote into the next. Empty when nothing was said.
function spokenText(text) {
  return spokenSpans(text).join("\n");
}

function hasSpeech(text) {
  return spokenSpans(text).some((span) => span.trim().length > 0);
}

module.exports = { spokenSpans, spokenText, hasSpeech };
