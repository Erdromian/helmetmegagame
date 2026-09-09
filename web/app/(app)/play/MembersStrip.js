"use client";

import { useCallback, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import { CloseIcon } from "@/app/components/icons";
import useActionRunner from "@/app/components/useActionRunner";
import { addMember, removeMember } from "./actions";

// Who is in this conversation, or in this private room — and the two buttons
// that change it.
//
// Until now the only way to let somebody into either was `/add` on Discord
// (bot/src/events/interactionCreate.js), which a "web only" player cannot type
// and which nobody who had not been told about it could discover. So the list
// is on the page instead, and `+ Add ‡` is a plain button rather than a row in
// a menu: opening a door is the ordinary thing you do in a private room, not
// an advanced one.
//
// It draws for a `conv:` place and for a PRIVATE `room:` place, and nowhere
// else. A public room needs no guest list — everyone standing in the Location
// can already walk in — and placeMembers() says so by answering with a null
// `members` rather than a refusal.
//
// Every rule is the server's. The × is drawn on everybody, including a
// key-holder who cannot actually be shown out: the metagaming rule
// (web/app/components/actionRegistry.js) says a control is never greyed for a
// fact about the person it names, and "their key admits them, take the key" is
// a better answer than a dead button.

// `data` is placeMembers()' answer, loaded once by Feed.js — the /remove
// command's picker needs the same list, and two fetches of it would be two
// answers to one question. `onChanged` asks for a re-read after a write.
export default function MembersStrip({ placeKey, data, onChanged }) {
  const [picking, setPicking] = useState(false);
  const { run, pending, error } = useActionRunner();

  const done = useCallback(() => {
    setPicking(false);
    onChanged?.();
  }, [onChanged]);

  const onAdd = useCallback(
    (characterId) => run(() => addMember(placeKey, characterId), undefined, { onOk: done }),
    [placeKey, run, done],
  );

  const onRemove = useCallback(
    (characterId) => run(() => removeMember(placeKey, characterId), undefined, { onOk: done }),
    [placeKey, run, done],
  );

  // Nothing at all until the first answer lands: a strip that appears empty
  // and then fills reads as somebody leaving and coming back.
  if (!data) return null;
  if (!data.ok) {
    return (
      <div className="chat-members">
        <FormError>{data.error}</FormError>
      </div>
    );
  }
  if (!data.members) return null;

  const candidates = data.candidates ?? [];

  return (
    <div className="chat-members">
      <div className="chip-row">
        {data.members.map((person) => (
          <span key={person.characterId} className="chip chat-member">
            <CharacterAvatar
              characterId={person.characterId}
              name={person.name}
              version={person.avatarVersion}
              size={20}
              zoomable
            />
            <span className="truncate">{person.name}</span>
            <IconButton
              icon={CloseIcon}
              label={`Show ${person.name} out`}
              disabled={pending}
              onClick={() => onRemove(person.characterId)}
            />
          </span>
        ))}
        <button
          type="button"
          className="btn-secondary"
          aria-expanded={picking}
          disabled={pending}
          onClick={() => setPicking((open) => !open)}
        >
          + Add
        </button>
      </div>

      {picking && (
        <div className="chip-row chat-member-picker">
          {candidates.length === 0 ? (
            <span className="text-sm text-muted">Nobody else is standing here. ‡</span>
          ) : (
            candidates.map((person) => (
              <button
                key={person.characterId}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => onAdd(person.characterId)}
              >
                <CharacterAvatar
                  characterId={person.characterId}
                  name={person.name}
                  version={person.avatarVersion}
                  src={person.avatarPath ?? undefined}
                  size={16}
                />
                {person.name}
              </button>
            ))
          )}
        </div>
      )}

      <FormError>{error}</FormError>
    </div>
  );
}
