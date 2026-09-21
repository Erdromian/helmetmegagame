"use client";

import { setSoundVolume, useSound } from "./soundStore";

// How loud, 0–100. The store keeps 0–1 (every cue's measured gain is a fraction of it, and
// the music bus multiplies the same number), so the division happens here and nowhere else
// — the player counts in percent and the mixer counts in gain.
//
// Controlled off the store rather than local state, so the copy in the top bar and the copy
// at the foot of /chat move together, and so do two tabs. Pass `value` (0–1) and
// `onChange` to drive some other volume with the same control — the instrument panel does.
export default function VolumeSlider({ id = "volume", value, onChange = setSoundVolume }) {
  const sound = useSound();
  const volume = value ?? sound.volume;
  const percent = Math.round(volume * 100);
  return (
    <div className="volume-row">
      <label className="volume-label text-muted" htmlFor={id}>
        Volume
      </label>
      <input
        id={id}
        className="volume-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className="volume-value mono">{percent}</span>
    </div>
  );
}
