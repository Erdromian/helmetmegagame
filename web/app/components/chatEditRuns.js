// What the edit box draws in which style (ChatEditBox.js): a line being
// changed, cut into runs that each have one look — speech, an emote, both, or
// neither. No JSX and every extension spelled out, so plain node can load it:
// db/test/chatEditRuns.test.js runs it with no bundler and no build step.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { spokenRanges } from "@lifeweb/db/lib/speech.js";

// remark-gfm as well as remark-parse, the pair ChatMarkdown's list starts with
// (markdownPlugins.js), so a word is emphasis here exactly when it is there —
// the underscores in a bare link are not.
const parser = unified().use(remarkParse).use(remarkGfm);

// Where the renderer will draw italics: every emphasis node, markers included.
function emoteRanges(text) {
  const ranges = [];
  (function walk(node) {
    if (node.type === "emphasis" && node.position) {
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset });
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child);
  })(parser.parse(text));
  return ranges;
}

// Speech is found by the server's rule (db/lib/speech.js), the same one the
// feed's tint follows. Every character lands in exactly one run, in order, so
// the runs joined back together are the text.
export default function editRuns(text) {
  if (!text) return [];
  const marks = [
    ...spokenRanges(text).map((r) => ({ ...r, kind: "speech" })),
    ...emoteRanges(text).map((r) => ({ ...r, kind: "emote" })),
  ];
  const cuts = new Set([0, text.length]);
  for (const m of marks) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const from = edges[i];
    const to = edges[i + 1];
    const inside = (kind) => marks.some((m) => m.kind === kind && m.start <= from && m.end >= to);
    const run = { text: text.slice(from, to), speech: inside("speech"), emote: inside("emote") };
    const last = runs[runs.length - 1];
    if (last && last.speech === run.speech && last.emote === run.emote) last.text += run.text;
    else runs.push(run);
  }
  return runs;
}
