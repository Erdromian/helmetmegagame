"use client";

import AuditSegments from "@/app/(desk)/gm/audit/AuditSegments";
import { describeAudit } from "@/lib/auditNarrative";

// One ACTION row of the transcript (ArchiveKind.ACTION, docs/systemdocs/ARCHIVE.md)
// as the sentence /gm/audit prints for the audit row behind it: the same
// renderer, so an act reads the same in both places. The row carries that audit
// row in `action` (db/lib/archiveActions.js). A row without one falls back to
// its plain `content` line.
//
// The line already names the character in its own column, so when the sentence
// opens with that same person it drops them: "Ada Vance · sowed 3× Foodstuffs",
// not "Ada Vance · Ada Vance sowed…". An outcome keeps its opening word, since
// there the one acting was a GM or the game.
export default function ArchiveActionSentence({ row }) {
  const action = row?.action;
  if (!action?.type) return <span>{row?.content ?? ""}</span>;

  const self = action.actorName && action.actorName === row.realName;
  const entry = {
    actionType: action.type,
    details: action.details ?? {},
    actor: { characterId: null, name: action.actorName ?? "Someone" },
    target: action.targetId ? { id: action.targetId, name: action.targetName ?? "someone" } : null,
    names: {},
  };
  let { segments } = describeAudit(entry);
  if (self && segments[0]?.k === "actor") {
    segments = segments.slice(1);
    // A type with no sentence of its own reads "Ada — Room search"; without
    // the name, the dash would open the line.
    if (segments[0]?.k === "t" && segments[0].v === "—") segments = segments.slice(1);
  }
  // A Move's words, when the audit sentence does not already quote them: the
  // row behind a filed or solved Move holds only its id, and a Move is the one
  // act whose point is what the player wrote.
  const d = entry.details;
  if (action.moveText && !d.to && !d.description) {
    segments = [...segments, { k: "t", v: "—" }, { k: "em", v: `“${action.moveText}”` }];
  }
  return <AuditSegments entry={entry} segments={segments} />;
}
