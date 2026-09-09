import remarkGfm from "remark-gfm";
import remarkChat from "./remarkChat";
import remarkSubtext from "./remarkSubtext";
import remarkTokens from "./remarkTokens";
import remarkDiscord from "./remarkDiscord";
import DiscordTime from "./DiscordTime";
import { DiscordEmoji, DiscordMention, DiscordPing } from "./DiscordMarkupNodes";

// The plugin lists, in one file, because three renderers each maintaining
// their own array is exactly how `<t:1757700120:F>` reached a player's DM
// thread as literal text: ChatMarkdown had learned Discord's chat syntax and
// MarkdownContent never did, and nothing made them agree.
//
// There are only TWO lists now, and the difference between them is one plugin.
// It used to be three, and the third — BASE_PLUGINS, the DM/inspector one —
// was missing remarkTokens, which is the same drift one layer down: a mention
// is stored as `{char:<id>}` on both faces, so a DM quoting one, a starred
// line and the archive transcript all printed a cuid in braces at the reader.
// A surface does not get to know a different SYNTAX from its neighbours. What
// it gets to decide is which tokens it resolves, and that is the `components`
// map, not this file.
//
// ORDER IS LOAD-BEARING, and in this order:
//   remarkSubtext  block-level, needs RAW text — a `-#` cannot be found once
//                  an inline pass has cut the paragraph into children
//   remarkChat     wraps a quoted sentence while it is still one run of text
//   remarkDiscord  inline tokens
//   remarkTokens   inline {kind:…} chips
// Put a token pass before remarkChat and a mention in the middle of a quote
// splits the text node, so the quote stops matching itself (CHAT.md).

// A `{char:<id>|<Name>}` carries a bar, and remark-gfm splits a table row on
// bars at BLOCK level — before remarkTokens ever sees the text. So a mention
// written into a table cell was torn in half and printed its raw cuid at the
// reader: `{char:cmtt…` in one cell, `Name}` in the next, and no mention at
// all. Every renderer below inherits that from remarkGfm, so the DM, the
// document and the scene were all wrong the same way.
//
// Escaping the bar as `\|` fixes it, and is safe OUTSIDE a table too rather
// than needing to know where it is: remark unescapes `\|` back to `|` in the
// text node, so remarkTokens still matches the whole token and the mention
// keeps its face. That is what makes this a blanket pass instead of a
// context-sensitive one.
//
// Done HERE, at render, rather than by writing `\|` into the row. What is
// STORED has to keep matching the visibility query in web/lib/feedAccess.js —
// a Prisma `contains` on `{char:<id>|` is how a mentioned player earns the
// right to read the row that mentions them (CHAT.md §5) — plus its JS twin,
// db/lib/characterMentions.js#mentionsCharacter. Escaping on the way in would
// have needed both of those, and every row already written, to agree on a new
// shape. This pass needs none of it, and it repairs the rows already in the
// database.
//
// The separator is the only bar a token can hold: freezeMentionName strips
// `{`, `}` and `|` out of the name half before it is ever frozen. The optional
// backslash in the pattern makes the pass idempotent, so running it twice
// cannot produce `\\|`.
const CHAR_TOKEN = /\{char:[^}]*\}/g;

export function escapeTokenBars(content) {
  if (typeof content !== "string" || !content.includes("{char:")) return content;
  return content.replace(CHAR_TOKEN, (token) => token.replace(/\\?\|/g, "\\|"));
}

// Anything written that is read as words: DMs, the audit inspector, the
// archive-context peek, documents and the handbook.
export const MESSAGE_PLUGINS = [remarkGfm, remarkSubtext, remarkDiscord, remarkTokens];
// A scene line: everything above plus chat's own two, ||spoilers|| and the
// speech tint. A DM is a GM and a player talking, not a scene, which is the
// one thing that genuinely differs between the two.
export const CHAT_PLUGINS = [remarkGfm, remarkSubtext, remarkChat, remarkDiscord, remarkTokens];

// The custom tags remarkDiscord emits. Spread into every renderer's
// `components` map — a renderer that omits it renders the tag as nothing at
// all, which is worse than the raw text was.
export const DISCORD_COMPONENTS = {
  discordtime: DiscordTime,
  discordmention: DiscordMention,
  discordemoji: DiscordEmoji,
  discordping: DiscordPing,
};
