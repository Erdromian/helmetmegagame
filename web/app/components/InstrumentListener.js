"use client";

import { useEffect, useRef, useState } from "react";
import { songByKey } from "@lifeweb/db/lib/instrumentSongs";
import { jukeboxSongByKey } from "@lifeweb/db/lib/jukeboxSongs";
import { duckLayer, isWanted, playOn, setTone, stopLayer, voicesOn } from "./music";
import { onCuesSounding } from "./sfx";
import { fileGain } from "./musicGain";
import { JUKEBOX_LOCATION_SLUGS } from "@lifeweb/db/lib/jukeboxText";
import { useFramedDenJukebox, useFramedJukebox, useMutedPerformers, usePerformances } from "./performanceStore";
import { usePhase, useStanding } from "./PhaseProvider";
import { useHeardPlace, useLastHeardPlace } from "./heardPlace";
import { standingForKey, useGmPlaces } from "./gmPlaces";

// Plays what the people around you are playing (docs/systemdocs/SOUND.md,
// "Performances"), and the Den's jukebox ("The Den's jukebox"). Mounted once beside
// MusicDirector, renders nothing.
//
// One VOICE per performance on the `player` layer ("player:<id>", music.js), so two
// people playing at once are both heard. Each is ANCHORED to its own startedAt, so
// somebody walking in halfway lands halfway, and unmuting catches up rather than
// starting over. The file's measured trim times the performer's own slider is the gain.
//
// A voice is only re-issued when its src or gain actually changes: playOn re-seeks an
// anchored track, and doing that on every frame would be a skip in the song.
//
// THE JUKEBOX is the `room` layer: one song, on loop, anchored to when it was put on so
// the whole Den hears the same bar, and through a lowpass — "Muffle the sound to imitate a
// low quality speaker". Being the top of the bus it ducks the place's ambience to silence
// while it plays. Sound effects are a different engine (sfx.js) and play over it, and while
// one is sounding the jukebox drops very low and comes back after (DUCK_* below).
// Where it comes from: Chat's feed frame while the stream is open, the phase poll's
// `standing.jukebox` otherwise. In a soundproof room it is heard through the wall.
//
// A GM with no character hears it too, while the place they have open in Chat — or had
// open last — is in the Den or the Den Interior. That is the same place their ambience
// follows (MusicDirector.js), and like the ambience it goes on playing on every page,
// a GM desk included. Theirs comes off the stream's `den` frame, and the phase poll's
// `denJukebox` once Chat is closed.
//
// `room` and `player` are mutually exclusive (music.js), and a lute in front of you beats
// a box in the corner: while anybody here is playing, the jukebox is not issued at all,
// and it comes back — at wherever its loop has got to — when the last of them stops.

// The speaker: a lowpass that keeps the voice and the beat and loses the air.
const SPEAKER_HZ = 2800;
// Through a soundproof wall: much darker, and a good deal quieter.
const WALL_HZ = 500;
const WALL_GAIN = 0.35;
// Under a sound effect the jukebox all but stops, fast, and comes back slowly once the last
// cue has finished — so the door, the dice or the gunshot is what you hear. HOLD bridges the
// gap between two cues close together, so the song does not pump up and down between them.
const DUCK_FACTOR = 0.15;
const DUCK_DOWN_MS = 150;
const DUCK_UP_MS = 1000;
const DUCK_HOLD_MS = 300;

