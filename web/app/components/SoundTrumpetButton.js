"use client";

import FormError from "@/app/components/FormError";
import useSoundItem from "./useSoundItem";

// Its own control rather than an entry in ActionGrid, because everything in
// that grid opens a dialog through RequestActionsProvider and this commits
// straight away — the same shape as the equip toggle. Threading a direct-fire
// case through the generic grid for one button would complicate the machinery
// for every other action in it.
//
// It asks first. One click is heard across most of the barony and cannot be
// taken back, which is the same reason the bell rope makes you type RING into
// a modal before it will ring.
export default function SoundTrumpetButton() {
  const { sound, pending, error, sounded } = useSoundItem();
  const onClick = () => sound("trumpet");

  return (
    <>
      <button type="button" className="btn action-strip-item" onClick={onClick} disabled={pending}>
        {pending ? "Sounding…" : "Trumpet"}
      </button>
      {sounded && !error ? <span className="text-muted text-sm">You sound it.</span> : null}
      <FormError>{error}</FormError>
    </>
  );
}
