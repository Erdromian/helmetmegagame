"use client";

import { CHAT_TEXT_SIZES, setChatTextSize, useChatTextSize } from "./chatTextStore";

export default function ChatTextSize() {
  const size = useChatTextSize();
  return (
    <div className="chat-text-size">
      <span className="text-sm text-muted">Chat text size</span>
      <div className="segmented" role="group" aria-label="Chat text size">
        {CHAT_TEXT_SIZES.map((s) => (
          <button key={s.value} type="button" aria-pressed={size === s.value} onClick={() => setChatTextSize(s.value)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
