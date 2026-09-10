"use client";

// The Oracle desk. See docs/systemdocs/ORACLE.md.
//
// Three columns, the shape the other desks already use (.desk-body is a
// 19rem / 1fr / 22rem grid): the zone rail, one page of prose, and the shared
// inspector. Clicking a name in the prose is what fills the inspector, which is
// the whole reason this is a desk and not a document page.
//
// The right-hand column is web/app/components/InspectorColumn.js — the SAME
// component /gm/turns and /gm/players mount, with the same Sheet / Tags / Moves
// / Archive / DMs tabs. Nothing about it is rebuilt here; a name click asks it
// for the Moves tab through `requestedTab`, the way the adjudication desk's
// "Past moves" button does.

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InspectorColumn from "@/app/components/InspectorColumn";
import DevPanelModal from "@/app/components/DevPanelModal";
import GmZoneRail from "@/app/components/GmZoneRail";
import usePins from "@/app/components/usePins";
import { useVisibleZoneNames } from "@/app/components/GmZoneViewProvider";
import OracleMarkdown from "./OracleMarkdown";
import { saveSynopsis } from "./actions";

const FRONT_PAGE = "__front__";

function EditBox({ page, onDone, onCancel }) {
  const [text, setText] = useState(page.body);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="field">
        <textarea
          value={text}
          rows={18}
          maxLength={20000}
          onChange={(event) => setText(event.target.value)}
          aria-label="Page"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() =>
            startSave(async () => {
              const res = await saveSynopsis({ id: page.id, body: text });
              if (res.ok) onDone(res.row);
              else setError(res.error);
            })
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    </div>
  );
}

export default function OracleDesk({
  turn,
  turns,
  pages,
  threads,
  zones,
  counts,
  roster,
  selectableZones,
  visibleZoneIds,
  visibleZoneNames,
  selectedKey,
}) {
  const router = useRouter();
  const [edits, setEdits] = useState(() => new Map());
  const [editing, setEditing] = useState(false);
  const [cache, setCache] = useState(() => new Map());
  const [devPanel, setDevPanel] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [tabRequest, setTabRequest] = useState(null);

  const zonesInView = useVisibleZoneNames(visibleZoneNames);
  const { pins, togglePin } = usePins({
    knownIdentities: useMemo(() => new Set(roster.map((r) => `c:${r.id}`)), [roster]),
  });

  const rosterById = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);

  // A page a GM saved in this session, over the server's copy. Avoids a full
  // desk reload for a change only this column shows.
  const pageFor = useCallback(
    (key) => {
      const base = pages.find((p) => p.key === key) ?? null;
      if (!base) return null;
      const edited = edits.get(base.id);
      return edited ? { ...base, ...edited } : base;
    },
    [pages, edits],
  );

  const page = pageFor(selectedKey);

  // The zone rail honours GmZoneView the way every other desk does — as a
  // VIEW. The server still ships every page (GAMEMASTERS.md §1); this hides
  // rows a GM has filtered out, it does not defend them.
  const visibleZones = useMemo(
    () => (zonesInView ? zones.filter((z) => zonesInView.includes(z.name)) : zones),
    [zones, zonesInView],
  );

  const onInspect = useCallback(
    (characterId, _name, tab) => {
      const row = rosterById.get(characterId);
      if (!row) return;
      setInspected({ characterId: row.id, discordUserId: row.discordUserId, name: row.name });
      if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
    },
    [rosterById],
  );

  const pinned = useMemo(
    () =>
      pins
        .map((p) => (p.characterId ? rosterById.get(p.characterId) : null))
        .filter(Boolean)
        .map((r) => ({ characterId: r.id, discordUserId: r.discordUserId, name: r.name })),
    [pins, rosterById],
  );

  function select(key) {
    setEditing(false);
    router.replace(`/gm/oracle?turn=${turn.number}&page=${encodeURIComponent(key)}`, { scroll: false });
  }

  return (
    <>
      <header className="desk-header">
        <h1 className="section-title">Oracle</h1>
        <div className="flex items-center gap-2">
          <label className="field-label" htmlFor="oracle-turn">
            Turn
          </label>
          <select
            id="oracle-turn"
            className="mono"
            value={turn.number}
            onChange={(event) => router.push(`/gm/oracle?turn=${event.target.value}`)}
          >
            {turns.map((t) => (
              <option key={t.number} value={t.number}>
                {t.number} · {t.phase === "DAWN" ? "Dawn" : "Dusk"}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="desk-body">
        <aside className="desk-rail">
          <button
            type="button"
            className={`desk-card ${selectedKey === FRONT_PAGE ? "is-selected" : ""}`}
            onClick={() => select(FRONT_PAGE)}
          >
            Front page
          </button>

          {visibleZones.map((zone) => {
            const count = counts[zone.id] ?? { present: 0 };
            return (
              <button
                key={zone.id}
                type="button"
                className={`desk-card ${selectedKey === zone.slug ? "is-selected" : ""}`}
                onClick={() => select(zone.slug)}
              >
                <span>{zone.name}</span>
                <span className="mono text-sm text-muted">{count.present}</span>
              </button>
            );
          })}

          {threads.length > 0 && (
            <section className="flex flex-col gap-1 p-3">
              <h2 className="field-label">Threads</h2>
              {threads.map((thread) => (
                <p key={thread.name} className="text-sm">
                  <strong>{thread.name}</strong>
                  <br />
                  <span className="text-muted">{thread.state}</span>
                </p>
              ))}
            </section>
          )}
        </aside>

        <main className="desk-main">
          {!page ? (
            <div className="desk-empty">
              <p>Nothing written for this turn yet.</p>
              <p className="text-sm">
                <Link href="/gm/dev?s=oracle">Settings</Link>
              </p>
            </div>
          ) : (
            <article className="flex flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="section-title">{page.title}</h2>
                {!editing && (
                  <button type="button" className="btn-quiet" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )}
              </div>


              {editing ? (
                <EditBox
                  page={page}
                  onCancel={() => setEditing(false)}
                  onDone={(row) => {
                    setEdits((prev) => new Map(prev).set(row.id, row));
                    setEditing(false);
                  }}
                />
              ) : (
                <OracleMarkdown text={page.body} onInspect={onInspect} className="doc-body" />
              )}
            </article>
          )}
        </main>

        <InspectorColumn
          inspected={inspected}
          pinned={pinned}
          roster={roster}
          onInspect={onInspect}
          onTogglePin={togglePin}
          cache={cache}
          setCache={setCache}
          tagsById={{}}
          currentTurnNumber={turn.number}
          pendingByCharacter={new Map()}
          onOpenDev={(characterId, name) => setDevPanel({ characterId, name })}
          requestedTab={tabRequest}
          emptyHint="Click a name to pull that character up here."
          footer={<GmZoneRail zones={selectableZones} selectedIds={visibleZoneIds} />}
        />
      </div>

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
    </>
  );
}
