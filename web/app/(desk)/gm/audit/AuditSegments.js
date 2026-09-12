"use client";

import CharacterLink from "@/app/components/CharacterLink";
import ResourceChip from "@/app/components/ResourceChip";
import ZoneChip from "@/app/components/ZoneChip";
import TagChip from "@/app/components/TagChip";

// One audit sentence, rendered. describeAudit() in web/lib/auditNarrative.js
// decides WHAT the segments are; this decides how each draws — which is why a
// tag comes out as a .chip, a Resources amount as the ⬢ pill, and a character
// as a real link into the dev panel rather than as text that looks like one.
//
// `tagsByName` is optional (id -> row is no use here — a `details` blob never
// carries a tag's id, only its name, written long before hover was a thing —
// so a "chip" segment is resolved by NAME against the current catalog). A
// caller with no catalog in reach, or a name that no longer matches — renamed,
// deleted since — gets the flat span it always had; this only ever upgrades.
export default function AuditSegments({ entry, segments, tagsByName = null }) {
  return (
    <span className="audit-line">
      {segments.map((s, i) => (
        <Segment key={i} entry={entry} seg={s} tagsByName={tagsByName} />
      ))}
    </span>
  );
}

function Segment({ entry, seg, tagsByName }) {
  switch (seg.k) {
    case "t":
      return <span>{seg.v}</span>;
    case "em":
      return <strong className="audit-em">{seg.v}</strong>;
    case "mono":
      return <span className="mono text-xs">{seg.v}</span>;
    case "chip": {
      const tag = tagsByName?.get(seg.v) ?? null;
      return tag ? <TagChip tag={tag} /> : <span className="chip">{seg.v}</span>;
    }
    case "qty":
      return <span className="mono text-xs">×{seg.v}</span>;
    case "res":
      return <ResourceChip value={seg.v} />;
    case "zone":
      return <ZoneChip zoneName={seg.v} />;
    case "actor":
      // The actor is a Discord identity first — a GM often has no character at
      // all — so it renders as their name, linked to their character only when
      // there is one to link to.
      return entry.actor.characterId ? (
        <CharacterLink characterId={entry.actor.characterId} name={entry.actor.name} isGm />
      ) : (
        <strong className="audit-em">{entry.actor.name}</strong>
      );
    case "target":
      return entry.target ? (
        <CharacterLink characterId={entry.target.id} name={entry.target.name} isGm />
      ) : (
        <span className="text-muted">someone</span>
      );
    default:
      return null;
  }
}
