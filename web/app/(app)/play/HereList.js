"use client";

import { useCallback, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import { useRequestActions } from "@/app/components/RequestActionsProvider";

// HERE: who is standing where you are, and what you can do to them.
//
// The rows come from db/lib/whosHere.js — the same function the "Who's here?"
// button on the Discord anchor answers with — so the street and the page can
// never disagree about who a stranger is. A concealed person is their alias
// and nothing else, and carries no menu: there is nobody there to act on
// until they take the hood off.
//
// The menu is the sheet's own people dialogs, opened through
// RequestActionsProvider with the clicked person already filled in. Nothing
// is forked: this is the same Heal dialog, the same Loot dialog, the same
// server actions.
//
// THE METAGAMING RULE STILL HOLDS (web/app/components/actionRegistry.js): no
// row is greyed for a fact about the person it names. Whether they can be
// looted, bound or harmed is the dialog's answer and the server's, never a
// hint you can read off a menu without opening it.
const PEOPLE_ACTIONS = [
  { mode: "examine", label: "Look at ‡", preset: "targetId" },
  { mode: "heal", label: "Heal", preset: "patientId" },
  { mode: "transfer", label: "Transfer", preset: "toKey", prefix: "character:" },
  { mode: "loot", label: "Loot", preset: "targetId" },
  { mode: "bind", label: "Bind", preset: "targetId" },
  { mode: "free", label: "Free", preset: "targetId" },
  { mode: "harm", label: "Harm", preset: "targetId" },
  { mode: "move", label: "Move Player ‡", preset: "targetId" },
];

function PersonMenu({ person, onClose }) {
  const actions = useRequestActions();
  const open = actions?.open ?? null;

  const pick = useCallback(
    (entry) => {
      onClose();
      if (!open) return;
      const value = entry.prefix ? `${entry.prefix}${person.characterId}` : person.characterId;
      open(entry.mode, null, { [entry.preset]: value });
    },
    [open, onClose, person],
  );

  return (
    <div className="hall-menu" role="menu" aria-label={person.name}>
      {PEOPLE_ACTIONS.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => pick(entry)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export default function HereList({ people, selfId, strip = false }) {
  const named = people?.named ?? [];
  const concealed = people?.concealed ?? [];
  const [openId, setOpenId] = useState(null);
  // The one place a click outside has to close something. Kept on the
  // wrapper rather than on the document: the menu is inside the column, and
  // a document listener would need an effect to attach.
  const wrapRef = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  const total = named.length + concealed.length;

  return (
    <div
      className={strip ? "hall-strip" : "hall-here"}
      ref={wrapRef}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget)) close();
      }}
    >
      {!strip && <p className="hall-section-title">Here · {total} ‡</p>}
      {total === 0 && !strip && <EmptyState>Nobody is here. ‡</EmptyState>}

      {named.map((person) => (
        <div key={person.characterId} className="hall-person-wrap">
          <button
            type="button"
            className="hall-person"
            aria-haspopup="menu"
            aria-expanded={openId === person.characterId}
            onClick={() => setOpenId(openId === person.characterId ? null : person.characterId)}
          >
            <CharacterAvatar
              characterId={person.characterId}
              name={person.name}
              version={person.avatarVersion}
              size={24}
            />
            {!strip && (
              <span className="hall-person-name">
                {person.name}
                {person.roleTitle ? <span className="text-muted"> · {person.roleTitle}</span> : null}
                {person.characterId === selfId ? <span className="text-muted"> · you ‡</span> : null}
              </span>
            )}
          </button>
          {openId === person.characterId && <PersonMenu person={person} onClose={close} />}
        </div>
      ))}

      {/* A hood is not a person you can act on. It gets the same row and no
          menu — the alias is everything anybody standing here can tell. */}
      {concealed.map((person, index) => (
        <div key={`hooded-${index}`} className="hall-person hall-person--hooded">
          <CharacterAvatar characterId={null} name={person.alias} size={24} />
          {!strip && <span className="hall-person-name text-muted">{person.alias}</span>}
        </div>
      ))}
    </div>
  );
}
