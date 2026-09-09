"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CHAT_PLUGINS, DISCORD_COMPONENTS, escapeTokenBars } from "./markdownPlugins";
import MessageToken from "./messageTokens";

// One line of a scene, rendered.
//
// What this adds over MarkdownContent.js: chat's own three (remarkChat) —
// ||spoilers|| and quoted speech. Both renderers now understand the same
// SYNTAX — the {kind:payload} tokens (remarkTokens), `-#` subtext
// (remarkSubtext) and Discord's angle-bracket vocabulary (remarkDiscord) —
// because text written on one face is read on the other and a surface that had
// not been taught a pass printed it raw. What still differs is the tint and the
// spoilers, which are a SCENE's, and a DM is a GM and a player talking.
//
// Every plugin feeds ONE tree, which is the reason these are remark plugins
// rather than string passes: a mention inside a spoiler inside a quote has to
// still be a mention.
//
// The token vocabulary itself is messageTokens.js, shared with MarkdownContent
// — deliberately short, so nobody can mint a live catalog chip mid-scene.

// Hidden until it is clicked, and it stays open after — the same as Discord's,
// and the same as what a reader expects from anything they had to ask to see.
// A button rather than a span with an onClick, so a keyboard gets it too.
function ChatSpoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="chat-spoiler"
      data-shown={shown ? "true" : "false"}
      aria-label={shown ? undefined : "Hidden. Click to show it"}
      onClick={() => setShown(true)}
    >
      {children}
    </button>
  );
}

// The plugin list and its ordering rule now live in markdownPlugins.js, so
// this renderer and the DM one cannot drift apart again — which is how a
// Discord timestamp ended up as raw text in somebody's thread.
const PLUGINS = CHAT_PLUGINS;
const COMPONENTS = { richtoken: MessageToken, chatspoiler: ChatSpoiler, ...DISCORD_COMPONENTS };

// memo'd on the text, which is what makes "parsed once per row" true: a row is
// keyed by seq in feedStore.js and its content only changes on an edit, so a
// hundred rows on screen re-parse nothing when the hundred-and-first lands.
function ChatMarkdown({ content }) {
  if (!content) return null;
  return (
    <div className="markdown-content chat-markdown">
      <ReactMarkdown remarkPlugins={PLUGINS} disallowedElements={["img"]} unwrapDisallowed components={COMPONENTS}>
        {escapeTokenBars(content)}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
