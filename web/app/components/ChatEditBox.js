"use client";

import { useMemo } from "react";
import editRuns from "./chatEditRuns";

// The box a line is changed in, drawn the way the line itself is drawn: the
// feed's own face and weight, an *emote* in italics, and "quoted speech" in
// the speech tint, so an edit reads as the line it will become rather than as
// a form field. The marks stay on screen, because they are what you edit.
//
// A textarea cannot colour part of its text, so it is two layers. The one
// underneath draws the words; the textarea on top holds the same words in
// transparent ink, and keeps the caret, the selection, the keyboard and paste.
// The drawn layer is in the flow and decides the height, and the textarea is
// stretched over it, so the two wrap on the same lines with no measuring.
// Both layers must keep the same font metrics for that to hold: italics are
// safe (Verdana's italic has the same advances as its roman), but bold is not,
// which is why **bold** is left as it is typed.
export default function ChatEditBox({ value, onChange, onKeyDown, autoFocus = false, label = "Change what you said" }) {
  const runs = useMemo(() => editRuns(value ?? ""), [value]);
  return (
    <div className="chat-edit">
      <div className="chat-edit-drawn" aria-hidden="true">
        {runs.map((run, i) => {
          const className = [run.speech && "speech", run.emote && "emote"].filter(Boolean).join(" ");
          return className ? (
            <span key={i} className={className}>
              {run.text}
            </span>
          ) : (
            run.text
          );
        })}
        {/* A text ending in a newline has an empty last line in the textarea,
            and a div would drop it. A zero-width space keeps the line. */}
        {"​"}
      </div>
      <textarea
        className="chat-edit-input"
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
