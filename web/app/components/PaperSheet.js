"use client";

import ChatMarkdown from "./ChatMarkdown";

// The one way a paper's words are drawn on the web. A letter, a notice on a
// board, a book you are holding, the "already on it" text in the Write dialog
// — all of it comes through here, so a sheet looks like a sheet everywhere:
// a serif block with its own ground, and the writer's markdown rendered the
// way the noticeboard already rendered it (docs/systemdocs/PAPERWORK.md §3).
//
// `paper` is db/lib/paper.js#paperView's shape: { kind, text, plain }. When
// `plain` is set the text is ABOUT the paper — a refusal, a seal, a closed
// book — and is drawn flat and italic, never as markdown, so a player cannot
// forge a refusal into a letter and nobody can tell blind from illiterate.
// The server decided that; this component only draws it.
export default function PaperSheet({ paper, className = "" }) {
  if (!paper?.text) return null;
  return (
    <div className={`paper-sheet ${className}`.trim()} data-kind={paper.kind ?? undefined}>
      {paper.plain ? <p className="paper-sheet-plain">{paper.text}</p> : <ChatMarkdown content={paper.text} />}
    </div>
  );
}
