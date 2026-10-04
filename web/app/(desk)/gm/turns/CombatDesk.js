"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import GmLook from "@/app/components/GmLook";
import StatusPill from "@/app/components/StatusPill";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import EffectComposer from "./EffectComposer";
import RoomEffectComposer from "./RoomEffectComposer";
import DeathComposer from "./DeathComposer";
import RoomEntryComposer from "./RoomEntryComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import StagingStrip from "./StagingStrip";
import SnapshotBody from "./SnapshotBody";
import { RESULT_BOX_MAX_LENGTH } from "@/lib/constants";
import { resolveCombat, getCombatSnapshots, endCombatAsGmAction } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { clearDeskDraft, deskDraftFresh, useDeskDraft, writeDeskDraft } from "./deskDraft";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";

// The arbitration desk for one fight (docs/systemdocs/ATTACK.md §8, from Bascinet's Combat Overhaul.docx).
// Everybody in it, grouped the way the doc asks — the attackers and the defenders, and apart from them
// whoever intervened on either side, with where they were when it started — each with what they were
// when they came into it (the snapshot), their roll, and what they wrote. Then ONE result for the whole
// fight: the Result box, staged rows anchored to the fight, Solve. The CavingDesk shape.
//
// "Message them" on a card stages a private message to that one person — the doc's "stage a message on
// attack actions which are only forwarded to a specific character". Every composer offers the fight's
// people one tap each (QuickPicks.js), so nobody is searched for by name.

const GROUPS = [
  { key: "attackers", label: "Attackers", test: (p) => p.side === "ATTACKER" && p.role !== "INTERVENER" },
  { key: "defenders", label: "Defenders", test: (p) => p.side === "DEFENDER" && p.role !== "INTERVENER" },
  { key: "joinA", label: "Joined the attackers", test: (p) => p.side === "ATTACKER" && p.role === "INTERVENER" },
  { key: "joinD", label: "Joined the defenders", test: (p) => p.side === "DEFENDER" && p.role === "INTERVENER" },
];

const ROLE_LABELS = { INITIATOR: "Started it", COLLABORATOR: "Asked along", TARGET: "Target", INTERVENER: "Intervened" };
const STATUS_LABELS = { INVITED: "No answer yet", DECLINED: "Declined", LEFT: "Left" };

// Where somebody who stepped in came from, and why they are there: the doc's "featuring … what their original
// location was when combat first started", plus the escort they came as and whether they were in it before.
function intervenerLines(person) {
  const lines = [
    person.distance === 0
      ? "Was already here when it started."
      : `Came ${person.distance} ${person.distance === 1 ? "Location" : "Locations"}${person.fromLocationName ? ` from ${person.fromLocationName}` : ""}.`,
  ];
  if (person.escortOfId) {
    const charge = person.escortOfName ?? "their charge";
    lines.push(person.side === "ATTACKER" ? `Escorting ${charge} — joined their attack.` : `Escorting ${charge} — stepped in to defend them.`);
  }
  if (person.cameBackFrom === "DECLINED") lines.push("Turned the invitation down, then joined the defenders.");
  if (person.cameBackFrom === "LEFT") lines.push("Left the fight earlier, then came back and joined.");
  return lines;
}

