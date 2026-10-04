"use client";

import { useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import Select from "@/app/components/Select";
import { createFriend, updateFriend } from "./friendActions";

const PLAYER_SAVE = { create: createFriend, update: updateFriend };

// Add somebody by hand, or rewrite what you remember of them. Anything goes —
// a nickname, a wrong role, a note to yourself — and it is exactly what a look
// at them will read back to you (docs/systemdocs/MEMORIES.md §2c).
//
// Mounted only while open, so its fields reset between openings for free, the
// same shell JournalComposer.js uses.
//
// The GM's Dev Panel mounts it too (MemoriesTab.js), with its own `save` pair
// and a `roster`: a GM may tie a new entry to a real character, which a player
// never can (MEMORIES.md §8).
export default function FriendComposer({ open, ...props }) {
  if (!open) return null;
  return <FriendComposerBody {...props} />;
}

function FriendComposerBody({ friend, onClose, save = PLAYER_SAVE, roster = null }) {
  const isEditing = Boolean(friend?.id);
  const [subjectId, setSubjectId] = useState("");
  const [name, setName] = useState(friend?.name ?? "");
  const [roleText, setRoleText] = useState(friend?.roleText ?? "");
  const [notes, setNotes] = useState(friend?.notes ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, guardedClose } = useDirtyGuard();

  function submit(e) {
    e.preventDefault();
    setError(null);
    const fields = { name, roleText, notes };
    if (roster && subjectId) fields.subjectId = subjectId;
    startTransition(async () => {
      const res = isEditing ? await save.update(friend.id, fields) : await save.create(fields);
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      onClose();
    });
  }

  return (
    <Modal title={isEditing ? `Edit ${friend.name}` : "Remember someone"} onClose={() => !pending && guardedClose(onClose)}>
      <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
            data-autofocus
            required
          />
        </label>
        {roster && !isEditing && (
          <label className="field">
            <span className="field-label">Linked to</span>
            <Select
              value={subjectId}
              onChange={(e) => {
                const next = e.target.value;
                setSubjectId(next);
                // Picking somebody fills an empty name with theirs.
                const picked = roster.find((c) => c.id === next);
                if (picked && !name.trim()) setName(picked.name);
                markDirty();
              }}
            >
              <option value="">Nobody (a name only)</option>
              {roster.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <span className="text-xs text-muted">A linked entry lets them recognise that person by sight.</span>
          </label>
        )}
        <label className="field">
          <span className="field-label">Role</span>
          <input
            value={roleText}
            maxLength={60}
            placeholder="Unknown"
            onChange={(e) => {
              setRoleText(e.target.value);
              markDirty();
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            rows={4}
            value={notes}
            maxLength={2000}
            placeholder="Anything worth remembering…"
            onChange={(e) => {
              setNotes(e.target.value);
              markDirty();
            }}
          />
        </label>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
