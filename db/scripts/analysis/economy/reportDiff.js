// What moved between two economy reports: the report.md lines and the model.json figures that changed.
// Used by `npm run economy:report -- --diff` (report.js). Pure: takes the two texts, returns lines to print.

// report.md: compare section by section. A table row is matched on its first cell, a sentence on its opening
// words, so a changed figure shows as one before/after pair rather than a removal and an addition.
function diffMarkdown(before, after) {
  const sections = (text) => {
    const out = new Map();
    let head = "(top)";
    for (const line of text.split("\n")) {
      if (/^#{1,3} /.test(line)) {
        head = line.replace(/^#+ /, "");
        continue;
      }
      if (!line.trim() || /^\|[-:| ]+\|$/.test(line)) continue;
      if (!out.has(head)) out.set(head, []);
      out.get(head).push(line);
    }
    return out;
  };
  const keyOf = (line) => (line.startsWith("|") ? line.split("|")[1].trim() : line.slice(0, 48));
  const a = sections(before);
  const b = sections(after);
  const lines = [];
  for (const head of new Set([...a.keys(), ...b.keys()])) {
    const was = a.get(head) ?? [];
    const now = b.get(head) ?? [];
    const gone = was.filter((l) => !now.includes(l));
    const added = now.filter((l) => !was.includes(l));
    if (!gone.length && !added.length) continue;
    lines.push(`## ${head}`);
    const byKey = new Map(added.map((l) => [keyOf(l), l]));
    for (const g of gone) {
      const k = keyOf(g);
      if (byKey.has(k)) {
        lines.push(`  - ${g}`, `  + ${byKey.get(k)}`);
        byKey.delete(k);
      } else lines.push(`  - ${g}`);
    }
    for (const l of byKey.values()) lines.push(`  + ${l}`);
  }
  return lines;
}

// model.json: flatten to path → value, arrays of records keyed by their id, slug, key or name where they have
// one, and list every number that moved by more than `eps` and every string that changed.
function flatten(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const id = v && typeof v === "object" ? v.id ?? v.slug ?? v.key ?? v.name ?? null : null;
      flatten(v, `${prefix}[${id ?? i}]`, out);
    });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.set(prefix, value);
  return out;
}
function diffModel(before, after, { eps = 0.05, cap = 200 } = {}) {
  const a = flatten(before, "", new Map());
  const b = flatten(after, "", new Map());
  const changes = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    if (typeof x === "number" && typeof y === "number") {
      if (Math.abs(x - y) > eps) changes.push({ key, x, y });
    } else if (x !== y && (typeof x === "string" || typeof y === "string" || x === undefined || y === undefined)) {
      if (x === undefined && y === undefined) continue;
      changes.push({ key, x, y });
    }
  }
  const byTop = new Map();
  for (const c of changes) {
    const top = c.key.split(/[.[]/)[0];
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(c);
  }
  const show = (v) => (v === undefined ? "(none)" : typeof v === "number" ? String(Math.round(v * 100) / 100) : JSON.stringify(v).slice(0, 80));
  const lines = [];
  let shown = 0;
  for (const [top, list] of byTop) {
    if (shown >= cap) break;
    lines.push(`## ${top} (${list.length})`);
    for (const c of list) {
      if (shown >= cap) break;
      lines.push(`  ${c.key}: ${show(c.x)} → ${show(c.y)}`);
      shown++;
    }
  }
  if (changes.length > shown) lines.push(`… and ${changes.length - shown} more`);
  return { lines, count: changes.length };
}

module.exports = { diffMarkdown, diffModel };
