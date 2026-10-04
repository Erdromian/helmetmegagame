"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import GmLook from "@/app/components/GmLook";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import EffectComposer from "./EffectComposer";
import RoomEffectComposer from "./RoomEffectComposer";
import DeathComposer from "./DeathComposer";
import RoomEntryComposer from "./RoomEntryComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import StagingStrip from "./StagingStrip";
import { useConfirm } from "@/app/components/ConfirmProvider";
import StatusPill from "@/app/components/StatusPill";
import SnapshotBody from "./SnapshotBody";
import { CAVING_KIND_LABELS, severityLabel } from "@/lib/cavingLabels";
import { RESULT_BOX_MAX_LENGTH } from "@/lib/constants";
import { resolveCavingRoll, undoCavingFind, getCavingSnapshot } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { clearDeskDraft, deskDraftFresh, useDeskDraft, writeDeskDraft } from "./deskDraft";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";

// The arbitration desk for one Caving Die roll — see
// docs/systemdocs/CAVING.md. Only a TROUBLE (die 1) row is ever unresolved;
// QUIET (2-5) and FIND (6) are stamped resolved the moment the pass writes
// them, so this desk's real job is monsters: narrate what happened, stage
// whatever effects and DMs the encounter needs, and mark it resolved. No
// lock — unlike a Move, two GMs opening the same roll can't race a solve
// that pays anyone twice.
//
// A FIND row opens here too, showing what was found — with no "Mark resolved"
// button, since it has nothing left to resolve, but with its own Undo. The
// loot landed as a PASSED CAVING_LOOT Request and that row still shows in the
// Requests lens; Undo here just saves the GM the trip, and goes through the
// very same undo the Caving lens runs (undoCavingFind in ./actions.js)
// so there is exactly one way the tag ever comes back off.
//
// A TROUBLE row is FOLDED: every 1 the caver rolled this turn, as one result of that severity
// (web/lib/cavingLabels.js#foldCavingRolls, CAVING.md §5). `roll.id` is the oldest of them — the
// Result box and everything staged here hang off it — and the snapshot panel reads the newest.

// The caver as they stood at their newest 1, loaded when it changes. Combat mode, the band and
// what they had on — the three things a GM wants for a fight in the dark.
function LastFailSnapshot({ rollId, latestId }) {
  const [state, setState] = useState({ key: null, snapshot: null, error: null });
  useEffect(() => {
    let live = true;
    getCavingSnapshot({ cavingRollId: rollId })
      .then((res) => {
        if (!live) return;
        setState({ key: latestId, snapshot: res?.ok ? (res.snapshot ?? null) : null, error: res?.ok ? null : (res?.error ?? null) });
      })
      .catch(() => live && setState({ key: latestId, snapshot: null, error: "Couldn't load the snapshot." }));
    return () => {
      live = false;
    };
  }, [rollId, latestId]);

  if (state.key !== latestId) return <p className="text-xs text-muted">Loading the snapshot…</p>;
  if (state.error) return <FormError>{state.error}</FormError>;
  const snap = state.snapshot;
  if (!snap) return <p className="text-xs text-muted">No snapshot for this roll.</p>;
  return <SnapshotBody snap={snap} />;
}

// Combat mode, and what the caver wrote (Combat Mode.docx; COMBAT-MODE.md §6). The snapshot below answers for the
// newest 1 alone, and a caver may have turned combat mode on between two of them, so this reads every 1 of the
// result off the column each froze. In combat mode at any of them is what let them write, and the desk says only
// that much (Bascinet, 2026-10-02).
function OnGuard({ roll }) {
  const alertCount = roll.alertCount ?? (roll.alert ? 1 : 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={alertCount > 0 ? "bad" : "neutral"}>{alertCount > 0 ? "In combat mode" : "Not in combat mode"}</StatusPill>
      </p>
      {alertCount > 0 &&
        (roll.response ? (
          <>
            <blockquote className="quote whitespace-pre-wrap text-sm">{roll.response}</blockquote>
            <p className="text-xs text-muted">
              Written {roll.respondedAtLabel ?? ""}
              {roll.respondedSinceResolved ? " · changed since this was resolved" : ""}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">They haven&apos;t written a response yet. They can until Moves lock.</p>
        ))}
    </div>
  );
}

