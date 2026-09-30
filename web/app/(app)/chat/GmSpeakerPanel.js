"use client";

import { useEffect, useState } from "react";
import DevPanelModal from "@/app/components/DevPanelModal";
import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import { gmSpeakerOf } from "./actions";

// "Look at" on a line, in the GM seat. A player's eye opens what their body
// can see of the speaker (LookReadout); a GM has no body, so theirs opens the
// speaker's character panel instead, the same one a name in the GM's Here
// list opens. Keyed by the line, like the player's, so a hooded line works
// without the page knowing who was under the hood.
export default function GmSpeakerPanel({ seq, onClose }) {
  const [found, setFound] = useState(null);

  useEffect(() => {
    let cancelled = false;
    gmSpeakerOf(seq)
      .then((res) => {
        if (!cancelled) setFound({ seq, ...(res ?? { ok: false, error: "Nobody said that." }) });
      })
      .catch(() => {
        if (!cancelled) setFound({ seq, ok: false, error: "Nobody said that." });
      });
    return () => {
      cancelled = true;
    };
  }, [seq]);

  const fresh = found?.seq === seq ? found : null;
  if (fresh?.ok) return <DevPanelModal characterId={fresh.characterId} onClose={onClose} />;
  return (
    <Modal open title="Look at" onClose={onClose} width="default">
      {fresh ? <FormError>{fresh.error}</FormError> : <p className="text-sm text-muted">Looking…</p>}
    </Modal>
  );
}
