"use client";

import { useEffect, useRef } from "react";
import { songByKey } from "@lifeweb/db/lib/instrumentSongs";
import { playOn, stopLayer, voicesOn } from "./music";
import { fileGain } from "./musicGain";
import { useMutedPerformers, usePerformances } from "./performanceStore";

// Plays what the people around you are playing (docs/systemdocs/SOUND.md,
// "Performances"). Mounted once beside MusicDirector, renders nothing.
//
// One VOICE per performance on the `player` layer ("player:<id>", music.js), so two
// people playing at once are both heard. Each is ANCHORED to its own startedAt, so
// somebody walking in halfway lands halfway, and unmuting catches up rather than
// starting over. The file's measured trim times the performer's own slider is the gain.
//
// A voice is only re-issued when its src or gain actually changes: playOn re-seeks an
// anchored track, and doing that on every frame would be a skip in the song.
export default function InstrumentListener() {
  const performances = usePerformances();
  const muted = useMutedPerformers();
  const applied = useRef(new Map());

  useEffect(() => {
    const now = Date.now();
    const wanted = new Map();
    for (const p of performances) {
      if (!p?.id || (p.endsAt && p.endsAt <= now)) continue;
      if (p.performerKey && muted.has(p.performerKey)) continue;
      const song = songByKey(p.songKey);
      if (!song?.src) continue;
      const volume = Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 1;
      wanted.set(`player:${p.id}`, { src: song.src, gain: fileGain(song.src) * volume, startedAt: p.startedAt });
    }

    const current = voicesOn("player");
    for (const key of applied.current.keys()) {
      if (!current.includes(key)) applied.current.delete(key);
    }
    for (const key of current) {
      if (!wanted.has(key)) {
        stopLayer(key);
        applied.current.delete(key);
      }
    }
    for (const [key, want] of wanted) {
      const was = applied.current.get(key);
      if (was && was.src === want.src && was.gain === want.gain && was.startedAt === want.startedAt) {
        continue;
      }
      playOn(key, { src: want.src, gain: want.gain, anchor: { startedAt: want.startedAt }, fadeInMs: 400 });
      applied.current.set(key, want);
    }
  }, [performances, muted]);

  return null;
}