export default function CavingDesk({
  roll,
  staged,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  stagingRooms,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
  gmProfiles,
  // Read-only mode, for a roll on a pushed turn opened from the History lens —
  // mirrors MoveHistoryDesk: no composers, no Mark resolved, the notes box
  // disabled. Staged rows still show (an unapplied one stays editable).
  readOnly = false,
  turnLabel = null,
}) {
  const confirm = useConfirm();
  // The Result box, held outside this component so a reload or anything else
  // that replaces the column hands it back (deskDraft.js) — the same
  // treatment MoveDesk.js gives its own.
  const draftKey = `caving:${roll.id}`;
  const draft = useDeskDraft(draftKey);
  const gmNotes = draft?.gmNotes ?? roll.gmNotes ?? "";
  // A cold draft is still guarded on close and on unload; it just stops
  // standing the desk's backstop poll down (useDirtyGuard, deskDraft.js).
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !!draft,
    alsoDirtyHoldsPoll: deskDraftFresh(draftKey),
  });

  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  // Set only by "Stage as message" below, to prefill the composer with the
  // Result box's narration — the same bridge MoveDesk.js uses. A plain
  // "+ Message" clears it first, so it opens empty.
  const [messagePrefill, setMessagePrefill] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const setNotes = useCallback(
    (value) => {
      markDirty();
      writeDeskDraft(draftKey, { gmNotes: value });
    },
    [markDirty, draftKey],
  );

  // mode: "save" keeps the Result text where it is, "resolve" stamps the roll.
  function run(mode) {
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await resolveCavingRoll({ cavingRollId: roll.id, gmNotes, mode }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        clearDeskDraft(draftKey);
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  // Taking the find back. The roll stands; only the loot comes off. Guarded
  // by CavingRoll.lootUndoneAt server-side, so a double-click drops nothing
  // twice.
  async function undoFind() {
    setError(null);
    const ok = await confirm({
      title: `Take back ${roll.lootTagName ?? "this find"}?`,
      message: roll.lootRoomName
        ? `${roll.characterName} keeps the roll — only the loot comes out of ${roll.lootRoomName}.`
        : `${roll.characterName} keeps the roll — only the loot comes off the sheet.`,
      confirmLabel: "Take it back",
      cancelLabel: "Leave it",
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = noteActionVersion(await undoCavingFind({ rollId: roll.id }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        // Same as resolve() above: GM notes typed but never marked clean
        // would otherwise leave isAnyDirty() stuck true for the rest of the
        // session, silently pausing the desk's 45s poll.
        markClean();
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar characterId={roll.characterId} name={roll.characterName} version={roll.avatarVersion} size={32} zoomable />
            <button type="button" className="desk-name" onClick={() => onInspect(roll.characterId, roll.characterName)}>
              {roll.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({roll.discordUsername})</span>
          </h2>
          {/* As they stood at the newest 1, and now if that changed. */}
          <GmLook then={roll.look?.then} now={roll.look?.now} frozen />
          <p className="text-xs text-muted">
            {roll.roleTitle && <>{roll.roleTitle} · </>}
            {roll.locationName ? <>{roll.locationName} · </> : null}
            {roll.zoneName} · ⚀ {roll.die} · {roll.kindLabel ?? CAVING_KIND_LABELS[roll.kind] ?? roll.kind}
            {severityLabel(roll) ? <> · {severityLabel(roll)}</> : null}
            {readOnly && turnLabel ? <> · {turnLabel}</> : null}
          </p>
          {/* Not on a History pick: the push has already let them go. */}
          {roll.stuck && !readOnly && (
            <p className="mt-1 flex items-center gap-2 text-sm">
              <StatusPill tone="bad">Stuck</StatusPill>
              {/* Bascinet's words, verbatim. */}
              <span>{roll.characterName} has rolled ten 1s this turn and can&apos;t move until move resolution.</span>
            </p>
          )}
          {/* A fresh failure after a GM resolved the group reopens it. */}
          {roll.respondedSinceResolved && <p className="mt-1 text-sm">They changed their response since this was resolved.</p>}
          {roll.newSinceResolved > 0 && (
            <p className="mt-1 text-sm">
              {roll.newSinceResolved === 1
                ? "1 new failed roll since this was resolved."
                : `${roll.newSinceResolved} new failed rolls since this was resolved.`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DevCharacterButton
            characterId={roll.characterId}
            name={roll.characterName}
            onOpen={() => onOpenDev?.(roll.characterId, roll.characterName)}
          />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {roll.kind === "FIND" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm">
            Rolled a {roll.die} and found <strong>{roll.lootTagName ?? "—"}</strong> ({roll.lootTier ?? "—"}).{" "}
            {roll.lootUndoneAt
              ? roll.lootRoomName
                ? `That find was taken back out of ${roll.lootRoomName}.`
                : "That find was taken back — the tag is off the sheet."
              : roll.lootRoomName
                ? `They already had one, so it was left in ${roll.lootRoomName}.`
                : roll.lootAlreadyHeld
                  ? "They already had one, so nothing was added."
                  : roll.lootTagId
                    ? "Already on their sheet."
                    : "Already granted, but the tag is no longer on record — take it off by hand from the Dev Panel."}
          </p>
          {roll.lootTagId && !roll.lootUndoneAt && (!roll.lootAlreadyHeld || roll.lootRoomName) && (
            <button type="button" className="btn-quiet" onClick={undoFind} disabled={pending}>
              {pending ? "Working…" : "Undo this find"}
            </button>
          )}
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">Combat mode</h3>
          <OnGuard roll={roll} />
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">At their last failed roll</h3>
          <LastFailSnapshot rollId={roll.id} latestId={roll.latestId ?? roll.id} />
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="desk-result mt-4 flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Result — what happened down there</span>
            <textarea
              rows={4}
              maxLength={RESULT_BOX_MAX_LENGTH}
              value={gmNotes}
              disabled={pending || readOnly}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened here…"
            />
          </label>
          {!readOnly && (
            <button
              type="button"
              className="btn-quiet self-start"
              disabled={!gmNotes.trim()}
              onClick={() => {
                setMessagePrefill(gmNotes);
                setComposer("message");
              }}
            >
              Stage as message
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this roll</h3>
          {!readOnly && (
            <StagingStrip
              onEffect={() => setComposer("effect")}
            onRoom={() => setComposer("room")}
              onLetIn={() => setComposer("letin")}
              onDeath={() => setComposer("death")}
              onMessage={() => {
                setMessagePrefill(null);
                setComposer("message");
              }}
              onPublic={() => setComposer("public")}
            />
          )}
        </div>

        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          stagingRooms={stagingRooms}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          readOnly={readOnly}
          empty="Nothing staged yet."
        />
      </div>

      {composer === "room" && (
        <RoomEffectComposer
          cavingRollId={roll.id}
          tagCatalog={tagCatalog}
          stagingRooms={stagingRooms}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "letin" && (
        <RoomEntryComposer
          cavingRollId={roll.id}
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
          roster={roster}
          stagingRooms={stagingRooms}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "death" && (
        <DeathComposer
          cavingRollId={roll.id}
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "effect" && (
        <EffectComposer
          cavingRollId={roll.id}
          offerObservers
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          cavingRollId={roll.id}
          defaultRecipients={[{ characterId: roll.characterId, name: roll.characterName }]}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? [{ characterId: roll.characterId, name: roll.characterName }] : undefined}
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            setMessagePrefill(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => {
            setComposer(null);
            setMessagePrefill(null);
          }}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          cavingRollId={roll.id}
          zones={presenceZones}
          stagingLocations={stagingLocations}
          stagingRooms={stagingRooms}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {!roll.resolvedByUsername && roll.autoResolved && (
        <p className="text-xs text-muted">
          Resolved automatically at the push{roll.resolvedAtLabel ? ` · ${roll.resolvedAtLabel}` : ""} — nobody
          adjudicated it.
        </p>
      )}
      {roll.resolvedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Resolved by {roll.resolvedByUsername}
          {roll.resolvedAtLabel ? ` · ${roll.resolvedAtLabel}` : ""}
        </p>
      )}

      <FormError>{error}</FormError>

      {roll.kind === "TROUBLE" && !readOnly && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          {/* Save is always here, resolved or not — the same fix MoveDesk.js:415
              describes. Marking a roll resolved used to take the only button
              that wrote the Result box away with it, so the box stayed typeable
              and threw away everything typed into it after that. */}
          <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={pending}>
            {pending ? "Working…" : "Save"}
          </button>
          {!roll.resolvedAt && (
            <button type="button" className="btn" onClick={() => run("resolve")} disabled={pending}>
              {pending ? "Working…" : "Mark resolved"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
