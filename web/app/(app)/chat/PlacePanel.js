"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import { NoticeText } from "./NoticeCards";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { INTERACT_PROMPT, INTENTION_MAX, QUEST_INTERACT_PREFIX } from "@lifeweb/db/lib/questText";
import { SLOT_PROMPT } from "@lifeweb/db/lib/slotText";
import { PHONE_TEXT, PHONE_DIGITS, clockLeft } from "@lifeweb/db/lib/phoneText";
import { NUKE_TEXT, NUKE_CODE_DIGITS } from "@lifeweb/db/lib/nukeText";
import { usePhoneFrame, noteHandset, setDialling } from "@/app/components/phoneStore";
import { playSfx } from "@/app/components/sfx";
import { RING_TEXT } from "@lifeweb/db/lib/ringText";
// The machine's words AND its clock — the countdown is derived here the same
// way the server derives it, off one implementation (docs/systemdocs/VENDING.md).
import { VENDING_TEXT, VENDING_MAX_PRICE, secondsLeftOn, timeLeftLine } from "@lifeweb/db/lib/vendingText";
import { BLACK_MARKET_TEXT } from "@lifeweb/db/lib/blackMarketText";
import { MERCHANT_TERMINAL_TEXT, withTax } from "@lifeweb/db/lib/merchantTerminalText";
import { GATEHOUSE_TEXT } from "@lifeweb/db/lib/gatehouseText";
import { controlThing } from "@lifeweb/db/lib/gateControls";
import { PassageDialog, ProcessRequestsDialog, DocumentsDialog } from "./GatehouseDialogs";
import MeisterTerminalDialog from "./MeisterTerminalDialog";
import { gateSubmitDocumentation } from "./gatehouseActions";
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
  pray,
  playSlots,
  turretState,
  toggleTurret,
  speakOnIntercom,
  openPhone,
  dialPhone,
  answerPhone,
  hangUpPhone,
  walkAwayPhone,
  insertPhoneObol,
  nukeState,
  nukeCheckCode,
  nukePressButton,
  interactWithQuest,
  openMachine,
  readMachine,
  leaveMachine,
  vendInsert,
  vendWithdraw,
  vendBuy,
  vendUnlock,
  vendLock,
  vendCollect,
  vendStockIn,
  vendStockOut,
  vendSetPrice,
  vendStockables,
  blackMarketView,
  blackMarketInsert,
  blackMarketBuy,
  merchantTerminalView,
  merchantTerminalInsert,
  merchantTerminalWithdraw,
  merchantTerminalOrder,
  merchantTerminalEditOrder,
  merchantTerminalRemoveOrder,
  enterTheCharon,
  leaveTheCharon,
  launchTheCharon,
  sleepInTheCharon,
} from "./actions";
import {
  depotCounterState,
  depotBank,
  depotSend,
  depotTurret,
  depotTurretRead,
} from "./counterActions";

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

