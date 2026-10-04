"use client";

import { useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useNotice } from "@/app/components/NoticeProvider";
import { Section } from "@/app/(app)/memories/MemoriesBoard";
import FriendsSection from "@/app/(app)/memories/FriendsSection";
import DaySection from "@/app/(app)/memories/DaySection";
import JournalList from "@/app/(app)/memories/JournalList";
import JournalComposer from "@/app/(app)/memories/JournalComposer";
import StarredList from "@/app/(app)/memories/StarredList";
import { RING_TEXT } from "@lifeweb/db/lib/ringText";
import {
  gmCreateFriend,
  gmUpdateFriend,
  gmDeleteFriend,
  gmSetPin,
  gmCreateNote,
  gmUpdateNote,
  gmPinNote,
  gmDeleteNote,
  gmUpdateHighlight,
  gmDeleteHighlight,
  gmForgetLine,
} from "./memoryActions";

// The Memories tab (docs/systemdocs/MEMORIES.md §8): the five sections of the
// character's /memories, drawn with the player's own components, but with
// the GM's verbs plugged in and the real words showing. Where the character's
// own head garbles an item today, it says so instead of garbling it.
//
// Every change commits at once, silently — the player is never told — and
// writes an audit row. `onChanged` refetches this tab and stales Record.
export default function MemoriesTab({ characterId, memories, error, linkRoster, onChanged }) {
  const notice = useNotice();
  const confirm = useConfirm();
  const [composerEntry, setComposerEntry] = useState(null);
  const [highlight, setHighlight] = useState(null);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!memories) return <p className="text-sm text-muted">Loading…</p>;

  // A composer shows its own refusal, so its verbs only refresh. A one-click
  // verb (forget, pin, remove) has nowhere to put one, so it says it here.
  const saving = (fn) => async (...args) => {
    const res = await fn(...args);
    if (res?.ok) onChanged();
    return res;
  };
  const clicking = (fn) => async (...args) => {
    const res = await fn(...args);
    if (res?.ok) onChanged();
    else notice({ text: res?.error ?? "Something went wrong.", tone: "bad" });
    return res;
  };

  const friendActions = {
    create: saving((fields) => gmCreateFriend({ characterId, ...fields })),
    update: saving((id, fields) => gmUpdateFriend({ characterId, id, ...fields })),
    remove: clicking((id) => gmDeleteFriend({ characterId, id })),
  };
  const noteSave = {
    create: saving((fields) => gmCreateNote({ characterId, ...fields })),
    update: saving((id, fields) => gmUpdateNote({ characterId, id, ...fields })),
  };
  const noteActions = {
    remove: clicking((id) => gmDeleteNote({ characterId, id })),
    setPinned: clicking((id, pinned) => gmPinNote({ characterId, id, pinned })),
  };
  const removeHighlight = clicking((id) => gmDeleteHighlight({ characterId, id }));
  const forgetLineNow = clicking((seq) => gmForgetLine({ characterId, seq }));

  async function forgetLine(line) {
    const ok = await confirm({
      title: "Forget this line?",
      message: "It leaves this character's memories of today. Everyone else who was there still heard it.",
      confirmLabel: "Forget",
    });
    if (ok) forgetLineNow(line.seq);
  }

  const noAccount = <EmptyState>This character has no player account to keep notes on.</EmptyState>;

  return (
    <CharacterMentionsProvider characters={memories.roster} directory={memories.directory}>
      <div>
        <p className="text-xs text-muted">
          What this character remembers, as they wrote it. Changes here are saved at once and never shown to the
          player as an edit.
        </p>
        {memories.foggy && (
          <p className="text-sm text-muted memory-fog">
            They are Concussed or Amnesiac: much of this reads as nonsense to them today. You see the real words.
          </p>
        )}

        <Section title="Friends" count={memories.friends.length} open>
          <FriendsSection friends={memories.friends} hasCharacter actions={friendActions} roster={linkRoster} />
        </Section>

        <Section title="Who am I?">
          {/* Keyed on the stored PIN, so a save (or a change elsewhere) resets the box. */}
          <WhoAmI key={memories.self.pin ?? ""} self={memories.self} onSave={saving((pin) => gmSetPin({ characterId, pin }))} />
        </Section>

        <Section title="Memories of the day" count={memories.day.length}>
          <DaySection lines={memories.day} hasCharacter onForget={forgetLine} />
        </Section>

        <Section title="Notes" count={memories.journal.length}>
          {memories.hasAccount ? (
            <>
              <div className="flex justify-end">
                <button type="button" className="btn" onClick={() => setComposerEntry({})}>
                  + New entry
                </button>
              </div>
              <JournalList entries={memories.journal} onEdit={setComposerEntry} actions={noteActions} />
            </>
          ) : (
            noAccount
          )}
        </Section>

        <Section title="Highlights" count={memories.starred.length}>
          {memories.hasAccount ? (
            <StarredList notes={memories.starred} remove={removeHighlight} onEdit={setHighlight} />
          ) : (
            noAccount
          )}
        </Section>
      </div>

      <JournalComposer
        open={composerEntry !== null}
        entry={composerEntry}
        roster={memories.roster}
        currentTurnNumber={memories.currentTurnNumber}
        save={noteSave}
        offerCharacterScope
        onClose={() => setComposerEntry(null)}
      />
      {highlight && (
        <HighlightComposer
          note={highlight}
          save={saving((content) => gmUpdateHighlight({ characterId, id: highlight.id, content }))}
          onClose={() => setHighlight(null)}
        />
      )}
    </CharacterMentionsProvider>
  );
}

// "Who am I?" for a GM: the real values, and the one thing on it that lives
// nowhere else on the panel — the infoterminal PIN. Name, seat and age are on
// the Identity tab.
function WhoAmI({ self, onSave }) {
  const [pin, setPin] = useState(self.pin ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const changed = pin !== (self.pin ?? "");

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await onSave(pin);
      if (!res?.ok) setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="memory-self-grid">
        <div className="field">
          <span className="field-label">Name</span>
          <p className="text-sm font-bold">{self.name}</p>
        </div>
        <div className="field">
          <span className="field-label">Role</span>
          <p className="text-sm">{self.roleTitle ?? "No role"}</p>
        </div>
        <div className="field">
          <span className="field-label">Age</span>
          <p className="text-sm">{self.age ?? "Not set"}</p>
        </div>
        <form className="field" onSubmit={submit}>
          <span className="field-label">{RING_TEXT.memoriesPin}</span>
          <span className="flex items-center gap-2">
            <input
              className="mono"
              value={pin}
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]{4}"
              aria-label="PIN"
              style={{ width: "6rem" }}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" className="btn" disabled={pending || !changed}>
              {pending ? "Saving…" : "Save"}
            </button>
          </span>
        </form>
      </div>
      <FormError>{error}</FormError>
      <p className="text-xs text-muted">Name, role and age are edited on the Identity tab.</p>
    </div>
  );
}

// Rewrites what a Highlight says. A GM-only door: a player can only unstar.
function HighlightComposer({ note, save, onClose }) {
  const [content, setContent] = useState(note.content ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, guardedClose } = useDirtyGuard();

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await save(content);
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      onClose();
    });
  }

  return (
    <Modal title={`Edit highlight · ${note.characterName}`} onClose={() => !pending && guardedClose(onClose)}>
      <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
        <label className="field">
          <span className="field-label">What was said</span>
          <textarea
            rows={5}
            value={content}
            maxLength={4000}
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            data-autofocus
            required
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
