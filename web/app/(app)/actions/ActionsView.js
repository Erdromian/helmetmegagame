"use client";

import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import Select from "@/app/components/Select";
import EmptyState from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import MarkdownContent from "@/app/components/MarkdownContent";

// What the page draws, from the one object page.js#FreshActions produces — the stored copy first, the
// fresh one when it lands (web/lib/snapshot). Rows are web/lib/spectatorActions.js's: nothing here
// decides what a spectator may see, only how it reads.

function Person({ characterId, name, version }) {
  return (
    <span className="flex items-center gap-2">
      <CharacterAvatar characterId={characterId} name={name} version={version} size={24} />
      <span className="font-medium">{name}</span>
    </span>
  );
}

// What a player wrote, as the desk quotes it.
function Written({ text, empty }) {
  return text ? (
    <p className="quote whitespace-pre-wrap text-sm">
      <span className="mark">»</span> {text}
    </p>
  ) : (
    <p className="text-sm text-muted">{empty}</p>
  );
}

// The GM's Result box and every message the push sent off this row. A Caving result has no Result
// here (spectatorActions.js keeps its GM notes back), so it passes none and shows only what was sent.
function Outcome({ result, messages }) {
  return (
    <div className="flex flex-col gap-2">
      {result !== undefined && (
        <div>
          <p className="field-label">Result</p>
          {result ? (
            <p className="whitespace-pre-wrap text-sm">{result}</p>
          ) : (
            <p className="text-sm text-muted">No result written.</p>
          )}
        </div>
      )}
      {messages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="field-label">Sent</p>
          {messages.map((m) => (
            <div key={m.id} className="text-sm">
              <p className="text-xs text-muted">
                {m.kind === "PUBLIC" ? `Posted in ${m.to || "a zone"}` : `To ${m.to || "somebody"}`}
              </p>
              <MarkdownContent content={m.content} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One entry in a section: a rule above every one but the first.
function Entry({ first, children }) {
  return (
    <article
      className={`flex flex-col gap-2 ${first ? "" : "border-t pt-3"}`.trim()}
      style={first ? undefined : { borderColor: "var(--border)" }}
    >
      {children}
    </article>
  );
}

function Count({ n }) {
  return <span className="text-xs text-muted">{n}</span>;
}

function Moves({ moves }) {
  return (
    <Panel title="Moves" actions={<Count n={moves.length} />}>
      {moves.length === 0 ? (
        <EmptyState>Nobody filed a Move this turn.</EmptyState>
      ) : (
        moves.map((m, i) => (
          <Entry key={m.id} first={i === 0}>
            <header className="flex flex-wrap items-center gap-2">
              <Person characterId={m.characterId} name={m.characterName} version={m.avatarVersion} />
              <span className="chip">{m.kindLabel}</span>
              <span className="text-xs text-muted">{m.where}</span>
            </header>
            <Written text={m.description} empty="Nothing written." />
            <Outcome result={m.result} messages={m.messages} />
          </Entry>
        ))
      )}
    </Panel>
  );
}

function Fights({ fights }) {
  return (
    <Panel title="Fights" actions={<Count n={fights.length} />}>
      {fights.length === 0 ? (
        <EmptyState>No fights this turn.</EmptyState>
      ) : (
        fights.map((f, i) => (
          <Entry key={f.id} first={i === 0}>
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{f.title}</h3>
              {f.fromAmbush && <StatusPill tone="neutral">Ambush</StatusPill>}
              <StatusPill tone="neutral">{f.endLabel}</StatusPill>
              {f.where ? <span className="text-xs text-muted">{f.where}</span> : null}
            </header>
            {f.openingMessage ? <Written text={f.openingMessage} /> : null}
            {f.sides.map((side) => (
              <section key={side.key} className="flex flex-col gap-1.5">
                <p className="group-label">{side.label}</p>
                {side.people.map((p) => (
                  <div key={p.id} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Person characterId={p.characterId} name={p.name} version={p.avatarVersion} />
                      {p.fromLocationName ? (
                        <span className="text-xs text-muted">came from {p.fromLocationName}</span>
                      ) : null}
                      {p.left ? <StatusPill tone="neutral">Left</StatusPill> : null}
                    </span>
                    <Written text={p.description} empty="Wrote nothing." />
                  </div>
                ))}
              </section>
            ))}
            <Outcome result={f.result} messages={f.messages} />
          </Entry>
        ))
      )}
    </Panel>
  );
}

function cavingLine(c) {
  if (c.kind === "TROUBLE") return c.severity;
  if (c.kind === "FIND") {
    if (!c.lootName) return "Found something";
    if (c.lootUndone) return `Found ${c.lootName}, taken back`;
    if (c.lootAlreadyHeld) return c.lootRoomName ? `Found ${c.lootName}, left in ${c.lootRoomName}` : `Found ${c.lootName}, already had one`;
    return `Found ${c.lootName}`;
  }
  return "Nothing happened";
}

function Caving({ caving }) {
  return (
    <Panel title="Caving" actions={<Count n={caving.length} />}>
      {caving.length === 0 ? (
        <EmptyState>Nobody went caving this turn.</EmptyState>
      ) : (
        caving.map((c, i) => (
          <Entry key={c.id} first={i === 0}>
            <header className="flex flex-wrap items-center gap-2">
              <Person characterId={c.characterId} name={c.characterName} version={c.avatarVersion} />
              <StatusPill tone={c.kind === "TROUBLE" ? "bad" : "neutral"}>{c.kindLabel}</StatusPill>
              <span className="text-sm">{cavingLine(c)}</span>
              {c.where ? <span className="text-xs text-muted">{c.where}</span> : null}
            </header>
            {c.response ? <Written text={c.response} /> : null}
            {c.messages.length > 0 && <Outcome messages={c.messages} />}
          </Entry>
        ))
      )}
    </Panel>
  );
}

export default function ActionsView({ turns, record }) {
  const router = useRouter();
  return (
    <PageShell width="wide">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">
          What every character did, and what came of it, once each turn was pushed.
        </p>
        {turns.length > 0 && (
          <label className="field" style={{ minWidth: "12rem" }}>
            <span className="field-label">Turn</span>
            <Select
              value={record?.turn.number != null ? String(record.turn.number) : ""}
              onChange={(e) => router.push(`/actions?turn=${e.target.value}`)}
            >
              {turns.map((t) => (
                <option key={t.id} value={String(t.number)}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {record ? (
        <>
          <Moves moves={record.moves} />
          <Fights fights={record.fights} />
          <Caving caving={record.caving} />
        </>
      ) : (
        <EmptyState>No turn has been pushed yet.</EmptyState>
      )}
    </PageShell>
  );
}
