// What part of a chat line was SAID out loud: the words inside quotation marks
// (docs/systemdocs/STRANGERS.md §4). Everything else in a line is narration,
// an emote like *nods at the door*, and nobody hears a voice in that.
//
// Pure, no requires. It is the one rule for speech: the browser tints speech
// by it too (web/app/components/speechRuns.js runs quoteRanges over the
// rendered line), so what a reader sees coloured as speech is what the game
// counts as speech:
//
//   - any double quote mark opens and any closes: " “ ” „ ‟. Which way round
//     a curly mark faces is the keyboard's guess, not the writer's, and a
//     phone types “ after a dash, so "Wait-“ has to close on it;
//   - the opening mark must be followed by a real character, since a lone "
//     mid-sentence is punctuation;
//   - a quote runs over line breaks, blank lines included, so a speech typed
//     as several lines or paragraphs is one speech. There is no length cap
//     either: a speech is as long as it is;
//   - two marks with nothing between them are not a quote.
//
// Nothing else between the marks matters: every other character, a dash, an
// emoji, a token or a run of `code`, is part of the speech.

const MARKS = /["“”„‟]/g;

// Backtick runs are literal, so a mark inside one neither opens nor closes.
// Each is filled with a stand-in of the same length, so indexes still line up
// and the run still counts as words when it sits inside a quote.
function withoutCode(text) {
  return text.replace(/`[^`\n]*`/g, (run) => "x".repeat(run.length));
}

// The pairing itself, on text whose code is already out of the way: every
// quote as `{ start, end }` offsets, marks included, in order. The browser
// calls this on a line it has already parsed, where code is its own node.
function quoteRanges(source) {
  const ranges = [];
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
    if (!close || close.index === start) {
      // An opener with no partner is just a character; carry on looking.
      from = start;
      continue;
    }
    ranges.push({ start: open.index, end: close.index + 1 });
    from = close.index + 1;
  }
  return ranges;
}

// Where each quote sits in `text`, marks included: `{ start, end }` offsets, in
// order. The chat's edit box tints these while a line is being changed
// (web/app/components/chatEditRuns.js), so it finds speech by this same rule.
function spokenRanges(text) {
  if (typeof text !== "string" || !text) return [];
  return quoteRanges(withoutCode(text));
}

// The quoted spans of `text`, marks stripped, in order.
function spokenSpans(text) {
  return spokenRanges(text).map(({ start, end }) => text.slice(start + 1, end - 1));
}

// The spoken words alone, each span on a line of its own so a sentence never
// runs from one quote into the next. Empty when nothing was said.
function spokenText(text) {
  return spokenSpans(text).join("\n");
}

function hasSpeech(text) {
  return spokenSpans(text).some((span) => span.trim().length > 0);
}

module.exports = { quoteRanges, spokenRanges, spokenSpans, spokenText, hasSpeech };
