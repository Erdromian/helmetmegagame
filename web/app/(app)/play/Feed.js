"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import Modal from "@/app/components/Modal";
import { CameraIcon, EditIcon, EyeIcon, HoodIcon, MoreIcon, NotesIcon, QuillIcon, SearchIcon, TrashIcon } from "@/app/components/icons";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRequestActions } from "@/app/components/RequestActionsProvider";
import { Readout } from "@/app/components/ExamineDialog";
import useActionRunner from "@/app/components/useActionRunner";
import { photographRow, starRow, lookAt, loadTravel, placeMembers, toggleConceal } from "./actions";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import {
  useFeed,
  useHistoryState,
  applyRow,
  addPending,
  markPendingFailed,
  retryPending,
  newestSeq,
} from "./feedStore";
import FeedSearch from "./FeedSearch";
import { useTyping, typingLine } from "./typingStore";
import { peekSeen } from "./seenStore";
// By PATH, never through the @lifeweb/db barrel: the barrel pulls Prisma and
// node:fs into whatever imports it, and this is a "use client" file. That
// module is pure string work with no requires of its own, so it is safe here
// — and it has to be here, or the row this composer draws says something
// different from the row the server writes a moment later.
import { capitalizeSentences, fixContractions } from "@lifeweb/db/lib/textCorrection";
import MentionMenu, { mentionQueryAt, matchRoster } from "./MentionMenu";
import CommandMenu from "./CommandMenu";
import MembersStrip from "./MembersStrip";
import {
  commandsFor,
  exactCommand,
  matchCommands,
  pendingArg,
  slashQueryAt,
  textArgOf,
} from "./commands";
import { MOVE_KINDS } from "./MoveDialog";

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
    <li className="hall-subtext" data-seq={row.seq ?? undefined}>
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
      <span>NEW</span>
    </li>
  );
}

