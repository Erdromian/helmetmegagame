"use client";

import { useRef, useState } from "react";
import ClickMenu from "./ClickMenu";
import IconButton from "./IconButton";
import ChatTextSize from "./ChatTextSize";
import VolumeSlider from "./VolumeSlider";
import { ChevronDownIcon, MusicIcon, SpeakerIcon, SpeakerOffIcon } from "./icons";
import { playSfx } from "./sfx";
import { setMusicOn, setSfxOn, useSound } from "./soundStore";

// The sound cluster: the speaker, the music switch, and a way to the volume.
//
// THE SPEAKER IS THE MASTER — it silences the cues and the music both, because a speaker
// button that leaves a song playing is a broken speaker button. The music switch silences
// only the music. See soundStore.js's header; the rule lives there, not here.
//
// The caret opens the volume panel, NOT the speaker. Clicking the speaker has to stay a
// one-click mute: somebody who wants quiet wants it in one click from wherever they are,
// which is the whole reason this is a button and not a settings page.
//
// `layout` picks the shape. "row" is the top bar: two buttons and a caret onto the volume
// panel. "stack" is the foot of /chat, where the two buttons join the bell and Mark all
// read in one row and the slider goes on its own line UNDER all of them — so that copy
// renders `display: contents` and PlacesColumn mounts its own <VolumeSlider /> last.
export default function SoundControls({ layout = "row" }) {
  const { sfx, music } = useSound();
  const caretRef = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="sound-controls" data-layout={layout}>
      <IconButton
        icon={sfx ? SpeakerIcon : SpeakerOffIcon}
        label={sfx ? "Sound on" : "Sound off"}
        aria-pressed={sfx}
        onClick={() => {
          const next = !sfx;
          setSfxOn(next);
          // Turning it on answers in its own voice — and this click is also the gesture
          // that unlocks audio in the browser, so it is the one place a confirming sound
          // is guaranteed to be heard.
          if (next) playSfx("success-soft");
        }}
      />
      <IconButton
        icon={MusicIcon}
        label={music ? "Music on" : "Music off"}
        tooltip={
          sfx
            ? music
              ? "Music on"
              : "Music off"
            : music
              ? "Music on, but sound is off"
              : "Music off"
        }
        aria-pressed={sfx && music}
        onClick={() => setMusicOn(!music)}
      />
      {layout === "stack" ? null : (
        <>
          {/* Bare .icon-btn, not IconButton: this one needs a ref for the popover to
              measure itself against, and a tooltip on a disclosure is noise. */}
          <button
            ref={caretRef}
            type="button"
            className="icon-btn"
            aria-label="Volume"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronDownIcon width="15" height="15" />
          </button>
          {open && (
            <ClickMenu triggerRef={caretRef} ariaLabel="Volume" onClose={() => setOpen(false)}>
              <div className="sound-panel">
                <VolumeSlider id="volume-bar" />
                <ChatTextSize />
              </div>
            </ClickMenu>
          )}
        </>
      )}
    </div>
  );
}