export default function InstrumentListener() {
  const performances = usePerformances();
  const muted = useMutedPerformers();
  const applied = useRef(new Map());
  const room = useRef(null);
  // Bumped when the next performance runs out. A song that ends on its own writes nothing
  // and raises no frame (db/lib/performance.js), so without this the jukebox would wait
  // under a lute that had already stopped.
  const [tick, setTick] = useState(0);

  const phase = usePhase();
  const standing = useStanding();
  const framed = useFramedJukebox();
  const framedDen = useFramedDenJukebox();
  const heardKey = useHeardPlace();
  const lastKey = useLastHeardPlace();
  const living = Boolean(phase?.hasCharacter) && phase?.phase !== "CLOSED";
  // The same test as MusicDirector.js: a GM with no character, in a running game.
  const gmMode = !living && phase?.phase === "RUNNING" && Boolean(phase?.gm);
  const gmPlaces = useGmPlaces(gmMode);

  let jukebox = null;
  // Which room decides "through the wall": the one Chat has open for a character, the one
  // open or last open for a GM (the same key their ambience follows).
  let wallKey = heardKey;
  if (living) {
    jukebox = framed !== undefined ? framed : (standing?.jukebox ?? null);
  } else if (gmMode) {
    const den = framedDen !== undefined ? framedDen : (phase?.denJukebox ?? null);
    const lookingAt = standingForKey(gmPlaces, lastKey)?.locationSlug;
    if (den && JUKEBOX_LOCATION_SLUGS.includes(lookingAt)) jukebox = den;
    wallKey = lastKey;
  }
  const jukeboxKey = jukebox?.songKey ?? null;
  const jukeboxStartedAt = jukebox?.startedAt ?? null;
  const behindWall = Boolean(
    jukebox && wallKey?.startsWith("room:") && jukebox.quietRoomIds?.includes(wallKey.slice("room:".length)),
  );

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

    // The jukebox, after the voices are settled. Nothing is issued under a performance:
    // playOn("room") would stop every voice (music.js), and the lute is meant to win.
    const song = jukeboxKey && typeof jukeboxStartedAt === "number" ? jukeboxSongByKey(jukeboxKey) : null;
    if (!song || wanted.size > 0) {
      if (isWanted("room")) stopLayer("room");
      room.current = null;
    } else {
      const want = {
        src: song.src,
        startedAt: jukeboxStartedAt,
        gain: fileGain(song.src) * (behindWall ? WALL_GAIN : 1),
        hz: behindWall ? WALL_HZ : SPEAKER_HZ,
      };
      const was = room.current;
      // A layer something else stopped (a voice starting, stopAllMusic) is not playing,
      // whatever this ref remembers, so it is issued again.
      if (!was || !isWanted("room") || was.src !== want.src || was.startedAt !== want.startedAt) {
        playOn("room", {
          src: want.src,
          gain: want.gain,
          hz: want.hz,
          loop: true,
          anchor: { startedAt: want.startedAt },
          fadeInMs: 1200,
        });
      } else if (was.gain !== want.gain || was.hz !== want.hz) {
        // The same song from the other side of a wall: re-levelled, never restarted.
        setTone("room", { gain: want.gain, hz: want.hz });
      }
      room.current = want;
    }

    // Voices last, so a lute starting after the jukebox takes the bus from it.
    for (const [key, want] of wanted) {
      const was = applied.current.get(key);
      if (was && was.src === want.src && was.gain === want.gain && was.startedAt === want.startedAt) {
        continue;
      }
      playOn(key, { src: want.src, gain: want.gain, anchor: { startedAt: want.startedAt }, fadeInMs: 400 });
      applied.current.set(key, want);
    }
  }, [performances, muted, jukeboxKey, jukeboxStartedAt, behindWall, tick]);

  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...performances.map((p) => (p?.endsAt > now ? p.endsAt : Infinity)));
    if (!Number.isFinite(next)) return undefined;
    const id = window.setTimeout(() => setTick((n) => n + 1), next - now + 250);
    return () => window.clearTimeout(id);
  }, [performances, tick]);

  // Sound effects over the jukebox. Only the `room` layer: an instrument somebody is playing
  // is a person in front of you, and holds its own against a cue.
  useEffect(() => {
    let release = null;
    const off = onCuesSounding((on) => {
      window.clearTimeout(release);
      if (on) duckLayer("room", DUCK_FACTOR, DUCK_DOWN_MS);
      else release = window.setTimeout(() => duckLayer("room", 1, DUCK_UP_MS), DUCK_HOLD_MS);
    });
    return () => {
      off();
      window.clearTimeout(release);
      duckLayer("room", 1, 0);
    };
  }, []);

  return null;
}
