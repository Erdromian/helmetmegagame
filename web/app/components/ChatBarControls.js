"use client";

import { useRef, useState } from "react";
import ChatTextSize from "./ChatTextSize";
import ClickMenu from "./ClickMenu";
import IconButton from "./IconButton";
import SoundControls from "./SoundControls";
import VolumeSlider from "./VolumeSlider";
import { BellIcon, BellOffIcon, BellRingIcon, CheckIcon, MoreIcon, ReloadIcon } from "./icons";
import { useChatBar } from "./chatBarStore";
import { togglePush, usePushState } from "@/app/(app)/chat/pushStore";

// Chat's bell and its Mark all read, beside the sound cluster (Chat
// Overhaul.docx: "Move the notify me and tick button to the top right next to
// the music/volume buttons"). Drawn in two places, never both at once: the top
// bar on a desktop (AppBar.js), and the chat head on a phone, where chat hides
// the top bar (chat.css).
//
// Nothing shows unless chat is on the page and has published its handler
// (./chatBarStore.js). The bell also needs Web Push to be possible here: a
// PushManager and the deployment's VAPID keys (CHAT.md §5a).

function Bell() {
  const push = usePushState();
  if (!push.supported) return null;
  // A browser that has blocked notifications will never ask again, so the
  // bell says so rather than looking like it does nothing.
  const label = push.on
    ? "Notifications on"
    : push.denied
      ? "Notifications are blocked in your browser's settings"
      : "Notify me";
  return (
    <IconButton
      icon={push.on ? BellRingIcon : push.denied ? BellOffIcon : BellIcon}
      label={label}
      aria-pressed={push.on}
      disabled={push.busy}
      onClick={togglePush}
    />
  );
}

// The top bar's copy: the bell, then the tick, in a row with the sound switches.
export default function ChatBarControls() {
  const bar = useChatBar();
  if (!bar) return null;
  return (
    <div className="sound-controls chat-bar-controls">
      <Bell />
      <IconButton icon={CheckIcon} label="Mark all read" onClick={bar.onMarkAllSeen} />
    </div>
  );
}

// The phone's copy, in the chat head. A 390px head has room for the place's
// name and a few thumb-sized buttons, not eight, so everything here folds
// behind one ⋯ button: the bell and the tick, in a row the way the top bar
// draws them, then the sound cluster (the switches, the volume and the text
// size, which is what the top bar's caret opens). The tick used to stay out
// on its own; with ≡, Actions, Search and 👥 beside it, that left the place's
// name "B…" on a 390px screen.
//
// Refresh leads the row. Chat never bounces, so a phone cannot pull down to
// refresh here (globals.css, "the document behind those three"); this is that
// gesture as a button. A full reload, so the stream comes back fresh too.
export function ChatPhoneControls() {
  const bar = useChatBar();
  const moreRef = useRef(null);
  const [open, setOpen] = useState(false);
  if (!bar) return null;
  return (
    <>
      {/* Bare .icon-btn, not IconButton: the popover measures itself against
          this ref, and a tooltip on a disclosure is noise. */}
      <button
        ref={moreRef}
        type="button"
        className="icon-btn"
        data-size="lg"
        aria-label="More"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <MoreIcon width={20} height={20} />
      </button>
      {open && (
        <ClickMenu triggerRef={moreRef} ariaLabel="More" onClose={() => setOpen(false)}>
          <div className="sound-panel">
            <div className="sound-controls">
              <IconButton icon={ReloadIcon} label="Refresh" onClick={() => window.location.reload()} />
              <Bell />
              <IconButton icon={CheckIcon} label="Mark all read" onClick={bar.onMarkAllSeen} />
              <SoundControls layout="stack" />
            </div>
            <VolumeSlider id="volume-phone" />
            <ChatTextSize />
          </div>
        </ClickMenu>
      )}
    </>
  );
}
