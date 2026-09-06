"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import Tooltip from "@/app/components/Tooltip";
import FormError from "@/app/components/FormError";
import { ANTAGONISTS, optInName, optInWhitelisted } from "@/lib/threats";
import { LEVELS, setPriority, pickedNothing } from "@lifeweb/db/lib/playerPreferences";
import { savePreferences, setReady, setUnready } from "../lobbyActions";

// The pregame lobby (docs/systemdocs/LOBBY.md §2): what a player sees on
// /character while the game is gathering and they have no character.
// Preferences save on every change, debounced; Ready is its own button.
//
// The four-level control is a .chip-row of four buttons, the house form for a
// small set of exclusive states. The High chip is weightier because it is the
// one that matters most to the roll (db/lib/roleAssignment.js).

const LEVEL_LABEL = { OFF: "Off", LOW: "Low", MEDIUM: "Med", HIGH: "High" };
const JOBLESS_OPTIONS = [
  { value: "COMMONER", label: "Join as Commoner" },
  { value: "MIGRANT", label: "Join as Migrant" },
  { value: "RETURN_TO_LOBBY", label: "Return to lobby" },
];
const SAVE_DELAY_MS = 400;

function PriorityControl({ slug, level, onChange, disabled }) {
  return (
    <div className="chip-row priority-row" role="radiogroup" aria-label="Priority">
      {["OFF", ...LEVELS].map((value) => {
        const active = (level ?? "OFF") === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`chip${value === "HIGH" ? " chip-high" : ""}`}
            data-active={active ? "true" : undefined}
            disabled={disabled}
            onClick={() => onChange(slug, value)}
          >
            {LEVEL_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}

export default function Lobby({ groups, initial, entry, readyCount, whitelisted, canSkip }) {
  const [priorities, setPriorities] = useState(initial.rolePriorities ?? {});
  const [optIns, setOptIns] = useState(initial.antagonistOptIns ?? []);
  const [jobless, setJobless] = useState(initial.joblessRole ?? "COMMONER");
  const [readyAt, setReadyAt] = useState(entry?.readyAt ?? null);
  const [openIntro, setOpenIntro] = useState(null);
  const [error, setError] = useState(null);
  const [saving, startSaving] = useTransition();
  const [pending, startPending] = useTransition();
  const timer = useRef(null);

  // Debounced: a player sweeping down the list fires one save, not thirty.
  // Whatever the server normalized comes back and replaces the local copy, so
  // a dropped whitelisted slug disappears from the screen too.
  function queueSave(next) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startSaving(async () => {
        try {
          const res = await savePreferences(next);
          if (!res?.ok) setError(res?.error ?? "Couldn't save. ‡");
          else {
            setError(null);
            setPriorities(res.saved.rolePriorities);
            setOptIns(res.saved.antagonistOptIns);
            setJobless(res.saved.joblessRole);
          }
        } catch {
          setError("Couldn't reach the server. Your last change may not have saved. ‡");
        }
      });
    }, SAVE_DELAY_MS);
  }

  function changeLevel(slug, level) {
    const next = setPriority(priorities, slug, level);
    setPriorities(next);
    queueSave({ priorities: next, antagonistOptIns: optIns, joblessRole: jobless });
  }

  function toggleOptIn(slug) {
    const next = optIns.includes(slug) ? optIns.filter((s) => s !== slug) : [...optIns, slug];
    setOptIns(next);
    queueSave({ priorities, antagonistOptIns: next, joblessRole: jobless });
  }

  function changeJobless(value) {
    setJobless(value);
    queueSave({ priorities, antagonistOptIns: optIns, joblessRole: value });
  }

  function toggleReady() {
    setError(null);
    startPending(async () => {
      try {
        const res = readyAt ? await setUnready() : await setReady();
        if (!res?.ok) setError(res?.error ?? "Something went wrong. ‡");
        else setReadyAt(readyAt ? null : res.readyAt);
      } catch {
        setError("Couldn't reach the server. ‡");
      }
    });
  }

  const nothingPicked = pickedNothing(priorities) && jobless === "RETURN_TO_LOBBY";
  const highSlug = Object.entries(priorities).find(([, l]) => l === "HIGH")?.[0] ?? null;

  return (
    <PageShell>
      <PageHeader
        title="Ravenheart is gathering"
        subtitle="The game has not started. Set what you'd like to play, then ready up. ‡"
        actions={
          <span className="chip mono">
            {readyCount} ready
          </span>
        }
      />

      {canSkip ? (
        <p className="text-sm">
          <Link href="/character?create=1" className="btn-secondary">
            Skip to character creation
          </Link>
          <span className="ml-3 text-muted">Gamemasters only. Makes a character now, lobby or not. ‡</span>
        </p>
      ) : null}

      <div className="panel flex flex-col gap-2 p-4" data-ready={readyAt ? "true" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="lobby-dot" aria-hidden="true" />
            <strong>{readyAt ? "Ready" : "Not ready"}</strong>
            {readyAt ? (
              <span className="text-sm text-muted">
                since {new Date(readyAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : null}
            {saving ? <span className="text-xs text-muted">saving…</span> : null}
          </span>
          <button type="button" className={readyAt ? "btn-secondary" : "btn"} onClick={toggleReady} disabled={pending}>
            {pending ? "…" : readyAt ? "Unready" : "Ready up"}
          </button>
        </div>
        <p className="text-sm text-muted">You can change everything below until the game starts. ‡</p>
        {nothingPicked ? (
          <p className="text-sm text-accent">
            You&apos;ve picked nothing, so you&apos;ll be sent back to the lobby at the start. ‡
          </p>
        ) : null}
        <FormError>{error}</FormError>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="panel-header">Roles</h2>
          <span className="text-xs text-muted">
            {highSlug ? "One High at a time. Setting another demotes this one to Med. ‡" : "One High at a time. ‡"}
          </span>
        </div>
        {groups.map((group) => (
          <div key={group.slug} className="flex flex-col gap-1">
            <h3 className="text-xs uppercase tracking-wide text-muted">{group.name}</h3>
            <ul className="panel divide-y divide-[var(--border)]">
              {group.roles.map((role) => {
                const locked = role.whitelistBlocked;
                const row = (
                  <li key={role.id} className="lobby-role" data-locked={locked ? "true" : undefined}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <button
                          type="button"
                          className="lobby-role-name"
                          onClick={() => setOpenIntro(openIntro === role.id ? null : role.id)}
                          aria-expanded={openIntro === role.id}
                        >
                          {role.name}
                          {role.grantsLeader ? <span title="Leader"> ★</span> : null}
                        </button>
                        <span className="text-xs text-muted">
                          {role.factionName}
                          {role.startingZoneName ? ` · ${role.startingZoneName}` : ""}
                        </span>
                      </div>
                      {openIntro === role.id && role.intro ? (
                        <p className="mt-1 text-sm text-muted">{role.intro}</p>
                      ) : null}
                    </div>
                    {locked ? (
                      <span className="text-xs text-muted">Whitelist only ‡</span>
                    ) : (
                      <PriorityControl slug={role.slug} level={priorities[role.slug]} onChange={changeLevel} />
                    )}
                  </li>
                );
                return locked ? (
                  <Tooltip key={role.id} text="Whitelist only ‡" className="block">
                    {row}
                  </Tooltip>
                ) : (
                  row
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="panel flex flex-col gap-2 p-4">
        <h2 className="panel-header">If nothing fits</h2>
        <div className="max-w-xs">
          <Select value={jobless} onChange={(e) => changeJobless(e.target.value)} aria-label="If nothing fits">
            {JOBLESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-sm text-muted">
          Return to lobby means you late-join by hand after the start. ‡
        </p>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Antagonists (optional)</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {ANTAGONISTS.map((a) => {
            const locked = optInWhitelisted(a) && !whitelisted;
            const box = (
              <CheckField
                key={a.slug}
                checked={optIns.includes(a.slug)}
                onChange={() => toggleOptIn(a.slug)}
                disabled={locked}
                className={locked ? "is-locked" : ""}
              >
                {optInName(a)}
              </CheckField>
            );
            return locked ? (
              <Tooltip key={a.slug} text="Whitelist only ‡" className="block">
                {box}
              </Tooltip>
            ) : (
              box
            );
          })}
        </div>
        <p className="text-sm text-muted">Ticking one says you&apos;re open to it. It doesn&apos;t promise it. ‡</p>
      </section>
    </PageShell>
  );
}
