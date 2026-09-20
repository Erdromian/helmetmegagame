"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { setMasterVolume, setMusicMuted, stopAllMusic } from "./music";
import { resolveProgram, runProgram } from "./musicProgram";
import { usePhase } from "./PhaseProvider";
import { musicIsAudible, useSound } from "./soundStore";

// The one thing that decides whether music is playing. Mounted once, in the root layout,
// renders nothing. Phase and the two switches in; a running program out.
//
// It does NOT re-run on a route change — `pathname` is read only to keep the GM desks
// quiet (musicProgram.js#resolveProgram), and the effect's dependency is the ANSWER to
// that question, not the path, so walking between ordinary pages never restarts a track.
//
// Nor on the mute switch, and that is the other half of the same rule. The program keeps
// running while muted; muting only silences the bus (music.js#setMusicMuted), so unmuting
// lands wherever the tape has got to instead of starting it again from the top. The mute
// effect is declared FIRST so a page that loads muted is muted before anything plays.
export default function MusicDirector() {
  const phase = usePhase();
  const setting = useSound();
  const audible = musicIsAudible(setting);
  const pathname = usePathname();
  const onDesk = pathname.startsWith("/gm/");

  useEffect(() => {
    setMusicMuted(!audible);
  }, [audible]);

  useEffect(() => {
    setMasterVolume();
  }, [setting.volume]);

  useEffect(() => {
    const program = phase ? resolveProgram(phase, onDesk ? "/gm/" : "/") : null;
    if (!program) {
      stopAllMusic();
      return undefined;
    }
    return runProgram(program);
  }, [phase, onDesk]);

  return null;
}
