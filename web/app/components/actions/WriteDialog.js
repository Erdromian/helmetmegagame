"use client";

import { useState, useTransition } from "react";
import ChipPicker from "../ChipPicker";
import PaperSheet from "../PaperSheet";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { writePaper, readMyPaper } from "@/app/(app)/character/paperActions";
// Safe in a "use client" bundle: paper.js requires only ./reading ->
// ./examineVision, and neither touches prisma. One definition, so the counter
// under the box and the server's own cap agree.
import { WRITE_MAX, BOOK_MAX, TITLE_MAX } from "@lifeweb/db/lib/paper";

// Write (docs/systemdocs/PAPERWORK.md): which sheet, and what is being added
// to it. Picking a sheet fetches what is already on it, so the box can show
// it read-only above the cursor — writing only ever appends. Fetched on
// demand rather than shipped with the page: an unreadable sheet must never
// have its text sitting in the page source. A blank book takes a title and
// six times the text, and is finished for good once written; a blank SHEET may
// take one too, and leaving it empty keeps the sheet anonymous the way every
// sheet used to be (db/lib/paper.js#paperName).
export default function WriteDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const options = pools.paperOptions ?? [];
  const [paperId, setPaperId] = useState("");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [existing, setExisting] = useState(null);
  const [reading, startReading] = useTransition();
  const { submit, busy, error } = useSubmit();

  const paper = options.find((o) => o.tagId === paperId) ?? null;
  const book = Boolean(paper?.book);
  // A sheet is named when it stops being blank, and never again — the same one
  // pass a book gets. Writing more on a sheet that already has words appends
  // to it and leaves its name alone, so a second hand cannot rename what a
  // first hand called it.
  const naming = book || Boolean(paper?.blank);
  const max = book ? BOOK_MAX : WRITE_MAX;

  function choose(nextId) {
    setPaperId(nextId);
    setExisting(null);
    const chosen = options.find((o) => o.tagId === nextId);
    if (!nextId || chosen?.blank || chosen?.book) return;
    startReading(async () => {
      const res = await readMyPaper(nextId);
      // A refusal shows in the box like anything else — the sentence is the
      // same "You can't read this" the chip gives, so nothing is disclosed.
      setExisting(res?.ok ? (res.paper ?? { kind: res.kind ?? null, text: res.text, plain: false }) : null);
    });
  }

  return (
    <ActionDialog
      title="Write"
      width="wide"
      busy={busy}
      error={error}
      empty={options.length === 0 ? "You have no paper. The Depot sells it." : null}
      canSubmit={Boolean(paperId && body.trim() && (!book || title.trim()))}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => writePaper({ tagId: paperId, text: body, title }),
          (res) => onDone(book ? `${res.name ?? "The book"} is written and bound.` : `Written on ${res.name ?? "the sheet"}.`),
        )
      }
    >
      <ChipPicker
        label="What are you writing on?"
        options={options.map((o) => ({
          id: o.tagId,
          label: o.name,
          note: o.blank || o.book ? `${o.quantity > 1 ? `×${o.quantity} · ` : ""}blank` : (o.excerpt ?? null),
        }))}
        value={paperId}
        onChange={choose}
      />
      {reading && <p className="text-xs text-muted">Reading…</p>}
      {/* Read-only, always. You can always write more; you can never take
          anything back off a sheet. */}
      {existing && (
        <div className="field">
          <span className="field-label">Already on it</span>
          <PaperSheet paper={existing} />
        </div>
      )}
      {naming && (
        <label className="field">
          <span className="field-label">{book ? "What is it called?" : "Name it (optional)"}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            maxLength={TITLE_MAX}
            required={book}
          />
        </label>
      )}
      {paperId && (
        <label className="field">
          <span className="field-label">{existing ? "Add underneath" : "What does it say?"}</span>
          <textarea rows={book ? 12 : 6} maxLength={max} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write here." />
          <span className="text-xs text-muted mono">
            {body.length} / {max}
          </span>
        </label>
      )}
      {book && <p className="text-xs text-muted">A book is written in one pass. Nothing can be added later.</p>}
    </ActionDialog>
  );
}
