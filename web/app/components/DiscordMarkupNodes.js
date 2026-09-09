"use client";

// The non-time half of Discord's angle-bracket vocabulary, rendered.
//
// The governing rule is the one characterMentions.js states and RichText.js
// repeats: a row is FACE-NEUTRAL, and a raw id is "not a visible unresolved
// reference, it is a line that looks broken". So none of these ever prints a
// snowflake. A Discord user id is precisely the identity this game keeps
// separate from a character (PROXYING.md), and it is not resolvable from
// inside a synchronous remark plugin anyway.

// `<@id>`, `<@!id>` and `<@&id>` all land here. Reuses the existing look for
// an unresolved {char:…} on purpose: to a reader, somebody behind a mask and
// somebody behind an un-translated id are the same person-shaped blank.
export function DiscordMention({ children }) {
  return <span className="chat-mention chat-mention--unknown">{children}</span>;
}

// `<:name:id>` renders as its NAME, never as the CDN image. Fetching
// cdn.discordapp.com would put a snowflake in a URL, make the reader's browser
// call Discord, and walk straight through MarkdownContent's own promise that
// a message cannot embed an image.
export function DiscordEmoji({ children }) {
  return <span className="discord-emoji">{children}</span>;
}

// `@here` / `@everyone`. The words stay — intercom.js writes `@here` as part
// of a sentence and deleting it changes what the sentence says — but they are
// muted, which is the truth: on the web this notified nobody.
export function DiscordPing({ children }) {
  return <span className="discord-ping">{children}</span>;
}
