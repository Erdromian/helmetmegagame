"use client";

import { memo } from "react";

// The composer's `/` list, and the sibling of MentionMenu.js in every way that
// matters: same popover, same anchoring above the box, same ↑↓ / Enter / Tab /
// Escape wiring in Feed.js.
//
// What it lists is ./commands.js filtered to the open place — a `/roll` in the
// street is a die nobody is standing close enough to read, and a `/add` in the
// zone summary has no door to open. Filtering rather than greying: this is a
// list of what you can type, not a menu of things you are being refused.

const CommandMenu = memo(function CommandMenu({ matches, active, onPick }) {
  if (matches.length === 0) return null;
  return (
    <div className="chat-mentions" role="listbox" aria-label="Commands">
      {matches.map((entry, i) => (
        <button
          key={entry.name}
          type="button"
          role="option"
          aria-selected={i === active}
          data-active={i === active ? "true" : "false"}
          className="menu-item chat-cmd-item"
          // Mousedown rather than click, MentionMenu's reason: the textarea
          // must not lose focus before the pick lands.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(entry);
          }}
        >
          <span className="mono chat-cmd-name">/{entry.name}</span>
          <span className="truncate text-muted">{entry.description}</span>
        </button>
      ))}
    </div>
  );
});

export default CommandMenu;
