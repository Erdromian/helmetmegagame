// The house format for a line the WORLD says into a channel — a gate crossing
// into a zone's #summary, a smell in a Location, a whisper overheard in a
// Room, somebody moving goods around a stash, the intercom.
//
// It is Discord's `-#` subtext, and the reason is that these lines are
// scenery. They arrive unprompted, often while people are mid-scene, and
// full-size bot text competing with player prose is what made them read as
// interruptions. Subtext sits under the conversation instead of in it.
//
// Before this existed the five call sites had four different formats between
// them — `»`, `*italics*`, and bare text. Anything new that narrates into a
// channel comes through here.
//
// One mechanical rule, easy to get wrong by hand: `-#` is PER LINE. A
// multi-line block needs the prefix on every line, or everything after the
// first renders full size.

// `text` is the line itself; `lines` are quoted extras under it, which take a
// `»` inside the subtext the way any restated content does. `signed` is a
// leftover of the retired draft-mark convention: still accepted so callers
// need not change, and it does nothing.
function ambientLine(text, lines = [], { signed = true } = {}) {
  // `text` is SPLIT on newlines rather than assumed single-line: a two-line
  // string would otherwise render its second half at full size — the exact
  // mistake the header warns about, made by the helper that prevents it.
  const body = [
    ...String(text).split("\n").map((l) => `-# ${l}`),
    ...lines.map((l) => `-# » ${l}`),
  ];
  void signed;
  return body.join("\n");
}

module.exports = { ambientLine };
