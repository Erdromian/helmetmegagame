"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { setMasterVolume, setMusicMuted } from "./music";
import { resolveAmbience } from "./placeAmbience";
import { useHeardPlace } from "./heardPlace";
import { resolveProgram, runProgram } from "./musicProgram";
import { setPlace, start as startConductor, stop as stopConductor } from "./musicConductor";
import { usePhase, useStanding } from "./PhaseProvider";
import { musicIsAudible, useSound } from "./soundStore";

// The one thing that decides what is playing. Mounted once, in the root layout, renders
// nothing. Phase, place and the two switches in; up to two running programs out.
//
// THREE STATES, and only one of them is on at a time:
//
//   A phase tape — the closed door, the lobby, rolling a character. These own the whole
//   bus while they run, because each is about the game itself rather than about anywhere
//   a person is standing.
//
//   The conductor — an ordinary living character in a running game. One timeline of
//   whatever the place sounds like, spots over the top of it, and mostly silence
//   between (musicConductor.js).
//
//   Nothing, on a GM desk.
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
  const standing = useStanding();
  const heardKey = useHeardPlace();
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

  const program = phase ? resolveProgram(phase, onDesk ? "/gm/" : "/") : null;
  // A place is only heard when no phase tape is talking over it. The `closed` tape owns
  // the ambient layer — that is the wind behind the shut door.
  const inGame = !program && !onDesk && Boolean(phase?.hasCharacter);
  // The room Chat has open can outrank the Location (placeAmbience.js#BY_ROOM).
  const here = inGame ? resolveAmbience(standing, heardKey) : null;

  // Nothing is stopped by hand here. runProgram's own cancel stops the layer it was
  // using, so a tape that stops being wanted is taken off by its effect's cleanup.
  useEffect(() => {
    if (!program) return undefined;
    return runProgram(program);
  }, [program]);

  // Declared before start(), so the conductor knows where you are before its first pick.
  // A new place never cuts what is playing; it only changes what plays NEXT.
  useEffect(() => {
    setPlace(here);
  }, [here]);

  useEffect(() => {
    if (!inGame) return undefined;
    startConductor();
    return stopConductor;
  }, [inGame]);

  return null;
}
