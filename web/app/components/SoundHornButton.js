"use client";

import FormError from "@/app/components/FormError";
import useSoundItem from "./useSoundItem";

// The Deep Beast Horn, beside the Trumpet in the verb strip and built the same
// way (SoundTrumpetButton.js): its own control rather than an ActionGrid entry,
// because everything in that grid opens a dialog and this commits straight
// away.
//
// It asks first, and it asks harder than the trumpet does: one click is a line
// in every surface Location in the game.
export default function SoundHornButton() {
  const { sound, pending, error, sounded } = useSoundItem();
  const onClick = () => sound("horn");

  return (
    <>
      <button type="button" className="btn action-strip-item" onClick={onClick} disabled={pending}>
        {pending ? "Sounding…" : "Sound horn"}
      </button>
      {sounded && !error ? <span className="text-muted text-sm">You sound it.</span> : null}
      <FormError>{error}</FormError>
    </>
  );
}
