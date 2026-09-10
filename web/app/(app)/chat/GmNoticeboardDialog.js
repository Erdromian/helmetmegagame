"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { NoticeText } from "./NoticeCards";
import { TITLE_MAX, WRITE_MAX } from "@lifeweb/db/lib/paper";
import { gmReadBoard, gmReadNotice, gmTearNotice, gmPostNotice } from "./actions";

// THE BOARD, WORKED BY A GM. The same button a player presses and the same
// dialog behind it — this is the player's NoticeboardDialog (PlacePanel.js)
// with the one control that needs a body swapped out.
//
// A player pins a paper they are carrying, so their third control is a picker.
// A GM is carrying nothing, so theirs is a writing form: the notice is minted
// on the spot, out of nothing, and nailed up in the same act.
//
// Two other differences, both of them consequences of having no body:
//
//   Reading  a GM sees everything, wax seals included. The ordinary gate reads
//            a tag list and a GM's is empty, so it would call them illiterate
//            and refuse every notice on every board.
//   Tearing  destroys the paper. A player walks away holding what they took
//            down; a GM has nowhere to put it.
//
// What does NOT differ is the line the room hears. A GM's pin and a GM's tear
// raise the same anonymous ambient a player's does — it names the paper and
// never the person — so nobody standing there can tell one from the other.
export default function GmNoticeboardDialog({ placeKey, onClose }) {
  const [board, setBoard] = useState(null);
  const [reading, setReading] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  const load = useCallback(() => {
    gmReadBoard(placeKey)
      .then(setBoard)
      .catch(() => setBoard({ ok: false, error: "Couldn't read the board." }));
  }, [placeKey]);

  // Re-read when the GM switches places with the dialog open, so it can never
  // sit there showing the Square's board over the Depot's name.
  useEffect(() => {
    load();
  }, [load]);

  if (!board) {
    return (
      <Modal open title="Noticeboard" onClose={onClose}>
        <p className="text-sm text-muted">Reading the board…</p>
      </Modal>
    );
  }
  if (!board.ok) {
    return (
      <Modal open title="Noticeboard" onClose={onClose}>
        <FormError>{board.error}</FormError>
      </Modal>
    );
  }

  return (
    <Modal open title="Noticeboard" onClose={onClose}>
      <p className="text-sm text-muted">{board.heading}</p>

      {board.notices.length === 0 && <EmptyState>Nothing is up.</EmptyState>}
      {board.notices.map((notice) => (
        <div key={notice.id} className="chat-notice-row">
          <span className="chat-person-name">{notice.name}</span>
          <button
            type="button"
            className="menu-item"
            disabled={pending}
            onClick={() => run(() => gmReadNotice(placeKey, notice.id), null, { onOk: setReading })}
          >
            Read
          </button>
          <button
            type="button"
            className="menu-item"
            disabled={pending}
            onClick={async () => {
              // A player's confirm says they end up holding it. A GM's says
              // the opposite, because that is what happens: the paper is
              // destroyed with the post and there is no undo.
              if (
                !(await confirm({
                  title: "Take it down?",
                  message: `${notice.name} comes off the board and is destroyed.`,
                  confirmLabel: "Tear it down",
                }))
              ) {
                return;
              }
              run(() => gmTearNotice(placeKey, notice.id), null, {
                onOk: () => {
                  setReading(null);
                  load();
                },
              });
            }}
          >
            Tear down
          </button>
        </div>
      ))}

      {/* The same block the feed's notice cards draw (NoticeCards.js), so a
          paper read from the street and one read from here are one
          rendering. */}
      <NoticeText reading={reading} />

      {/* Blank leaves the sheet "A Note", the same as a player's own Write —
          db/lib/paper.js#paperName. The caps match paperActions.js: the title
          is cleaned server-side, the body only trimmed, so a proclamation
          signed on its own line stays signed on its own line. */}
      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Body</span>
        <textarea
          rows={6}
          value={body}
          maxLength={WRITE_MAX}
          disabled={pending}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!body.trim() || pending}
          onClick={() =>
            run(() => gmPostNotice(placeKey, { title, body }), null, {
              onOk: () => {
                setTitle("");
                setBody("");
                load();
              },
            })
          }
        >
          Post a notice
        </button>
      </div>
    </Modal>
  );
}
