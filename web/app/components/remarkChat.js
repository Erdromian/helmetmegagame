// The extension is spelled out, unlike every other import here, so plain node
// can load this file: db/test/chatFormatting.test.js runs the two passes with
// no bundler and no build step.
import wrapRuns from "./chatRuns.js";

// The two things a chat line does that a document never does, as one remark
// plugin. It runs alongside remark-gfm, remarkTokens and remarkDiscord in
// ChatMarkdown.js, so all of it lands in the same tree react-markdown renders
// from — which is what lets a spoiler sit inside a quote, or a mention inside a
// spoiler, without any of the three knowing about the others.
//
//   ||like this||   a spoiler, hidden until it is clicked
//   "like this"     quoted speech, tinted with --speech
//
// `-#` subtext used to live here too. It moved to remarkSubtext.js, because it
// is Discord's syntax rather than ours and every surface needs it — a DM was
// showing players a literal "-#".
//
// Why speech is worth tinting at all: a Chat row is a paragraph of mixed
// narration and dialogue, and in a wall of them the words somebody actually
// SAID are the ones a reader is scanning for. Discord solves this by giving
// everybody a coloured name and nothing else; the tint does it inside the
// line.
//
// BOTH PASSES SCAN SIBLINGS, not one text node — chatRuns.js says why, and it
// is the difference between `he said "*get out*"` being tinted and not. Until
// that existed, a quote or a spoiler holding any emphasis, bold, strikethrough,
// code span, link or mention was silently skipped, which is most of them.

// Not greedy, no newlines, and capped: an unmatched quote at the top of a long
// message must not swallow the rest of it looking for a partner. Both curly and
// straight marks, because a phone keyboard produces the curly pair without
// asking — and `“` may only open while `”` may only close, which is what a
// phone gives you anyway.
//
// `openTight` is the rule that a quote opens on a real character: `he said " `
// mid-sentence is punctuation, not the start of speech. There is deliberately
// no matching rule on the closing mark.
const SPEECH = {
  open: /["“]/,
  close: /["”]/,
  forbidden: /["“”\n]/,
  openTight: true,
  keepDelimiters: true,
  build: (children) => element("span", "speech", children),
};

// Discord's own delimiter. Double pipes, nothing empty inside, and the bars
// themselves are not part of what is hidden.
const SPOILER = {
  open: /\|\|/,
  close: /\|\|/,
  forbidden: /[|\n]/,
  build: (children) => element("chatspoiler", "chat-spoiler", children),
};

function element(hName, className, children) {
  return {
    type: "chatSpan",
    data: { hName, hProperties: { className } },
    children,
  };
}

export default function remarkChat() {
  return (tree) => {
    // Spoilers before speech, so a quote inside a hidden line is still a quote
    // once it is revealed.
    wrapRuns(tree, SPOILER);
    wrapRuns(tree, SPEECH);
  };
}
