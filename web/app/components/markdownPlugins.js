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
//   remarkTokens   inline {kind:…} chips
//   remarkDiscord  inline <t:…> and friends
//   remarkChat     quoted speech and ||spoilers||, LAST
//
// The tokens go first and the scene's own marks go last, which is the reverse
// of how it was. The old order put remarkChat first because a mention in the
// middle of a quote split the text node and the quote stopped matching itself —
// and that was true of every other formatting mark too, which is the bug
// chatRuns.js fixes: remarkChat now scans SIBLINGS, so a resolved mention or a
// timestamp inside a quote is simply one more thing the quote wraps. Going last
// is what keeps a token's payload out of its reach: a name like
// `Bob "Ace" Smith` would otherwise have had its own speech tinted, in the
// middle of a mention.

// The pre-parse escape pass lives in tokenEscape.js, which has no imports so a
// test can load it with no build step. It is what keeps a
// `{char:…|Bob *the Blade* Marley}` in one piece, and a mention written into a
// table cell out of remark-gfm's block-level bar split. The old name is kept as
// an alias so no call site had to move.
export { default as escapeTokenSyntax, default as escapeTokenBars } from "./tokenEscape";

// Anything written that is read as words: DMs, the audit inspector, the
// archive-context peek, documents and the handbook.
export const MESSAGE_PLUGINS = [remarkGfm, remarkSubtext, remarkTokens, remarkDiscord];
// A scene line: everything above plus chat's own two, ||spoilers|| and the
// speech tint. A DM is a GM and a player talking, not a scene, which is the
// one thing that genuinely differs between the two.
export const CHAT_PLUGINS = [remarkGfm, remarkSubtext, remarkTokens, remarkDiscord, remarkChat];

// The custom tags remarkDiscord emits. Spread into every renderer's
// `components` map — a renderer that omits it renders the tag as nothing at
// all, which is worse than the raw text was.
export const DISCORD_COMPONENTS = {
  discordtime: DiscordTime,
  discordmention: DiscordMention,
  discordemoji: DiscordEmoji,
  discordping: DiscordPing,
};
