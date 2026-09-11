// Finding a delimited run that has FORMATTING inside it.
//
// The problem this exists to solve. `remark-parse` (plus remark-gfm) builds the
// whole inline tree before any plugin runs, so by the time a plugin sees a
// paragraph, every `*star*`, `` `tick` ``, `~~tilde~~` and `[link](…)` has
// already become its own node and cut the surrounding text in half. A pass
// built on `mdast-util-find-and-replace` only ever sees ONE text node, so
//
//     he said "*get out*"
//
// arrives as three siblings — the text `he said "`, an emphasis, the text `"` —
// and no regex in the world matches a quote that opens in the first and closes
// in the third. The quote was simply never tinted, and the same was true of
// `||a *hidden* word||`. Players write with emphasis constantly, so this was
// most quotes.
//
// So the scan here runs over a parent's CHILD LIST rather than over one string.
// The opener and the closer still have to sit in text nodes, but everything
// between them may be any number of siblings, and those siblings go inside the
// wrapper untouched — which is the whole point: the tint is around the phrase,
// and the emphasis inside it is still emphasis.
//
// A tiny walk of our own rather than unist-util-visit, for the reason
// remarkSubtext.js gives: that package is here only as somebody else's
// transitive dependency. This file imports NOTHING, which is also what lets
// db/test/chatFormatting.test.js load it with no build step.

// Inside code the whole point of the text is that it is literal — the same
// `ignore` both find-and-replace passes used to carry.
const OPAQUE = new Set(["code", "inlineCode"]);

const text = (value) => ({ type: "text", value });

// How much text a sibling contributes, so an emphasis in the middle of a quote
// still counts against the length cap.
function textLength(node) {
  if (node.type === "text") return node.value.length;
  if (!Array.isArray(node.children)) return 0;
  let total = 0;
  for (const child of node.children) total += textLength(child);
  return total;
}

// The first closer at or after `startOffset` in child `from`, searching forward
// through the siblings. Returns { index, start, end } or null.
//
// A run gives up — rather than reaching further — on any of: a forbidden
// character (a second quote, a stray bar), a hard line break, running past the
// cap, or running out of siblings. Giving up is what stops one unmatched quote
// at the top of a long message from swallowing the rest of it.
function findClose(children, from, startOffset, spec) {
  const close = new RegExp(spec.close.source, "g");
  let inner = 0;

  for (let i = from; i < children.length; i += 1) {
    const node = children[i];
    const begin = i === from ? startOffset : 0;

    if (node.type === "text") {
      close.lastIndex = begin;
      const hit = close.exec(node.value);
      const chunk = node.value.slice(begin, hit ? hit.index : node.value.length);
      if (spec.forbidden.test(chunk)) return null;
      inner += chunk.length;
      if (inner > spec.maxInner) return null;
      if (hit) {
        // Nothing between the marks is not a quote, it is two marks.
        if (inner < 1) return null;
        return { index: i, start: hit.index, end: hit.index + hit[0].length };
      }
      continue;
    }

    // A hard break is the node-shaped spelling of the newline the old regexes
    // refused.
    if (node.type === "break") return null;

    inner += textLength(node);
    if (inner > spec.maxInner) return null;
  }

  return null;
}

// Is this opener actually opening something? Speech wants the mark followed by
// a real character, so `he said " ` mid-sentence does not start a quote. The
// character after it may live in the NEXT sibling — which is exactly the
// `"*get out*"` case — and a sibling is never whitespace.
function opensHere(children, index, end, spec) {
  if (!spec.openTight) return true;
  const value = children[index].value;
  if (end < value.length) return !/\s/.test(value[end]);
  return index + 1 < children.length;
}

// The children of the wrapper: the tail of the opening text node, whole
// siblings, the head of the closing one. `keepDelimiters` decides whether the
// marks themselves go in — speech keeps its quotes so the tint reads as one
// phrase, a spoiler drops its bars.
function runChildren(children, from, open, close, spec) {
  const start = spec.keepDelimiters ? open.start : open.end;
  const end = spec.keepDelimiters ? close.end : close.start;

  if (from === close.index) {
    const only = children[from].value.slice(start, end);
    return only ? [text(only)] : [];
  }

  const inner = [];
  const head = children[from].value.slice(start);
  if (head) inner.push(text(head));
  for (let i = from + 1; i < close.index; i += 1) inner.push(children[i]);
  const tail = children[close.index].value.slice(0, end);
  if (tail) inner.push(text(tail));
  return inner;
}

// One parent's children, with every run wrapped.
function scan(children, spec) {
  const open = new RegExp(spec.open.source, "g");
  const out = [];
  let i = 0;
  let from = 0;

  while (i < children.length) {
    const node = children[i];
    if (node.type !== "text") {
      out.push(node);
      i += 1;
      from = 0;
      continue;
    }

    open.lastIndex = from;
    const mark = open.exec(node.value);
    const hit = mark ? { start: mark.index, end: mark.index + mark[0].length } : null;

    // Nothing left to open here: keep what is left of this node and move on.
    if (!hit) {
      const rest = node.value.slice(from);
      if (rest) out.push(text(rest));
      i += 1;
      from = 0;
      continue;
    }

    const close = opensHere(children, i, hit.end, spec) ? findClose(children, i, hit.end, spec) : null;

    // An opener with no partner is just a character. Emit up to and including
    // it and carry on looking — the next mark may be the real opener.
    if (!close) {
      out.push(text(node.value.slice(from, hit.end)));
      from = hit.end;
      continue;
    }

    const before = node.value.slice(from, hit.start);
    if (before) out.push(text(before));
    out.push(spec.build(runChildren(children, i, hit, close, spec)));

    i = close.index;
    from = close.end;
    if (from >= children[i].value.length) {
      i += 1;
      from = 0;
    }
  }

  return out;
}

// Walk the tree and wrap every run of `spec` in place.
//
// Depth first, children before the parent, so a run built here is never scanned
// again — and so a quote written inside an emphasis (`*she said "no"*`) is found
// on the emphasis's own children, where it belongs.
export default function wrapRuns(tree, spec) {
  const full = { maxInner: 400, keepDelimiters: false, openTight: false, ...spec };

  (function walk(node) {
    if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
    if (OPAQUE.has(node.type)) return;
    for (const child of node.children) walk(child);
    node.children = scan(node.children, full);
  })(tree);
}
