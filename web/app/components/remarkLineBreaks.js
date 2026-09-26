// A newline in a chat line is a line break, the way Discord draws it. Markdown
// reads a single newline as a space, so a long emote typed over several lines
// with Shift+Enter came out as one run-on paragraph. Chat only: documents and
// the handbook are written as Markdown and keep Markdown's rule.
//
// Splits every text node on "\n" and puts a `break` node (which becomes <br>)
// between the pieces. Code is left alone — an inlineCode node is not "text".

function walk(node) {
  if (!Array.isArray(node.children)) return;
  const out = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
      child.value.split("\n").forEach((piece, i) => {
        if (i > 0) out.push({ type: "break" });
        if (piece) out.push({ type: "text", value: piece });
      });
      continue;
    }
    walk(child);
    out.push(child);
  }
  node.children = out;
}

export default function remarkLineBreaks() {
  return (tree) => walk(tree);
}
