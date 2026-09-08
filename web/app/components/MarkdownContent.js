import ReactMarkdown from "react-markdown";
import { BASE_PLUGINS, DISCORD_COMPONENTS } from "./markdownPlugins";

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
// What it still deliberately does NOT get is remarkChat: no speech tint and no
// spoilers. A DM is a GM and a player talking, not a scene.
export default function MarkdownContent({ content, className }) {
  if (!content) return null;

  return (
    <div className={`markdown-content ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={BASE_PLUGINS}
        components={DISCORD_COMPONENTS}
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