function ParticipantCard({ person, snapshot, onInspect, onMessage, readOnly }) {
  const [open, setOpen] = useState(false);
  const out = person.status === "DECLINED" || person.status === "LEFT";
  return (
    <div className="desk-fighter" data-out={out ? "" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <CharacterAvatar characterId={person.characterId} name={person.name} version={person.avatarVersion} size={24} />
          <button type="button" className="desk-name" onClick={() => onInspect(person.characterId, person.name)}>
            {person.name}
          </button>
          <span className="text-xs text-muted">{ROLE_LABELS[person.role] ?? person.role}</span>
          {STATUS_LABELS[person.status] ? <StatusPill tone="neutral">{STATUS_LABELS[person.status]}</StatusPill> : null}
          {!person.alert ? <StatusPill tone="bad">Surprised</StatusPill> : null}
          {person.calledOff ? <StatusPill tone="neutral">Wants to call off</StatusPill> : null}
        </span>
        <span className="mono text-sm" title="The roll — never shown to the player">
          ⚀ {person.rollLine}
        </span>
      </div>
      {/* What the others in the fight saw of them as they came in, and now if that changed. */}
      <GmLook then={person.look?.then} now={person.look?.now} frozen />
      {person.role === "INTERVENER" && <p className="text-xs text-muted">{intervenerLines(person).join(" ")}</p>}
      {person.leftReason ? <p className="text-xs text-muted">Left the fight: {person.leftReason}.</p> : null}
      {/* Always first, whatever they wrote: the game started this fight for a hungry Vampire (moveRows.js#combatRow). */}
      {person.compelledLine ? <p className="text-sm font-bold">{person.compelledLine}</p> : null}
      <p className="text-sm">
        {person.description ? (
          <span className="quote">» {person.description}</span>
        ) : (
          <span className="text-muted">{person.alert ? "Hasn't written anything." : "Caught by surprise — can't write an attack."}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide snapshot" : "Snapshot"}
        </button>
        {!readOnly && (
          <button type="button" className="btn-quiet" onClick={() => onMessage(person)}>
            Message them
          </button>
        )}
      </div>
      {open ? (
        snapshot ? (
          <SnapshotBody snap={snapshot} />
        ) : (
          <p className="text-xs text-muted">{snapshot === undefined ? "Loading the snapshot…" : "No snapshot."}</p>
        )
      ) : null}
    </div>
  );
}

export default function CombatDesk({
  combat,
  staged,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  stagingRooms,
  onInspect,
  onClose,
  registerEscape,
  gmProfiles,
  // A past turn's fight, opened from History: nothing on it may change, the CavingDesk rule.
  readOnly = false,
  turnLabel = null,
}) {
  const confirm = useConfirm();
  const draftKey = `combat:${combat.id}`;
  const draft = useDeskDraft(draftKey);
  const result = draft?.resultMessage ?? combat.resultMessage ?? "";
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !!draft,
    alsoDirtyHoldsPoll: deskDraftFresh(draftKey),
  });

  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  // Every snapshot at once, on open: a handful of rows, and a GM flicking between cards should not wait.
  // Reloaded whenever anybody's snapshot changes (combatRow's snapshotKey) — somebody joining, and a declined
  // row turning into their place on the defenders, which adds nobody to the count but snapshots them afresh.
  const snapshotKey = `${combat.id}#${combat.snapshotKey ?? combat.people.length}`;
  const [snapshots, setSnapshots] = useState({ key: null, byId: {} });
  useEffect(() => {
    let live = true;
    getCombatSnapshots({ combatId: combat.id })
      .then((res) => live && setSnapshots({ key: snapshotKey, byId: res?.ok ? (res.snapshots ?? {}) : {} }))
      .catch(() => live && setSnapshots({ key: snapshotKey, byId: {} }));
    return () => {
      live = false;
    };
  }, [combat.id, snapshotKey]);
  // undefined while the load for the current key is out; null once it is back without one for them.
  const snapshotFor = (personId) => (snapshots.key === snapshotKey ? (snapshots.byId[personId] ?? null) : undefined);

  const [composer, setComposer] = useState(null);
  // A message composer's prefill: "Stage as message" (everyone, the Result text) or "Message them" (one person).
  const [messageSeed, setMessageSeed] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const setResult = useCallback(
    (value) => {
      markDirty();
      writeDeskDraft(draftKey, { resultMessage: value });
    },
    [markDirty, draftKey],
  );

  const everyone = combat.people.filter((p) => p.status !== "DECLINED").map((p) => ({ id: p.characterId, name: p.name }));
  const recipients = (list) => list.map((p) => ({ characterId: p.id, name: p.name }));

  function run(mode) {
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await resolveCombat({ combatId: combat.id, resultMessage: result, mode }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        clearDeskDraft(draftKey);
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  async function endFight() {
    const ok = await confirm({
      title: "End this fight now?",
      message: "Everybody in it goes free at once — nobody is held the 30 minutes a call-off holds — and they're all told. The fight stays here for you to rule on.",
      confirmLabel: "End the fight",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await endCombatAsGmAction({ combatId: combat.id }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  const done = (patch) => {
    setComposer(null);
    setMessageSeed(null);
    applyDeskPatch(patch);
  };

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{combat.title}</h2>
          <p className="text-xs text-muted">
            {combat.locationName}
            {combat.zoneName ? ` · ${combat.zoneName}` : ""} · started <span className="mono">{new Date(combat.startedAtMs).toISOString().slice(11, 16)}</span>
            {combat.endLabel ? ` · ${combat.endLabel}` : ""}
            {readOnly && turnLabel ? ` · ${turnLabel}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {combat.fromAmbush && <StatusPill tone="neutral">Ambush</StatusPill>}
            <StatusPill tone={combat.live ? "bad" : "neutral"}>{combat.statusLabel}</StatusPill>
            {combat.reopened && <StatusPill tone="warn">Reopened</StatusPill>}
          </p>
          {combat.reopened ? (
            <p className="mt-1 text-xs text-muted">Somebody came into this fight after it was solved. Look it over again, then Solve.</p>
          ) : null}
          {combat.openingMessage ? <p className="mt-1 text-sm quote">» {combat.openingMessage}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {combat.live && !readOnly && (
            <button type="button" className="btn-quiet" onClick={endFight} disabled={pending}>
              End fight
            </button>
          )}
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {GROUPS.map((group) => {
        const people = combat.people.filter(group.test);
        if (people.length === 0) return null;
        return (
          <section key={group.key} className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="field-label">{group.label}</h3>
            {people.map((person) => (
              <ParticipantCard
                key={person.id}
                person={person}
                snapshot={snapshotFor(person.id)}
                onInspect={onInspect}
                readOnly={readOnly}
                onMessage={(p) => {
                  setMessageSeed({ recipients: [{ characterId: p.characterId, name: p.name }], content: undefined });
                  setComposer("message");
                }}
              />
            ))}
          </section>
        );
      })}

      <div className="desk-result mt-4 flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Result — what happened in this fight</span>
          <textarea
            rows={5}
            maxLength={RESULT_BOX_MAX_LENGTH}
            value={result}
            disabled={pending || readOnly}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Who came off worse, and how…"
          />
        </label>
        {!readOnly && (
          <button
            type="button"
            className="btn-quiet self-start"
            disabled={!result.trim()}
            onClick={() => {
              setMessageSeed({ recipients: recipients(everyone), content: result });
              setComposer("message");
            }}
          >
            Stage as message to everyone in it
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this fight</h3>
          {!readOnly && (
            <StagingStrip
              onEffect={() => setComposer("effect")}
              onRoom={() => setComposer("room")}
              onLetIn={() => setComposer("letin")}
              onDeath={() => setComposer("death")}
              onMessage={() => {
                setMessageSeed(null);
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

      {composer === "effect" && (
        <EffectComposer
          combatId={combat.id}
          quickPicks={everyone}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onDone={done}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "room" && (
        <RoomEffectComposer
          combatId={combat.id}
          tagCatalog={tagCatalog}
          stagingRooms={stagingRooms}
          onDone={done}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "letin" && (
        <RoomEntryComposer
          combatId={combat.id}
          quickPicks={everyone}
          roster={roster}
          stagingRooms={stagingRooms}
          onDone={done}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "death" && (
        <DeathComposer combatId={combat.id} quickPicks={everyone} roster={roster} onDone={done} onCancel={() => setComposer(null)} />
      )}
      {composer === "message" && (
        <MessageComposer
          combatId={combat.id}
          quickPicks={everyone}
          initialContent={messageSeed?.content}
          initialRecipients={messageSeed?.recipients}
          roster={roster}
          onDone={done}
          onCancel={() => {
            setComposer(null);
            setMessageSeed(null);
          }}
        />
      )}
      {composer === "public" && (
        <PublicComposer combatId={combat.id} zones={presenceZones} onDone={done} onCancel={() => setComposer(null)} />
      )}

      {combat.resolvedByUsername && (
        <p className="mt-3 text-xs text-muted">Solved by {combat.resolvedByUsername}</p>
      )}

      <FormError>{error}</FormError>

      {!readOnly && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={pending}>
            {pending ? "Working…" : "Save"}
          </button>
          {combat.resolvedAt ? (
            <button type="button" className="btn-quiet" onClick={() => run("unsolve")} disabled={pending}>
              Reopen
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => run("solve")} disabled={pending}>
              {pending ? "Working…" : "Solve"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
