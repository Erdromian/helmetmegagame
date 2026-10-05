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
import { resolveCavingRoll, undoCavingFind, getCavingSnapshots } from "./actions";
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
// A TROUBLE row is a RESULT (web/lib/cavingLabels.js#foldCavingResults, CAVING.md §5a, §5c): before the
// lock, every 1 one caver rolled this turn; once the turn locks, everybody standing in one Location —
// each caver with their own severity, and anybody there with no failed roll at all. `roll.id` is the
// oldest 1 in it — the Result box and everything staged here hang off it — and every person in it has a
// card of their own below: severity, combat mode and response, and their snapshot.

// Everybody's snapshot for the result, in one load (actions.js#getCavingSnapshots), keyed by character id:
// a caver as they stood at their newest 1, a bystander as they stood when the turn locked. Combat mode,
// the band and what they had on — the three things a GM wants for a fight in the dark. Reloaded when a
// new 1 lands or somebody joins the result.
function useCavingSnapshots(rollId, key) {
  const [state, setState] = useState({ key: null, snapshots: {}, error: null });
  useEffect(() => {
    // A FIND or QUIET row has nobody to snapshot.
    if (!rollId) return undefined;
    let live = true;
    getCavingSnapshots({ cavingRollId: rollId })
      .then((res) => {
        if (!live) return;
        setState({ key, snapshots: res?.ok ? (res.snapshots ?? {}) : {}, error: res?.ok ? null : (res?.error ?? null) });
      })
      .catch(() => live && setState({ key, snapshots: {}, error: "Couldn't load the snapshots." }));
    return () => {
      live = false;
    };
  }, [rollId, key]);
  return state.key === key ? state : null;
}

function PersonSnapshot({ loaded, person }) {
  if (!loaded) return <p className="text-xs text-muted">Loading the snapshot…</p>;
  if (loaded.error) return <FormError>{loaded.error}</FormError>;
  const snap = loaded.snapshots[person.characterId];
  if (!snap) return <p className="text-xs text-muted">No snapshot for {person.failed ? "this roll" : "them"}.</p>;
  return <SnapshotBody snap={snap} />;
}

// Combat mode, and what the caver wrote (Combat Mode.docx; COMBAT-MODE.md §6). The snapshot below answers for the
// newest 1 alone, and a caver may have turned combat mode on between two of them, so this reads every 1 of the
// result off the column each froze. In combat mode at any of them is what let them write, and the desk says only
// that much (Bascinet, 2026-10-02). Somebody with no failed roll was never asked, so they get a line saying so.
function OnGuard({ person }) {
  if (!person.failed) {
    return <p className="text-xs text-muted">No failed rolls, so they weren&apos;t asked how they respond.</p>;
  }
  const alertCount = person.alertCount ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={alertCount > 0 ? "bad" : "neutral"}>{alertCount > 0 ? "In combat mode" : "Not in combat mode"}</StatusPill>
      </p>
      {alertCount > 0 &&
        (person.response ? (
          <>
            <blockquote className="quote whitespace-pre-wrap text-sm">{person.response}</blockquote>
            <p className="text-xs text-muted">Written {person.respondedAtLabel ?? ""}</p>
          </>
        ) : (
          <p className="text-xs text-muted">They haven&apos;t written a response yet. They can until Moves lock.</p>
        ))}
    </div>
  );
}

