"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import Modal from "@/app/components/Modal";
import { CameraIcon, EditIcon, EyeIcon, MoreIcon, TrashIcon } from "@/app/components/icons";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { Readout } from "@/app/components/ExamineDialog";
import { photographRow } from "./actions";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import {
  useFeed,
  applyRow,
  addPending,
  markPendingFailed,
  retryPending,
  newestSeq,
} from "./feedStore";
import { useTyping, typingLine } from "./typingStore";
import { peekSeen } from "./seenStore";
// By PATH, never through the @lifeweb/db barrel: the barrel pulls Prisma and
// node:fs into whatever imports it, and this is a "use client" file. That
// module is pure string work with no requires of its own, so it is safe here
// — and it has to be here, or the row this composer draws says something
// different from the row the server writes a moment later.
import { capitalizeSentences, fixContractions } from "@lifeweb/db/lib/textCorrection";
import MentionMenu, { mentionQueryAt, matchRoster } from "./MentionMenu";

// One place's scene: what has been said here, and — where the place allows it
// — the box to say something.
//
// This was PlayFeed.js, which knew about exactly one Location. It knows about
// a PLACE now: the Location you are standing in, a Room off it, a conversation
// you are in, or the zone's summary. What changes between them is the name in
// the composer, whether there IS a composer, and the slowmode; everything
// else is the same scene.
//
// Nothing here waits on a server round trip to move. Pressing Enter appends
// the row to the store in the same frame and clears the box; the POST that
// follows only swaps the confirmed row in behind it. That is the whole reason
// this page is not a server action and a revalidatePath — see the plan's
// "Why the past web UIs felt slow".

// A run is one speaker's messages within seven minutes of each other, drawn
// as one block with a single face. The rule is copied from DmThread.js rather
// than imported: that component is a GM's DM conversation, a different shape
// with a different row type, and sharing the constant would tie them together
// for no gain.
const RUN_GAP_MS = 7 * 60_000;
// How close to the bottom still counts as "reading the newest", in px.
const STICK_PX = 40;
// The same five minutes db/lib/say.js#EDIT_WINDOW_MS enforces. Kept here as a
// number rather than imported, because importing from @lifeweb/db in a
// "use client" file drags Prisma and node:fs into the browser bundle. The
// server is the one that decides; this only decides whether to draw a button.
const EDIT_WINDOW_MS = 5 * 60_000;

