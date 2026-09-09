"use client";

import ReactMarkdown from "react-markdown";
import { MESSAGE_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "./markdownPlugins";
import MessageToken from "./messageTokens";

// Renders Discord-message markdown (bold/italic/strikethrough/code/quotes/
// links/lists) as real elements rather than raw asterisks — used anywhere a
// DirectMessage's content is shown back to a GM, and in the player's own
// Bascinet pane. react-markdown never emits raw HTML from the source text by
// default (no rehype-raw plugin wired in), so this is safe against a player's
// message content injecting markup; images are dropped outright since a
// message shouldn't be able to embed one.
//
// It also renders Discord's angle-bracket vocabulary (remarkDiscord), which
// this file went without for a long time — long enough that two lobby DMs
// showed players a literal `<t:1757700120:F>` where a time belonged. A DM is
// the one surface where text written FOR Discord is read on the web, so it
// needs that pass more than anywhere else.
//
// And it renders the {kind:payload} tokens (remarkTokens), which it went
// without for exactly the same reason and with exactly the same result: a
// mention typed on either face is stored as `{char:<id>}`, so a DM quoting one
// — or a starred line, or the transcript — printed a cuid in braces at the
// reader. The vocabulary is messageTokens.js's short one, shared with
// ChatMarkdown: a message may name a person, never mint a catalog chip.
//
// What it still deliberately does NOT get is remarkChat: no speech tint and no
// spoilers. A DM is a GM and a player talking, not a scene.
const COMPONENTS = { richtoken: MessageToken, ...DISCORD_COMPONENTS };

export default function MarkdownContent({ content, className }) {
  if (!content) return null;

  return (
    <div className={`markdown-content ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={MESSAGE_PLUGINS}
        components={COMPONENTS}
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {escapeTokenBars(content)}
      </ReactMarkdown>
    </div>
  );
}
