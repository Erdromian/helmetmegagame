"use client";

import { useCallback, useEffect, useState } from "react";
import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { NoticeText } from "./NoticeCards";
import { gmReadBoard, gmReadNotice, gmTearNotice } from "./actions";

// THE NOTICE CARDS AT THE TOP OF A STREET, for a GM (./NoticeCards.js is the
// player's). Same cards in the same place, over the GM's own three board
// actions, which differ the way ./GmNoticeboardDialog.js says: a GM reads
// every paper, seals included, and a paper a GM tears down is destroyed,
// because a GM has nothing to hold it in. Pinning a new one stays in that
// dialog, on the GM tab.
export default function GmNoticeCards({ placeKey, version = 0, onChanged }) {
  const [board, setBoard] = useState(null);
  const [reading, setReading] = useState(null);
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  const load = useCallback(() => {
    gmReadBoard(placeKey)
      .then((res) => setBoard(res?.ok ? { placeKey, ...res } : null))
      .catch(() => setBoard(null));
  }, [placeKey]);

  useEffect(() => {
    load();
  }, [load, version]);

  // Stamped with the street it was read for, so walking to the next street
  // never shows the last one's papers for a frame.
  const notices = board?.placeKey === placeKey ? (board.notices ?? []) : [];
  if (notices.length === 0) return null;

  return (
    <div className="chat-notices">
      {notices.map((notice) => (
        <div key={notice.id} className="chat-notice-card">
          <p className="chat-notice-card-title">{notice.name}</p>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(() => gmReadNotice(placeKey, notice.id), null, { onOk: setReading })}
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
                    message: `${notice.name} comes off the board and is destroyed.`,
                    confirmLabel: "Tear it down",
                  }))
                ) {
                  return;
                }
                run(() => gmTearNotice(placeKey, notice.id), null, {
                  onOk: () => (onChanged ? onChanged() : load()),
                });
              }}
            >
              Tear
            </button>
          </div>
        </div>
      ))}

      <FormError>{error}</FormError>

      {reading?.ok && (
        <Modal open title={reading.name} onClose={() => setReading(null)} width="default">
          <NoticeText reading={reading} showName={false} />
        </Modal>
      )}
    </div>
  );
}