function timeLabel(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// What the world says, rather than what a person says: an arrival, a smell, a
// turret, the turn line. Drawn as subtext with no face, the same way Discord
// renders the `-#` these lines go out as (db/lib/ambientLine.js).
const SystemRow = memo(function SystemRow({ row }) {
  return (
    <li className="hall-subtext">
      <ChatMarkdown content={row.content} />
    </li>
  );
});

// Discord's red line: everything under it landed since you last had this
// place open. Drawn once, where the list was when you opened it, and left
// there while you read — it is a bookmark, not a cursor.
function NewLine() {
  return (
    <li className="hall-new-line" aria-hidden="true">
      <span>NEW ‡</span>
    </li>
  );
}

// memo'd, and the whole point of keying the store by seq: a new message
// re-renders one of these, not the run of a hundred above it.
const FeedRow = memo(function FeedRow({
  row,
  startsRun,
  mine,
  // Somebody else's line, and this reader may look at who said it: the row
  // carries a name rather than an alias (see the note on `canLook` below).
  canLook,
  // …and has an instant camera in their hands.
  canPhoto,
  // A GM with no living character. They may take any line down, their own
  // rules — no ownership, no five-minute window.
  canRemove,
  editing,
  coarse,
  onRetry,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onLookAt,
  onPhotograph,
  onRemove,
}) {
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(row.content ?? "");

  // Always reachable on a touch screen, where there is no hover to reveal
  // them; out of the way of a mouse until it is over the row.
  const anyAction = mine || canLook || canPhoto || canRemove;
  const showActions = anyAction && !editing && !row.pending && (coarse || hover);

  return (
    <li
      className="hall-row"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        marginTop: startsRun ? "var(--sp-3)" : "var(--sp-1)",
        // No hex anywhere — a pending row is the same row, quieter.
        opacity: row.pending ? 0.6 : 1,
      }}
    >
      <div style={{ width: 32, flexShrink: 0 }}>
        {startsRun && (
          <CharacterAvatar characterId={row.characterId} name={row.name ?? ""} version={row.avatarVersion} size={32} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {startsRun && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{row.name}</span>
            <span className="mono text-xs" style={{ color: "var(--muted)" }}>
              {timeLabel(row.sentAt)}
            </span>
            {row.editedAt && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                (edited) ‡
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div className="field">
            <textarea
              rows={2}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit();
                  return;
                }
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                onSaveEdit(row.seq, draft);
              }}
            />
            <div className="flex gap-2">
              <button type="button" className="btn-quiet" onClick={() => onSaveEdit(row.seq, draft)}>
                Save ‡
              </button>
              <button type="button" className="btn-quiet" onClick={onCancelEdit}>
                Cancel ‡
              </button>
            </div>
          </div>
        ) : (
          <ChatMarkdown content={row.content} />
        )}

        {/* The bar FLOATS over the row's top-right corner (.hall-row-actions),
            so it never pushes the sentence around when a mouse crosses the
            line. Everything it offers is re-decided by the server when it is
            pressed: the five-minute window, the camera in your hands, whether
            that person is still standing beside you. */}
        {showActions && (
          <div className="hall-row-actions">
            {mine && (
              <>
                <IconButton icon={EditIcon} label="Change ‡" onClick={() => onEdit(row.seq, row.sentAt)} />
                <IconButton icon={TrashIcon} label="Take back ‡" onClick={() => onDelete(row.seq, row.sentAt)} />
              </>
            )}
            {canLook && (
              <IconButton icon={EyeIcon} label="Look at ‡" onClick={() => onLookAt(row.characterId)} />
            )}
            {canPhoto && (
              <IconButton icon={CameraIcon} label="Photograph ‡" onClick={() => onPhotograph(row.seq)} />
            )}
            {canRemove && (
              <IconButton icon={TrashIcon} label="Remove ‡" onClick={() => onRemove(row.seq)} />
            )}
          </div>
        )}

        {row.failed && (
          <button type="button" className="btn-quiet" onClick={() => onRetry(row.clientId)}>
            Try again ‡
          </button>
        )}
      </div>
    </li>
  );
});

// What the camera caught. The print is already in your pocket by the time
// this opens — a Tag row of its own (db/lib/photoMint.js) — so this is the
// photographer being shown their own shot, the same courtesy the 📸 reaction
// pays with an embed. The footer is the photo's NAME, which is how it will
// read in an inventory, a stash and a Transfer dialog.
//
// The readout is db/lib/examine.js#examineReadout, built with the viewer's
// own sight stripped out: a lens has no medical training, so a surgeon's
// photograph carries no diagnosis into the hands of whoever they give it to.
function PhotoReadout({ state, onClose }) {
  const readout = state?.readout ?? null;

  return (
    <Modal open title={readout?.name ?? "Photograph ‡"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Winding the film… ‡</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {state?.line && <p className="text-sm">{state.line}</p>}
        {/* The SAME block the sheet's Look at draws
            (web/app/components/ExamineDialog.js). A photograph is a readout
            of a moment, so there was never a reason for it to be a poorer
            one — db/lib/examine.js already decides what a print gives away,
            and photographRow() strips the looker's own sight before it asks. */}
        {readout && <Readout readout={readout} />}
        {/* The only thing that is the PHOTOGRAPH's rather than the subject's:
            what the print in your hands is called. */}
        {state?.photoName && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {state.photoName}
          </p>
        )}
      </div>
    </Modal>
  );
}

function newClientId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// How often this tab tells the server somebody is writing. The route holds the
// real limit (a client is the half a player can rewrite); this only keeps a
// held-down key from being a request per character.
const TYPING_PING_MS = 4000;

// How many times a slowmode refusal resends on its own before the row is
// given up on. Three covers a clock that was a second out; more would be a
// tab talking to itself.
const MAX_SLOWMODE_RETRIES = 3;

