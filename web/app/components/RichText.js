"use client";

import { useTags } from "./TagsProvider";
import { useProductionRates } from "./ProductionRatesProvider";
import { useCarryReference } from "./CarryProvider";
import { useDocuments } from "./DocumentsProvider";
import TagChip from "./TagChip";
import ResourceChip from "./ResourceChip";
import DocumentChip from "./DocumentChip";
import InfoIcon from "./InfoIcon";
import { CharMention } from "./messageTokens";
import { splitTokens } from "./richTokens";

function TagToken({ payload, fallback }) {
  const { tagsById, tagsBySlug } = useTags();
  const key = payload.trim();
  const tag = tagsById.get(key) ?? tagsBySlug.get(key);
  return tag ? <TagChip tag={tag} /> : fallback;
}

// Payload is "field:tier", e.g. "herding:laborer" — see
// db/lib/production.js's PRODUCTION_RATES for the field/tier names. The API
// ships each tier pre-formatted as `display` ("3", or "0–4" when it rolls).
function ResourceToken({ payload, fallback }) {
  const { rates } = useProductionRates();
  const [field, tier] = payload.split(":").map((p) => p.trim());
  const rate = rates[field]?.[tier];
  if (!rate) return fallback;
  return <ResourceChip value={rate.display} />;
}

// Payload is Document.key (docs/documents.yaml's `key:`), e.g.
// "courtstructure". The index carries every written document's name, but a
// body only for those the reader may open — see getDocumentIndex (lib/referenceData.js).
function DocumentToken({ payload, fallback }) {
  const { docsByKey } = useDocuments();
  const doc = docsByKey.get(payload.trim());
  return doc ? <DocumentChip doc={doc} /> : fallback;
}

// Payload is a Character.id, optionally with the name it was mentioned under
// after a `|`. One implementation, shared with the Markdown renderers
// (messageTokens.js) — this used to be a second copy, and a second copy of a
// rule about whose name may be printed is a second answer to it.

// Payload is the tooltip sentence itself, not a lookup key — the one token
// that can never fail to resolve. It renders the shared "?" glyph, for a
// footnote that would clutter the line it explains.
function InfoToken({ payload }) {
  return <InfoIcon text={payload.trim()} />;
}

// Payload is a tag slug carrying Tag.carryBonus ("pack-mule", "cart").
// Renders the plain sentence "You can carry N more item tags, and M ⬢.",
// computed from the live GameConfig caps by getCarryReference
// (lib/referenceData.js) — see docs/systemdocs/CARRY.md.
function CarryToken({ payload, fallback }) {
  const { lines } = useCarryReference();
  return lines[payload.trim()] ?? fallback;
}

// Payload is a slash command's name without the slash ("play"), so a tag
// description can say `type {cmd:play}` and have it render as something a
// player types rather than as a chip naming a thing. Like InfoToken it looks
// nothing up and can never fail — the payload IS the content. The bot writes
// plain backticks instead, because Discord renders Markdown and this does not.
function CmdToken({ payload }) {
  return <code className="cmd-chip">/{payload.trim()}</code>;
}

// {word:crudux cruo} — a phrase worn as a chip, the Grimoire's Words of the
// Circle (web/lib/grimoire.js). The payload is the text itself.
function WordToken({ payload }) {
  return <span className="chip word-chip">{payload.trim()}</span>;
}

const BUBBLE_KINDS = {
  tag: TagToken,
  resource: ResourceToken,
  carry: CarryToken,
  document: DocumentToken,
  char: CharMention,
  info: InfoToken,
  cmd: CmdToken,
  word: WordToken,
};

// Renders plain text, except any {kind:payload} token (e.g. {tag:slug} or
// {resource:field:tier}) becomes an inline bubble widget. Each kind owns its
// own lookup/rendering (TagToken, ResourceToken, ...) so new kinds can be
// added without touching this dispatch logic. Unknown kinds and unresolved
// payloads are left as literal text (rather than silently dropped) so a bad
// reference is easy to spot.
//
// This is the full-fat renderer: a {tag:…} becomes a hoverable TagChip. Text
// that already lives inside a tooltip or a button wants ChipText instead —
// see richTokens.js, which holds the parser both share.
export default function RichText({ text, as: Tag = "span" }) {
  if (!text) return null;

  const parts = splitTokens(text).map((part, i) => {
    if (part.text !== undefined) return part.text;
    const Token = BUBBLE_KINDS[part.kind];
    if (!Token) return part.raw;
    return (
      <Token key={`${part.kind}-${part.payload}-${i}`} payload={part.payload} fallback={part.raw} />
    );
  });

  return <Tag>{parts}</Tag>;
}
