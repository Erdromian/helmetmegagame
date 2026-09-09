"use client";

import InfoIcon from "./InfoIcon";
import CharacterAvatar from "./CharacterAvatar";
import { useCharacterMentions } from "./CharacterMentionsProvider";

// The short token vocabulary a MESSAGE is allowed to resolve, shared by every
// renderer that draws one — the feed, a DM, a starred line, the transcript, a
// journal entry.
//
// It lives here rather than in ChatMarkdown.js because those five surfaces used
// to disagree about it: /play resolved the tokens, MarkdownContent had never
// been given remarkTokens at all so a DM printed literal braces, and the
// transcript and the Journal went through RichText, which resolves the WHOLE
// catalog. One copy, so they cannot drift again.
//
// Deliberately short. A message is a player writing, and the catalog tokens
// ({tag:…}, {resource:…}, {document:…}) are authored reference syntax —
// resolving them here would let anyone mint a live chip mid-scene. RichText.js
// is still the full-fat renderer, and it is still right for authored prose (a
// tag description, a Desire, an appearance). An unresolved token falls back to
// its literal text, the contract richTokens.js states for every kind.

// A {char:…} payload is `<id>` or `<id>|<name it was sent under>`. Split on the
// FIRST bar only: an id never contains one, and a name might.
export function splitCharPayload(payload) {
  const raw = (payload ?? "").trim();
  const bar = raw.indexOf("|");
  if (bar === -1) return { id: raw, frozenName: null };
  return { id: raw.slice(0, bar).trim(), frozenName: raw.slice(bar + 1).trim() || null };
}

// A {char:<id>} in a message. The map comes from CharacterMentionsProvider,
// which /play fills from two lists: the people standing here, and the wider
// directory of everybody whose name is safe to print
// (web/lib/mentionDirectory.js).
//
// The NAME comes off the token when the token carries one. A mention is the one
// piece of a row that used to be resolved live, so putting a hood on rewrote
// what every past line had said and a Mulligan rename renamed somebody in
// history. Everything else about a row's identity is frozen at send time
// (ArchiveEntry.characterName, .concealedAlias, .presentedAvatarPath); this is
// the same rule, carried in the token itself so it survives being copied into a
// Note or quoted into a journal entry.
//
// The FACE is still live, and gated: it is only drawn when the directory
// resolves that id AND still presents them under the name the token froze. That
// fails safe in both directions, the rule Note.presentedAvatarPath already
// follows — somebody since renamed loses their face here rather than gaining
// the wrong one, and somebody since hooded never gains a face at all.
//
// A miss with no frozen name draws a person-shaped blank, because a cuid in
// braces is not a visible unresolved reference, it is a line that looks broken.
export function CharMention({ payload }) {
  const mentionsById = useCharacterMentions();
  const { id, frozenName } = splitCharPayload(payload);
  const character = mentionsById.get(id);
  const name = frozenName ?? character?.name ?? null;
  if (!name) return <span className="chat-mention chat-mention--unknown">someone</span>;

  const faced = character && (!frozenName || character.name === frozenName);
  return (
    <span className="chat-mention">
      {faced ? (
        <CharacterAvatar
          characterId={character.id}
          name={character.name}
          version={character.updatedAt}
          size={16}
          zoomable
        />
      ) : (
        <CharacterAvatar name={name} unknown size={16} />
      )}
      <span>{name}</span>
    </span>
  );
}

// The `richtoken` element remarkTokens.js emits, for a message body.
export default function MessageToken({ kind, payload, raw }) {
  if (kind === "char") return <CharMention payload={payload} />;
  if (kind === "info") return <InfoIcon text={payload.trim()} />;
  if (kind === "cmd") return <code className="cmd-chip">/{payload.trim()}</code>;
  return raw;
}
