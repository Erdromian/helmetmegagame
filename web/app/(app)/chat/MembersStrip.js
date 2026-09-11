"use client";

import { useCallback, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import { CloseIcon } from "@/app/components/icons";
import useActionRunner from "@/app/components/useActionRunner";
import { addMember, removeMember } from "./actions";
import useNarrow from "./useNarrow";

// How many faces the phone's folded row shows before it says "+n".
const FACEPILE_MAX = 5;

// Who is in this conversation, or in this private room — and the two buttons
// that change it.
//
// Until now the only way to let somebody into either was `/add` on Discord
// (bot/src/events/interactionCreate.js), which a "web only" player cannot type
// and which nobody who had not been told about it could discover. So the list
// is on the page instead, and `+ Add` is a plain button rather than a row in
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
  // On a phone the strip is one row of faces until it is tapped open — a
  // conversation with a dozen people in it used to wrap to three rows of
  // chips above a feed that had no rows to spare. Opening it is a state of
  // this strip, so it closes again when the reader moves to another place
  // (Feed.js keys itself on the place).
  const narrow = useNarrow();
  const [unfolded, setUnfolded] = useState(false);
  const folded = narrow && !unfolded && !picking;

  const done = useCallback(() => {
    setPicking(false);
    onChanged?.();
  }, [onChanged]);

  const onAdd = useCallback(
    (ref) => run(() => addMember(placeKey, ref), undefined, { onOk: done }),
    [placeKey, run, done],
  );

  // A character id for somebody named, the opaque hood token for somebody in
  // one — a concealed row carries no id at all, because /api/avatar takes one
  // and answers with a face (db/lib/presentedMembers.js).
  const onRemove = useCallback(
    (ref) => run(() => removeMember(placeKey, ref), undefined, { onOk: done }),
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

  if (folded) {
    const shown = data.members.slice(0, FACEPILE_MAX);
    const rest = data.members.length - shown.length;
    return (
      <div className="chat-members chat-members--folded">
        <button
          type="button"
          className="chat-facepile"
          aria-expanded={false}
          aria-label={`${data.members.length} in here — show who`}
          onClick={() => setUnfolded(true)}
        >
          {shown.map((person) => (
            <span key={person.characterId ?? person.token ?? person.name} className="chat-facepile-face">
              <CharacterAvatar
                characterId={person.characterId ?? undefined}
                src={person.avatarPath ?? undefined}
                unknown={Boolean(person.unknownFace)}
                name={person.name}
                version={person.avatarVersion}
                size={22}
              />
            </span>
          ))}
          <span className="chat-facepile-count">
            {rest > 0 ? `+${rest}` : data.members.length === 0 ? "Nobody else" : `${data.members.length} in here`}
          </span>
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => setPicking(true)}>
          + Add
        </button>
      </div>
    );
  }

  return (
    <div className="chat-members">
      <div className="chip-row">
        {data.members.map((person) => (
          <span key={person.characterId ?? person.token ?? person.name} className="chip chat-member">
            {/* The face the server decided this reader may have, on the same
                three props the HERE column draws with: a real id only for
                somebody named, the mask sprite as `src` once you have watched
                them speak in it, and the question-mark plate until then. This
                strip used to pass the character id unconditionally, which
                fetched the real portrait of everybody in the room — the
                reason inviting somebody into a conversation looked like it
                broke their disguise. */}
            <CharacterAvatar
              characterId={person.characterId ?? undefined}
              src={person.avatarPath ?? undefined}
              unknown={Boolean(person.unknownFace)}
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
              onClick={() => onRemove(person.characterId ?? person.token)}
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
            <span className="text-sm text-muted">Nobody else is standing here.</span>
          ) : (
            candidates.map((person, index) => (
              <button
                key={person.characterId ?? person.token ?? `hooded-${index}`}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => onAdd(person.characterId ?? person.token)}
              >
                <CharacterAvatar
                  characterId={person.characterId ?? undefined}
                  name={person.name}
                  version={person.avatarVersion}
                  src={person.avatarPath ?? undefined}
                  unknown={Boolean(person.unknownFace)}
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
