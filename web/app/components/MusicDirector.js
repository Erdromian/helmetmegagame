"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { setMasterVolume, stopAllMusic } from "./music";
import { resolveProgram, runProgram } from "./musicProgram";
import { usePhase } from "./PhaseProvider";
import { musicIsAudible, useSound } from "./soundStore";

// The one thing that decides whether music is playing. Mounted once, in the root layout,
// renders nothing. Phase and the two switches in; a running program out.
//
// It does NOT re-run on a route change — `pathname` is read only to keep the GM desks
// quiet (musicProgram.js#resolveProgram), and the effect's dependency is the ANSWER to
// that question, not the path, so walking between ordinary pages never restarts a track.
export default function MusicDirector() {
  const phase = usePhase();
  const setting = useSound();
  const audible = musicIsAudible(setting);
  const pathname = usePathname();
  const onDesk = pathname.startsWith("/gm/");

  useEffect(() => {
    setMasterVolume(setting.volume);
  }, [setting.volume]);

  useEffect(() => {
    if (!phase || !audible) {
      stopAllMusic();
      return undefined;
    }
    const program = resolveProgram(phase, onDesk ? "/gm/" : "/");
    if (!program) {
      stopAllMusic();
      return undefined;
    }
    return runProgram(program);
  }, [phase, audible, onDesk]);

  return null;
}
