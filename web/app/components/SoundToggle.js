"use client";

import IconButton from "@/app/components/IconButton";
import { SpeakerIcon, SpeakerOffIcon } from "@/app/components/icons";
import { playSfx } from "@/app/components/sfx";
import { useSound, setSoundOn } from "@/app/(app)/chat/soundStore";

// The switch. Sound is ON by default, so this is mostly a way to turn it OFF — which is
// why it is a plain two-state button and not a settings page: somebody who wants quiet
// wants it in one click, from wherever they are.
//
// Two copies are mounted (ChatHead's right edge, and .chat-places-foot beside the bell and
// the checkmark) and they share one store, so either one moves both. On a phone the places
// column is a drawer, so the head copy is the one that is always reachable.
export default function SoundToggle() {
  const { on } = useSound();
  return (
    <IconButton
      icon={on ? SpeakerIcon : SpeakerOffIcon}
      label={on ? "Sound on" : "Sound off"}
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setSoundOn(next);
        // Turning it on answers in its own voice — and this click is also the gesture that
        // unlocks audio in the browser, so it is the one place a confirming sound is
        // guaranteed to be heard.
        if (next) playSfx("success-soft");
      }}
    />
  );
}
