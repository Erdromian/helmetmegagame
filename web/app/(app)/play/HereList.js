"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import { EyeIcon } from "@/app/components/icons";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { Readout } from "@/app/components/ExamineDialog";
import { examineHooded, loadPeopleHere } from "./actions";

// HERE: who is standing where you are, and what you can do to them.
//
// The rows come from db/lib/whosHere.js — the same function the "Who's here?"
// button on the Discord anchor answers with — so the street and the page can
// never disagree about who a stranger is.
//
// A hood gets the SAME row as anybody else, an alias and an eye. Looking at
// somebody is the one thing you can do to a person you cannot name, and a
// hood you may not look at was never a rule, only a consequence of the row
// having no id to hand a dialog. It has a token instead: an HMAC of the
// character id (db/lib/whosHere.js#resolveHoodToken), so the browser is never
// told who is under it, and the server resolves it against the people
// actually standing here.
//
// The menu is the sheet's own people dialogs, opened through
// RequestActionsProvider with the clicked person already filled in. Nothing
// is forked: this is the same Heal dialog, the same Loot dialog, the same
// server actions. A hood's menu is Converse and nothing else — there is
// nobody there to heal or loot until the hood comes off.
//
// THE METAGAMING RULE STILL HOLDS (web/app/components/actionRegistry.js): no
// row is greyed for a fact about the person it names. Whether they can be
// looted, bound or harmed is the dialog's answer and the server's, never a
// hint you can read off a menu without opening it.
//
// Look at is NOT on this menu: the eye on the row is the Look at, on every
// named row and on every hood, and a second copy of it inside the menu was
// the same dialog one click further away.
const PEOPLE_ACTIONS = [
  { mode: "heal", label: "Heal", preset: "patientId" },
  { mode: "transfer", label: "Transfer", preset: "toKey", prefix: "character:" },
  { mode: "loot", label: "Loot", preset: "targetId" },
  { mode: "bind", label: "Bind", preset: "targetId" },
  { mode: "free", label: "Free", preset: "targetId" },
  { mode: "harm", label: "Harm", preset: "targetId" },
  { mode: "move", label: "Move Player ‡", preset: "targetId" },
];

function PersonMenu({ person, onClose, onConverse }) {
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
      {onConverse && (
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            onClose();
            // Opened ON this person, so the dialog has them ticked already —
            // asking for a corner with somebody and then having to name them
            // again was the same answer typed twice.
            onConverse({ id: person.characterId, name: person.name });
          }}
        >
          Converse ‡
        </button>
      )}
    </div>
  );
}

// A hood's read is the impoverished one db/lib/examine.js builds, and there is
// no picker to hang it off — the sheet's Look at dialog resolves its roster by
// character id, which is exactly what this row does not have. So the readout
// comes back through its own server action and is shown here.
function HoodReadout({ state, onClose }) {
  const readout = state?.readout ?? null;

  return (
    <Modal open title={readout?.name ?? "Look at ‡"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Looking… ‡</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {/* The SAME readout the sheet's Look at dialog draws
            (web/app/components/ExamineDialog.js) — the face, the appearance,
            the tags. There were three hand-rolled copies of that block and
            the hood's was the poorest of them, which meant looking at a
            stranger told you less than looking at a neighbour for no reason
            anybody had decided. db/lib/examine.js still decides WHAT a hood
            gives away; this only draws it. */}
        {readout && <Readout readout={readout} />}
      </div>
    </Modal>
  );
}

// How often the column re-reads who is standing here. The same minute
// YouPanel.js polls its own list on, and for the same reason: this is a
// server prop off page.js, so without it somebody walking up to you never
// appeared until you reloaded. The strip does not poll — it is the phone's
// copy of the same list, and one poller per screen is enough.
const HERE_POLL_MS = 60_000;

export default function HereList({ people, selfId, strip = false, onConverse = null, poll = false }) {
  // Seeded from the server and replaced by the poll. HallAside keys this
  // component on the server list, so a move remounts it with the new street's
  // people rather than leaving a stale poll answer in place.
  const [live, setLive] = useState(people);
  const named = live?.named ?? [];
  const concealed = live?.concealed ?? [];
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (!poll) return undefined;
    const timer = setInterval(() => {
      loadPeopleHere()
        .then((res) => {
          if (res?.ok) setLive({ named: res.named, concealed: res.concealed });
        })
        .catch(() => {
          // A missed read costs one stale minute. The next one fixes it.
        });
    }, HERE_POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);
  const [hood, setHood] = useState(null);
  const actions = useRequestActions();
  // The one place a click outside has to close something. Kept on the
  // wrapper rather than on the document: the menu is inside the column, and
  // a document listener would need an effect to attach.
  const wrapRef = useRef(null);

  const close = useCallback(() => setOpenId(null), []);

  const lookAt = useCallback(
    (characterId) => {
      close();
      actions?.open?.("examine", null, { targetId: characterId });
    },
    [actions, close],
  );

  // Fetch-then-set, from a click rather than an effect: the readout is one
  // round trip and the dialog is open the whole time it is in flight.
  const lookAtHood = useCallback(
    (token) => {
      close();
      setHood({ loading: true });
      examineHooded(token)
        .then((res) => {
          if (res?.ok) setHood({ readout: res.readout });
          else setHood({ error: res?.error ?? "You can't see them. ‡" });
        })
        .catch(() => setHood({ error: "You can't see them. ‡" }));
    },
    [close],
  );

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
          <div className={strip ? undefined : "hall-person-row"}>
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
            {!strip && person.characterId !== selfId && (
              <span className="hall-person-eye">
                <IconButton icon={EyeIcon} label="Look at ‡" onClick={() => lookAt(person.characterId)} />
              </span>
            )}
          </div>
          {openId === person.characterId && (
            <PersonMenu person={person} onClose={close} onConverse={onConverse} />
          )}
        </div>
      ))}

      {/* Keyed by POSITION rather than by token: db/lib/whosHere.js mints no
          token at all when there is no AUTH_SECRET to key the HMAC with, and
          two hoods would then share the key `hooded-null`. The eye still
          draws — looking through a null token gets the refusal the server
          already answers a bad one with. */}
      {concealed.map((person, index) => (
        <div key={`hooded-${index}`} className="hall-person-wrap">
          <div className={strip ? undefined : "hall-person-row"}>
            <button
              type="button"
              className="hall-person"
              aria-haspopup="menu"
              aria-expanded={openId === `hooded-${index}`}
              onClick={() => setOpenId(openId === `hooded-${index}` ? null : `hooded-${index}`)}
            >
              <CharacterAvatar characterId={null} name={person.alias} size={24} />
              {!strip && <span className="hall-person-name text-muted">{person.alias}</span>}
            </button>
            {!strip && (
              <span className="hall-person-eye">
                <IconButton icon={EyeIcon} label="Look at ‡" onClick={() => lookAtHood(person.token)} />
              </span>
            )}
          </div>
          {openId === `hooded-${index}` && onConverse && (
            <div className="hall-menu" role="menu" aria-label={person.alias}>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  // No id under a hood, so nobody to tick — the dialog opens
                  // the way the place card's Converse opens it.
                  onConverse();
                }}
              >
                Converse ‡
              </button>
            </div>
          )}
        </div>
      ))}

      {hood && <HoodReadout state={hood} onClose={() => setHood(null)} />}
    </div>
  );
}
