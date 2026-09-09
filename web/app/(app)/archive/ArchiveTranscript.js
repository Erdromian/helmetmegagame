import ChatMarkdown from "@/app/components/ChatMarkdown";

// The transcript as a dense reading surface (docs/systemdocs/ARCHIVE.md §5):
// one line per thing said, under a sticky day header and a scene line, with
// runs of system rows folded into one muted line each.
//
// Grouping is by CONSECUTIVE runs over the page's rows, never by bucketing
// the whole page: rows arrive in the query's order, and bucketing would
// silently reorder a page whose sort is newest-first. The one pre-pass below
// builds a flat list of blocks; nothing mutates during render.

const FOLD_LABEL = {
  CHARACTER_CREATED: (n) => `${n} arrived`,
  DEATH: (n) => `${n} died`,
  DESIRE_FULFILLED: (n) => (n === 1 ? "1 desire fulfilled" : `${n} desires fulfilled`),
  TRAVEL: (n) => `${n} moved`,
  LIFEWEB: (n) => `${n} lifeweb`,
};

function phaseWord(phase) {
  return phase ? `${phase.charAt(0)}${phase.slice(1).toLowerCase()}` : null;
}

function dayLabel(entry) {
  if (entry.turnNumber == null) return "Before the game";
  return `Day ${Math.ceil(entry.turnNumber / 2)}`;
}

function sceneLabel(entry) {
  const place = entry.zoneName ?? "Elsewhere";
  return entry.threadName ? `${place} · ${entry.threadName}` : place;
}

// A concealed message keeps both halves: the alias is what the room saw, the
// real name is who it was. Together they make the finished archive readable
// as one story — and are why the archive stays shut until the game ends.
function displayName(entry) {
  if (entry.concealedAlias) {
    return entry.characterName ? `${entry.concealedAlias} (${entry.characterName})` : entry.concealedAlias;
  }
  return entry.characterName ?? "Unknown";
}

function clock(sentAt) {
  return new Date(sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function foldSummary(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, n]) => (FOLD_LABEL[kind] ?? ((k) => `${k} ${kind.toLowerCase()}`))(n))
    .join(" · ");
}

function buildBlocks(entries) {
  const blocks = [];
  let dayKey = undefined;
  let sceneKey = undefined;
  let lastDay = null;
  for (const entry of entries) {
    const thisDay = entry.turnNumber ?? "none";
    if (thisDay !== dayKey) {
      dayKey = thisDay;
      sceneKey = undefined;
      lastDay = { type: "day", key: `d${entry.id}`, label: dayLabel(entry), phase: phaseWord(entry.turnPhase) };
      blocks.push(lastDay);
    }
    if (entry.kind === "TURN_START") {
      // The header IS this row — the day line above already says everything it
      // carries, so the row itself is not rendered.
      continue;
    }
    const thisScene = sceneLabel(entry);
    if (thisScene !== sceneKey) {
      sceneKey = thisScene;
      blocks.push({ type: "scene", key: `s${entry.id}`, label: thisScene });
    }
    if (entry.kind === "MESSAGE") {
      blocks.push({ type: "row", key: entry.id, entry });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.type === "fold") last.entries.push(entry);
      else blocks.push({ type: "fold", key: `f${entry.id}`, entries: [entry] });
    }
  }
  return blocks;
}

export default function ArchiveTranscript({ entries }) {
  if (entries.length === 0) {
    return <p className="panel p-4 text-sm text-muted">Nothing here.</p>;
  }
  const blocks = buildBlocks(entries);
  return (
    <div className="archive">
      {blocks.map((b) => {
        if (b.type === "day") {
          return (
            <div key={b.key} className="archive-day">
              {[b.label, b.phase].filter(Boolean).join(" · ")}
            </div>
          );
        }
        if (b.type === "scene") {
          return (
            <div key={b.key} className="archive-scene">
              {b.label}
            </div>
          );
        }
        if (b.type === "fold") {
          return (
            <details key={b.key} className="archive-fold">
              <summary>{foldSummary(b.entries)}</summary>
              <ul>
                {b.entries.map((e) => (
                  <li key={e.id}>
                    <span className="archive-row-time">{clock(e.sentAt)}</span> {e.content}
                  </li>
                ))}
              </ul>
            </details>
          );
        }
        const { entry } = b;
        return (
          <div key={b.key} className="archive-row">
            <span className="archive-row-time">{clock(entry.sentAt)}</span>
            <span className="archive-row-who" title={displayName(entry)}>
              {displayName(entry)}
            </span>
            <span className="archive-row-what">
              <ChatMarkdown content={entry.content} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
