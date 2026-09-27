"use client";

// "Everyone in the fight", one tap each, above a composer's roster search (docs/systemdocs/ATTACK.md §8 —
// the doc: staging a combat "allows GMs to readily select characters involved in the combat as targets
// without having to search their names individually"). `picks` is [{ id, name, note? }]; `chosen` is the
// set of ids already on the composer. Draws nothing without picks, so every other desk is unchanged.
export default function QuickPicks({ picks, chosen, onAdd, label = "In this fight" }) {
  if (!picks?.length) return null;
  const left = picks.filter((p) => !chosen.has(p.id));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {left.length > 1 && (
          <button type="button" className="chip" onClick={() => onAdd(left)}>
            + All of them
          </button>
        )}
        {left.map((p) => (
          <button key={p.id} type="button" className="chip" onClick={() => onAdd([p])}>
            + {p.name}
            {p.note ? <span className="chip-note">{p.note}</span> : null}
          </button>
        ))}
        {left.length === 0 && <span className="text-sm text-muted">all added</span>}
      </div>
    </div>
  );
}
