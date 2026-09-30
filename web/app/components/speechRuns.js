// Quoted speech in a chat line's tree, found by the server's own rule
// (db/lib/speech.js), so what a reader sees tinted is what the game hears.
//
// A quote can run over line breaks and blank lines, which in the tree means
// across `break` nodes and from one paragraph into the next — and it can hold
// formatting, so its marks may sit in different siblings, or one inside an
// emphasis and one outside it. So the line is read back as plain text first,
// in order, with a stand-in for everything that is not text; the rule finds
// the quotes in that text; and each quote is then wrapped where it lies,
// cut into one wrapper per stretch of siblings it covers. A quote over two
// paragraphs is two wrappers, one in each. Every extension spelled out, so
// plain node can load it: db/test/chatFormatting.test.js runs it with no
// bundler and no build step.
import { quoteRanges } from "@lifeweb/db/lib/speech.js";

// What a line is read through. Anything else — a token, a mention, an emoji,
// code — is one closed thing: no mark inside it counts, and a quote takes it
// in whole.
const CONTAINERS = new Set([
  "root",
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "chatSpan",
]);

// A block starts after a blank line, as it did in what was typed. A block is
// never put inside a wrapper; a quote goes into it instead.
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "code",
  "thematicBreak",
]);

const opens = (node) => CONTAINERS.has(node.type) && Array.isArray(node.children);

// The line as text: every text node's words, "\n" for a break, a blank line
// before a block, and one "x" for a closed thing. `units` says where each text
// node and closed thing landed in it.
function readLine(tree) {
  let source = "";
  const units = new Map();
  (function walk(node) {
    if (BLOCKS.has(node.type) && source && !source.endsWith("\n\n")) {
      source += source.endsWith("\n") ? "\n" : "\n\n";
    }
    if (node.type === "text") {
      units.set(node, source.length);
      source += node.value;
    } else if (node.type === "break") {
      units.set(node, source.length);
      source += "\n";
    } else if (opens(node)) {
      for (const child of node.children) walk(child);
    } else {
      units.set(node, source.length);
      source += "x";
    }
  })(tree);
  return { source, units };
}

// Which quote holds the character at `at`, or -1.
function quoteAt(ranges, at) {
  for (let i = 0; i < ranges.length; i += 1) {
    if (at < ranges[i].start) return -1;
    if (at < ranges[i].end) return i;
  }
  return -1;
}

// A text node cut at every quote edge inside it, each piece with its quote.
function cut(node, at, ranges) {
  const end = at + node.value.length;
  const edges = [at, end];
  for (const r of ranges) {
    if (r.start > at && r.start < end) edges.push(r.start);
    if (r.end > at && r.end < end) edges.push(r.end);
  }
  edges.sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    if (edges[i] === edges[i + 1]) continue;
    pieces.push({ value: node.value.slice(edges[i] - at, edges[i + 1] - at), quote: quoteAt(ranges, edges[i]) });
  }
  return pieces;
}

// Walk and wrap every quote in place. `build` makes the wrapper from its children.
export default function wrapSpeech(tree, build) {
  const { source, units } = readLine(tree);
  const ranges = quoteRanges(source);
  if (ranges.length === 0) return;

  // The quote a whole node sits inside: its number, -1 for none, or null when
  // it is only partly inside one, or across two.
  const covers = new Map();
  function cover(node) {
    if (covers.has(node)) return covers.get(node);
    let answer;
    if (node.type === "text") {
      const quotes = new Set(cut(node, units.get(node), ranges).map((p) => p.quote));
      answer = quotes.size === 1 ? [...quotes][0] : null;
    } else if (!opens(node)) {
      answer = quoteAt(ranges, units.get(node));
    } else {
      const quotes = new Set(node.children.map(cover));
      answer = quotes.size === 0 ? -1 : quotes.size === 1 ? [...quotes][0] : null;
    }
    covers.set(node, answer);
    return answer;
  }

  (function rewrite(parent) {
    const out = [];
    let run = null;
    const flush = () => {
      if (run) out.push(build(run.children));
      run = null;
    };
    for (const child of parent.children) {
      const quote = cover(child);
      if (quote === -1) {
        flush();
        out.push(child);
        continue;
      }
      if (BLOCKS.has(child.type) || (quote === null && opens(child))) {
        flush();
        if (opens(child)) rewrite(child);
        out.push(child);
        continue;
      }
      // Wholly inside one quote, or a text node to cut into pieces that are.
      const pieces =
        quote === null
          ? cut(child, units.get(child), ranges).map((p) => ({ node: { type: "text", value: p.value }, quote: p.quote }))
          : [{ node: child, quote }];
      for (const piece of pieces) {
        if (run && run.quote !== piece.quote) flush();
        if (piece.quote === -1) {
          out.push(piece.node);
          continue;
        }
        if (!run) run = { quote: piece.quote, children: [] };
        run.children.push(piece.node);
      }
    }
    flush();
    parent.children = out;
  })(tree);
}