export default function Feed({
  place,
  self,
  // Whether GameConfig.tupperAutocorrectEnabled is on. The server applies
  // capitalizeSentences(fixContractions(…)) to everything said through
  // db/lib/say.js, so the optimistic row applies it too — otherwise you watch
  // your own sentence rewrite itself a second after you send it.
  autocorrect = false,
  onSeen,
  onOpenSheet = null,
  // whosHere().named for where this character stands, as { id, name,
  // updatedAt } — the @ list, and the same roster the page hands
  // CharacterMentionsProvider so a {char:…} renders back as a face.
  roster = [],
  // A GM watching with no living character (web/lib/feedAccess.js#loadFeedViewer).
  // They speak nowhere and act on nobody, but they may take a line down.
  gm = false,
  // Whether this character's sheet holds an instant-camera
  // (db/lib/photoMint.js#CAMERA_SLUG). The row's 📷 is the web twin of the
  // 📸 reaction; the server re-checks the camera either way.
  hasCamera = false,
  // The GM desk's Scene tab (PLAYER-DESK.md): the same scene with no composer
  // and no sheet. A GM speaks nowhere (HALL.md §5a), so this only removes chrome
  // that would have refused anyway.
  readOnly = false,
}) {
  const placeKey = place?.placeKey ?? null;
  const rows = useFeed(placeKey);
  const typing = typingLine(useTyping(placeKey));
  const coarse = useIsCoarsePointer();
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [editingSeq, setEditingSeq] = useState(null);
  // What the camera caught, while the print is being made and after: one of
  // { loading } | { readout, photoName, line } | { error }.
  const [photo, setPhoto] = useState(null);

  // The sheet's people dialogs, mounted on the page (play/page.js). Absent
  // for a GM and on the desk's Scene tab, which is what leaves the eye off
  // those rows.
  const requestActions = useRequestActions();
  const openAction = requestActions?.open ?? null;

  // What this place looked like the moment it was opened, plus whatever hold
  // this tab has since put on its own composer. Both are per-place, and both
  // are captured DURING a render rather than in an effect —
  // react-hooks/set-state-in-effect is an error here, and setting state in a
  // render to follow a changed prop is the pattern React documents for it.
  //
  //   mark  the seen mark as it stood on opening, which is where the NEW line
  //         goes. Frozen on purpose: marking the place read (below) moves the
  //         stored mark, and a line that chased it down the list as you read
  //         would never be anywhere useful.
  //   hold  epoch ms the composer opens again at, set from a send or from the
  //         server's own retryAfter.
  const [opened, setOpened] = useState(() => ({ placeKey, mark: peekSeen(placeKey), hold: 0 }));
  if (opened.placeKey !== placeKey) setOpened({ placeKey, mark: peekSeen(placeKey), hold: 0 });
  const newMark = opened.placeKey === placeKey ? opened.mark : null;
  const hold = opened.placeKey === placeKey ? opened.hold : 0;

  const scrollerRef = useRef(null);
  const textareaRef = useRef(null);
  // { at, query, active } — where the live `@word` starts, what has been typed
  // of it, and which row of the popover is highlighted. One piece of state, so
  // a keystroke that both moves the caret and moves the highlight is one
  // render.
  const [mention, setMention] = useState(null);
  const lastTypedAt = useRef(0);
  // Read inside the scroll handler and the arrival effect, where a stale
  // closure would stick the view to the wrong end of the list.
  const atBottomRef = useRef(true);
  // Retries this tab has scheduled for itself after a slowmode refusal, so a
  // place change or a closed tab does not leave one to fire into nothing.
  const retryTimers = useRef(new Set());
  // Slowmode, answered rather than swallowed. The box stays TYPEABLE through
  // the hold the way Discord's does — people write while they wait — so an
  // Enter inside it has to say something, or the words just sit there and
  // nothing at all happens. The countdown chip flinches and the error line
  // says the number once.
  const [nudge, setNudge] = useState(false);
  const nudgeTimer = useRef(null);

  // ---- Slowmode ------------------------------------------------------------
  //
  // A wait, not a failure. The zone summary is the only place with one
  // (db/lib/feedAccess.js), and it used to arrive as a 429 the composer read
  // as a network error: the row went red and offered a Retry that would have
  // been refused again. Now the composer knows when it may speak, counts the
  // seconds down, and — if a 429 gets through anyway, which two tabs can
  // still manage — holds the row and sends it again itself.
  const slowmodeMs = (place?.slowmodeSeconds ?? 0) * 1000;

  // When the server will let this character speak here again, measured the
  // same way the server measures it: from their own newest line in the place.
  // That is also what seeds the countdown when a place is opened.
  const ownDeadline = useMemo(() => {
    if (slowmodeMs <= 0) return 0;
    let best = 0;
    for (const row of rows) {
      if (!row.seq || row.characterId !== self.characterId || !row.sentAt) continue;
      const at = new Date(row.sentAt).getTime();
      if (at > best) best = at;
    }
    return best > 0 ? best + slowmodeMs : 0;
  }, [rows, slowmodeMs, self.characterId]);

  const deadline = Math.max(hold, ownDeadline);

  // One re-render a second while a countdown is running, and nothing else:
  // the number itself is read off the clock in the render below, which is the
  // one place in this file where reading the clock is the point.
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline <= Date.now()) return undefined;
    const timer = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const waitSeconds = deadline > 0 ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;

  // Named, so it can schedule itself: a 429 comes back with the seconds left,
  // and the answer to it is this same call once they are up.
  const send = useCallback(
    async function send(clientId, content, attempt = 0) {
      try {
        const res = await fetch("/api/feed/say", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place: placeKey, content, clientId }),
        });
        const data = await res.json().catch(() => null);

        if (res.status === 429) {
          const wait = Math.max(1, Number(data?.retryAfter) || 1) * 1000;
          setOpened((current) =>
            current.placeKey === placeKey ? { ...current, hold: Date.now() + wait } : current,
          );
          if (attempt >= MAX_SLOWMODE_RETRIES) {
            setError(data?.error ?? "That didn't send. ‡");
            markPendingFailed(placeKey, clientId);
            return;
          }
          // The row stays pending and the countdown explains the wait, so
          // there is nothing to tell the player that the number is not
          // already telling them.
          setError(null);
          const timer = setTimeout(() => {
            retryTimers.current.delete(timer);
            void send(clientId, content, attempt + 1);
          }, wait + 250);
          retryTimers.current.add(timer);
          return;
        }

        if (!res.ok) {
          setError(data?.error ?? "That didn't send. ‡");
          markPendingFailed(placeKey, clientId);
          return;
        }
        setError(null);
        if (data?.row) applyRow(placeKey, data.row);
      } catch {
        setError("That didn't send. ‡");
        markPendingFailed(placeKey, clientId);
      }
    },
    [placeKey],
  );

  // The flinch is a few hundred milliseconds; a tab closed inside one should
  // not leave a timer holding a setState.
  useEffect(() => {
    return () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    };
  }, []);

  // A scheduled retry outlives a change of place on purpose — it is still
  // carrying words somebody typed, and the send it will make names the place
  // they typed them in. Only a closed tab drops it.
  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // "Somebody is writing something", the web half of it. Fire-and-forget: the
  // answer is never read, and a failure means one missing line rather than
  // anything a player has to be told about.
  const pingTyping = useCallback(() => {
    if (!placeKey || !place?.canSpeak) return;
    const now = Date.now();
    if (now - lastTypedAt.current < TYPING_PING_MS) return;
    lastTypedAt.current = now;
    fetch("/api/feed/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: placeKey }),
    }).catch(() => {});
  }, [placeKey, place?.canSpeak]);

  const matches = useMemo(
    () => (mention ? matchRoster(roster, mention.query) : []),
    [mention, roster],
  );

  // The `@word` under the caret, recomputed on every edit. In the handler, not
  // an effect: the caret is a DOM fact and reading it during a render would be
  // both impure and a frame late.
  const onDraftChange = useCallback(
    (event) => {
      const value = event.target.value;
      const caret = event.target.selectionStart ?? value.length;
      setDraft(value);
      const found = mentionQueryAt(value, caret);
      setMention(found ? { ...found, active: 0 } : null);
      pingTyping();
    },
    [pingTyping],
  );

  // Swaps the half-typed `@bar` for the token the row is actually made of.
  // {char:<id>} is what goes on the wire, on both faces: the outbox turns it
  // into a Discord role mention on the way out, and prepareSpeech turns a
  // Discord one back into this on the way in, so the ROW is face-neutral.
  const pickMention = useCallback(
    (person) => {
      setMention((current) => {
        if (!current) return null;
        const before = draft.slice(0, current.at);
        const after = draft.slice(current.at + 1 + current.query.length);
        const token = `{char:${person.id}} `;
        setDraft(`${before}${token}${after}`);
        const caret = before.length + token.length;
        // After the value lands, or setSelectionRange moves a caret in the old
        // string. Not an effect — this is the tail of a click.
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(caret, caret);
        });
        return null;
      });
    },
    [draft],
  );

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content || !placeKey) return;
    // Inside the hold. The draft is kept — it is theirs, and they will send
    // it in a second — and the chip is what says so.
    if (deadline > Date.now()) {
      setError(`Slowmode. Wait ${Math.max(1, Math.ceil((deadline - Date.now()) / 1000))} s. ‡`);
      setNudge(true);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => setNudge(false), 500);
      return;
    }
    const clientId = newClientId();
    setDraft("");
    setMention(null);
    setError(null);
    addPending(placeKey, {
      clientId,
      seq: null,
      characterId: self.characterId,
      name: self.name,
      avatarVersion: self.avatarVersion,
      // What the SERVER will store, not what was typed. Both transforms, in
      // the order db/lib/say.js#transformSpeech runs them.
      content: autocorrect ? capitalizeSentences(fixContractions(content)) : content,
      sentAt: new Date().toISOString(),
    });
    // Optimistic, so a second Enter in the same second meets the countdown
    // rather than the server's refusal.
    if (slowmodeMs > 0) {
      setOpened((current) => (current.placeKey === placeKey ? { ...current, hold: Date.now() + slowmodeMs } : current));
    }
    atBottomRef.current = true;
    setAtBottom(true);
    // The RAW text goes to the server, which runs the same transforms itself
    // — sending the transformed copy would run them twice.
    void send(clientId, content);
  }, [draft, placeKey, self, send, autocorrect, slowmodeMs, deadline]);

  const onRetry = useCallback(
    (clientId) => {
      const row = retryPending(placeKey, clientId);
      if (row) void send(clientId, row.content);
    },
    [placeKey, send],
  );

  // The window, checked in an event handler where reading the clock is both
  // legal and correct. The refusal is the bot's word for word, so a player
  // hears one rule on both faces.
  const withinWindow = (sentAt) => Date.now() - new Date(sentAt ?? 0).getTime() < EDIT_WINDOW_MS;
  const TOO_LATE = "That was said more than five minutes ago and stands. ‡";

  const onEdit = useCallback((seq, sentAt) => {
    if (!withinWindow(sentAt)) {
      setError(TOO_LATE);
      return;
    }
    setError(null);
    setEditingSeq(seq);
  }, []);

  const onCancelEdit = useCallback(() => setEditingSeq(null), []);

  // The row swaps in from the stream, so nothing is written into the store
  // here: the server is the one that decides what the message now says.
  const onSaveEdit = useCallback(async (seq, content) => {
    setEditingSeq(null);
    try {
      const res = await fetch("/api/feed/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq, content }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "That didn't change. ‡");
        return;
      }
      setError(null);
    } catch {
      setError("That didn't change. ‡");
    }
  }, []);

  const onDelete = useCallback(
    async (seq, sentAt) => {
      if (!withinWindow(sentAt)) {
        setError(TOO_LATE);
        return;
      }
      if (!(await confirm({ title: "Take that back? ‡", message: "It goes from here and from Discord. ‡", confirmLabel: "Take it back ‡" }))) {
        return;
      }
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't go. ‡");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go. ‡");
      }
    },
    [confirm],
  );

  // ---- Somebody else's line ------------------------------------------------

  // Look at, from the row rather than from a picker. The SHEET's own dialog,
  // opened with the speaker already chosen (RequestActionsProvider), so
  // nothing about the readout is forked — and the server re-resolves the
  // looker from the session and re-checks co-presence, which is why handing
  // it a character id off a row is safe.
  //
  // A GM has no dialogs mounted at all, so `open` is simply absent for them.
  const onLookAt = useCallback(
    (characterId) => {
      if (!characterId) return;
      openAction?.("examine", null, { targetId: characterId });
    },
    [openAction],
  );

  // Photograph. The camera is not spent (db/lib/photoMint.js) and the print
  // is deduped per (photographer, row) server-side, so a second press on the
  // same line gives back the same refusal the bot's 📸 does rather than a
  // second Tag row.
  const onPhotograph = useCallback((seq) => {
    setPhoto({ loading: true });
    photographRow(seq)
      .then((res) => {
        if (res?.ok) setPhoto({ readout: res.readout, photoName: res.photoName, line: res.line });
        else setPhoto({ error: res?.error ?? "The camera caught nothing. ‡" });
      })
      .catch(() => setPhoto({ error: "The camera caught nothing. ‡" }));
  }, []);

  // A GM taking a line down. Same route as Take back, with no character on
  // the session — db/lib/say.js#deleteSpeech skips the owner and the window
  // for a GM, and the route is the one that decides they are one.
  const onRemove = useCallback(
    async (seq) => {
      if (
        !(await confirm({
          title: "Remove this line? ‡",
          message: "It goes from here and from Discord. ‡",
          confirmLabel: "Remove it ‡",
        }))
      ) {
        return;
      }
      try {
        const res = await fetch("/api/feed/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "That didn't go. ‡");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go. ‡");
      }
    },
    [confirm],
  );

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    atBottomRef.current = near;
    setAtBottom(near);
    // Reading to the bottom is what clears the unread dot. Written on the
    // scroll, not on selection, so opening a busy room and scrolling away
    // still leaves the dot for what you have not read.
    if (near && placeKey) onSeen?.(placeKey, newestSeq(placeKey));
  }, [placeKey, onSeen]);

  // Scroll follows only a reader who is already at the bottom. Yanking
  // somebody back down while they are reading further up is the single most
  // annoying thing a chat window can do.
  // Only a DOM call, never a setState: react-hooks/set-state-in-effect is an
  // error here, and a "you have unread" flag would have needed one. Showing
  // the pill whenever the reader is scrolled up says the same thing without
  // a second piece of state to keep honest.
  // Scrolls the LIST, not the document: scrollIntoView walks every scrollable
  // ancestor, so on a phone it dragged the whole page down under the header
  // every time a row landed.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  // Changing place lands the reader at the newest line of the new place, the
  // way opening a channel does. The ref rather than state, so this makes no
  // render of its own.
  useEffect(() => {
    atBottomRef.current = true;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [placeKey]);

  // What actually clears the unread dot.
  //
  // This used to hang off the scroll handler alone, which meant a feed short
  // enough to fit on the screen never marked anything: the place you had just
  // spoken in went unread the moment you left it and stayed that way. So it
  // runs on opening a place and on every line that lands in it — while the
  // tab is in front of you and you are at the bottom of the list, which is
  // what "read" means. markSeen writes localStorage and notifies its own
  // store; it is not a setState, so an effect is where it belongs.
  useEffect(() => {
    if (!placeKey) return undefined;
    const catchUp = () => {
      if (document.visibilityState !== "visible") return;
      if (!atBottomRef.current) return;
      onSeen?.(placeKey, newestSeq(placeKey));
    };
    catchUp();
    // Lines that landed while the tab was in the background are read the
    // moment it comes back to the front.
    document.addEventListener("visibilitychange", catchUp);
    return () => document.removeEventListener("visibilitychange", catchUp);
  }, [placeKey, rows, onSeen]);

  // Where the NEW line goes: above the first row said since this place was
  // opened that somebody ELSE said. Your own line never gets one over it —
  // you were there — so speaking in a room you had read to the end does not
  // draw a divider above your own sentence.
  //
  // A place with no mark at all (never opened in this browser) gets no line;
  // seedSeenIfFresh has already caught a first visit up, so the only rows
  // this leaves undivided are ones nobody was waiting on.
  const newAt = useMemo(() => {
    if (!newMark) return null;
    let mark;
    try {
      mark = BigInt(newMark);
    } catch {
      return null;
    }
    for (const row of rows) {
      if (!row.seq || row.characterId === self.characterId) continue;
      try {
        if (BigInt(row.seq) > mark) return row.seq;
      } catch {
        return null;
      }
    }
    return null;
  }, [rows, newMark, self.characterId]);

  // Looks BACK at the previous row rather than carrying a running variable
  // forward: react-hooks/immutability forbids reassigning a closure variable
  // inside a render, and the answer is the same either way.
  //
  // `mine` is what draws ✎ and ✕: a confirmed row of this character's. The
  // five-minute window is NOT decided here — the clock moves while the page
  // sits open, and a render that read it would be deciding on a stale one (and
  // is impure besides). It is checked when the button is pressed, and again by
  // the server, which is the only check that counts.
  const withRuns = useMemo(
    () =>
      rows.map((row, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const at = row.sentAt ? new Date(row.sentAt).getTime() : 0;
        const prevAt = prev?.sentAt ? new Date(prev.sentAt).getTime() : 0;
        const system = row.source === "SYSTEM";
        const startsRun =
          !prev || prev.source === "SYSTEM" || prev.characterId !== row.characterId || at - prevAt > RUN_GAP_MS;
        // A GM watching with no living character has `self.characterId` null,
        // and so does a SYSTEM line's `row.characterId` — so without the first
        // half of this, every ownerless line in the scene wore Change and Take
        // back as if the GM had said it.
        const mine = Boolean(row.seq) && Boolean(self.characterId) && row.characterId === self.characterId;
        const theirs = Boolean(row.seq) && !system && Boolean(row.characterId) && !mine;
        // THE HOOD RULE, and it is the simplest correct one: the eye is
        // offered only on a row that carries the speaker's own name. A row
        // written under an alias — a hood, or a forced name — has
        // `row.alias` set (db/lib/archive.js#feedRowShape), and opening a
        // dialog on its character id would be looking a hood up BY ID, which
        // is exactly what the token in db/lib/whosHere.js exists to prevent.
        // The eye on that person is in HERE instead, where it goes through
        // examineHooded and never learns who they are.
        //
        // The camera has no such problem: it is pressed against a SEQ, the
        // server resolves the speaker itself, and a photograph of a hood is a
        // photograph of a hood — the same impoverished readout the 📸
        // reaction prints (db/lib/examine.js#concealedReadout).
        const canLook = theirs && !gm && Boolean(openAction) && !row.alias;
        const canPhoto = theirs && !gm && hasCamera;
        const canRemove = gm && Boolean(row.seq) && !system;
        return {
          row,
          startsRun,
          mine,
          system,
          canLook,
          canPhoto,
          canRemove,
          newLine: Boolean(row.seq) && row.seq === newAt,
        };
      }),
    [rows, self.characterId, newAt, gm, hasCamera, openAction],
  );

  if (!place) {
    return (
      <div className="hall-main">
        <div className="hall-feed">
          <EmptyState>Nowhere is open. ‡</EmptyState>
        </div>
      </div>
    );
  }

  // The head is the place's name and nothing else. The description used to
  // sit here with a "more" button on it, capped halfway down a fixed-height
  // strip; it belongs beside the scene rather than over it, and the turn is
  // already on the crumb above the whole Hall (layout.js).
  return (
    <div className="hall-main">
      <div className="hall-head">
        <h1 className="section-title">{place.name}</h1>
      </div>

      <div ref={scrollerRef} onScroll={onScroll} className="hall-feed">
        {withRuns.length === 0 ? (
          <EmptyState>Nothing has been said here yet. ‡</EmptyState>
        ) : (
          <ul className="list-none p-0">
            {withRuns.map(({ row, startsRun, mine, system, canLook, canPhoto, canRemove, newLine }) => {
              const key = row.clientId ?? row.seq;
              if (system) {
                return (
                  <Fragment key={key}>
                    {newLine && <NewLine />}
                    <SystemRow row={row} />
                  </Fragment>
                );
              }
              const editing = Boolean(row.seq) && row.seq === editingSeq;
              return (
                <Fragment key={editing ? `${row.seq}:edit` : key}>
                  {newLine && <NewLine />}
                  <FeedRow
                    // Keyed by the CLIENT id where there is one, which the
                    // confirmed row carries now too (feedStore.js#applyRow):
                    // the optimistic row and the row that confirms it are then
                    // one React element, so the <li> and its <img> survive the
                    // swap instead of one unmounting as the other mounts.
                    row={row}
                    startsRun={startsRun}
                    mine={mine}
                    canLook={canLook}
                    canPhoto={canPhoto}
                    canRemove={canRemove}
                    editing={editing}
                    coarse={coarse}
                    onRetry={onRetry}
                    onEdit={onEdit}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveEdit}
                    onDelete={onDelete}
                    onLookAt={onLookAt}
                    onPhotograph={onPhotograph}
                    onRemove={onRemove}
                  />
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {!atBottom && (
        <button
          type="button"
          className="btn-quiet hall-pill"
          onClick={() => {
            atBottomRef.current = true;
            setAtBottom(true);
            scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          New messages ‡
        </button>
      )}

      {/* Who is writing something, above the composer and below the scene.
          Holds its line's height whether or not anybody is, so the feed does
          not jump every time somebody starts and stops. */}
      <p className="hall-typing" aria-live="polite">
        {typing}
      </p>

      {!readOnly && (
        <div className="hall-composer">
          {place.canSpeak ? (
            <>
              <div className="field hall-composer-box">
                <textarea
                  id="hall-composer"
                  ref={textareaRef}
                  aria-label={`Say something in ${place.name} ‡`}
                  rows={2}
                  value={draft}
                  placeholder={`Say something in ${place.name}… ‡`}
                  onChange={onDraftChange}
                  onKeyDown={(e) => {
                    // The @ list owns the arrows and Enter while it is open —
                    // it is the thing the keystroke is aimed at.
                    if (mention && matches.length > 0) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const step = e.key === "ArrowDown" ? 1 : matches.length - 1;
                        setMention((m) => (m ? { ...m, active: (m.active + step) % matches.length } : m));
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickMention(matches[mention.active] ?? matches[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                    }
                    // A phone keyboard's Enter is a newline, as it is in
                    // Discord's app; the button beside the box is the send
                    // there. On a keyboard Enter sends and Shift+Enter breaks
                    // the line.
                    if (coarse || e.key !== "Enter" || e.shiftKey) return;
                    e.preventDefault();
                    submit();
                  }}
                />
                {mention && (
                  <MentionMenu matches={matches} active={mention.active} onPick={pickMention} />
                )}
              </div>
              {waitSeconds > 0 && (
                // Slowmode, said as a clock rather than as a refusal. The
                // zone summary is the only place that has one.
                <span className="hall-countdown mono" data-nudge={nudge ? "true" : undefined} aria-live="polite">
                  {waitSeconds} s ‡
                </span>
              )}
              {coarse && (
                <button type="button" className="btn" onClick={submit} disabled={!draft.trim() || waitSeconds > 0}>
                  Send ‡
                </button>
              )}
            </>
          ) : (
            // A Location is the street's scenery, not its speech (CHANNELS.md
            // §2). Saying so beats a composer that refuses.
            <p className="hall-quiet">
              {place.kind === "loc"
                ? "This is the open street. Step into a room to speak. ‡"
                : "You can only watch here. ‡"}
            </p>
          )}
          {/* The phone's way to the right column: the people, the place panel
              and the You strip, as a sheet over the scene. Hidden on a
              desktop by the same media query that hides the column, since
              there it would only open what is already on screen. */}
          <span className="hall-sheet-trigger">
            <IconButton icon={MoreIcon} label="Here ‡" disabled={!onOpenSheet} onClick={onOpenSheet ?? undefined} />
          </span>
        </div>
      )}

      <FormError>{error}</FormError>

      {photo && <PhotoReadout state={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
}
