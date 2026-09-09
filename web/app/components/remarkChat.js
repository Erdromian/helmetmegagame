import { findAndReplace } from "mdast-util-find-and-replace";

// The two things a chat line does that a document never does, as one remark
// plugin. It runs alongside remark-gfm and remarkTokens in ChatMarkdown.js, so
// all of it lands in the same tree react-markdown renders from — which is what
// lets a spoiler sit inside a quote, or a mention inside a spoiler, without
// any of the three knowing about the others.
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

// Not greedy, no newlines, and capped: an unmatched quote at the top of a long
// message must not swallow the rest of it looking for a partner. The closing
// quote also cannot be preceded by a space, so `he said "well," she "…` reads
// the way it looks. Both curly and straight quotes, because a phone keyboard
// produces the curly pair without asking.
const SPEECH = /(["“])(?!\s)([^"“”\n]{1,400}?)(["”])/g;

// Discord's own delimiter. Double pipes, nothing empty inside.
const SPOILER = /\|\|([^|\n]{1,400}?)\|\|/g;

function element(hName, className, children) {
  return {
    type: "chatSpan",
    data: { hName, hProperties: { className } },
    children,
  };
}

export default function remarkChat() {
  return (tree) => {
    // Spoilers before speech, so a quote inside a hidden line is still a
    // quote once it is revealed. Both skip code, where the point of the text
    // is that it is literal.
    findAndReplace(
      tree,
      [SPOILER, (_raw, inner) => element("chatspoiler", "chat-spoiler", [{ type: "text", value: inner }])],
      { ignore: ["code", "inlineCode"] },
    );

    findAndReplace(
      tree,
      [
        SPEECH,
        (_raw, open, inner, close) =>
          element("span", "speech", [{ type: "text", value: `${open}${inner}${close}` }]),
      ],
      { ignore: ["code", "inlineCode"] },
    );
  };
}
