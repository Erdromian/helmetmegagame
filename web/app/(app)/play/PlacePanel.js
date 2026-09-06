"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import {
  loadAffordances,
  examineHere,
  readStash,
  loadTravel,
  travelTo,
  turnBackTravel,
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

// THE PLACE: every button the Location's pinned anchor and the Room starters
// carry on Discord, as web dialogs.
//
// The LIST is not written here. It comes from
// db/lib/placeAffordances.js#affordancesFor, which is also what
// db/lib/locationAnchorRow.js and db/lib/roomStarterRow.js draw their buttons
// from — so a place that grew a noticeboard grows one on both faces, and a
// new affordance is one entry in that catalog rather than two lists to keep
// in step.
//
// Each dialog's work is a server action in ./actions.js. None of them trusts
// what this component sent: standing in the room is re-checked there every
// time, because a dialog outlives somebody walking out of it.

const TONE_CLASS = { go: "btn", danger: "btn-danger", plain: "btn-secondary" };

// The affordances that open a dialog of their own, and the ones that are a
// single click. Anything not named here is handled by its `kind`.
function dialogFor(entry) {
  if (entry.kind === "gate" || entry.kind === "keyed") return null;
  return entry.id;
}

function Readout({ title, lines, onClose }) {
  return (
    <Modal open title={title} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <p key={index} className="text-sm">
            {line}
          </p>
        ))}
      </div>
    </Modal>
  );
}

