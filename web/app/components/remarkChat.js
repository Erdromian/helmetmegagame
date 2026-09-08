import { findAndReplace } from "mdast-util-find-and-replace";

// The three things a chat line does that a document never does, as one remark
// plugin. It runs alongside remark-gfm and remarkTokens in ChatMarkdown.js, so
// all of it lands in the same tree react-markdown renders from — which is what
// lets a spoiler sit inside a quote, or a mention inside a spoiler, without
// any of the three knowing about the others.
//
//   ||like this||   a spoiler, hidden until it is clicked
//   -# like this    Discord's subtext, the quiet line under a scene
//   "like this"     quoted speech, tinted with --speech
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

// The prefix, at the start of a line. Discord treats `-#` per LINE rather than
// per block, and a paragraph here can hold several lines joined by soft
// breaks, so every line of the paragraph is stripped rather than only the
// first — the same rule db/lib/ambientLine.js writes by.
const SUBTEXT_LINE = /^-#[ \t]?/;

function element(hName, className, children) {
  return {
    type: "chatSpan",
    data: { hName, hProperties: { className } },
    children,
  };
}

// A tiny walk of our own rather than unist-util-visit: that package is here
// only as somebody else's transitive dependency, and reaching into one is how
// a build breaks on an install that resolved it differently.
function walk(node, visit) {
  visit(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child, visit);
}

// True when this paragraph opens with `-#`. Judged on the FIRST text child
// only: a paragraph that merely contains the sequence halfway through is
// somebody writing about it, not writing in it.
function opensAsSubtext(node) {
  const first = node.children?.[0];
  return first?.type === "text" && SUBTEXT_LINE.test(first.value ?? "");
}

export default function remarkChat() {
  return (tree) => {
    // Subtext first, and on the raw text: stripping the prefix after the
    // inline passes below would mean matching `-#` against text that had
    // already been cut into element children.
    walk(tree, (node) => {
      if (node.type !== "paragraph" || !opensAsSubtext(node)) return;
      for (const child of node.children ?? []) {
        if (child.type !== "text" || typeof child.value !== "string") continue;
        child.value = child.value
          .split("\n")
          .map((line) => line.replace(SUBTEXT_LINE, ""))
          .join("\n");
      }
      node.data = {
        ...(node.data ?? {}),
        hName: "div",
        hProperties: { className: "chat-subtext" },
      };
    });

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
