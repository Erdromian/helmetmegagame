"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import { NoticeText } from "./NoticeCards";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  loadAffordances,
  flipGate,
  holdKeyed,
  readBoard,
  readNotice,
  tearNotice,
  pinNotice,
  converseRooms,
  openConversation,
  ringBell,
  turretState,
  toggleTurret,
  speakOnIntercom,
} from "./actions";

// THE PLACE's dialogs, and the one hook that owns them.
//
// This file used to draw a panel of its own: every affordance
// db/lib/placeAffordances.js#affordancesFor returned, as one flat strip of
// buttons. That was the Discord anchor's shape rendered verbatim, Intercom
// and all six Storage buttons at once, and it is gone. The affordances are
// now split across the column by what they belong to — the Location's own on
// PlaceCard.js, the OPEN room's on RoomPanel.js, Converse on a person's row
// in HereList.js, Travel on TravelNodes.js.
//
// What survives is the part that was never the panel's shape: the dialogs,
// and the refresh rule. Anything that changes a label a button wears — a gate
// now shut, a door now held — re-reads the whole list rather than patching a
// row, which is what keeps this column and the anchor saying the same thing.
//
// Each dialog's work is a server action in ./actions.js. None of them trusts
// what this component sent: standing in the room is re-checked there every
// time, because a dialog outlives somebody walking out of it.

// The button tone an affordance asks for, as a class. Shared by the two
// panels that draw fixtures — PlaceCard.js for the Location's own and
// RoomPanel.js for the open room's — because a Location's danger button and a
// room's should never be able to look different.
export const TONE_CLASS = { go: "btn", danger: "btn-danger", plain: "btn-secondary" };

// ONE instance of this, in HallAside.js. The affordance list, the notice and
// the open dialog are shared by every section of the column, so a gate opened
// from the place card relabels itself and a room's Intercom and the card's
// noticeboard cannot both be open at once.
export function usePlaceActions(initialAffordances, onChanged) {
  const [affordances, setAffordances] = useState(initialAffordances ?? []);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const { run, pending, error, setError } = useActionRunner();
  const confirm = useConfirm();

  const refresh = useCallback(() => {
    loadAffordances()
      .then((res) => {
        if (res?.ok) setAffordances(res.affordances);
      })
      .catch(() => {
        // A stale button refuses on the server; nothing worth a sentence.
      });
  }, []);

  const say = useCallback(
    (res) => {
      setNotice([res.line, res.note].filter(Boolean).join(" ") || null);
      refresh();
      // Anything else on the page that is drawn off the same place — the
      // noticeboard cards pinned to the top of the Location's feed are the
      // one so far — is told to re-read. A pin made in this dialog and a
      // card in the street are the same board.
      onChanged?.(res);
    },
    [refresh, onChanged],
  );

  const openFixture = useCallback(
    async (entry) => {
      setError(null);
      setNotice(null);
      if (entry.kind === "gate") {
        const ask = entry.isOpen
          ? { title: "Shut the way?", message: `The way to ${entry.farName} closes. ‡`, confirmLabel: "Shut it" }
          : { title: "Open the way?", message: `The way to ${entry.farName} opens. ‡`, confirmLabel: "Open it" };
        // Confirm first, transition second — never inside startTransition
        // (DESIGN-SYSTEM.md §8).
        if (!(await confirm(ask))) return;
        run(flipGate, entry.linkId, { onOk: say });
        return;
      }
      if (entry.kind === "keyed") {
        if (entry.held) {
          setNotice(`The way to ${entry.farName} is already being held open. ‡`);
          return;
        }
        run(holdKeyed, entry.linkId, { onOk: say });
        return;
      }
      // Everything left is a dialog named by its own id: gates and keyed
      // doors have already returned above, and they were the only branch a
      // mapping function had.
      setDialog({ kind: entry.id, entry });
    },
    [confirm, run, say, setError],
  );

  // Converse hangs off a person's row now rather than a button of its own:
  // it is a corner you take somebody into, so the place to ask for one is
  // beside the somebody.
  //
  // `person` is whoever's row it was opened from — {id, name} — so the dialog
  // opens with them already ticked. The place card's own Converse passes
  // nothing, and so does a hood's, which has no id to tick.
  const openConverse = useCallback(
    (person = null) => {
      setError(null);
      setNotice(null);
      setDialog({ kind: "converse", entry: null, person: person?.id ? person : null });
    },
    [setError],
  );

  const close = useCallback(() => {
    setDialog(null);
    setError(null);
  }, [setError]);

  const dialogs = (
    <>
      {dialog?.kind === "noticeboard" && <NoticeboardDialog onClose={close} onDone={say} />}
      {dialog?.kind === "converse" && (
        <ConverseDialog person={dialog.person} onClose={close} onDone={say} />
      )}
      {dialog?.kind === "bell" && <BellDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "turret" && <TurretDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "intercom" && <IntercomDialog entry={dialog.entry} onClose={close} onDone={say} />}
    </>
  );

  return { affordances, openFixture, openConverse, say, notice, error, pending, dialogs };
}