export default function PlacePanel({ initialAffordances, place, rooms = 0, exits = 0 }) {
  const [affordances, setAffordances] = useState(initialAffordances ?? []);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const { run, pending, error, setError } = useActionRunner();
  const confirm = useConfirm();
  const actions = useRequestActions();

  // Anything that changes a label a button wears — a gate now shut, a door
  // now held — re-reads the whole list rather than patching one row, which
  // is what keeps this panel and the anchor saying the same thing.
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
      setNotice([res.line, res.note].filter(Boolean).join(" "));
      refresh();
    },
    [refresh],
  );

  const onClick = useCallback(
    async (entry) => {
      setError(null);
      setNotice(null);
      if (entry.kind === "gate") {
        const ask = entry.isOpen
          ? { title: "Shut the way? ‡", message: `The way to ${entry.farName} closes. ‡`, confirmLabel: "Shut it ‡" }
          : { title: "Open the way? ‡", message: `The way to ${entry.farName} opens. ‡`, confirmLabel: "Open it ‡" };
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
      setDialog({ kind: dialogFor(entry), entry });
    },
    [confirm, run, say, setError],
  );

  const close = useCallback(() => {
    setDialog(null);
    setError(null);
  }, [setError]);

  return (
    <div className="hall-place-panel">
      <p className="hall-section-title">{place?.name ?? "Here ‡"}</p>
      <p className="hall-quiet-line">
        {rooms} room{rooms === 1 ? "" : "s"} · {exits} exit{exits === 1 ? "" : "s"} ‡
      </p>

      {affordances.length === 0 ? (
        <EmptyState>There is nothing to work here. ‡</EmptyState>
      ) : (
        <div className="hall-buttons">
          {affordances.map((entry) => (
            <button
              key={`${entry.id}:${entry.linkId ?? entry.roomId ?? "place"}`}
              type="button"
              className={TONE_CLASS[entry.tone] ?? "btn-secondary"}
              disabled={pending}
              onClick={() => onClick(entry)}
            >
              {entry.roomName && entry.id === "storage" ? `Storage · ${entry.roomName}` : entry.label}
            </button>
          ))}
        </div>
      )}

      {notice && <p className="hall-quiet-line">{notice}</p>}
      <FormError>{error}</FormError>

      {dialog?.kind === "travel" && <TravelDialog onClose={close} onDone={say} />}
      {dialog?.kind === "examine" && <ExamineHereDialog onClose={close} />}
      {dialog?.kind === "storage" && (
        <StorageDialog entry={dialog.entry} onClose={close} onTransfer={() => actions?.open?.("transfer")} />
      )}
      {dialog?.kind === "noticeboard" && <NoticeboardDialog onClose={close} onDone={say} />}
      {dialog?.kind === "converse" && <ConverseDialog onClose={close} onDone={say} />}
      {dialog?.kind === "bell" && <BellDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "turret" && <TurretDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "intercom" && <IntercomDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "whosHere" && (
        <Modal open title="Who's here? ‡" onClose={close}>
          <p className="text-sm text-muted">Everyone standing here is in the column beside you. ‡</p>
        </Modal>
      )}
      {dialog?.kind === "secretRooms" && (
        <Modal open title="Secret rooms? ‡" onClose={close}>
          <p className="text-sm text-muted">
            Every room a key of yours opens is already in your places, on the left. ‡
          </p>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ travel

function TravelDialog({ onClose, onDone }) {
  const [data, setData] = useState(null);
  const [target, setTarget] = useState("");
  const [dragged, setDragged] = useState([]);
  const { run, pending, error } = useActionRunner();

  // Loaded on open rather than with the page: an exit's state moves under a
  // player standing still, and a stale list would offer a shut gate.
  useEffect(() => {
    let cancelled = false;
    loadTravel()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the ways out. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDrag = (id) =>
    setDragged((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (!data) {
    return (
      <Modal open title="Travel" onClose={onClose}>
        <p className="text-sm text-muted">Reading the road… ‡</p>
      </Modal>
    );
  }
  if (!data.ok) {
    return (
      <Modal open title="Travel" onClose={onClose}>
        <FormError>{data.error}</FormError>
      </Modal>
    );
  }

  // Already walking: a paid crossing is a day on the road, and the only thing
  // on offer is turning round (MAP.md §3).
  if (data.heading) {
    return (
      <Modal open title="Travel" onClose={onClose}>
        <p className="text-sm">You are on the road to {data.heading}. You arrive next turn. ‡</p>
        <FormError>{error}</FormError>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() =>
              run(turnBackTravel, undefined, {
                onOk: (res) => {
                  onDone(res);
                  onClose();
                },
              })
            }
          >
            Turn back ‡
          </button>
        </div>
      </Modal>
    );
  }

  const chosen = data.options.find((o) => o.id === target) ?? null;

  return (
    <Modal open title="Travel" onClose={onClose}>
      <div className="field">
        <label className="field-label" htmlFor="hall-travel">
          Where to? ‡
        </label>
        <Select id="hall-travel" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Pick a way out… ‡</option>
          {data.options.map((option) => (
            <option key={option.id} value={option.id} disabled={!option.passable}>
              {option.name}
              {option.crossesZone && option.zoneName ? ` — into ${option.zoneName}` : ""}
              {option.passable ? "" : " — shut"}
            </option>
          ))}
        </Select>
      </div>

      {chosen?.crossesZone && (
        <p className="text-sm text-muted">
          {data.freeReason
            ? `${data.freeReason} ‡`
            : data.freeLeft > 0
              ? `${data.freeLeft} free ${data.freeLeft === 1 ? "crossing" : "crossings"} left this turn. ‡`
              : "This one costs your Move, and you arrive next turn. ‡"}
        </p>
      )}

      {data.drag.length > 0 && (
        <div className="chip-row" role="group" aria-label="Bring somebody ‡">
          {data.drag.map((person) => (
            <button
              key={person.id}
              type="button"
              className="chip"
              data-active={dragged.includes(person.id) ? "true" : undefined}
              aria-pressed={dragged.includes(person.id)}
              onClick={() => toggleDrag(person.id)}
            >
              {person.name}
            </button>
          ))}
        </div>
      )}

      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!target || pending}
          onClick={() =>
            run(travelTo, { locationId: target, draggedIds: dragged }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Go ‡
        </button>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- examine

function ExamineHereDialog({ onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    examineHere()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't take it in. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <Modal open title="Examine" onClose={onClose}>
        <p className="text-sm text-muted">Looking around… ‡</p>
      </Modal>
    );
  }
  if (!data.ok) {
    return (
      <Modal open title="Examine" onClose={onClose}>
        <FormError>{data.error}</FormError>
      </Modal>
    );
  }
  return <Readout title={data.name} lines={data.lines} onClose={onClose} />;
}

// ----------------------------------------------------------------- storage

function StorageDialog({ entry, onClose, onTransfer }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    readStash(entry.roomId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't see in there. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.roomId]);

  return (
    <Modal open title={data?.name ?? "Storage"} onClose={onClose}>
      {!data && <p className="text-sm text-muted">Looking… ‡</p>}
      {data && !data.ok && <FormError>{data.error}</FormError>}
      {data?.ok && <p className="text-sm">{data.line}</p>}
      {data?.ok && (
        <div className="modal-actions">
          {/* The same Transfer dialog the sheet has — a room stash is one of
              its destinations, so there is nothing here to fork. */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              onClose();
              onTransfer();
            }}
          >
            Move things ‡
          </button>
        </div>
      )}
    </Modal>
  );
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
      .catch(() => setBoard({ ok: false, error: "Couldn't read the board. ‡" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!board) {
    return (
      <Modal open title="Noticeboard" onClose={onClose}>
        <p className="text-sm text-muted">Reading the board… ‡</p>
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

      {board.notices.length === 0 && <EmptyState>Nothing is up. ‡</EmptyState>}
      {board.notices.map((notice) => (
        <div key={notice.id} className="hall-notice-row">
          <span className="hall-person-name">{notice.name}</span>
          <button
            type="button"
            className="menu-item"
            disabled={pending}
            onClick={() => run(readNotice, notice.id, { onOk: setReading })}
          >
            Read ‡
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
            Tear down ‡
          </button>
        </div>
      ))}

      {/* A notice is shown as written, in a plain block, so nothing on it can
          render as markup or ping anybody. A sealed or unreadable one comes
          back as the refusal instead, in the same shape, so nobody watching
          learns which it was. */}
      {reading?.ok && (
        <div className="field">
          <span className="field-label">{reading.name}</span>
          {reading.plain ? <p className="text-sm">{reading.text}</p> : <pre className="hall-notice-text">{reading.text}</pre>}
        </div>
      )}

      {board.holding.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor="hall-pin">
            Pin a paper ‡
          </label>
          <Select id="hall-pin" value={pinId} onChange={(e) => setPinId(e.target.value)}>
            <option value="">Pick one… ‡</option>
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
            Pin it ‡
          </button>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- converse

function ConverseDialog({ onClose, onDone }) {
  const [rooms, setRooms] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    converseRooms()
      .then((res) => {
        if (!cancelled) setRooms(res);
      })
      .catch(() => {
        if (!cancelled) setRooms({ ok: false, error: "Couldn't find a room. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal open title="Converse" onClose={onClose}>
      <p className="text-sm text-muted">That room hears that someone is whispering, never who. ‡</p>
      {!rooms && <p className="text-sm text-muted">Looking for a corner… ‡</p>}
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
              <option value="">Pick a room… ‡</option>
              {rooms.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                  {room.private ? " — private" : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="hall-converse-name">
              Call it what? ‡
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
                run(openConversation, { roomId, name }, {
                  onOk: (res) => {
                    onDone(res);
                    onClose();
                  },
                })
              }
            >
              Open it ‡
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
          Type {word} to confirm ‡
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
      title="Sound the bell ‡"
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
        if (!cancelled) setState({ ok: false, error: "The panel is dead. ‡" });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.roomId]);

  if (!state) {
    return (
      <Modal open title="The turret ‡" onClose={onClose}>
        <p className="text-sm text-muted">Reading the panel… ‡</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title="The turret ‡" onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  return (
    <WordDialog
      title={state.armed ? "Disarm the turret ‡" : "Arm the turret ‡"}
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
          What goes out ‡
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
          Speak ‡
        </button>
      </div>
    </Modal>
  );
}