// What a place looks like while its backlog is on the wire. Three faded rows
// with no words in them, so the shape of the scene is already on the page when
// the rows land and nothing has to say "Nothing has been said here yet. ‡"
// first and then take it back. Tokens only, and aria-hidden: there is nothing
// here for a screen reader to read.
export function FeedSkeleton() {
  return (
    <ul className="list-none p-0" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="hall-skeleton">
          <span className="hall-skeleton-face" />
          <span className="hall-skeleton-lines">
            <span className="hall-skeleton-bar" data-w="short" />
            <span className="hall-skeleton-bar" />
          </span>
        </li>
      ))}
    </ul>
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
  onStar,
  onRemove,
}) {
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(row.content ?? "");

  // Always reachable on a touch screen, where there is no hover to reveal
  // them; out of the way of a mouse until it is over the row.
  // ⭐ is offered on every line that HAS a seq — your own included, exactly as
  // the reaction is in Discord — which is what widened the bar past the rows
  // somebody can act against. A system line with no seq still has nothing.
  const anyAction = mine || canLook || canPhoto || canRemove || row.seq != null;
  const showActions = anyAction && !editing && !row.pending && (coarse || hover);

  return (
    <li
      className="hall-row"
      data-seq={row.seq ?? undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-run={startsRun ? "start" : undefined}
      data-pending={row.pending ? "true" : undefined}
    >
      <div className="hall-row-face">
        {startsRun && (
          <CharacterAvatar characterId={row.characterId} name={row.name ?? ""} version={row.avatarVersion} size={32} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {startsRun && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{row.name}</span>
            <span className="mono text-xs text-muted">{timeLabel(row.sentAt)}</span>
            {row.editedAt && <span className="text-xs text-muted">(edited)</span>}
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
                Save
              </button>
              <button type="button" className="btn-quiet" onClick={onCancelEdit}>
                Cancel
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
                <IconButton icon={EditIcon} label="Change" onClick={() => onEdit(row.seq, row.sentAt)} />
                <IconButton icon={TrashIcon} label="Take back" onClick={() => onDelete(row.seq, row.sentAt)} />
              </>
            )}
            {canLook && (
              <IconButton icon={EyeIcon} label="Look at" onClick={() => onLookAt(row.characterId)} />
            )}
            {canPhoto && (
              <IconButton icon={CameraIcon} label="Photograph" onClick={() => onPhotograph(row.seq)} />
            )}
            {row.seq != null && (
              <IconButton icon={NotesIcon} label="Save to Notes" onClick={() => onStar(row.seq)} />
            )}
            {canRemove && (
              <IconButton icon={TrashIcon} label="Remove" onClick={() => onRemove(row.seq)} />
            )}
          </div>
        )}

        {row.failed && (
          <button type="button" className="btn-quiet" onClick={() => onRetry(row.clientId)}>
            Try again
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
    <Modal open title={readout?.name ?? "Photograph"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Winding the film…</p>}
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
          <p className="text-xs text-muted">{state.photoName}</p>
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

// How often the members strip re-reads itself with nothing prompting it. See
// the interval in Feed() for why a push-only strip is not enough.
const MEMBERS_REFRESH_MS = 60_000;

// What the open street answers to a sentence somebody typed at it. One string,
// because the command-only composer says it on Enter and the read-only fall-
// through below says it where there is no composer at all.
const STREET_LINE = "This is the open street. Step into a room to speak. ‡";

// The chips a command still wants: a person, a Move kind, or a destination.
//
// One row at a time — the FIRST unfilled argument is the question being
// asked. Drawing every argument at once would make this a form, and the whole
// point of a command line is that it asks one thing and then gets out of the
// way.
//
// The person row includes HOODS where the command says it may (`/look`), and
// their value is the opaque token db/lib/whosHere.js minted, not an id: the
// browser is never told who is under one.
// At most this many faces in the person row. Past a dozen the chips wrap into
// a wall and the box they belong to is off the bottom of the screen; the
// filter below is what a player uses to get past it.
const PERSON_CHIP_LIMIT = 12;

function CommandArgs({ command, people, members, query = "", onPick }) {
  const { entry, values } = command;
  const arg = pendingArg(entry, values);
  const [destinations, setDestinations] = useState(null);

  // The reachable places, only for a command that asks for one. Fetched on
  // demand rather than with the page: an exit's state moves under a player
  // standing still, and a stale list would offer a shut gate.
  useEffect(() => {
    if (arg?.kind !== "destination") return undefined;
    let cancelled = false;
    loadTravel()
      .then((res) => {
        if (!cancelled) setDestinations(res?.ok ? res.options : []);
      })
      .catch(() => {
        if (!cancelled) setDestinations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [arg?.kind]);

  if (!arg) return null;

  if (arg.kind === "moveKind") {
    return (
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move">
        {MOVE_KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={values[arg.name] === kind.value}
            className="chip"
            data-active={values[arg.name] === kind.value ? "true" : undefined}
            // The textarea must not lose focus to a chip: the next thing the
            // player types is the command's text argument.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, kind.value)}
          >
            {kind.label}
          </button>
        ))}
      </div>
    );
  }

  if (arg.kind === "destination") {
    if (!destinations) return <p className="text-sm text-muted">Reading the road…</p>;
    if (destinations.length === 0) return <p className="text-sm text-muted">No way out of here. ‡</p>;
    return (
      <div className="chip-row" aria-label="Where to">
        {destinations.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            title={option.reason ?? undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
    );
  }

  // `from: "members"` is /remove, whose people are the guest list rather than
  // the street — a conversation member need not be standing beside you. It
  // falls back to who is here when the list has not landed.
  const roster =
    arg.from === "members" && members.length > 0
      ? members
      : [...(people?.named ?? []), ...(arg.hoods ? (people?.concealed ?? []) : [])];

  if (roster.length === 0) return <p className="text-sm text-muted">Nobody to pick.</p>;

  // What is in the box FILTERS the row. A command that asks for a person has
  // no text argument, so the textarea is doing nothing else — and a Location
  // with thirty people in it is otherwise a picker you scroll rather than one
  // you use. Same prefix rule as the @ list, so the two behave alike.
  const hits = matchRoster(roster, query, Infinity);
  const shown = hits.slice(0, PERSON_CHIP_LIMIT);
  const more = hits.length - shown.length;

  if (shown.length === 0) return <p className="text-sm text-muted">Nobody here by that name. ‡</p>;

  return (
    <div className="chip-row" aria-label="Who">
      {shown.map((person, index) => {
        // A hood has no characterId — the token is the whole handle, and it
        // is what the server resolves back against the people standing here.
        const value = person.characterId ?? person.token ?? null;
        const label = person.name ?? person.alias ?? "somebody";
        return (
          <button
            key={value ?? `hooded-${index}`}
            type="button"
            className="chip"
            disabled={!value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(arg.name, value)}
          >
            {label}
          </button>
        );
      })}
      {more > 0 && <span className="text-sm text-muted">…and {more} more</span>}
    </div>
  );
}

// `/look`'s answer. The SAME readout the sheet's Look at dialog draws
// (web/app/components/ExamineDialog.js), so a stranger looked at from the
// composer tells you exactly what one looked at from the column does.
function LookReadout({ state, onClose }) {
  const readout = state?.readout ?? null;
  return (
    <Modal open title={readout?.name ?? "Look at"} onClose={onClose} width="default">
      <div className="flex flex-col gap-2">
        {state?.loading && <p className="text-sm text-muted">Looking…</p>}
        {state?.error && <FormError>{state.error}</FormError>}
        {readout && <Readout readout={readout} />}
      </div>
    </Modal>
  );
}

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
  // The Location's noticeboard, as cards pinned above the scene. A node
  // rather than data: Hall.js owns the board's state, because the Noticeboard
  // dialog in the right column pins to the same board this draws.
  notices = null,
  // A search hit somebody clicked: Hall.js selects the place and loads the
  // window around the seq, and hands the seq back here to scroll to.
  // { seq, at } — `at` is a timestamp, so clicking the same hit twice scrolls
  // twice.
  jump = null,
  onJump = null,
  // The rows page.js server-rendered, and which place they belong to.
  // feedStore.js is a module-level client store, so its server snapshot is
  // empty by construction — without this the SERVER paint of a busy street
  // was a skeleton, and the scene only appeared once the browser had
  // hydrated. Used only while the store has nothing for that place, which
  // after hydration is never (Hall.js seeds it in a state initializer).
  fallbackPlace = null,
  fallbackRows = null,
  // whosHere() whole — named AND hoods. `roster` above is the @ list and has
  // no hoods in it on purpose; the slash commands' person picker does, because
  // Look at is the one thing you may do to somebody you cannot name.
  people = null,
  // What the composer's commands can do that a server action cannot: pick a
  // node in the Travel grid, open the Converse dialog. Hall.js owns both,
  // because both live in the right column.
  onTravelPick = null,
  onConverse = null,
  // Bumped by Hall.js on the stream's `places` event, so a key turning or
  // somebody else's /add re-reads the members strip.
  placesVersion = 0,
  // Paperwork, beside the composer rather than on the sheet
  // (docs/systemdocs/PAPERWORK.md): { canWrite, canSeal, hasBird,
  // birdSentToday }, all resolved server-side in web/lib/selfPools.js. Each
  // entry opens the SHEET's own dialog; the four actions re-check every gate.
  letters = null,
  // The hood (PROXYING.md §5). `canConceal` is "something over your face that
  // is not forced" — drawn only then, because a bare face has nothing to
  // toggle. `alias` is what the room reads while it is on, which is what the
  // composer says its name is.
  canConceal = false,
  concealed = false,
  alias = null,
}) {
  const placeKey = place?.placeKey ?? null;
  const stored = useFeed(placeKey);
  // "idle" | "loading" | "loaded". The empty state is only honest once the
  // backlog is actually in; before that it is the skeleton's turn.
  const historyState = useHistoryState(placeKey);
  // Which commands the open place allows (./commands.js). Recomputed per
  // place rather than filtered at use: a /roll offered in the street and
  // refused on Enter is a control that lied.
  const available = useMemo(() => commandsFor(place?.kind), [place?.kind]);
  // A COMMAND-ONLY composer. The street takes no speech (CHANNELS.md §2) and
  // used to take no box either — which quietly meant /shout, the one command
  // whose whole point is being heard outdoors, had nowhere to be typed
  // (HALL.md §5). So the box is drawn, and it accepts a `/` and nothing else:
  // plain text answers with the same sentence that used to sit here instead.
  const commandOnly = Boolean(place) && !place.canSpeak && place.kind === "loc";
  // The server rows stand in only until this place's history is actually
  // loaded. Past that the store IS the scene — and it was the fallback that
  // brought a deleted line back: take the only line in a quiet street down,
  // the store empties, and the server's copy from page-load slid in behind it
  // as though nothing had happened.
  const rows =
    historyState !== "loaded" &&
    stored.length === 0 &&
    placeKey &&
    placeKey === fallbackPlace &&
    fallbackRows?.length
      ? fallbackRows
      : stored;
  const [searchOpen, setSearchOpen] = useState(false);
  // The `at` of a jump whose failure the reader has already waved away, so
  // closing the search box after a miss actually closes it.
  const [dismissedJump, setDismissedJump] = useState(null);
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
  // The ✉ menu's entries. Each one is shown only where the SHEET would show
  // it, off the same server-resolved gates (web/lib/selfPools.js), and each
  // opens the sheet's own dialog. The bird is the one that greys rather than
  // hides: it is a thing you have and have already used today, and saying so
  // is better than a button that vanishes overnight.
  const lettersMenu = useMemo(() => {
    if (!letters || !openAction) return [];
    const rows = [];
    if (letters.canWrite) rows.push({ mode: "write", label: "Write" });
    if (letters.canSeal) rows.push({ mode: "seal", label: "Seal" });
    if (letters.hasBird) {
      rows.push({
        mode: "bird",
        label: letters.birdSentToday ? "Sent today" : "Send by bird",
        disabled: Boolean(letters.birdSentToday),
      });
    }
    return rows;
  }, [letters, openAction]);

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
  // ---- Slash commands ------------------------------------------------------
  //
  // Three pieces of state, and they are three because they change on three
  // different keystrokes.
  //
  //   slash    { query, active } while the `/` popover is open. Null the rest
  //            of the time, including all of command mode — once a command is
  //            picked there is nothing left to autocomplete.
  //   command  { entry, values } — command MODE. The chip in the box is drawn
  //            off `entry`, and the textarea holds the entry's one text arg.
  //   cmdLine  what the command answered, under the composer. Cleared on the
  //            next keystroke, so it never outlives the thing it explains.
  const [slash, setSlash] = useState(null);
  const [command, setCommand] = useState(null);
  const [cmdLine, setCmdLine] = useState(null);
  // A hood's readout, or a named person's, from `/look`. One path for both:
  // the server tells a 32-hex token from a cuid itself, so the browser never
  // learns which it sent (play/actions.js#lookAt).
  const [look, setLook] = useState(null);
  // The ✉ menu beside the composer, and the hood's own in-flight state. Both
  // are the composer's, not the scene's, so they live here.
  const [lettersOpen, setLettersOpen] = useState(false);
  const [concealPending, startConceal] = useTransition();
  const [concealError, setConcealError] = useState(null);
  const router = useRouter();
  const {
    run: runCommand,
    pending: cmdPending,
    error: cmdError,
    setError: setCmdError,
  } = useActionRunner();
  // Who is in this conversation or private room, and who could be let in.
  // Loaded here rather than inside MembersStrip because `/remove`'s picker is
  // the same list, and two fetches of it would be two answers to one question.
  const [members, setMembers] = useState(null);
  const [membersNonce, setMembersNonce] = useState(0);
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
            setError(data?.error ?? "That didn't send.");
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
          setError(data?.error ?? "That didn't send.");
          markPendingFailed(placeKey, clientId);
          return;
        }
        setError(null);
        if (data?.row) applyRow(placeKey, data.row);
      } catch {
        setError("That didn't send.");
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

  const cmdMatches = useMemo(
    () => (slash ? matchCommands(available, slash.query) : []),
    [slash, available],
  );

  // Only two kinds of place have a guest list at all: a conversation, and a
  // PRIVATE room. Asked about anywhere else, placeMembers() answers with a
  // null `members` rather than a refusal — but not asking is cheaper.
  const hasMembers =
    place?.kind === "conv" || (place?.kind === "room" && place?.roomKind === "PRIVATE");

  useEffect(() => {
    if (!hasMembers || !placeKey) return undefined;
    let cancelled = false;
    placeMembers(placeKey)
      .then((res) => {
        // Stamped with the place it answers for. The state outlives a walk
        // across town, and an unstamped answer would draw the last room's
        // guest list over this one's for a frame.
        if (!cancelled) setMembers({ placeKey, res });
      })
      .catch(() => {
        if (!cancelled) {
          setMembers({ placeKey, res: { ok: false, error: "Couldn't read who is in here. ‡" } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasMembers, placeKey, membersNonce, placesVersion]);

  // And once a minute regardless. The strip learns about a change from the
  // stream's `places` frame and from a message in this place (Hall.js), but
  // neither fires for a key GRANTED to somebody else while nobody is talking —
  // there is no frame for that at all — so the list could sit wrong for as
  // long as the room stayed quiet. A minute is slow enough to cost nothing and
  // quick enough that nobody notices they waited.
  useEffect(() => {
    if (!hasMembers || !placeKey) return undefined;
    const timer = setInterval(() => setMembersNonce((n) => n + 1), MEMBERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasMembers, placeKey]);

  const reloadMembers = useCallback(() => setMembersNonce((n) => n + 1), []);
  const membersData = members?.placeKey === placeKey ? members.res : null;

  // The `@word` under the caret, recomputed on every edit. In the handler, not
  // an effect: the caret is a DOM fact and reading it during a render would be
  // both impure and a frame late.
  const onDraftChange = useCallback(
    (event) => {
      const value = event.target.value;
      const caret = event.target.selectionStart ?? value.length;
      // The last command's answer explains the box as it was a moment ago, so
      // it goes the instant the box changes.
      setCmdLine(null);
      setCmdError(null);

      // Already in command mode: the box is the command's text argument, and
      // neither menu belongs in it.
      if (command) {
        setDraft(value);
        pingTyping();
        return;
      }

      // `/shout ` — the whole name and a space. Discord's composer does this,
      // and it is how anybody who knows the command avoids the menu entirely.
      const exact = exactCommand(available, value);
      if (exact) {
        setDraft("");
        setSlash(null);
        setMention(null);
        setCommand({ entry: exact, values: {} });
        return;
      }

      setDraft(value);
      const found = slashQueryAt(value, caret);
      if (found) {
        setSlash({ ...found, active: 0 });
        setMention(null);
        pingTyping();
        return;
      }
      setSlash(null);
      const mentioned = mentionQueryAt(value, caret);
      setMention(mentioned ? { ...mentioned, active: 0 } : null);
      pingTyping();
    },
    [pingTyping, command, available, setCmdError],
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

  // ---- Command mode --------------------------------------------------------

  // Leaving command mode. The typed text comes BACK into the box rather than
  // being thrown away — Escape on a half-written /report should not cost
  // somebody the paragraph they had written into it.
  const exitCommand = useCallback(
    (keepText = "") => {
      setCommand(null);
      setSlash(null);
      setCmdError(null);
      setDraft(keepText);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setCmdError],
  );

  const pickCommand = useCallback((entry) => {
    setSlash(null);
    setMention(null);
    setDraft("");
    setCmdLine(null);
    setCommand({ entry, values: {} });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // Looking somebody up from `/look`. ONE path for a name and for a hood: the
  // server tells a 32-hex token from a character id itself, so the browser is
  // never told which of the two it is holding (play/actions.js#lookAt).
  const onLookUp = useCallback((ref) => {
    setLook({ loading: true });
    lookAt(ref)
      .then((res) => {
        if (res?.ok) setLook({ readout: res.readout });
        else setLook({ error: res?.error ?? "You can't see them." });
      })
      .catch(() => setLook({ error: "You can't see them." }));
  }, []);

  // What a command can reach that a server action cannot. Hall.js owns the
  // travel grid and the Converse dialog, so both arrive as callbacks.
  const commandCtx = useMemo(
    () => ({
      placeKey,
      travelTo: onTravelPick,
      converse: onConverse,
      lookAt: onLookUp,
    }),
    [placeKey, onTravelPick, onConverse, onLookUp],
  );

  // Enter, in command mode. Every gate here is a hint — each command's `run`
  // lands on a server action that re-resolves the actor and re-checks
  // everything, so a missing argument caught here only spares a round trip.
  const runCurrent = useCallback(() => {
    if (!command) return;
    const { entry, values } = command;
    const textArg = textArgOf(entry);
    const body = draft.trim();
    if (textArg && !body) {
      setCmdError("Write something first.");
      return;
    }
    if (textArg?.maxLength && body.length > textArg.maxLength) {
      setCmdError(`That is ${body.length} characters, and the most is ${textArg.maxLength}. ‡`);
      return;
    }
    const missing = pendingArg(entry, values);
    if (missing) {
      setCmdError("Pick one first.");
      return;
    }
    const filled = textArg ? { ...values, [textArg.name]: body } : values;
    runCommand(
      // `run` may answer with nothing at all — /look and /converse only open
      // something — and useActionRunner reads a missing `ok` as a failure.
      async () => (await entry.run(filled, commandCtx)) ?? { ok: true },
      undefined,
      {
        onOk: (res) => {
          setCommand(null);
          setDraft("");
          setCmdLine(res?.line ?? null);
        },
      },
    );
  }, [command, draft, runCommand, commandCtx, setCmdError]);

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content || !placeKey) return;
    // The street's box is for commands. The draft is KEPT — a player who meant
    // to shout is one slash away from meaning it — and the sentence says which
    // slash-less thing they just did.
    if (commandOnly) {
      setError(STREET_LINE);
      return;
    }
    // Inside the hold. The draft is kept — it is theirs, and they will send
    // it in a second — and the chip is what says so.
    if (deadline > Date.now()) {
      setError(`Slowmode. Wait ${Math.max(1, Math.ceil((deadline - Date.now()) / 1000))} s.`);
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
  }, [draft, placeKey, self, send, autocorrect, slowmodeMs, deadline, commandOnly]);

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
        setError(data?.error ?? "That didn't change.");
        return;
      }
      setError(null);
    } catch {
      setError("That didn't change.");
    }
  }, []);

  const onDelete = useCallback(
    async (seq, sentAt) => {
      if (!withinWindow(sentAt)) {
        setError(TOO_LATE);
        return;
      }
      if (!(await confirm({ title: "Take that back?", message: "It goes from here and from Discord. ‡", confirmLabel: "Take it back" }))) {
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
          setError(data?.error ?? "That didn't go.");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go.");
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
        else setPhoto({ error: res?.error ?? "The camera caught nothing." });
      })
      .catch(() => setPhoto({ error: "The camera caught nothing." }));
  }, []);

  // ⭐ — the web twin of the reaction in Discord. It writes the same `Note`
  // row, and the server upsert makes a second press on the same line a no-op
  // rather than a second note, so this needs no pressed state of its own.
  // The answer goes on the composer's quiet line, where every other one-shot
  // command answer already lands.
  const onStar = useCallback((seq) => {
    setCmdError(null);
    starRow(seq)
      .then((res) => {
        if (res?.ok) setCmdLine(res.line ?? "Saved to your Notes.");
        else setCmdError(res?.error ?? "That line is gone.");
      })
      .catch(() => setCmdError("Could not reach the server. Nothing was changed. ‡"));
  }, [setCmdError]);

  // A GM taking a line down. Same route as Take back, with no character on
  // the session — db/lib/say.js#deleteSpeech skips the owner and the window
  // for a GM, and the route is the one that decides they are one.
  const onRemove = useCallback(
    async (seq) => {
      if (
        !(await confirm({
          title: "Remove this line?",
          message: "It goes from here and from Discord. ‡",
          confirmLabel: "Remove it",
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
          setError(data?.error ?? "That didn't go.");
          return;
        }
        setError(null);
      } catch {
        setError("That didn't go.");
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

  // A search hit. The row is already in the store by the time this runs —
  // Hall.js loads the window around the seq before it hands the jump down —
  // so this is only the scroll and the flash. DOM calls, no state: the
  // highlight is an attribute the CSS animates and then nobody looks at
  // again.
  useEffect(() => {
    // Only once the place it names is the place on screen: setting the hash
    // and setting this happen together, but the hashchange that swaps the
    // place arrives a beat later.
    if (!jump?.seq || jump.placeKey !== placeKey) return undefined;
    const el = scrollerRef.current;
    if (!el) return undefined;
    const row = el.querySelector(`[data-seq="${CSS.escape(String(jump.seq))}"]`);
    if (!row) return undefined;
    // The reader is being taken somewhere on purpose, so the follow-the-bottom
    // rule stands down until they scroll again.
    atBottomRef.current = false;
    row.scrollIntoView({ block: "center" });
    row.setAttribute("data-hit", "true");
    const timer = setTimeout(() => row.removeAttribute("data-hit"), 2000);
    return () => clearTimeout(timer);
  }, [jump, placeKey]);

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
          <EmptyState>Nowhere is open.</EmptyState>
        </div>
      </div>
    );
  }

  // A search hit that went nowhere. Hall.js loads the window around the seq
  // and then opens the place, so by the time this place's history is LOADED
  // the line should be among its rows — and if it is not (a line deleted
  // between the search and the click, a window request that failed), the box
  // closing on nothing at all reads as a broken button. So the box comes back
  // and says so. Derived from the rows rather than from the DOM, and derived
  // rather than stored: react-hooks/set-state-in-effect is an error here.
  const jumpMissed =
    Boolean(jump?.seq) &&
    jump.placeKey === placeKey &&
    historyState === "loaded" &&
    jump.at !== dismissedJump &&
    !rows.some((row) => String(row.seq) === String(jump.seq));
  const showSearch = Boolean(onJump) && (searchOpen || jumpMissed);
  const closeSearch = () => {
    setSearchOpen(false);
    setDismissedJump(jump?.at ?? null);
  };

  // The head is the place's name and nothing else. The description used to
  // sit here with a "more" button on it, capped halfway down a fixed-height
  // strip; it belongs beside the scene rather than over it, and the turn is
  // already on the crumb above the whole Hall (layout.js).
  return (
    <div className="hall-main">
      <div className="hall-head">
        <h1 className="section-title">{place.name}</h1>
        {onJump && (
          <IconButton
            icon={SearchIcon}
            label="Search what was said"
            aria-expanded={showSearch}
            onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))}
          />
        )}
      </div>

      {/* Who is in this conversation or private room, and the two buttons that
          change it. Only those two kinds of place have one — MembersStrip
          draws nothing when placeMembers() answers with no list. */}
      {hasMembers && !readOnly && (
        <MembersStrip placeKey={placeKey} data={membersData} onChanged={reloadMembers} />
      )}

      {showSearch && (
        <FeedSearch
          place={place}
          notice={jumpMissed ? "Couldn't find that line." : null}
          onClose={closeSearch}
          onPick={(hitPlace, seq) => {
            // Not dismissed: if this hit turns out to be gone too, the box has
            // to come back and say so rather than shutting on nothing.
            setSearchOpen(false);
            onJump(hitPlace, seq);
          }}
        />
      )}

      <div ref={scrollerRef} onScroll={onScroll} className="hall-feed">
        {/* The board is nailed to the top of the street, not filed into it in
            the order it went up: a notice is a thing standing there, and it
            has to still be readable after fifty lines of scene. */}
        {notices}
        {withRuns.length === 0 ? (
          historyState === "loaded" ? (
            <EmptyState>Nothing has been said here yet. ‡</EmptyState>
          ) : (
            <FeedSkeleton />
          )
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
                    onStar={onStar}
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
          New messages
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
          {place.canSpeak || commandOnly ? (
            <>
              <div className="field hall-composer-box">
                {command && (
                  <span className="hall-cmd-chip mono" data-cmd={command.entry.name}>
                    /{command.entry.name}
                  </span>
                )}
                <textarea
                  id="hall-composer"
                  ref={textareaRef}
                  aria-label={
                    commandOnly
                      ? `Run a command in ${place.name} ‡`
                      : concealed && alias
                        ? `Say something as ${alias}`
                        : `Say something in ${place.name}`
                  }
                  rows={2}
                  value={draft}
                  placeholder={
                    command
                      ? (textArgOf(command.entry)?.placeholder ?? "Press Enter to run it ‡")
                      : commandOnly
                        ? "Type / for a command…"
                        : concealed && alias
                          ? `Say something as ${alias}…`
                          : `Say something in ${place.name}…`
                  }
                  onChange={onDraftChange}
                  onKeyDown={(e) => {
                    // The `/` list owns the keys while it is open, the same
                    // way the @ list does below — and it is checked first,
                    // because the two are never open at once and this one is
                    // the more recently opened when they compete.
                    if (slash && cmdMatches.length > 0) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const step = e.key === "ArrowDown" ? 1 : cmdMatches.length - 1;
                        setSlash((cur) => (cur ? { ...cur, active: (cur.active + step) % cmdMatches.length } : cur));
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickCommand(cmdMatches[slash.active] ?? cmdMatches[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSlash(null);
                        return;
                      }
                    }
                    // In command mode the box belongs to the command. Escape
                    // drops the chip; so does Backspace on an empty box, which
                    // is how Discord's composer lets go of one.
                    if (command) {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        exitCommand(`/${command.entry.name} `);
                        return;
                      }
                      if (e.key === "Backspace" && draft.length === 0) {
                        e.preventDefault();
                        exitCommand(`/${command.entry.name}`);
                        return;
                      }
                      if (!coarse && e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        runCurrent();
                        return;
                      }
                      return;
                    }
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
                {slash && (
                  <CommandMenu matches={cmdMatches} active={slash.active} onPick={pickCommand} />
                )}
                {/* The arguments a command still wants, as chips under the
                    box. One row at a time: the first unfilled one is the
                    question being asked, and drawing all of them at once would
                    be a form rather than a command line. */}
                {command && (
                  <CommandArgs
                    command={command}
                    people={people}
                    members={membersData?.members ?? []}
                    query={draft}
                    onPick={(name, value) =>
                      setCommand((cur) => (cur ? { ...cur, values: { ...cur.values, [name]: value } } : cur))
                    }
                  />
                )}
              </div>
              {waitSeconds > 0 && (
                // Slowmode, said as a clock rather than as a refusal. The
                // zone summary is the only place that has one.
                <span className="hall-countdown mono" data-nudge={nudge ? "true" : undefined} aria-live="polite">
                  {waitSeconds} s
                </span>
              )}
              {coarse && (
                // A phone's Enter is a newline (Discord's app does the same),
                // so this button is the only way to run a command there too.
                <button
                  type="button"
                  className="btn"
                  onClick={command ? runCurrent : submit}
                  disabled={
                    command
                      ? cmdPending || (Boolean(textArgOf(command.entry)) && !draft.trim())
                      : // In the street the button is live with text in the box
                        // on purpose: pressing it is how a phone hears the
                        // sentence explaining why nothing was said.
                        !draft.trim() || (!commandOnly && waitSeconds > 0)
                  }
                >
                  {command ? "Run" : "Send"}
                </button>
              )}
            </>
          ) : (
            // Everywhere else a character may read but not speak — the zone
            // summary they are only listed in, somewhere a GM is watching.
            // The street is not here any more: it has the command-only box
            // above, and says STREET_LINE when somebody types prose into it.
            <p className="hall-quiet">You can only watch here. ‡</p>
          )}
          {/* Paperwork and the hood, beside the send. Neither is a place's
              affordance — they are things you do with your own hands wherever
              you are standing — so they sit on the composer rather than in the
              right column. */}
          {(lettersMenu.length > 0 || canConceal) && (
            <span className="hall-composer-tools">
              {lettersMenu.length > 0 && (
                <span className="hall-tool-wrap">
                  <IconButton
                    icon={QuillIcon}
                    label="Letters"
                    aria-haspopup="menu"
                    aria-expanded={lettersOpen}
                    onClick={() => setLettersOpen((was) => !was)}
                  />
                  {lettersOpen && (
                    <div className="hall-menu" role="menu" aria-label="Letters">
                      {lettersMenu.map((entry) => (
                        <button
                          key={entry.mode}
                          type="button"
                          role="menuitem"
                          className="menu-item"
                          disabled={entry.disabled}
                          onClick={() => {
                            setLettersOpen(false);
                            openAction?.(entry.mode);
                          }}
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              )}
              {canConceal && (
                <IconButton
                  icon={HoodIcon}
                  label={concealed ? "Take the hood off" : "Put the hood up"}
                  aria-pressed={concealed}
                  disabled={concealPending}
                  onClick={() => {
                    setConcealError(null);
                    startConceal(async () => {
                      try {
                        const res = await toggleConceal();
                        // The name every row this composer writes will wear
                        // is a server prop, so the page is what has to
                        // re-read it.
                        if (res?.ok) router.refresh();
                        else setConcealError(res?.error ?? "Something went wrong.");
                      } catch {
                        setConcealError("Could not reach the server. Nothing was changed. ‡");
                      }
                    });
                  }}
                />
              )}
            </span>
          )}
          {/* The phone's way to the right column: the people, the place panel
              and the You strip, as a sheet over the scene. Hidden on a
              desktop by the same media query that hides the column, since
              there it would only open what is already on screen. */}
          <span className="hall-sheet-trigger">
            <IconButton icon={MoreIcon} label="Here" disabled={!onOpenSheet} onClick={onOpenSheet ?? undefined} />
          </span>
        </div>
      )}

      {/* What a command answered. A server string a player reads, so it is
          rendered rather than printed — several of them carry a `**` because
          the same sentence goes out to Discord too. */}
      {cmdLine && (
        <div className="hall-quiet-line">
          <ChatMarkdown content={cmdLine} />
        </div>
      )}
      <FormError>{error ?? cmdError ?? concealError}</FormError>

      {photo && <PhotoReadout state={photo} onClose={() => setPhoto(null)} />}
      {look && <LookReadout state={look} onClose={() => setLook(null)} />}
    </div>
  );
}
