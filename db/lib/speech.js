// What part of a chat line was SAID out loud: the words inside quotation marks
// (docs/systemdocs/STRANGERS.md §4). Everything else in a line is narration,
// an emote like *nods at the door*, and nobody hears a voice in that.
//
// Pure, no requires. It is the server's copy of the rule the browser tints
// speech with (web/app/components/remarkChat.js, SPEECH), so what a reader
// sees coloured as speech is what the game counts as speech:
//
//   - any double quote mark opens and any closes: " “ ” „ ‟. Which way round
//     a curly mark faces is the keyboard's guess, not the writer's, and a
//     phone types “ after a dash, so "Wait-“ has to close on it;
//   - the opening mark must be followed by a real character, since a lone "
//     mid-sentence is punctuation;
//   - no line break inside, so one unmatched quote cannot swallow the rest of
//     a message. There is no length cap: a speech is as long as it is;
//   - two marks with nothing between them are not a quote.
//
// Nothing else between the marks matters: every other character, a dash, an
// emoji, a token or a run of `code`, is part of the speech.

const MARKS = /["“”„‟]/g;
const FORBIDDEN = /\n/;

// Backtick runs are literal, so a mark inside one neither opens nor closes.
// Each is filled with a stand-in of the same length, so indexes still line up
// and the run still counts as words when it sits inside a quote.
function withoutCode(text) {
  return text.replace(/`[^`\n]*`/g, (run) => "x".repeat(run.length));
}

// The quoted spans of `text`, marks stripped, in order.
function spokenSpans(text) {
  if (typeof text !== "string" || !text) return [];
  const source = withoutCode(text);
  const spans = [];
  let from = 0;
  while (from < source.length) {
    MARKS.lastIndex = from;
    const open = MARKS.exec(source);
    if (!open) break;
    const start = open.index + 1;
    // Must open onto a real character.
    if (start >= source.length || /\s/.test(source[start])) {
      from = start;
      continue;
    }
    MARKS.lastIndex = start;
    const close = MARKS.exec(source);
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
