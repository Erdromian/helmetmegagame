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