// ONE instance of this, in ChatAside.js. The affordance list, the notice and
// the open dialog are shared by every section of the column, so a gate opened
// from the place card relabels itself and a room's Intercom and the card's
// noticeboard cannot both be open at once.
export function usePlaceActions(initialAffordances, onChanged) {
  const [affordances, setAffordances] = useState(initialAffordances ?? []);
  // A fresh list from the server replaces whatever this hook was holding.
  // useState reads its argument once, so without this a router.refresh()
  // after travelling from the map, a move made on Discord or a key picked up
  // left the column drawing the LAST place's room buttons — walk into the
  // Baron's Study and there was no Phone until the page was reloaded.
  // Adjusted during render rather than in an effect (set-state-in-effect).
  const [fromServer, setFromServer] = useState(initialAffordances);
  if (initialAffordances !== fromServer) {
    setFromServer(initialAffordances);
    setAffordances(initialAffordances ?? []);
  }
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
      // The Town Gatehouse's lever (db/lib/gateControls.js) is a gate button
      // drawn in its room rather than on the place card; it flips the same way.
      if (entry.kind === "gate" || entry.id === "gateLever") {
        // A room that named its control is asked about that ("The shutters
        // come down"), not about a way to somewhere — db/lib/placeAffordances.js.
        const thing = controlThing(entry.control) ?? `The way to ${entry.farName}`;
        const ask = entry.isOpen
          ? { title: "Shut it?", message: `${thing} closes.`, confirmLabel: "Shut it" }
          : { title: "Open it?", message: `${thing} opens.`, confirmLabel: "Open it" };
        // Confirm first, transition second — never inside startTransition
        // (DESIGN-SYSTEM.md §8).
        if (!(await confirm(ask))) return;
        run(flipGate, entry.linkId, { onOk: say });
        return;
      }
      if (entry.kind === "keyed") {
        if (entry.held) {
          setNotice(`The way to ${entry.farName} is already being held open.`);
          return;
        }
        run(holdKeyed, entry.linkId, { onOk: say });
        return;
      }
      // The Gate's finger-prick (docs/systemdocs/GATEHOUSE.md): the shared
      // confirm says what it does, and there is nothing else to ask.
      if (entry.id === "submitDocumentation") {
        const ask = {
          title: GATEHOUSE_TEXT.documentTitle,
          message: GATEHOUSE_TEXT.documentConfirm,
          confirmLabel: GATEHOUSE_TEXT.documentConfirmLabel,
        };
        if (!(await confirm(ask))) return;
        run(gateSubmitDocumentation, undefined, { onOk: say });
        return;
      }
      // The Charon (docs/systemdocs/CHARON.md). Four buttons and no dialogs:
      // two are plain verbs, and the two that cannot be taken back ask through
      // the shared confirm rather than a one-off modal of their own.
      if (entry.id === "charonEnter") {
        run(enterTheCharon, { roomId: entry.roomId }, { onOk: say });
        return;
      }
      if (entry.id === "charonLeave") {
        run(leaveTheCharon, { onOk: say });
        return;
      }
      if (entry.id === "charonLaunch") {
        // Confirm first, transition second — never inside startTransition
        // (DESIGN-SYSTEM.md §8), same as the gate above.
        if (!(await confirm({ message: "Launch the Charon? This is irreversible.", confirmLabel: "Launch" }))) {
          return;
        }
        run(launchTheCharon, { roomId: entry.roomId }, { onOk: say });
        return;
      }
      if (entry.id === "charonSleep") {
        const ask = {
          message: "Go to sleep and await the shuttle's docking, allowing you to respawn. This is irreversible.",
          confirmLabel: "Sleep",
        };
        if (!(await confirm(ask))) return;
        run(sleepInTheCharon, { roomId: entry.roomId }, { onOk: say });
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
  // `person` is whoever's row it was opened from — { ref, name } — so the
  // dialog opens with them already ticked. `ref` is a character id, or
  // "hood:<token>" for somebody standing there in a mask: taking a stranger
  // aside is a thing you can do without knowing their name, and having to ask
  // them to lift the helmet first is the disguise undone. The place card's
  // own Converse passes nothing.
  const openConverse = useCallback(
    (person = null) => {
      setError(null);
      setNotice(null);
      setDialog({ kind: "converse", entry: null, person: person?.ref ? person : null });
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
      {dialog?.kind === "pray" && <PrayDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "slots" && <SlotDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "vending" && <VendingDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "blackMarket" && <BlackMarketDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "requestPassage" && <PassageDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "processRequests" && <ProcessRequestsDialog onClose={close} onDone={say} />}
      {dialog?.kind === "createDocuments" && <DocumentsDialog onClose={close} onDone={say} />}
      {dialog?.kind === "merchantTerminal" && <MerchantTerminalDialog onClose={close} onDone={say} />}
      {dialog?.kind === "meisterTerminal" && <MeisterTerminalDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "turret" && <TurretDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "infoterminal" && <InfoterminalDialog onClose={close} onDone={say} />}
      {dialog?.kind === "depotTurret" && <DepotTurretDialog onClose={close} onDone={say} />}
      {dialog?.kind === "phone" && <PhoneDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "nuke" && <NukeDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "intercom" && <IntercomDialog entry={dialog.entry} onClose={close} onDone={say} />}
      {dialog?.kind === "questInteract" && (
        <QuestInteractDialog entry={dialog.entry} onClose={close} onDone={say} />
      )}
    </>
  );

  // The phone in this character's hand, if any — drawn under the place card by
  // both asides, so the keypad is one click away after its dialog is closed.
  const phoneBar = <PhoneHandsetBar affordances={affordances} onOpen={openFixture} onDone={say} />;

  return { affordances, openFixture, openConverse, say, notice, error, pending, dialogs, phoneBar };
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
        <div key={notice.id} className="chat-notice-row">
          <span className="chat-person-name">{notice.name}</span>
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
          <label className="field-label" htmlFor="chat-pin">
            Pin a paper
          </label>
          <Select id="chat-pin" value={pinId} onChange={(e) => setPinId(e.target.value)}>
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

// Exported for Chat.js: the `/converse` command opens this same dialog from
// the composer, and on a phone the right column that owns it is not even
// mounted (Chat.js). One dialog either way — a second copy of the room picker
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
      <p className="text-sm text-muted">Speak privately with someone.</p>
      {!rooms && <p className="text-sm text-muted">Looking for a corner…</p>}
      {rooms && !rooms.ok && <FormError>{rooms.error}</FormError>}
      {rooms?.ok && rooms.rooms.length === 0 && (
        <EmptyState>There&apos;s no room here to hold a conversation in.</EmptyState>
      )}
      {rooms?.ok && rooms.rooms.length > 0 && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="chat-converse-room">
              Where?
            </label>
            <Select id="chat-converse-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Pick a room…</option>
              {rooms.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                  {room.private ? " — private" : ""}
                </option>
              ))}
            </Select>
          </div>
          {person?.ref && (
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
            <label className="field-label" htmlFor="chat-converse-name">
              Call it what?
            </label>
            <input
              id="chat-converse-name"
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
                run(openConversation, { roomId, name, inviteRefs: invited && person?.ref ? [person.ref] : [] }, {
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
        <label className="field-label" htmlFor="chat-word">
          Type {word} to confirm
        </label>
        <input id="chat-word" value={typed} maxLength={16} onChange={(e) => setTyped(e.target.value)} />
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

// Pray, at the Shrine of an Old Man. A plain confirm rather than the bell's
// WordDialog, on purpose: typing RING is a speed bump on a LOUD act, and this
// one disturbs nobody. What it does is permanent, takes whatever the character
// believed in, and puts them on a table that can kill them — so the friction
// that fits is being TOLD that, which is all this dialog is.
function PrayDialog({ entry, onClose, onDone }) {
  const { run, pending, error } = useActionRunner();
  return (
    <Modal open title="Pray" onClose={onClose}>
      <p className="text-sm text-muted">
        The face is waiting. Praying here is permanent, it takes whatever you believed in now, and
        what happens to you afterwards is not up to you.
      </p>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn-danger"
          disabled={pending}
          onClick={() =>
            run(pray, { roomId: entry.roomId }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Pray
        </button>
      </div>
    </Modal>
  );
}

// The Den's slot machine. One confirm, because the whole act is deciding to
// put five obols in — everything after that is the machine's business, and it
// tells the room what it did (db/lib/slotMachine.js).
function SlotDialog({ entry, onClose, onDone }) {
  const { run, pending, error } = useActionRunner();
  return (
    <Modal open title="The slot machine" onClose={onClose}>
      <p className="text-sm text-muted">{SLOT_PROMPT}</p>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            run(playSlots, { roomId: entry.roomId }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Enter coins
        </button>
      </div>
    </Modal>
  );
}

// The Black Market terminal in the Exactor's Office (docs/systemdocs/DEPOT.md
// §0n). Feed it obols, then order off its shelf; the goods are in your hands at
// once. It takes coin and never gives it back, so there is no Withdraw — the
// credit is shared by everybody whose ring works it. Every rule is in
// db/lib/blackMarket.js; this is the shape of the page.
function BlackMarketDialog({ entry, onClose, onDone }) {
  const T = BLACK_MARKET_TEXT;
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState(1);
  // tagId -> the quantity typed on its row. Empty means not in the cart.
  const [cart, setCart] = useState({});
  const { run, pending, error } = useActionRunner();
  const roomId = entry.roomId;

  useEffect(() => {
    let cancelled = false;
    blackMarketView({ roomId })
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: BLACK_MARKET_TEXT.noTerminal });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (!state) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <p className="text-sm text-muted">The screen flickers on…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  const wares = state.wares ?? [];
  const items = wares
    .map((w) => ({ ware: w, quantity: Math.trunc(Number(cart[w.id]) || 0) }))
    .filter((line) => line.quantity > 0);
  const total = items.reduce((sum, line) => sum + line.ware.price * line.quantity, 0);

  // Every verb re-reads the terminal: the credit is shared, and somebody else
  // may have spent it since this opened.
  const act = (fn, args, after) =>
    run(fn, { roomId, ...args }, {
      onOk: (res) => {
        onDone(res);
        after?.();
        blackMarketView({ roomId })
          .then((next) => setState(next?.ok ? next : { ok: false, error: next?.error ?? T.noTerminal }))
          .catch(() => {});
      },
    });

  return (
    <Modal open title={T.title} onClose={onClose}>
      <p className="text-sm text-muted">
        <span className="mono">{T.credit(state.credit)}</span> · {T.carrying(state.carrying)}
      </p>

      {/* Coin first, the way the machine is used: feed it, then order. */}
      <div className="field">
        <label className="field-label" htmlFor="chat-black-market-amount">
          {T.insertLabel}
        </label>
        <div className="flex items-center gap-3">
          <input
            id="chat-black-market-amount"
            type="number"
            className="w-24"
            min={1}
            max={Math.max(1, state.carrying)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || state.carrying <= 0}
            onClick={() => act(blackMarketInsert, { amount: Math.max(1, Number(amount) || 0) })}
          >
            {T.insertButton}
          </button>
        </div>
        <p className="text-sm text-muted">{T.noWithdraw}</p>
      </div>

      {wares.length === 0 && <EmptyState>{T.emptyShelf}</EmptyState>}
      {wares.map((ware) => (
        <div key={ware.id} className="chat-notice-row">
          <span className="chat-person-name" title={ware.description}>
            {ware.name}
          </span>
          <span className="mono text-sm text-muted">{ware.price} ¢</span>
          {ware.owned ? (
            <span className="text-sm text-muted">{T.owned}</span>
          ) : (
            // `control` because this input lives OUTSIDE a .field — without it
            // the box, border and background never apply.
            <input
              type="number"
              className="control w-16"
              min={0}
              max={ware.stackable ? 99 : 1}
              aria-label={`${T.quantityLabel} — ${ware.name}`}
              value={cart[ware.id] ?? ""}
              placeholder="0"
              onChange={(e) => setCart((c) => ({ ...c, [ware.id]: e.target.value }))}
            />
          )}
        </div>
      ))}

      <FormError>{error}</FormError>
      {/* Sticky: twenty-nine wares scroll the panel, and the total and Buy
          have to stay in sight while a cart is being filled. */}
      <div className="modal-actions modal-actions--sticky">
        <span className="mono text-sm mr-auto">{T.total(total)}</span>
        <button
          type="button"
          className="btn"
          disabled={pending || items.length === 0 || total > state.credit}
          onClick={() =>
            act(
              blackMarketBuy,
              { items: items.map((line) => ({ tagId: line.ware.id, quantity: line.quantity })) },
              () => setCart({}),
            )
          }
        >
          {T.buyButton}
        </button>
      </div>
    </Modal>
  );
}

// The Merchant's Terminal at the Depot (docs/systemdocs/DEPOT.md §0c). It opens
// locked for everybody; Unlock asks the server, which wants the Merchant's
// License in hand or the Merchant's ring on the finger. Two tabs: the shelf,
// grouped and foldable, with the coin slot above it; and the pending list,
// where an order can be changed or taken back until the train comes in. Every
// rule is in db/lib/merchantTerminal.js; this is the shape of the page.
function MerchantTerminalDialog({ onClose, onDone }) {
  const T = MERCHANT_TERMINAL_TEXT;
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("order");
  const [amount, setAmount] = useState(1);
  // tagId -> the quantity typed on its row. Empty means not in the cart.
  const [cart, setCart] = useState({});
  // orderId -> { tagId -> quantity } for a pending order being changed.
  const [edits, setEdits] = useState({});
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    merchantTerminalView({ unlock: false })
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: MERCHANT_TERMINAL_TEXT.jammed });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every write re-reads the terminal unlocked: its coin and its pending list
  // are shared, and somebody else may have changed either since this opened.
  const reread = () =>
    merchantTerminalView({ unlock: true })
      .then((next) => setState(next?.ok ? next : { ok: false, error: next?.error ?? T.jammed }))
      .catch(() => {});
  const act = (fn, args, after) =>
    run(fn, args, {
      onOk: (res) => {
        onDone(res);
        after?.();
        reread();
      },
    });

  if (!state) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <p className="text-sm text-muted">The screen flickers on…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }
  if (!state.unlocked) {
    return (
      <Modal open title={T.title} onClose={onClose}>
        <p className="mono terminal-locked">{T.locked}</p>
        <p className="text-sm text-muted">{T.lockedPrompt}</p>
        <FormError>{error}</FormError>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => run(merchantTerminalView, { unlock: true }, { onOk: setState })}
          >
            {T.unlockButton}
          </button>
        </div>
      </Modal>
    );
  }

  const groups = state.groups ?? [];
  const wares = groups.flatMap((g) => g.wares);
  const items = wares
    .map((w) => ({ ware: w, quantity: Math.trunc(Number(cart[w.id]) || 0) }))
    .filter((line) => line.quantity > 0);
  const subtotal = items.reduce((sum, line) => sum + line.ware.price * line.quantity, 0);
  const onOrder = (state.pending ?? []).reduce((sum, o) => sum + o.total, 0);
  const cartCost = withTax(subtotal, state.taxRate);
  const overBudget = withTax(onOrder + subtotal, state.taxRate) > state.holds;
  const coinAmount = Math.max(1, Math.trunc(Number(amount) || 0));

  return (
    <Modal open title={T.title} onClose={onClose}>
      <p className="text-sm text-muted">
        <span className="mono">{T.holds(state.holds)}</span> {T.committed(state.committed)} {T.carrying(state.carrying)}
      </p>
      <p className="text-sm text-muted">{T.taxNote(state.taxRate)}</p>

      <div className="field">
        <label className="field-label" htmlFor="chat-terminal-amount">
          {T.insertLabel} · {T.withdrawLabel}
        </label>
        <div className="flex items-center gap-3">
          <input
            id="chat-terminal-amount"
            type="number"
            className="w-24"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || state.carrying <= 0}
            onClick={() => act(merchantTerminalInsert, { amount: coinAmount })}
          >
            {T.insertButton}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || state.free <= 0}
            onClick={() => act(merchantTerminalWithdraw, { amount: coinAmount })}
          >
            {T.withdrawButton}
          </button>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        {[
          ["order", T.tabOrder],
          ["pending", `${T.tabPending} (${(state.pending ?? []).length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-active={tab === key}
            className="tab-item"
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "order" && (
        <>
          {groups.length === 0 && <EmptyState>{T.emptyShelf}</EmptyState>}
          <div className="terminal-shelf">
            {groups.map((group) => (
              <details key={group.name} className="terminal-group" open>
                <summary>
                  {group.name} <span className="text-muted">({group.wares.length})</span>
                </summary>
                {group.wares.map((ware) => (
                  <div key={ware.id} className="terminal-ware">
                    <div className="terminal-ware-text">
                      <span className="chat-person-name">{ware.name}</span>
                      {ware.description && <span className="text-sm text-muted">{ware.description}</span>}
                    </div>
                    <span className="mono text-sm">{ware.priceWithTax} ¢</span>
                    <input
                      type="number"
                      className="control w-16"
                      min={0}
                      max={ware.stackable ? 99 : 1}
                      aria-label={`${T.quantityLabel} — ${ware.name}`}
                      value={cart[ware.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setCart((c) => ({ ...c, [ware.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </details>
            ))}
          </div>
          <FormError>{error}</FormError>
          <div className="modal-actions modal-actions--sticky">
            <span className="mono text-sm mr-auto">{T.cartTotal(cartCost)}</span>
            <button
              type="button"
              className="btn"
              disabled={pending || items.length === 0 || overBudget}
              onClick={() =>
                act(
                  merchantTerminalOrder,
                  { items: items.map((line) => ({ tagId: line.ware.id, quantity: line.quantity })) },
                  () => setCart({}),
                )
              }
            >
              {T.orderButton}
            </button>
          </div>
        </>
      )}

      {tab === "pending" && (
        <>
          {(state.pending ?? []).length === 0 && <EmptyState>{T.noPending}</EmptyState>}
          <div className="terminal-shelf">
            {(state.pending ?? []).map((order) => {
              const draft = edits[order.id] ?? {};
              const qtyOf = (line) => draft[line.tagId] ?? String(line.quantity);
              const changed = order.lines.some((line) => qtyOf(line) !== String(line.quantity));
              return (
                <div key={order.id} className="terminal-order">
                  <p className="text-sm text-muted">{T.placedBy(order.placedByName, order.placedTurn)}</p>
                  {order.lines.map((line) => (
                    <div key={line.tagId} className="terminal-ware">
                      <span className="chat-person-name">{line.name}</span>
                      <span className="mono text-sm">{line.unitPrice} ¢</span>
                      <input
                        type="number"
                        className="control w-16"
                        min={0}
                        max={99}
                        aria-label={`${T.quantityLabel} — ${line.name}`}
                        value={qtyOf(line)}
                        onChange={(e) =>
                          setEdits((all) => ({ ...all, [order.id]: { ...draft, [line.tagId]: e.target.value } }))
                        }
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    <span className="mono text-sm mr-auto">{T.pendingTotal(order.total)}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={pending || !changed}
                      onClick={() =>
                        act(
                          merchantTerminalEditOrder,
                          {
                            orderId: order.id,
                            items: order.lines.map((line) => ({
                              tagId: line.tagId,
                              quantity: Math.max(0, Math.trunc(Number(qtyOf(line)) || 0)),
                            })),
                          },
                          () => setEdits((all) => ({ ...all, [order.id]: undefined })),
                        )
                      }
                    >
                      {T.saveButton}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={pending}
                      onClick={() => act(merchantTerminalRemoveOrder, { orderId: order.id })}
                    >
                      {T.removeButton}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <FormError>{error}</FormError>
        </>
      )}
    </Modal>
  );
}

// The Merchant's vending machine (docs/systemdocs/VENDING.md).
//
// Opening it TAKES the machine — the view is what is exclusive, so a second
// person cannot so much as read what is in the slot. Closing this dialog does
// not give it back: you are still standing at it, and you have your five
// minutes. "Step away" is the deliberate exit, and it is the one that puts your
// change back in your pocket.
//
// The countdown is derived from `holderSince` with the same function the server
// uses (@lifeweb/db/lib/vendingText), so the seconds on screen and the refusal
// behind them can never disagree.
function VendingDialog({ entry, onClose, onDone }) {
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  // The merchant's side: what is in his pockets that could go on the shelf, and
  // the per-row price boxes. Both empty for a customer, who never sees them.
  const [stock, setStock] = useState(null);
  const [putTagId, setPutTagId] = useState("");
  const [putQty, setPutQty] = useState(1);
  const [putPrice, setPutPrice] = useState(0);
  const [prices, setPrices] = useState({});
  const { run, pending, error } = useActionRunner();
  const roomId = entry.roomId;

  const refresh = useCallback(
    (res) => {
      if (res?.ok) setState(res);
      return res;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    openMachine({ roomId })
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: VENDING_TEXT.noMachine });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // What the merchant could put on the shelf, loaded only once the front is
  // open — it is a question about HIS pockets, and a customer never asks it.
  useEffect(() => {
    if (state?.mode !== "merchant") return undefined;
    let cancelled = false;
    vendStockables({ roomId })
      .then((res) => {
        if (!cancelled) setStock(res?.ok ? res : { rows: [] });
      })
      .catch(() => {
        if (!cancelled) setStock({ rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [state?.mode, state?.slots, roomId]);

  // One ticker for the clock. It re-reads the machine when the hold runs out,
  // so the dialog turns itself back into the closed view rather than sitting
  // there offering buttons the server will refuse.
  useEffect(() => {
    if (!state?.ok || !state.holderSince) return undefined;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (secondsLeftOn(state, at) === 0) {
        readMachine({ roomId })
          .then((res) => setState(res?.ok ? res : { ok: false, error: VENDING_TEXT.holdLost }))
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state, roomId]);

  if (!state) {
    return (
      <Modal open title={VENDING_TEXT.title} onClose={onClose}>
        <p className="text-sm text-muted">Looking through the glass…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={VENDING_TEXT.title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  // Somebody else has it. They are named as the room would see them, never as
  // the row — a hooded customer reads as "A young man" here too.
  if (state.mode === "busy") {
    return (
      <Modal open title={VENDING_TEXT.title} onClose={onClose}>
        <p className="text-sm text-muted">{VENDING_TEXT.holderIs(state.holderName ?? "Somebody")}</p>
        <p className="text-sm text-muted">{VENDING_TEXT.closed}</p>
      </Modal>
    );
  }
  if (state.mode === "closed") {
    return (
      <Modal open title={VENDING_TEXT.title} onClose={onClose}>
        <p className="text-sm text-muted">{VENDING_TEXT.closed}</p>
        <FormError>{error}</FormError>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => run(openMachine, { roomId }, { onOk: refresh })}
          >
            {VENDING_TEXT.btnOpen}
          </button>
        </div>
      </Modal>
    );
  }

  const merchant = state.mode === "merchant";
  const held = state.floatObols ?? 0;
  const rows = state.slots ?? [];
  const puttable = stock?.rows ?? [];
  // Every verb re-reads the machine rather than patching state locally: several
  // things move at once behind a purchase, and the shelf is the server's answer.
  const act = (fn, args = {}) =>
    run(fn, { roomId, ...args }, {
      onOk: (res) => {
        onDone(res);
        readMachine({ roomId })
          .then((next) => setState(next?.ok ? next : { ok: false, error: VENDING_TEXT.holdLost }))
          .catch(() => {});
      },
    });

  return (
    <Modal open title={VENDING_TEXT.title} onClose={onClose}>
      <p className="text-sm text-muted">{merchant ? VENDING_TEXT.promptMerchant : VENDING_TEXT.prompt}</p>
      <p className="text-sm text-muted">
        <span className="mono">{held > 0 ? VENDING_TEXT.floatLine(held) : VENDING_TEXT.floatNone}</span>{" "}
        {timeLeftLine(state, now)}
      </p>
      {merchant && (
        <p className="text-sm text-muted mono">
          {state.tillObols > 0 ? VENDING_TEXT.tillLine(state.tillObols) : VENDING_TEXT.tillNone}
        </p>
      )}

      {rows.length === 0 && <EmptyState>{merchant ? VENDING_TEXT.emptyMerchant : VENDING_TEXT.empty}</EmptyState>}
      {rows.map((row) => (
        // flex-wrap because .chat-notice-row does not wrap on its own, and the
        // merchant's version of a row carries six controls — without it they
        // run off the side of the panel on a phone.
        <div key={row.tagId} className="chat-notice-row flex-wrap">
          <span className="chat-person-name">{row.name}</span>
          <span className="mono text-sm text-muted">
            {row.priceObols > 0 ? `${row.priceObols} ¢` : "free"} · {row.quantity}
          </span>
          <button
            type="button"
            className="menu-item"
            disabled={pending || row.priceObols > held}
            onClick={() => act(vendBuy, { tagId: row.tagId })}
          >
            {VENDING_TEXT.btnBuy}
          </button>
          {merchant && (
            // basis-full puts the merchant's controls on a line of their own,
            // so the line above stays exactly the customer's: name, price, Buy.
            // Sharing one line cost the NAME — .chat-person-name is the
            // flex:1 ellipsis element, so with six siblings it truncated to
            // "T." on a phone, losing the one thing the row is about.
            <div className="basis-full flex items-center gap-3">
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => act(vendStockOut, { tagId: row.tagId, quantity: 1 })}
              >
                {VENDING_TEXT.btnStockOut}
              </button>
              {/* `control` because this input lives OUTSIDE a .field — without
                  it the box, border and background never apply and the price
                  renders as bare text nobody would guess is editable. */}
              <input
                type="number"
                className="control w-16"
                min={0}
                max={VENDING_MAX_PRICE}
                aria-label={`${VENDING_TEXT.modalPriceField} — ${row.name}`}
                value={prices[row.tagId] ?? row.priceObols}
                onChange={(e) => setPrices((p) => ({ ...p, [row.tagId]: e.target.value }))}
              />
              <button
                type="button"
                className="menu-item"
                disabled={pending}
                onClick={() => act(vendSetPrice, { tagId: row.tagId, priceObols: prices[row.tagId] ?? row.priceObols })}
              >
                {VENDING_TEXT.btnSetPrice}
              </button>
            </div>
          )}
        </div>
      ))}

      {merchant && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="chat-vending-put">
              {VENDING_TEXT.selectStock}
            </label>
            <Select
              id="chat-vending-put"
              value={putTagId}
              onChange={(e) => setPutTagId(e.target.value)}
            >
              <option value="">…</option>
              {puttable.map((row) => (
                <option key={row.tagId} value={row.tagId}>
                  {row.name} ({row.held})
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="chat-vending-put-qty">
              {VENDING_TEXT.modalStockQtyField}
            </label>
            <input
              id="chat-vending-put-qty"
              type="number"
              min={1}
              value={putQty}
              onChange={(e) => setPutQty(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="chat-vending-put-price">
              {VENDING_TEXT.modalStockPriceField}
            </label>
            <input
              id="chat-vending-put-price"
              type="number"
              min={0}
              max={VENDING_MAX_PRICE}
              value={putPrice}
              onChange={(e) => setPutPrice(e.target.value)}
            />
          </div>
          {/* A plain row, NOT .modal-actions — that class is sticky-to-the-
              bottom chrome, and a second one inside the body detaches this
              button and fights the real footer for the same edge. */}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || !putTagId}
              onClick={() =>
                act(vendStockIn, {
                  tagId: putTagId,
                  quantity: Math.max(1, Number(putQty) || 0),
                  priceObols: putPrice,
                })
              }
            >
              {VENDING_TEXT.btnStockIn}
            </button>
          </div>
        </>
      )}

      {/* mt-4: the shelf rows above are 3px-padded flex rows, so without it the
          label sits straight on the last ware's name. */}
      <div className="field mt-4">
        <label className="field-label" htmlFor="chat-vending-amount">
          {VENDING_TEXT.modalInsertField}
        </label>
        <input
          id="chat-vending-amount"
          type="number"
          min={1}
          max={VENDING_MAX_PRICE}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <FormError>{error}</FormError>
      {/* flex-wrap: .modal-actions is a single unwrapping flex row, and the
          merchant's side puts five buttons in it — which overflowed the panel
          and clipped the first one off its left edge. */}
      <div className="modal-actions flex-wrap">
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => act(vendInsert, { amount: Math.max(1, Number(amount) || 0) })}
        >
          {VENDING_TEXT.btnInsert}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending || held <= 0}
          onClick={() => act(vendWithdraw)}
        >
          {VENDING_TEXT.btnWithdraw}
        </button>
        {state.licensed && !merchant && (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(vendUnlock)}>
            {VENDING_TEXT.btnUnlock}
          </button>
        )}
        {merchant && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || !(state.tillObols > 0)}
              onClick={() => act(vendCollect)}
            >
              {VENDING_TEXT.btnCollect}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(vendLock)}>
              {VENDING_TEXT.btnLock}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-quiet"
          disabled={pending}
          onClick={() =>
            run(leaveMachine, { roomId }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          {VENDING_TEXT.btnLeave}
        </button>
      </div>
    </Modal>
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
          ? "The barrels drop and the yard is safe to cross again."
          : "It fires on everyone standing in the Gatehouse — the Cerberon, the Baron, you. Armour helps; a name does not."
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

// -------------------------------------------------------------- the counter

// The infoterminal and the Merchant's gun are fixtures on walls
// (db/lib/placeAffordances.js), so they open from here and from Discord. The
// gun is the Depot's alone; the infoterminal is wherever db/lib/depot.js#INFOTERMINAL_ROOM_SLUGS
// says there is one. Every one of them re-checks the standing, the papers and
// the money on the server — a dialog outlives somebody walking out of the
// room, which is the whole reason none of this is decided here.

// The infoterminal (docs/systemdocs/RINGS.md §5). It reads the
// ring on your finger, and asks for the account's PIN only when the ring is
// somebody else's or its owner is Concussed or Amnesiac. The PIN lives in this
// dialog's state alone and rides along with each call; the server checks it
// every time (db/lib/depotCounter.js#terminalAccount).
function InfoterminalDialog({ onClose, onDone }) {
  const [state, setState] = useState(null);
  const [pinDraft, setPinDraft] = useState("");
  const [pin, setPin] = useState(null);
  const [direction, setDirection] = useState("WITHDRAW");
  const [amount, setAmount] = useState(1);
  // Send's recipient: an account id, or VAULT for handing the claim back.
  const [sendTo, setSendTo] = useState("");
  const { run, pending, error } = useActionRunner();
  const reload = useCallback((withPin) => {
    depotCounterState(withPin ? { pin: withPin } : undefined)
      .then((res) => setState(res))
      .catch(() => setState({ ok: false, error: "The terminal is dead." }));
  }, []);
  useEffect(() => {
    reload(null);
  }, [reload]);
  const title = RING_TEXT.infoterminalTitle;

  if (!state) {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">{RING_TEXT.infoterminalReading}</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  if (!state.account && state.pinNeeded) {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">{state.pinPrompt}</p>
        <div className="field">
          <label className="field-label" htmlFor="chat-infoterminal-pin">
            {RING_TEXT.infoterminalPinLabel}
          </label>
          <input
            id="chat-infoterminal-pin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
        {/* A wrong PIN comes back as the same prompt with the refusal under it. */}
        {pin && <FormError>{state.accountProblem}</FormError>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={!pinDraft}
            onClick={() => {
              setPin(pinDraft);
              reload(pinDraft);
            }}
          >
            Enter
          </button>
        </div>
      </Modal>
    );
  }

  if (!state.account) {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">{state.accountProblem}</p>
      </Modal>
    );
  }

  const withdrawing = direction === "WITHDRAW";
  // Send (the Depot's machine only — state.sendTo is null anywhere else) pays
  // another account, or hands the claim back to the Vault; it moves no coin.
  const sending = direction === "SEND" && Array.isArray(state.sendTo);
  const max = withdrawing || sending ? state.account.balanceObols : state.heldObols;
  // Refused, never clamped. Firefox lets a letter into a number box and then
  // reports the whole box as "", so "12o" used to reach the old clamp as 0 and
  // quietly move 1 ¢. A box that does not hold a whole amount in range greys
  // the button out and leaves the typo on screen to be fixed.
  const n = Number(amount);
  const valid = amount !== "" && Number.isInteger(n) && n >= 1 && n <= max && (!sending || sendTo !== "");

  return (
    <Modal open title={title} onClose={onClose}>
      <p className="text-sm text-muted">
        {state.account.fingerprint} · {state.account.balanceObols} ¢ in {state.account.crown ? "the Vault" : "the account"},{" "}
        {state.heldObols} ¢ in your pocket.
        {state.account.backed ? "" : " Held off-world."}
      </p>
      <div className="field">
        <label className="field-label" htmlFor="chat-infoterminal-dir">
          Which way
        </label>
        <Select id="chat-infoterminal-dir" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="WITHDRAW">Take coin out</option>
          <option value="DEPOSIT">Put coin in</option>
          {Array.isArray(state.sendTo) && <option value="SEND">Send to an account</option>}
        </Select>
      </div>
      {sending && (
        <div className="field">
          <label className="field-label" htmlFor="chat-infoterminal-to">
            Send to
          </label>
          <Select id="chat-infoterminal-to" value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
            <option value="">Pick an account</option>
            {/* The Crown's money is the Vault already; sending it there moves nothing. */}
            {!state.account.crown && <option value="VAULT">The Vault</option>}
            {state.sendTo.map((a) => (
              <option key={a.id} value={a.id}>
                {a.holderName}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="chat-infoterminal-amount">
          How much, up to {max} ¢
        </label>
        <input
          id="chat-infoterminal-amount"
          type="number"
          min={1}
          max={max}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={pending || !valid}
          onClick={() =>
            sending
              ? run(
                  depotSend,
                  { toAccountId: sendTo === "VAULT" ? null : sendTo, toTreasury: sendTo === "VAULT", amount: n, pin },
                  {
                    onOk: (res) => {
                      onDone({ line: res.line });
                      onClose();
                    },
                  },
                )
              : run(
                  depotBank,
                  { direction, amount: n, pin },
                  {
                    onOk: (res) => {
                      onDone({ line: `${res.direction === "WITHDRAW" ? "Withdrew" : "Deposited"} ${res.amount} ¢.` });
                      onClose();
                    },
                  },
                )
          }
        >
          Do it
        </button>
      </div>
    </Modal>
  );
}

function DepotTurretDialog({ onClose, onDone }) {
  const [state, setState] = useState(null);
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    depotTurretRead()
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: "The panel is dead." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          ? "The gun retracts and the shop is safe again."
          : "It fires on any face not on file. Concealing yours means it fires on you too."
      }
      onClose={onClose}
      pending={pending}
      error={error}
      onSubmit={(word) =>
        run(depotTurret, { word }, {
          onOk: (res) => {
            onDone(res);
            onClose();
          },
        })
      }
    />
  );
}

// ------------------------------------------------------------------ quests

// A quest's Interact button (docs/systemdocs/QUESTS.md). The prompt is
// INTERACT_PROMPT from db/lib/questText.js rather than a sentence typed here,
// because the Discord modal shows the same one — a player who meets this on
// both faces must read the same words.
//
// The quest id travels in the affordance's customId, which is where the
// Discord button carries it too. Nothing here decides whether the press is
// allowed: interactWithQuest re-checks the quest, the place, the door and the
// one-Move-a-turn rule on the server, because a dialog outlives somebody
// walking out of the cave.
function QuestInteractDialog({ entry, onClose, onDone }) {
  const [intention, setIntention] = useState("");
  const { run, pending, error } = useActionRunner();
  const questId = entry?.customId?.slice(QUEST_INTERACT_PREFIX.length) ?? "";

  return (
    <Modal open title={entry?.roomName || "Interact"} onClose={onClose}>
      <p className="text-sm text-muted">{INTERACT_PROMPT}</p>
      <div className="field">
        <label className="field-label" htmlFor="quest-intention">
          Your intentions
        </label>
        <textarea
          id="quest-intention"
          rows={4}
          value={intention}
          maxLength={INTENTION_MAX}
          onChange={(e) => setIntention(e.target.value)}
        />
      </div>
      <FormError>{error}</FormError>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={!intention.trim() || pending}
          onClick={() =>
            run(interactWithQuest, { questId, intention }, {
              onOk: (res) => {
                onDone(res);
                onClose();
              },
            })
          }
        >
          Interact
        </button>
      </div>
    </Modal>
  );
}


// ------------------------------------------------------------- the telephone
//
// A keypad, not a list (docs/systemdocs/PHONES.md §3). Pressing the Phone button
// picks the receiver up — and answers a named phone that is ringing — so the dialog
// is drawn off the server's answer to that, then kept live by the feed's `phones`
// frame (phoneStore.js). Closing the dialog does NOT put the phone down: the holder
// has to be able to type into the room, which is how you talk down a phone. The
// handset bar under the place card (PhoneHandsetBar) is how you get back to it.
//
// No help text beyond the phone's own number and the payphone's price, which is a
// thing you are about to be charged and so has to be said before you are.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
const STATE_LINE = {
  idle: PHONE_TEXT.stateIdle,
  calling: PHONE_TEXT.stateCalling,
  connected: PHONE_TEXT.stateConnected,
  dead: PHONE_TEXT.stateDead,
  ringing: PHONE_TEXT.stateRinging,
};

// The button that picks up a phone ringing in your own hand. A payphone with no time
// on it wants its coin first, and the button says so.
function answerLabel(handset) {
  return handset?.payphone && handset.needsCoin ? `${PHONE_TEXT.answer} (${PHONE_TEXT.insertCoin.toLowerCase()})` : PHONE_TEXT.answer;
}

// A clock that ticks once a second while `on`, for the payphone's countdown.
function useSecondTick(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

// The handset for THIS phone, off the store — which every action answer and every
// feed frame lands in — or null when it is not in this character's hand.
function useHandset(roomId) {
  const { handset } = usePhoneFrame();
  return handset?.roomId === roomId ? handset : null;
}

function PaidTime({ handset, now }) {
  if (!handset?.payphone) return null;
  if (!handset.paidUntil) return <p className="text-sm text-muted">{PHONE_TEXT.insert}</p>;
  const left = new Date(handset.paidUntil).getTime() - now;
  return (
    <p className={`phone-timer${handset.needsCoin ? " is-low" : ""}`}>
      {PHONE_TEXT.timeLeft} <span className="mono">{clockLeft(left)}</span>
      {handset.needsCoin ? <span className="phone-timer-ask"> · {PHONE_TEXT.insertAgain}</span> : null}
    </p>
  );
}

function PhoneDialog({ entry, onClose, onDone }) {
  const [state, setState] = useState(null);
  const [digits, setDigits] = useState("");
  const { run, pending, error } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    openPhone({ roomId: entry.roomId })
      .then((res) => {
        if (cancelled) return;
        setState(res);
        if (res?.handset) noteHandset(res.handset);
        if (res?.sfx) playSfx(res.sfx);
        if (res?.line) onDone({ line: res.line });
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: "The line is dead." });
      });
    return () => {
      cancelled = true;
    };
    // onDone is the panel's notice setter; re-running the pick-up because it
    // changed identity would pick the phone up twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.roomId]);

  const handset = useHandset(entry.roomId);
  const now = useSecondTick(Boolean(handset?.paidUntil));
  const title = state?.phone ? `The phone — ${state.phone}` : "The phone";

  // Every answer lands in two places: the handset store (so the bar and the tones
  // follow at once) and the panel's notice line.
  const landed = (res) => {
    setDialling(false);
    if (res.handset) noteHandset(res.handset);
    if (res.mode === "gone") {
      noteHandset(null);
      onDone(res);
      onClose();
      return;
    }
    if (res.mode === "holding" || res.mode === "answer") setState(res);
    onDone(res);
  };
  const act = (action, extra = {}) =>
    run(action, { roomId: entry.roomId, ...extra }, { onOk: landed, onFail: () => setDialling(false) });

  if (!state) {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }
  if (state.mode === "held") {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">{PHONE_TEXT.held}</p>
      </Modal>
    );
  }
  // A payphone ringing: answering it takes a coin first.
  if (state.mode === "answer") {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm">{PHONE_TEXT.stateRinging}</p>
        <p className="text-sm text-muted">{PHONE_TEXT.insert}</p>
        <FormError>{error}</FormError>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={pending} onClick={() => act(answerPhone)}>
            {PHONE_TEXT.insertCoin}
          </button>
        </div>
      </Modal>
    );
  }

  // Ejected by the clock, or walked away from on another tab.
  if (!handset) {
    return (
      <Modal open title={title} onClose={onClose}>
        <p className="text-sm text-muted">{PHONE_TEXT.notHolding}</p>
      </Modal>
    );
  }

  const phase = handset.state ?? "idle";
  const canDial = phase === "idle";
  const press = (key) => {
    if (!canDial) return;
    if (key === "clear") setDigits("");
    else if (key === "back") setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d.length >= PHONE_DIGITS ? d : d + key));
  };
  const dial = () => {
    if (!canDial || digits.length !== PHONE_DIGITS || pending) return;
    // The long tone starts now, not when the exchange answers: a number that goes
    // nowhere rings out for a few seconds on the server before it says so.
    setDialling(true);
    act(dialPhone, { digits });
    setDigits("");
  };
  const onKey = (event) => {
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === "Backspace") press("back");
    else if (event.key === "Enter") dial();
    else return;
    event.preventDefault();
  };

  return (
    <Modal open title={title} onClose={onClose}>
      {/* The keypad listens for the number keys while the dialog has focus. */}
      <div className="phone" onKeyDown={onKey} role="group" aria-label={title}>
        {handset.number != null ? <p className="text-sm text-muted">{PHONE_TEXT.ownNumber(handset.number)}</p> : null}
        <p className={`phone-state is-${phase}`}>{STATE_LINE[phase] ?? PHONE_TEXT.stateIdle}</p>
        <PaidTime handset={handset} now={now} />
        <div className="phone-readout mono" aria-live="polite">
          {Array.from({ length: PHONE_DIGITS }, (_, i) => (
            <span key={i} className={digits[i] ? "is-set" : ""}>
              {digits[i] ?? "·"}
            </span>
          ))}
        </div>
        <div className="phone-keypad">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="btn-secondary phone-key"
              disabled={!canDial || pending}
              onClick={() => press(key)}
              aria-label={key === "back" ? "Delete" : key === "clear" ? PHONE_TEXT.clear : key}
            >
              {key === "back" ? "⌫" : key === "clear" ? "C" : key}
            </button>
          ))}
        </div>
        <FormError>{error}</FormError>
        <div className="modal-actions phone-actions">
          {phase === "ringing" ? (
            <button type="button" className="btn" disabled={pending} onClick={() => act(answerPhone)}>
              {answerLabel(handset)}
            </button>
          ) : (
            <button type="button" className="btn" disabled={!canDial || digits.length !== PHONE_DIGITS || pending} onClick={dial}>
              {PHONE_TEXT.dial}
            </button>
          )}
          {handset.payphone && handset.needsCoin && handset.paidUntil ? (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(insertPhoneObol)}>
              {PHONE_TEXT.insertCoin}
            </button>
          ) : null}
          <button type="button" className="btn-secondary" disabled={canDial || pending} onClick={() => act(hangUpPhone)}>
            {PHONE_TEXT.hangUp}
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(walkAwayPhone)}>
            {PHONE_TEXT.walkAway}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ the bomb
//
// A keypad and one button under it, and nothing to type into (docs/systemdocs/
// NUKE.md): Bascinet's design document wants the sequence pressed out on the pad,
// so the dialog listens to no keyboard at all. The eighth digit asks the server
// whether it is the sequence — a wrong one counts, and the third in a row locks
// this character out — and a right one lights the button green. Pressing it arms
// the bomb, or disarms it if it is armed; the server checks the sequence again.

const NUKE_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

function NukeDialog({ entry, onClose, onDone }) {
  const [state, setState] = useState(null);
  const [digits, setDigits] = useState("");
  const [green, setGreen] = useState(false);
  const [miss, setMiss] = useState(0);
  const { run, pending, error, setError } = useActionRunner();

  useEffect(() => {
    let cancelled = false;
    nukeState({ roomId: entry.roomId })
      .then((res) => {
        if (!cancelled) setState(res);
      })
      .catch(() => {
        if (!cancelled) setState({ ok: false, error: NUKE_TEXT.noBomb });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.roomId]);

  // After a refusal, the keypad as it now stands — the refusal itself is only
  // words, and a third strike has to grey the pad out.
  const reread = () => {
    nukeState({ roomId: entry.roomId })
      .then((res) => {
        if (res?.ok) setState(res);
      })
      .catch(() => {});
  };

  const locked = Boolean(state?.lockedOut);
  const closed = !state?.ok || locked || state?.gone;

  // The eighth digit goes straight to the server; nothing is pressed after it.
  const check = (full) => {
    run(
      nukeCheckCode,
      { roomId: entry.roomId, digits: full },
      {
        onOk: (res) => {
          setState((prev) => ({ ...prev, ...res }));
          setGreen(true);
        },
        onFail: () => {
          setDigits("");
          setMiss((n) => n + 1);
          reread();
        },
      },
    );
  };

  const press = (key) => {
    if (closed || pending) return;
    setError(null);
    // A physical button under a finger, every press — played here rather than
    // sent by the server, since nothing is asked of it until the eighth digit.
    playSfx("nuke-key");
    if (key === "clear") {
      setDigits("");
      setGreen(false);
      return;
    }
    if (key === "back") {
      setDigits((d) => d.slice(0, -1));
      setGreen(false);
      return;
    }
    if (digits.length >= NUKE_CODE_DIGITS) return;
    const next = digits + key;
    setDigits(next);
    if (next.length === NUKE_CODE_DIGITS) check(next);
  };

  const pressButton = () => {
    if (!green || pending) return;
    run(
      nukePressButton,
      { roomId: entry.roomId, digits },
      {
        onOk: (res) => {
          setState((prev) => ({ ...prev, ...res }));
          setDigits("");
          setGreen(false);
          if (res.line) onDone({ line: res.line });
        },
        onFail: () => {
          setDigits("");
          setGreen(false);
          reread();
        },
      },
    );
  };

  if (!state) {
    return (
      <Modal open title={NUKE_TEXT.title} onClose={onClose}>
        <p className="text-sm text-muted">…</p>
      </Modal>
    );
  }
  if (!state.ok) {
    return (
      <Modal open title={NUKE_TEXT.title} onClose={onClose}>
        <FormError>{state.error}</FormError>
      </Modal>
    );
  }

  return (
    <Modal open title={NUKE_TEXT.title} onClose={onClose}>
      <div className="nuke" role="group" aria-label={NUKE_TEXT.title}>
        <p className={`nuke-state${state.armed ? " is-armed" : ""}`}>
          <span className="nuke-lamp" aria-hidden="true" />
          {state.gone ? NUKE_TEXT.gone : state.armed ? NUKE_TEXT.armedState : NUKE_TEXT.safeState}
        </p>
        {/* A shake on a wrong sequence; the key restarts the animation each time. */}
        <div key={miss} className={`phone-readout nuke-readout mono${miss ? " is-wrong" : ""}`} aria-live="polite">
          {Array.from({ length: NUKE_CODE_DIGITS }, (_, i) => (
            <span key={i} className={digits[i] ? "is-set" : ""}>
              {digits[i] ?? "·"}
            </span>
          ))}
        </div>
        <div className="phone-keypad nuke-keypad">
          {NUKE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="btn-secondary phone-key"
              disabled={closed || pending || (green && key !== "clear" && key !== "back")}
              onClick={() => press(key)}
              aria-label={key === "back" ? "Delete" : key === "clear" ? NUKE_TEXT.clear : key}
            >
              {key === "back" ? "⌫" : key === "clear" ? "C" : key}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`nuke-button${green ? " is-green" : ""}`}
          disabled={!green || pending || closed}
          onClick={pressButton}
        >
          {state.armed ? NUKE_TEXT.disarm : NUKE_TEXT.arm}
        </button>
        {locked ? <p className="text-sm text-muted nuke-locked">{NUKE_TEXT.lockedOut}</p> : null}
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

/**
 * The phone in your hand, under the place card, for as long as you hold it: what the
 * line is doing, the payphone's clock, and the way back to the keypad. Drawn off the
 * feed's `phones` frame, so it appears on whichever tab or face picked the phone up.
 */
export function PhoneHandsetBar({ affordances, onOpen, onDone }) {
  const { handset } = usePhoneFrame();
  const now = useSecondTick(Boolean(handset?.paidUntil));
  const { run, pending, error } = useActionRunner();
  if (!handset) return null;

  const entry = affordances.find((e) => e.id === "phone" && e.roomId === handset.roomId) ?? {
    id: "phone",
    kind: "room",
    roomId: handset.roomId,
  };
  const landed = (res) => {
    noteHandset(res.mode === "gone" ? null : (res.handset ?? null));
    onDone(res);
  };
  const act = (action) => run(action, { roomId: handset.roomId }, { onOk: landed });

  return (
    <div className="phone-bar">
      <p className="phone-bar-line">
        <span className="phone-bar-name">{handset.name ?? "The phone"}</span>
        <span className={`phone-state is-${handset.state}`}>{STATE_LINE[handset.state] ?? ""}</span>
      </p>
      <PaidTime handset={handset} now={now} />
      <FormError>{error}</FormError>
      <div className="phone-bar-actions">
        {handset.state === "ringing" ? (
          <button type="button" className="btn" disabled={pending} onClick={() => act(answerPhone)}>
            {answerLabel(handset)}
          </button>
        ) : null}
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => onOpen(entry)}>
          Keypad
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={handset.state === "idle" || pending}
          onClick={() => act(hangUpPhone)}
        >
          {PHONE_TEXT.hangUp}
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(walkAwayPhone)}>
          {PHONE_TEXT.walkAway}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- intercom

function IntercomDialog({ entry, onClose, onDone }) {
  const [body, setBody] = useState("");
  const { run, pending, error } = useActionRunner();
  return (
    <Modal open title="Intercom" onClose={onClose}>
      <p className="text-sm text-muted">
        Heard in every zone that has a speaker, and everyone is pinged. Nobody is told who spoke.
      </p>
      <div className="field">
        <label className="field-label" htmlFor="chat-pa">
          What goes out
        </label>
        <textarea id="chat-pa" rows={3} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
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
