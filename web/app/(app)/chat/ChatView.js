"use client";

import EmptyState from "@/app/components/EmptyState";
import RequestActionsProvider from "@/app/components/RequestActionsProvider";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import Chat from "./Chat";

// What /chat draws, from the one object page.js#FreshChat produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are the same names <Chat> and <RequestActionsProvider> always took;
// only the place they are spelled out moved.
export default function ChatView({ kind, chat, providers, roster, mentionDirectory = [] }) {
  if (kind === "empty" || kind === "nowhere") {
    return (
      <div className="chat-body chat-body--empty">
        <div className="panel">
          <EmptyState>{kind === "empty" ? "You have no living character. ‡" : "You are nowhere yet."}</EmptyState>
        </div>
      </div>
    );
  }
  const scene = <Chat {...chat} />;
  if (!providers) return scene;
  return (
    <CharacterMentionsProvider characters={roster} directory={mentionDirectory}>
      <RequestActionsProvider {...providers}>{scene}</RequestActionsProvider>
    </CharacterMentionsProvider>
  );
}
