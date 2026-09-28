"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { setMasterVolume, setMusicMuted } from "./music";
import { BY_DRUG, GHOST, INTERRUPTS, resolveAmbience } from "./placeAmbience";
import { useHeardPlace, useLastHeardPlace } from "./heardPlace";
import { standingForKey, useGmPlaces } from "./gmPlaces";
import { resolveProgram, runProgram } from "./musicProgram";
import {
  interrupt,
  setHold,
  setPlace,
  start as startConductor,
  stop as stopConductor,
} from "./musicConductor";
import { usePhase, useStanding } from "./PhaseProvider";
import { musicIsAudible, useSound } from "./soundStore";

// The one thing that decides what is playing. Mounted once, in the root layout, renders
// nothing. Phase, place and the two switches in; up to two running programs out.
//
// THREE STATES, and only one of them is on at a time:
//
//   A phase tape — the closed door, the lobby, rolling a character. These own the whole
//   bus while they run, because each is about the game itself rather than about anywhere
//   a person is standing. "Only lobby music tracks can play during lobby."
//
//   The conductor — ambience, "universal across all pages, including GM ones". One
//   timeline of whatever the place sounds like, spots over the top of it, and mostly
//   silence between (musicConductor.js). Three kinds of listener get it:
//
//     a living character — the place they stand in, on every page, a GM desk included;
//     a GHOST in a running game — the dead's own ambience, wherever they are looking;
//     a GM with no character in a running game — the place they are looking at in Chat,
//       or the last one they looked at. Nothing new starts on a GM panel, but a track
//       already playing runs on to its end there; it fades only when Chat is switched to a
//       place it cannot play in.
//
//   Nothing, otherwise: a GM desk outside a running game.
//
// It does NOT re-run on a route change — `pathname` is read only to ask "is this a GM desk?",
// which keeps the phase tapes off them (musicProgram.js#resolveProgram) and holds a
// characterless GM's timeline there. The effects depend on the ANSWER to that question, not
// the path, so walking between ordinary pages never restarts a track.
//
// Nor on the mute switch, and that is the other half of the same rule. The program keeps
// running while muted; muting only silences the bus (music.js#setMusicMuted), so unmuting
// lands wherever the tape has got to instead of starting it again from the top. The mute
// effect is declared FIRST so a page that loads muted is muted before anything plays.
export default function MusicDirector() {
  const phase = usePhase();
  const standing = useStanding();
  const heardKey = useHeardPlace();
  const lastKey = useLastHeardPlace();
  const setting = useSound();
  const audible = musicIsAudible(setting);
  const pathname = usePathname();
  const onDesk = pathname.startsWith("/gm/");

  const running = phase?.phase === "RUNNING";
  const living = Boolean(phase?.hasCharacter) && phase?.phase !== "CLOSED";
  const gmMode = !living && running && Boolean(phase?.gm);
  const ghostMode = !living && running && !gmMode && Boolean(phase?.ghost);
  const gmPlaces = useGmPlaces(gmMode);

  useEffect(() => {
    setMusicMuted(!audible);
  }, [audible]);

  useEffect(() => {
    setMasterVolume();
  }, [setting.volume]);

  const program = phase ? resolveProgram(phase, onDesk ? "/gm/" : "/") : null;
  // A place is only heard when no phase tape is talking over it. The `closed` tape owns
  // the ambient layer — that is the wind behind the shut door.
  const inGame = !program && (living || gmMode || ghostMode);
  let here = null;
  if (inGame && living) here = resolveAmbience(standing, heardKey);
  else if (inGame && ghostMode) here = GHOST;
  else if (inGame && gmMode) here = resolveAmbience(standingForKey(gmPlaces, lastKey), lastKey);

  // Nothing is stopped by hand here. runProgram's own cancel stops the layer it was
  // using, so a tape that stops being wanted is taken off by its effect's cleanup.
  useEffect(() => {
    if (!program) return undefined;
    return runProgram(program);
  }, [program]);

  // Declared before start(), so the conductor knows where you are before its first pick.
  // A GM looking at a DM or a net names no place; their last place stands until they look
  // at one again.
  useEffect(() => {
    if (gmMode && !here) return;
    setPlace(here);
  }, [here, gmMode]);

  // Also before start(), so a GM who loads straight onto a desk starts held and hears
  // nothing. A GM with a character of their own is `living`, and hears that place anywhere.
  const held = gmMode && onDesk;
  useEffect(() => {
    setHold(held);
  }, [held]);

  useEffect(() => {
    if (!inGame) return undefined;
    startConductor();
    return stopConductor;
  }, [inGame]);

  // "Ambience interrupting sound effect of becoming a ghost". Only a change this page SAW:
  // a ghost loading the page has been one for a while, and hears the ghost ambience plainly.
  const wasGhost = useRef(null);
  useEffect(() => {
    if (!phase) return;
    const before = wasGhost.current;
    wasGhost.current = ghostMode;
    if (ghostMode && before === false) interrupt(INTERRUPTS.ghost);
  }, [phase, ghostMode]);

  // "Sound and ambience that plays immediately after the charon has taken off" — once per
  // launch, for the people it lifted. The stamp outlives a reload inside the window
  // gamePhase.js reports it for.
  const launchedAt = living ? (standing?.charonLaunchedAt ?? null) : null;
  useEffect(() => {
    if (!launchedAt || heardLaunch(launchedAt)) return;
    interrupt(INTERRUPTS.charonLaunch);
  }, [launchedAt]);

  // The sound of taking a drug: its song cuts in once per dose, and then stays on as the
  // listener's bed while the high lasts (placeAmbience.js#BY_DRUG). gamePhase.js only stamps
  // a dose from the last few minutes, and the stamp outlives a reload, so a dose taken on
  // Discord is still heard when the site is opened after. The newest dose wins if two land
  // in one poll — two songs cutting each other off is worse than one.
  const doses = living ? (standing?.drugs ?? []) : [];
  const dose = doses
    .filter((d) => d.takenAt && BY_DRUG[d.id])
    .reduce((best, d) => (!best || d.takenAt > best.takenAt ? d : best), null);
  const doseKey = dose ? `${dose.id}@${dose.takenAt}` : null;
  useEffect(() => {
    if (!doseKey) return;
    const id = doseKey.slice(0, doseKey.lastIndexOf("@"));
    if (heardDose(doseKey)) return;
    interrupt(BY_DRUG[id]);
  }, [doseKey]);

  return null;
}

const DOSE_KEY = "bascinet:music:dose";
let doseHeard = null;

/** Whether this browser has already heard this dose; marks it heard if not. */
function heardDose(key) {
  if (doseHeard === key) return true;
  doseHeard = key;
  try {
    if (window.localStorage.getItem(DOSE_KEY) === key) return true;
    window.localStorage.setItem(DOSE_KEY, key);
  } catch {
    // Storage blocked: once per page load, which the module variable already is.
  }
  return false;
}

const LAUNCH_KEY = "bascinet:music:charon";
let launchHeard = null;

/** Whether this browser has already heard this launch; marks it heard if not. */
function heardLaunch(at) {
  if (launchHeard === at) return true;
  launchHeard = at;
  try {
    if (window.localStorage.getItem(LAUNCH_KEY) === String(at)) return true;
    window.localStorage.setItem(LAUNCH_KEY, String(at));
  } catch {
    // Storage blocked: once per page load, which the module variable already is.
  }
  return false;
}
