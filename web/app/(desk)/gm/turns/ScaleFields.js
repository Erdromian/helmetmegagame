"use client";

import Select from "@/app/components/Select";
import { SCALES, formatScaleNumber as shown, resolveScale } from "@lifeweb/db/lib/stagedScales";

// The staging composer's Scales group (ADJUDICATION.md §1b): hunger, mood and a
// Vampire's blood and humanity, each left alone, Set to a number, or Changed
// by one. The limits come from db/lib/stagedScales.js, the same registry the
// server validates against, so the two can't disagree.
//
// `value` is { [key]: { op: "" | "set" | "add", value: string } }. `readings`
// is what getScaleReadings sent back for the chosen targets — null while it
// loads or if it failed, which only costs the "now" line.
//
// Blood and humanity only show when somebody picked is a Vampire, or the row
// already carries one of them, or the readings never came back and there is
// no way to tell.

export function emptyScaleDraft(existing) {
  return Object.fromEntries(
    SCALES.map((s) => {
      const change = existing?.[s.key];
      return [s.key, change ? { op: change.op, value: String(change.value) } : { op: "", value: "" }];
    }),
  );
}

// What goes to the server: only the scales a GM picked a mode for.
export function scaleDraftPayload(draft) {
  const out = {};
  for (const s of SCALES) {
    const entry = draft?.[s.key];
    if (entry?.op) out[s.key] = { op: entry.op, value: entry.value.trim() };
  }
  return out;
}

export function scaleDraftDirty(draft) {
  return SCALES.some((s) => draft?.[s.key]?.op);
}

// The consequence a GM should hear about before pressing Stage, not after
// reading the tray on the next turn.
function edgeNote(key, to, from) {
  if (key === "hunger" && to === 0) return "At 0 they start dying at the next push unless they eat before it.";
  if (key === "blood" && to === 0 && from !== 0) return "Bloodcrazed: 60 humanity gone, and they feed and attack next turn.";
  if (key === "humanity" && to === 0 && from !== 0) return "Bestial and a Wight, for good.";
  return null;
}

function readout(scale, entry, readings) {
  const change = entry.op && entry.value.trim() !== "" && Number.isInteger(Number(entry.value))
    ? { op: entry.op, value: Number(entry.value) }
    : null;
  if (!readings?.length) {
    return change?.op === "set" ? { line: `→ ${shown(change.value)} (${scale.band(change.value)})` } : null;
  }

  if (readings.length === 1) {
    const r = readings[0];
    const blocked = r.blocked?.[scale.key];
    if (blocked) return { warnLine: `Won't move — ${blocked}.` };
    const now = r.values?.[scale.key];
    const nowText = `Now ${shown(now)} (${scale.band(now)})`;
    if (!change) return { line: nowText };
    const to = resolveScale(scale.key, now, change);
    return {
      line: `${nowText} → ${shown(to)} (${scale.band(to)})`,
      note: edgeNote(scale.key, to, now),
    };
  }

  // Several targets: no single "now" to show. Who will be skipped only once a
  // change is actually picked — before that it is noise on every row.
  if (!change) return null;
  const blocked = readings.filter((r) => r.blocked?.[scale.key]);
  const reasons = [...new Set(blocked.map((r) => r.blocked[scale.key]))].join(", ");
  return {
    line: change.op === "set" ? `→ ${shown(change.value)} (${scale.band(change.value)})` : null,
    warnLine: blocked.length ? `${blocked.length} of ${readings.length} won't move — ${reasons}.` : null,
    note: change.op === "set" ? edgeNote(scale.key, change.value, null) : null,
  };
}

export default function ScaleFields({ value, onChange, readings, readingsFailed, existing }) {
  const anyVampire = readings?.some((r) => r.vampire);
  const visible = SCALES.filter(
    (s) => !s.vampire || anyVampire || readingsFailed || existing?.[s.key] || value?.[s.key]?.op,
  );

  function update(key, patch) {
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  }

  return (
    <section className="composer-group">
      <h3 className="composer-group-title">Scales</h3>
      <p className="text-xs text-muted">
        Hidden meters — players only ever see the word. Applied at the push, and tonight&apos;s decay leaves them alone: they start the next turn on this number.
      </p>
      {visible.map((scale) => {
        const entry = value?.[scale.key] ?? { op: "", value: "" };
        const said = readout(scale, entry, readings);
        return (
          <div key={scale.key} className="flex flex-wrap items-end gap-2">
            <label className="field" style={{ width: "9rem" }}>
              <span className="field-label">{scale.label}</span>
              <Select
                value={entry.op}
                onChange={(e) => update(scale.key, { op: e.target.value })}
                aria-label={`${scale.label}: how to change it`}
              >
                <option value="">No change</option>
                <option value="set">Set to</option>
                <option value="add">Change by</option>
              </Select>
            </label>
            {entry.op && (
              <label className="field" style={{ width: "7rem" }}>
                <span className="field-label">
                  {entry.op === "set" ? `${shown(scale.min)}–${shown(scale.max)}` : "±"}
                </span>
                <input
                  type="number"
                  step={1}
                  min={entry.op === "set" ? scale.min : undefined}
                  max={entry.op === "set" ? scale.max : undefined}
                  value={entry.value}
                  onChange={(e) => update(scale.key, { value: e.target.value })}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder={entry.op === "add" ? "±0" : undefined}
                />
              </label>
            )}
            {said && (said.line || said.warnLine || said.note) && (
              <div className="min-w-0 pb-2 text-xs">
                {said.line && <p className="text-muted">{said.line}</p>}
                {said.warnLine && <p className="text-accent">{said.warnLine}</p>}
                {said.note && <p className="text-accent">{said.note}</p>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
