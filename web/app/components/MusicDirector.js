"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { setMasterVolume, setMusicMuted } from "./music";
import { resolveAmbience } from "./placeAmbience";
import { PROGRAMS, resolveProgram, runProgram } from "./musicProgram";
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
//   A place tape plus the music rotation — an ordinary living character in a running
//   game. Two programs on two layers, which is what the mixer is for.
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
  // the ambient layer — that is the wind behind the shut door — and two tapes on one
  // layer is two programs fighting over one element.
  const here = !program && !onDesk && phase?.hasCharacter ? resolveAmbience(standing) : null;

  // Nothing is stopped by hand here. runProgram's own cancel stops the layer it was
  // using, so a tape that stops being wanted is taken off by its effect's cleanup —
  // which is also why this must NOT call stopAllMusic(): that would reach across and cut
  // the ambience tape the effect below owns, on every phase change.
  useEffect(() => {
    if (!program) return undefined;
    return runProgram(program);
  }, [program]);

  // `here` is a stable reference: every entry in placeAmbience.js's tables is built once
  // at module load, so two neighbouring caves resolve to the very same object and walking
  // between them does not re-run this effect and restart the bed underfoot.
  useEffect(() => {
    if (!here) return undefined;
    return runProgram(here.program);
  }, [here]);

  // The rotation is one tape everywhere it plays, so it is keyed on nothing but whether
  // it should be playing at all — which means walking out of the Caves picks the music
  // back up rather than starting it over.
  const wantsMusic = Boolean(here?.music);
  useEffect(() => {
    if (!wantsMusic) return undefined;
    return runProgram(PROGRAMS.rotation);
  }, [wantsMusic]);

  return null;
}
