"use client";

import { useCallback, useEffect, useState } from "react";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { readBoard, readNotice, tearNotice } from "./actions";

// THE NOTICEBOARD, in the street rather than behind a button.
//
// A board is an attribute on a Location (db/lib/noticeboard.js), and what is
// nailed to it is standing there for anyone to read — so it belongs at the
// top of the Location's own feed, above the scene and pinned there, not
// filed into the scroll in the order the papers went up. The Noticeboard
// dialog in the right column keeps its job: pinning one of YOUR papers, which
// needs a picker.
//
// Everything a notice does stays as open as it always was. Anyone standing
// here may read one or tear one down, including somebody else's.

// What a notice says, once it has been read. Two shapes, and which one is
// drawn is the server's call, never this component's:
//
//   plain     the reader could not read it — blind, illiterate, dark, or the
//             paper is sealed. `text` is the refusal, and it is the SAME
//             refusal in every one of those cases, so nobody watching learns
//             which it was. Rendered as flat text.
//   otherwise the words on the paper, through ChatMarkdown like every other
//             string in this page that a person wrote.
export function NoticeText({ reading, showName = true }) {
  if (!reading?.ok) return null;
  return (
    <div className="field">
      {showName && <span className="field-label">{reading.name}</span>}
      {reading.plain ? <p className="text-sm">{reading.text}</p> : <ChatMarkdown content={reading.text} />}
    </div>
  );
}

export default function NoticeCards({ version = 0, onChanged }) {
  const [board, setBoard] = useState(null);
  const [reading, setReading] = useState(null);
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  const load = useCallback(() => {
    readBoard()
      .then((res) => setBoard(res?.ok ? res : null))
      .catch(() => setBoard(null));
  }, []);

  // Re-read on open and on every pin or tear, wherever it came from — the
  // dialog in the right column pins to this same board, and a card that did
  // not know would sit there naming a paper somebody has taken away.
  useEffect(() => {
    load();
  }, [load, version]);

  const notices = board?.notices ?? [];
  if (notices.length === 0) return null;

  return (
    <div className="hall-notices">
      {notices.map((notice) => (
        <div key={notice.id} className="hall-notice-card">
          <p className="hall-notice-card-title">{notice.name}</p>
          <div className="hall-buttons">
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(readNotice, notice.id, { onOk: setReading })}
            >
              Read
            </button>
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: "Take it down?",
                    message: `${notice.name} comes off the board and into your hands. ‡`,
                    confirmLabel: "Tear it down",
                  }))
                ) {
                  return;
                }
                run(tearNotice, notice.id, {
                  // Whoever owns the version counter re-reads for everybody;
                  // with nobody listening this component refreshes itself.
                  onOk: (res) => (onChanged ? onChanged(res) : load()),
                });
              }}
            >
              Tear
            </button>
          </div>
        </div>
      ))}

      <FormError>{error}</FormError>

      {/* The same reading the Noticeboard dialog does, in a modal because
          there is no panel here to put it under. Nobody is told it was
          read. */}
      {reading?.ok && (
        <Modal open title={reading.name} onClose={() => setReading(null)} width="default">
          <NoticeText reading={reading} showName={false} />
        </Modal>
      )}
    </div>
  );
}
