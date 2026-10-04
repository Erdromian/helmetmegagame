"use client";

import { useEffect, useRef, useState } from "react";
import { songByKey } from "@lifeweb/db/lib/instrumentSongs";
import { jukeboxSongByKey } from "@lifeweb/db/lib/jukeboxSongs";
import { isWanted, playOn, setTone, stopLayer, voicesOn } from "./music";
import { setJukebox } from "./musicConductor";
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
// low quality speaker". It is on at one level or it is off: sound effects (sfx.js) play
// over it without moving it, and through a soundproof wall it is darker but no quieter.
// While it plays, the place's ambience song is stopped and no new one starts
// (musicConductor.js#setJukebox); a fresh one is picked once it goes off.
// Where it comes from: Chat's feed frame while the stream is open, the phase poll's
// `standing.jukebox` otherwise.
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
// Through a soundproof wall: much darker, at the same level.
const WALL_HZ = 500;

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
      setJukebox(false);
    } else {
      const want = {
        src: song.src,
        startedAt: jukeboxStartedAt,
        gain: fileGain(song.src),
        hz: behindWall ? WALL_HZ : SPEAKER_HZ,
      };
      // Before playOn, so the ambience song fades out as the jukebox fades in.
      setJukebox(true);
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
      } else if (was.hz !== want.hz) {
        // The same song from the other side of a wall: darkened, never restarted.
        setTone("room", { hz: want.hz });
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

  // Unmounted, there is no jukebox to keep the ambience off.
  useEffect(() => () => setJukebox(false), []);

  return null;
}
