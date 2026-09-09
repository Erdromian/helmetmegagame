// Discord's `-#` subtext, as its own plugin.
//
// It lived in remarkChat.js, which meant only /chat understood it — so the
// `-#` line on a lobby seat DM reached players as a literal "-#". That is the
// same bug as the raw `<t:…>` beside it, and it has the same cause: this is
// Discord's SYNTAX, not a styling choice we made, so every surface that reads
// text written for Discord needs it. remarkChat keeps what really is ours —
// the speech tint and spoilers.
//
// It is separate from remarkDiscord for one reason, and it is load-bearing:
// this pass is block-level and has to run on RAW text, before any inline pass
// has cut a paragraph into element children. So it goes first in every list,
// ahead of remarkChat, while remarkDiscord's inline tokens go after.

// The prefix, at the start of a line. Discord treats `-#` per LINE rather than
// per block, and a paragraph here can hold several lines joined by soft
// breaks, so every line of the paragraph is stripped rather than only the
// first — the same rule db/lib/ambientLine.js writes by.
const SUBTEXT_LINE = /^-#[ \t]?/;

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

export default function remarkSubtext() {
  return (tree) => {
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
  };
}
