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
// ORDER IS LOAD-BEARING, and in this order:
//   remarkSubtext  block-level, needs RAW text — a `-#` cannot be found once
//                  an inline pass has cut the paragraph into children
//   remarkChat     wraps a quoted sentence while it is still one run of text
//   remarkDiscord  inline tokens
//   remarkTokens   inline {kind:…} chips
// Put a token pass before remarkChat and a mention in the middle of a quote
// splits the text node, so the quote stops matching itself (CHAT.md).

// DMs, the audit inspector, the archive context peek.
export const BASE_PLUGINS = [remarkGfm, remarkSubtext, remarkDiscord];
// A scene line: everything above plus chat's own three and the {kind:…} chips.
export const CHAT_PLUGINS = [remarkGfm, remarkSubtext, remarkChat, remarkDiscord, remarkTokens];
// Documents and the handbook: authored prose, with catalog chips.
export const DOC_PLUGINS = [remarkGfm, remarkSubtext, remarkDiscord, remarkTokens];

// The custom tags remarkDiscord emits. Spread into every renderer's
// `components` map — a renderer that omits it renders the tag as nothing at
// all, which is worse than the raw text was.
export const DISCORD_COMPONENTS = {
  discordtime: DiscordTime,
  discordmention: DiscordMention,
  discordemoji: DiscordEmoji,
  discordping: DiscordPing,
};