// One person in the result. `ownNotes` is a caver's Result box from before the lock merged their result
// into this one — kept on their own oldest roll, so it is shown here rather than lost.
function PersonCard({ person, loaded, ownNotes, readOnly, onInspect, onOpenDev }) {
  return (
    <section className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <CharacterAvatar characterId={person.characterId} name={person.characterName} version={person.avatarVersion} size={28} zoomable />
            <button type="button" className="desk-name" onClick={() => onInspect(person.characterId, person.characterName)}>
              {person.characterName}
            </button>
            <span className="text-muted text-sm">({person.discordUsername})</span>
          </h3>
          <GmLook then={person.look?.then} now={person.look?.now} frozen />
          <p className="text-xs text-muted">
            {person.roleTitle && <>{person.roleTitle} · </>}
            {person.failed ? `Severity ${person.severity}` : "No failed rolls"}
            {person.nowLocationName ? <> · now in {person.nowLocationName}</> : null}
          </p>
          {/* Not on a History pick: the push has already let them go. */}
          {person.stuck && !readOnly && (
            <p className="mt-1 flex items-center gap-2 text-sm">
              <StatusPill tone="bad">Stuck</StatusPill>
              {/* Bascinet's words, verbatim. */}
              <span>{person.characterName} has rolled ten 1s this turn and can&apos;t move until move resolution.</span>
            </p>
          )}
        </div>
        <DevCharacterButton
          characterId={person.characterId}
          name={person.characterName}
          onOpen={() => onOpenDev?.(person.characterId, person.characterName)}
        />
      </div>
      <OnGuard person={person} />
      {ownNotes && (
        <div className="flex flex-col gap-1">
          <span className="field-label">Their result before the lock</span>
          <blockquote className="quote whitespace-pre-wrap text-sm">{ownNotes}</blockquote>
        </div>
      )}
      <span className="field-label">{person.failed ? "At their last failed roll" : "When the turn locked"}</span>
      <PersonSnapshot loaded={loaded} person={person} />
    </section>
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

  const isResult = roll.kind === "TROUBLE";
  // Everybody in the result: the cavers with 1s (worst first), then whoever stood with them at the lock.
  const people = isResult ? [...(roll.members ?? []), ...(roll.bystanders ?? [])] : [];
  // A staged effect, death or let-in starts on the worst-off caver; a message goes to everybody in it.
  const primary = isResult && people[0] ? { id: people[0].characterId, name: people[0].characterName } : { id: roll.characterId, name: roll.characterName };
  const recipients = people.length
    ? people.map((p) => ({ characterId: p.characterId, name: p.characterName }))
    : [{ characterId: roll.characterId, name: roll.characterName }];
  const snapshotKey = `${roll.latestId ?? roll.id}|${people.map((p) => p.characterId).join(",")}`;
  const snapshots = useCavingSnapshots(isResult ? roll.id : null, snapshotKey);

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

  // The Result box: one for the whole result, on its oldest 1 (CAVING.md §5a).
  const resultBox = isResult && (
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
  );

  const stagingBlock = (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="field-label">{isResult ? "Staged on this result" : "Staged on this roll"}</h3>
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
  );

  const composers = (
    <>
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
          defaultTarget={primary}
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
          defaultTarget={primary}
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
          defaultTarget={primary}
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
          defaultRecipients={recipients}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? recipients : undefined}
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
    </>
  );

  const footer = (
    <>
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

      {isResult && !readOnly && (
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
    </>
  );

  if (isResult) {
    return (
      <div className="desk-card">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {/* The place: where the caver stands now before the lock, where everybody stood at it after (CAVING.md §5c). */}
            <h2 className="section-title">{roll.locationName ?? "Somewhere underground"}</h2>
            <p className="text-xs text-muted">
              {roll.zoneName} · {severityLabel(roll)}
              {readOnly && turnLabel ? <> · {turnLabel}</> : null}
            </p>
            {roll.merged && (
              <p className="text-xs text-muted">
                {people.length === 1 ? "1 person was" : `${people.length} people were`} here when the turn locked, and this is
                one result for all of them.
              </p>
            )}
            {/* A fresh failure, or a response written, after a GM resolved the result reopens it. */}
            {roll.respondedSinceResolved && (
              <p className="mt-1 text-sm">
                {roll.merged ? "A response changed since this was resolved." : "They changed their response since this was resolved."}
              </p>
            )}
            {roll.newSinceResolved > 0 && (
              <p className="mt-1 text-sm">
                {roll.newSinceResolved === 1
                  ? "1 new failed roll since this was resolved."
                  : `${roll.newSinceResolved} new failed rolls since this was resolved.`}
              </p>
            )}
          </div>
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </header>

        {people.map((person) => (
          <PersonCard
            key={person.characterId}
            person={person}
            loaded={snapshots}
            ownNotes={person.characterId !== roll.characterId ? person.gmNotes : ""}
            readOnly={readOnly}
            onInspect={onInspect}
            onOpenDev={onOpenDev}
          />
        ))}

        {resultBox}
        {stagingBlock}
        {composers}
        {footer}
      </div>
    );
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
          {/* How they look now. A QUIET or FIND roll freezes no look of its own. */}
          <GmLook then={roll.look?.then} now={roll.look?.now} frozen />
          <p className="text-xs text-muted">
            {roll.roleTitle && <>{roll.roleTitle} · </>}
            {roll.locationName ? <>{roll.locationName} · </> : null}
            {roll.zoneName} · ⚀ {roll.die} · {roll.kindLabel ?? CAVING_KIND_LABELS[roll.kind] ?? roll.kind}
            {readOnly && turnLabel ? <> · {turnLabel}</> : null}
          </p>
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

      {stagingBlock}
      {composers}
      {footer}
    </div>
  );
}