// ------------------------------------------------------------- noticeboard

function NoticeboardDialog({ onClose, onDone }) {
  const [board, setBoard] = useState(null);
  const [reading, setReading] = useState(null);
  const [pinId, setPinId] = useState("");
  const { run, pending, error } = useActionRunner();

  const load = useCallback(() => {
    readBoard()
      .then(setBoard)
      .catch(() => setBoard({ ok: false, error: "Couldn't read the board." }));
  }, []);

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
        <div key={notice.id} className="hall-notice-row">
          <span className="hall-person-name">{notice.name}</span>
          <button
            type="button"
            className="menu-item"
            disabled={pending}
            onClick={() => run(readNotice, notice.id, { onOk: setReading })}
          >
            Read
          </button>
          <button
            type="button"
            className="menu-item"
            disabled={pending}
            onClick={() =>
              run(tearNotice, notice.id, {
                onOk: (res) => {
                  onDone(res);
                  load();
                },
              })
            }
          >
            Tear down
          </button>
        </div>
      ))}

      {/* The same block the feed's notice cards draw (NoticeCards.js), so a
          paper read from the street and one read from this dialog are one
          rendering. A sealed or unreadable one comes back as the refusal
          instead, in the same shape, so nobody watching learns which it
          was. */}
      <NoticeText reading={reading} />

      {board.holding.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor="hall-pin">
            Pin a paper
          </label>
          <Select id="hall-pin" value={pinId} onChange={(e) => setPinId(e.target.value)}>
            <option value="">Pick one…</option>
            {board.holding.map((paper) => (
              <option key={paper.tagId} value={paper.tagId}>
                {paper.name}
                {paper.sealed ? " — sealed" : ""}
              </option>
            ))}
          </Select>
        </div>
      )}

      <FormError>{error}</FormError>
      {board.holding.length > 0 && (
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={!pinId || pending}
            onClick={() =>
              run(pinNotice, pinId, {
                onOk: (res) => {
                  setPinId("");
                  onDone(res);
                  load();
                },
              })
            }
          >
            Pin it
          </button>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- converse

// Exported for Hall.js: the `/converse` command opens this same dialog from
// the composer, and on a phone the right column that owns it is not even
// mounted (Hall.js). One dialog either way — a second copy of the room picker
// and the invite list would be two answers to one question.
export function ConverseDialog({ person = null, onClose, onDone }) {
  const [rooms, setRooms] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  // Opened from somebody's row: they are in it unless you untick them. The
  // server re-checks that they are ALIVE and standing here before it writes
  // the membership row, so this chip is a tick and never a lock.
  const [invited, setInvited] = useState(person?.id ? true : false);
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    converseRooms()
      .then((res) => {
        if (!cancelled) setRooms(res);
      })
      .catch(() => {
        if (!cancelled) setRooms({ ok: false, error: "Couldn't find a room." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal open title="Converse" onClose={onClose}>
      <p className="text-sm text-muted">That room hears that someone is whispering, never who. ‡</p>
      {!rooms && <p className="text-sm text-muted">Looking for a corner…</p>}
      {rooms && !rooms.ok && <FormError>{rooms.error}</FormError>}
      {rooms?.ok && rooms.rooms.length === 0 && (
        <EmptyState>There&apos;s no room here to hold a conversation in. ‡</EmptyState>
      )}
      {rooms?.ok && rooms.rooms.length > 0 && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="hall-converse-room">
              Which room is this linked to? ‡
            </label>
            <Select id="hall-converse-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Pick a room…</option>
              {rooms.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                  {room.private ? " — private" : ""}
                </option>
              ))}
            </Select>
          </div>
          {person?.id && (
            <div className="chip-row" role="group" aria-label="Who comes with you">
              <button
                type="button"
                className="chip"
                data-active={invited ? "true" : undefined}
                aria-pressed={invited}
                onClick={() => setInvited((on) => !on)}
              >
                {person.name}
              </button>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="hall-converse-name">
              Call it what?
            </label>
            <input
              id="hall-converse-name"
              value={name}
              maxLength={90}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <FormError>{error}</FormError>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              disabled={!roomId || !name.trim() || pending}
              onClick={() =>
                run(openConversation, { roomId, name, inviteIds: invited && person?.id ? [person.id] : [] }, {
                  onOk: (res) => {
                    onDone(res);
                    onClose();
                  },
                })
              }
            >
              Open it
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------- the rope, the PA,
// -------------------------------------------------------------- and the gun

// One shape for the two confirms that ask for a typed word. It is deliberate
// friction, not a password: the server forgives case and stray spaces, and
// the word is the place to say in plain words what is about to happen.
function WordDialog({ title, word, help, danger, onClose, onSubmit, pending, error }) {
  const [typed, setTyped] = useState("");
  return (
    <Modal open title={title} onClose={onClose}>
      <p className="text-sm text-muted">{help}</p>
      <div className="field">
        <label className="field-label" htmlFor="hall-word">
          Type {word} to confirm
        </label>
        <input id="hall-word" value={typed} maxLength={16} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className={danger ? "btn-danger" : "btn"}
          disabled={!typed.trim() || pending}
          onClick={() => onSubmit(typed)}
        >
          {title}
        </button>
      </div>
    </Modal>
  );
}

function BellDialog({ entry, onClose, onDone }) {
  const { run, pending, error } = useActionRunner();
  return (
    <WordDialog
      title="Sound the bell"
      word="RING"
      help="Heard for a long way around, loudest near the Cathedral. Nobody is pinged. ‡"
      onClose={onClose}
      pending={pending}
      error={error}
      onSubmit={(word) =>
        run(ringBell, { roomId: entry.roomId, word }, {
          onOk: (res) => {
            onDone(res);
            onClose();
          },
        })
      }
    />
  );
}

function TurretDialog({ entry, onClose, onDone }) {
  const [state, setState] = useState(null);
  const { run, pending, error } = useActionRunner();

  // Read on open, so the confirm asks for the word that matches which way the
  // switch is thrown right now — and re-read on the server, because two
  // people in the office can open this in the same moment.
  useEffect(() => {
    let cancelled = false;
    turretState(entry.roomId)
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: "The panel is dead." });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.roomId]);

  if (!state) {
    return (
      <Modal open title="The turret" onClose={onClose}>
        <p className="text-sm text-muted">Reading the panel…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title="The turret" onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  return (
    <WordDialog
      title={state.armed ? "Disarm the turret" : "Arm the turret"}
      word={state.word}
      danger={!state.armed}
      help={
        state.armed
          ? "The barrels drop and the yard is safe to cross again. ‡"
          : "It fires on everyone standing in the Gatehouse — the Cerberon, the Baron, you. Armour helps; a name does not. ‡"
      }
      onClose={onClose}
      pending={pending}
      error={error}
      onSubmit={(word) =>
        run(toggleTurret, { roomId: entry.roomId, word }, {
          onOk: (res) => {
            onDone(res);
            onClose();
          },
        })
      }
    />
  );
}

function IntercomDialog({ entry, onClose, onDone }) {
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  return (
    <Modal open title="Intercom" onClose={onClose}>
      <p className="text-sm text-muted">
        Heard in every zone that has a speaker, and everyone is pinged. Nobody is told who spoke. ‡
      </p>
      <div className="field">
        <label className="field-label" htmlFor="hall-pa">
          What goes out
        </label>
        <textarea id="hall-pa" rows={3} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!body.trim() || pending}
          onClick={() =>
            run(speakOnIntercom, { roomId: entry.roomId, body }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Speak
        </button>
      </div>
    </Modal>
  );
}
