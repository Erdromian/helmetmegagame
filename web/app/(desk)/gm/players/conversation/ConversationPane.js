"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DevPanelModal from "@/app/components/DevPanelModal";
import ZoneChip from "@/app/components/ZoneChip";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import IconButton from "@/app/components/IconButton";
import { SendIcon } from "@/app/components/icons";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { useThreadFeed, noteConversationRead } from "../liveInbox";
import {
  sendGmDm,
  markConversationRead,
  claimConversation,
  releaseConversation,
} from "../actions";
import { useDmDraft, writeDmDraft, dmDraftFresh } from "../dmDraft";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { selectConversation } from "../selection";
import { dialogHoldsKeyboard } from "@/app/components/Modal";

// The centre column: a real chat pane rather than a thread block sitting in
// document flow. The transcript takes the height that's left and scrolls
// inside itself; the composer is pinned to the bottom where a composer
// belongs.
let optimisticSeq = 0;

// One id per send, minted before the send and kept across a Retry. It is what
// pairs the optimistic line with the row that comes back, and it is what makes
// Retry safe: the server finds the nonce already on the table and returns that
// row instead of delivering a second copy.
function mintNonce() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function ConversationPane({
  discordUserId,
  label,
  characterId,
  avatarVersion,
  zoneName,
  status,
  moveId,
  initialMessages,
  initialHasMore,
  gmProfiles,
  myDiscordUserId,
  claimedByDiscordUserId,
  lastReadAtMs = 0,
}) {
  // The parent page keys this component on `discordUserId`, so a conversation
  // switch remounts it — that's what resets this state, rather than an effect
  // syncing it to a prop.
  const [pages, setPages] = useState({ messages: initialMessages, hasMore: initialHasMore });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [claimedBy, setClaimedBy] = useState(claimedByDiscordUserId);
  const lastMarkedIdRef = useRef(null);
  // The Dev Panel open as a modal over this conversation, or null. Mirrors
  // RosterTable.js and the adjudication desk's Workspace.js — opening it
  // never navigates away from the conversation.
  const [devPanelOpen, setDevPanelOpen] = useState(false);

  // Held in memory, mirrored to localStorage where there is room (../dmDraft).
  // Typing never depends on the mirror succeeding.
  const content = useDmDraft(discordUserId);
  // An unsent reply counts as unsaved work, so the desk's gated poll stands
  // down while there is one (isAnyDirty) rather than refetching the page
  // under a half-written sentence. `enabled: false` deliberately leaves the
  // beforeunload prompt off: the reply is mirrored to storage (dmDraft.js)
  // and comes back after a reload, so asking "are you sure" — on every ⌘R,
  // and on the stale chip's own reload — would warn about nothing.
  //
  // It only holds the poll down while somebody is ACTUALLY WRITING, the same
  // 10-minute rule the adjudication desk's Result box follows
  // (useDirtyGuard.js#alsoDirtyHoldsPoll, deskDraft.js). A half-typed reply
  // left in a conversation last week is still shown and still restored — it
  // just stops freezing the whole desk's backstop poll for ever.
  useDirtyGuard({
    enabled: false,
    alsoDirty: content.trim().length > 0,
    alsoDirtyHoldsPoll: dmDraftFresh(discordUserId),
  });

  // What the live poll has brought in for this conversation since the page
  // was seeded (liveInbox.js), unioned with the server page during render —
  // never copied into state. A pending optimistic row retires the moment the
  // real row with the same content shows up, whichever path delivers it
  // first: the poll can beat the send action's own answer.
  const feed = useThreadFeed(discordUserId);
  const displayed = useMemo(() => {
    const byId = new Map();
    for (const m of pages.messages) byId.set(m.id, m);
    for (const m of feed) if (!byId.has(m.id)) byId.set(m.id, m);
    // Retired by NONCE, not by text. Matching on content meant sending "ok"
    // twice retired both placeholders against the first row that landed, and
    // left the second send looking like it had never happened.
    const settled = new Set(
      [...byId.values()].filter((m) => !m.pending && m.clientNonce).map((m) => m.clientNonce),
    );
    return [...byId.values()]
      .filter((m) => !(m.pending && m.clientNonce && settled.has(m.clientNonce)))
      .sort((a, b) => {
        const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }, [pages.messages, feed]);

  const writeDraft = useCallback((value) => writeDmDraft(discordUserId, value), [discordUserId]);

  // The composer grows with what's in it, one line to ten, then scrolls —
  // measured in the change handler (and once on mount for a restored draft),
  // not in an effect.
  const composerRef = useRef(null);
  const fitComposer = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(window.getComputedStyle(el).lineHeight) || 20;
    const max = line * 10 + 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);

  // Mark-read: fires from a client effect after mount, and again whenever a
  // new INBOUND message id appears — NEVER during RSC render, which would
  // mark-on-hover under Next's link prefetch. Only while the tab is actually
  // visible, and de-duplicated per newest-message id via the ref.
  useEffect(() => {
    const newest = displayed[displayed.length - 1];
    if (!newest) return;
    // Neither an optimistic row nor a failed one is a real message yet —
    // marking read against a temp id would burn the de-dupe slot the real one
    // needs, and a failed row never gets a real id at all.
    if (newest.pending || newest.failed) return;
    if (lastMarkedIdRef.current === newest.id) return;
    if (document.visibilityState !== "visible") return;
    lastMarkedIdRef.current = newest.id;
    // Said locally FIRST, so the rail badge and the nav badge clear on the
    // open rather than on whichever frame the server's cursor reaches next
    // (liveInbox.js#noteConversationRead). Then said again with the cursor
    // the server actually wrote, which is what the override is reconciled
    // against.
    noteConversationRead(discordUserId, Date.now());
    markConversationRead({ playerDiscordUserId: discordUserId }).then((result) => {
      if (result?.ok && Number.isFinite(result.lastReadAtMs)) {
        // `fromServer` — this REPLACES the Date.now() guess above rather than
        // having to be newer than it. A browser clock running fast would
        // otherwise leave its own over-claim standing and hide the badge for
        // every message that arrives before the real clock catches up.
        noteConversationRead(discordUserId, result.lastReadAtMs, { fromServer: true });
      }
    });
  }, [displayed, discordUserId]);

  // The GET route, not the server action it used to call. Paging back through
  // a long conversation is the other thing a GM does while meaning to click
  // somewhere else, and an action would put the click behind it — the same
  // reason the rail's search moved (api/gm/conversation-search).
  async function loadOlder() {
    const oldest = pages.messages[0];
    if (!oldest) return;
    const params = new URLSearchParams({
      user: discordUserId,
      beforeMs: String(new Date(oldest.createdAt).getTime()),
      beforeId: oldest.id,
    });
    try {
      const res = await fetch(`/api/gm/thread?${params}`, { cache: "no-store" });
      // res.ok is true for a 204 ("not a GM any more"), so test it by hand or
      // the next line parses an empty body.
      if (res.status === 204 || !res.ok) return;
      const result = await res.json();
      setPages((prev) => ({
        messages: [...result.messages, ...prev.messages],
        hasMore: result.hasMore,
      }));
    } catch {
      // Offline or a switchover. The sentinel stays, so scrolling up again
      // retries; nothing already on screen is lost.
    }
  }

  // Send is optimistic: the row appears and the draft clears the instant you
  // hit Enter, because waiting on a Discord round trip for the text you just
  // typed to appear is what made the composer feel slow. The temp row is
  // styled pending until the server answers.
  //
  // A failure no longer takes the row away and puts the words back in the
  // box. That was safe when a GM sat still waiting for the answer, and wrong
  // the rest of the time: the draft is per conversation and shared with
  // whatever they started typing next, so a slow failure overwrote a sentence
  // in progress. The failed line stays where it is instead, with Retry and
  // Discard on it — and Retry reuses the nonce, so a send whose ANSWER got
  // lost cannot land twice: the row is already on the table under that nonce
  // and sendGmDm hands it back instead of posting again.
  //
  // One window that does not cover, honestly: the nonce is written when the DM
  // is LOGGED, which is after the Discord POST (web/lib/discordGuild.js#sendDm).
  // A send that reached Discord and then lost its log write — the container
  // swapped between the two, or the log insert itself failed for something
  // other than the nonce already being there — leaves no row for Retry to find,
  // and Retry posts a second copy. Closing it means reserving the nonce before
  // the POST and filling the row in afterwards, which is a change to all three
  // sendDm transports and is not made here.
  const deliver = useCallback(
    (message, tempId, nonce) => {
      startTransition(async () => {
        // try/catch, not just the `ok` flag: an action REJECTS when the
        // request never completes at all (the tab offline, a container
        // swapped mid-deploy), and that is the commonest way a send fails.
        // Left unhandled it surfaced as an uncaught "Failed to fetch" and the
        // row sat pending for ever, which is the exact state this is here to
        // stop.
        let result;
        try {
          result = await sendGmDm({ discordUserId, content: message, clientNonce: nonce });
        } catch {
          result = { ok: false, error: "That didn't send — you may be offline." };
        }
        if (!result.ok) {
          setPages((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === tempId ? { ...m, pending: false, failed: true, error: result.error } : m,
            ),
          }));
          setError(result.error);
          return;
        }
        // The action returns the fresh tail page too — the only path that
        // brings in what the PLAYER said since this pane mounted (state is
        // seeded once; a poll's router.refresh can't reseed it). MERGE it: the
        // GM may have paged back hundreds of messages with loadOlder, and
        // replacing the array would snap them to the last 100. Rows already
        // held keep their place; new ids are appended in server order; the
        // optimistic row goes.
        setPages((prev) => {
          const kept = prev.messages.filter((m) => m.id !== tempId);
          if (!Array.isArray(result.messages)) {
            return {
              ...prev,
              messages: prev.messages.map((m) => (m.id === tempId ? (result.message ?? { ...m, pending: false }) : m)),
            };
          }
          const have = new Set(kept.map((m) => m.id));
          const fresh = result.messages.filter((m) => !have.has(m.id));
          return { ...prev, messages: [...kept, ...fresh] };
        });
      });
    },
    [discordUserId],
  );

  function handleSend(e) {
    e.preventDefault();
    const message = content.trim();
    if (!message || message.length > GM_MESSAGE_MAX_LENGTH) return;
    setError(null);

    const tempId = `optimistic-${(optimisticSeq += 1)}`;
    const nonce = mintNonce();
    const optimistic = {
      id: tempId,
      clientNonce: nonce,
      discordUserId,
      direction: "OUTBOUND",
      // Matches what sendDm actually writes, so the row does not visibly
      // reflow when the real one replaces it. `sentText` is the bare thing
      // that was handed to the server, kept so Retry can resend exactly it —
      // deriving it back out of `content` meant stripping a leading "» ", and
      // a GM who deliberately opened their message with one lost it.
      sentText: message,
      content: `» ${message}`,
      authorDiscordUserId: myDiscordUserId,
      source: "gm_reply",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPages((prev) => ({ ...prev, messages: [...prev.messages, optimistic] }));
    writeDraft("");
    if (composerRef.current) {
      composerRef.current.value = "";
      fitComposer(composerRef.current);
    }

    deliver(message, tempId, nonce);
  }

  // Retry sends the same words under the same nonce, taken from `sentText` —
  // the bare text this row was sent with — rather than unpicked from the `»`
  // the row wears. The fallback is for a row from before that field existed.
  const retrySend = useCallback(
    (row) => {
      setError(null);
      setPages((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === row.id ? { ...m, pending: true, failed: false, error: null } : m,
        ),
      }));
      deliver(row.sentText ?? row.content.replace(/^» /, ""), row.id, row.clientNonce);
    },
    [deliver],
  );

  const discardSend = useCallback((row) => {
    setPages((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== row.id) }));
  }, []);

  function toggleClaim() {
    startTransition(async () => {
      if (claimedBy === myDiscordUserId) {
        await releaseConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(null);
      } else {
        await claimConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(myDiscordUserId);
      }
    });
  }

  // Escape leaves the conversation for the roster, layered topmost-first the
  // same way the adjudication desk does it (Workspace.js):
  //   1. An open Modal (Dev Panel, confirm) owns Escape — Modal.js handles its
  //      own, so yield while one is on screen.
  //   2. A focused input/textarea/select — blur it. The reply composer is a
  //      textarea, and Escape mid-sentence must not throw the GM out of the
  //      conversation; a second Escape then leaves.
  //   3. Otherwise, close the conversation — a state change now (selection.js),
  //      not a navigation, so the roster comes back without a server round
  //      trip. DeskMiddle swaps the two, so the roster does re-mount and its
  //      own search box starts empty; what it no longer does is re-fetch.
  // Unlike /gm/turns, leaving here is a step back to the list rather than off
  // the whole desk — the rail never leaves the screen — which is why this one
  // navigates where that one deliberately doesn't. Non-destructive either way:
  // the composer draft is held per conversation in memory, and mirrored to
  // storage where there is room (dmDraft.js).
  const coarse = useIsCoarsePointer();
  useEffect(() => {
    // No Escape key on a touch-primary device, and no stray navigation there.
    if (coarse) return undefined;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (dialogHoldsKeyboard()) return;
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
        active.blur();
        return;
      }
      selectConversation(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coarse]);

  const onKeyDown = useSubmitOnEnter();

  // Focus the composer the moment a conversation opens, so clicking a rail
  // row means you can just type. Mount-only is right: the parent keys this
  // component on discordUserId, and the InboxPoller's refresh doesn't
  // remount it, so a poll tick can't steal focus mid-sentence. Skipped on
  // touch — popping the keyboard over the thread would be worse than a tap.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    fitComposer(el);
    if (coarse) return;
    el.focus({ preventScroll: true });
    // After a restored draft, the caret belongs at the end, not position 0.
    el.setSelectionRange(el.value.length, el.value.length);
  }, [coarse, fitComposer]);

  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const nearLimit = content.length > GM_MESSAGE_MAX_LENGTH * 0.9;
  const claimedByOther = claimedBy && claimedBy !== myDiscordUserId;
  const sendHint = coarse ? "Send" : "Send — Enter sends, Shift+Enter for a new line";

  return (
    <div className="desk-convo">
      <div className="desk-convo-head">
        <div className="flex items-center gap-2 min-w-0">
          {/* Narrow tiers only (globals.css): down there the roster and the
              rail are not on screen beside this, so the way back has to be
              in the conversation itself. Same destination as Esc. */}
          <button
            type="button"
            className="btn-quiet desk-back"
            title="Back to the roster"
            onClick={() => selectConversation(null)}
          >
            ← Back
          </button>
          <CharacterAvatar characterId={characterId} name={label} version={avatarVersion} size={32} zoomable />
          <h2 className="section-title truncate">{label}</h2>
          {zoneName ? <ZoneChip zoneName={zoneName} /> : null}
          {status && <EnumPill map={CHARACTER_STATUS} value={status} />}
        </div>
        <div className="flex items-center gap-2">
          {moveId && (
            <Link href={`/gm/turns/move/${moveId}`} className="btn-quiet">
              Adjudicate →
            </Link>
          )}
          <DevCharacterButton
            characterId={characterId}
            name={label}
            onOpen={() => setDevPanelOpen(true)}
          />
          {/* A fixed width, because the three labels this button wears are
              very different lengths and everything to its left jumped sideways
              every time a claim changed hands. */}
          <button
            type="button"
            className="btn-quiet text-center"
            style={{ width: "11rem" }}
            disabled={claimedByOther || pending}
            onClick={toggleClaim}
          >
            {claimedBy
              ? claimedByOther
                ? "Claimed by another GM"
                : "Release claim"
              : "Claim conversation"}
          </button>
          {/* Twin of the Escape key handler above. It used to be LABELLED
              "Esc", which reads as a keycap sitting in a row of verbs rather
              than as a thing to press; a close mark is what a pane's own
              corner control looks like everywhere else, and the key still
              gets said, in the tooltip. */}
          <button
            type="button"
            className="btn-quiet"
            title="Close — or press Esc"
            aria-label="Close this conversation"
            onClick={() => selectConversation(null)}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="desk-convo-thread">
        {displayed.length === 0 ? (
          <p className="text-sm text-muted p-4">
            No messages yet. Whatever you send first opens the conversation.
          </p>
        ) : (
          <DmThread
            messages={displayed}
            gmProfiles={gmProfiles}
            onLoadOlder={loadOlder}
            hasMore={pages.hasMore}
            character={characterId ? { id: characterId, name: label, avatarVersion } : null}
            newSinceMs={lastReadAtMs}
            myDiscordUserId={myDiscordUserId}
            onRetry={retrySend}
            onDiscard={discardSend}
          />
        )}
      </div>

      <form className="desk-convo-composer" onSubmit={handleSend}>
        <div className="desk-convo-box">
          <label className="field min-w-0 flex-1">
            <span className="sr-only">Reply</span>
            <textarea
              ref={composerRef}
              rows={1}
              value={content}
              onChange={(e) => {
                writeDraft(e.target.value);
                fitComposer(e.target);
              }}
              onKeyDown={onKeyDown}
              placeholder={`Message ${label}`}
              title={coarse ? undefined : "Enter sends, Shift+Enter for a new line"}
            />
          </label>
          <IconButton
            icon={SendIcon}
            label={sendHint}
            type="submit"
            disabled={pending || !content.trim() || over}
          />
        </div>
        {(nearLimit || error) && (
          <div className="flex items-center justify-between gap-2">
            {error ? (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : (
              <span />
            )}
            {nearLimit && (
              <span className="text-xs mono" style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}>
                {content.length} / {GM_MESSAGE_MAX_LENGTH}
              </span>
            )}
          </div>
        )}
      </form>

      {devPanelOpen && (
        <DevPanelModal
          characterId={characterId}
          name={label}
          onClose={() => setDevPanelOpen(false)}
        />
      )}
    </div>
  );
}
