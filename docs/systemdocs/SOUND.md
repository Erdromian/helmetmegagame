# Sound

Everything the browser makes a noise with. Two engines, one set of switches.

There is no bot side to this: Discord plays nothing. This is the web app only.

---

## 1. Two engines, and why they are two

| | `web/app/components/sfx.js` | `web/app/components/music.js` |
|---|---|---|
| Plays | events — a click, a gate, a phone | beds and tracks |
| How long | under a second, mostly | minutes |
| Rate limited | yes, 120 ms per cue and 4 per 500 ms | no |
| In a hidden tab | dropped | **keeps playing** |
| Interrupted by an ordinary cue | its one drone is, yes | no |
| Volume | per-cue measured gain × the slider | per-layer gain × the slider |

`sfx.js` is the older of the two and it is good at its job. It also carries one
drone, for the Thanati rite, and that drone is stopped by the next ordinary cue,
stopped when the tab blurs, and capped by `maxMs`. Every one of those rules is
right for a rite and fatal for a soundtrack, which is why the music did not get
built on top of it.

Both modules carry the same twelve lines of autoplay-gate code. That is
deliberate — `music.js` has to `resume()` an `AudioContext` inside the gesture
handler itself, which is not the same act as setting a boolean, and exporting a
mutable `armed` out of `sfx.js` would be a worse coupling than the duplication.
The comment in each says so. Leave them apart.

### Adding a cue

Put the file in `web/public/assets/sfx/`, add a line to `CUES` in `sfx.js`, and
measure its gain into the `GAIN` table beside it (the targets are documented at
the top of that table). Credit it in `web/public/assets/sfx/ATTRIBUTION.md`.
Server-side code names cues through `db/lib/sfx.js`, not by string.

---

## 2. The switches

One localStorage key, `bascinet:sound`, read through `useSyncExternalStore` in
`web/app/components/soundStore.js`. The snapshot is a **string**, `sfx|music|volume`,
because `useSyncExternalStore` compares by identity and a fresh object every read
is an infinite render loop. A two-field value is the older `on|volume` shape and
parses in place with music defaulting on; nothing rewrites it.

**The speaker is the master.** It silences the cues *and* the music, because a
speaker button that leaves a song playing is a broken speaker button. The music
button silences only the music. So what a player hears is `sfx && music`, which
is `musicIsAudible()` — but the music *button* reads `music` alone, so somebody
who is currently muted can still set what they want for later.

That is the one thing about this file that looks like a bug and is not. Do not
collapse the two flags into one.

Volume is 0–1 in storage and 0–100 on the slider; the division happens in
`VolumeSlider.js` and nowhere else. It only ever attenuates — every cue and every
track is levelled before it reaches this number, so full is the level the game
was tuned at.

Per browser, not per character. Volume is a property of the room somebody is
sitting in, not of the person they are playing, and a spectator or a ghost has no
character row to hang a column on. A `storage` event carries a change to the
other tabs.

**Where the controls are:** the top bar on every page (`SoundControls.js`, mounted
by `AppBar.js`), and the foot of `/chat`'s places column. Same component, `layout`
picks the shape — `"row"` puts the volume behind a caret, `"stack"` puts the
slider inline. The caret opens the panel rather than the speaker, because
clicking the speaker has to stay a one-click mute.

---

## 3. The music bus

Four layers. The **highest one holding a track is the one you hear**.

```
ambient   the default bed — wind, room tone
music     event and situation music — the lobby, a special room, a sting
room      a jukebox, a gramophone: something switched on in the room
player    somebody playing a piano or a guitar
```

Player beats room because a person playing an instrument in front of you is
nearer than furniture in the corner, and because it is something somebody is
*doing*.

A layer under the top one does **not stop** — it ducks to silence, so when the
thing above it ends it is still where you left it. Takeover is a 1.2-second
crossfade.

`LAYER_MODE` is the one concession to bandwidth: `ambient` is `"continue"` (a
wind loop restarted at 0:00 under a jukebox is audible), everything else is
`"pause"` (a 4 MB song should not stream through ten silent minutes of somebody's
data plan).

**Only `ambient` and `music` have callers today.** `room` and `player` are
reachable by `playOn("room", …)` and wired into the priority rule, waiting for
the jukeboxes and the instruments. That is the whole of the scaffolding and it
costs three strings.

### How it is built

`AudioContext` plus a `GainNode` per layer, with the tracks staying as `<audio>`
elements routed in through `createMediaElementSource`.

Everything here is a fade — 3 s in, 4 s out, 5 s out, 1 s in, plus the crossfade
— and a gain ramp is scheduled on the audio clock, where a busy main thread
cannot make it stutter. Ramping `element.volume` on a timer steps audibly and
drifts. The element stays because it **streams**: `white_waking` is 4 MB and
would be roughly 40 MB of resident float PCM through `decodeAudioData`, and the
element hands over `duration`, `currentTime` and `ended` for nothing.

If `AudioContext` is missing, `ramp()` falls back to a `requestAnimationFrame`
ramp on `element.volume`. One branch inside one function — not a second engine.

### If a soundtrack goes quiet

1. **Has anything been clicked?** Browsers refuse audio until a real gesture.
   `musicArmed()` says. There is deliberately no "click to enable sound" dialog.
2. **Is the master off?** `soundSetting()` in the console.
3. **Is there a program for this state at all?** `resolveProgram` returns `null`
   for a running game with a living character, and for every `/gm/` path.
4. **On iOS**, the silent switch mutes Web Audio whatever the volume says. That
   is not a bug in this code.

---

## 4. Programs

What plays and when, in `web/app/components/musicProgram.js`. A program is a
layer plus a **tape** of steps. The timings are data on purpose: retune a gap, a
fade or a loop point by editing a number, never by editing control flow.

`MusicDirector.js` — mounted once in the root layout, renders nothing — picks the
program from the phase and runs it.

| state | program |
|---|---|
| `CLOSED` | wind beds for about a minute, then, **at most once an hour per browser**, `white_waking` fading in over 3 s and out over 4, then the wind again, forever |
| `LOBBY` | `song_game`, a 5-second tail, 15 seconds of nothing, again |
| `RUNNING`/`ENDED` with no living character | `song_game` from 0:00, then 10 s, then repeatedly from **0:18** fading in over a second — the intro is odd, so only the first pass hears it |
| anything else, or any `/gm/` path | silence |

The GM clause is worth knowing: a GM has no character of their own during a
running game, so without it the character-creation loop would start under the
audit desk.

### The step table

| key | meaning |
|---|---|
| `src` / `pick` | one file, or an array chosen from per entry (the wind beds) |
| `startAt` | seeds `currentTime`. This is the 0:18 |
| `loop` | the element loops; only `holdMs` ends it |
| `holdMs` | advance after N ms whatever the track is doing |
| `fadeInMs` / `fadeOutMs` | gain ramps. The out ramp is read off `duration` when metadata lands, never guessed |
| `gain` | per-step trim, multiplied by layer and master |
| `once` | consumed on first entry, skipped thereafter |
| `cooldownMs` | with `once`: the clock only starts once the step has been played HALFWAY through, and is kept in `localStorage`, so a refresh or another tab skips it until it expires |
| `silenceMs` | stop the layer, wait, continue |
| `warmAtMs` | fetch the next step's file this far into this one |
| `goto` | jump to an index. The only loop construct |

**`once` is module scope** — a `Set` at the top of the file — so a *soft*
navigation from `/character` to `/notes` does not replay it. On its own that
reset on every refresh, and players heard `white_waking` constantly, so the step
also carries `cooldownMs: 3_600_000`: the time it played is kept in
`localStorage` (`bascinet:music:waking`), and a refresh or a second tab inside
the hour skips it.

**The hour is only paid if it was heard.** `onPlayedFraction(layer, 0.5, …)` in
`music.js` watches the element's own `currentTime`, so the stamp is written
halfway through the track and not before. Close the tab on the first bars and
nothing is written — the next load wakes you properly. It also means a buffering
phone counts what it played rather than what was scheduled. If storage is blocked, it falls back to once per page load.

**One live timer per run.** `silenceMs`, `holdMs` and `warmAtMs` are timers;
everything else advances off the element's own `ended` event, so a stalled buffer
on a phone delays the tape rather than desyncing it. A monotonic `runId` means a
cancelled run can never advance a tape it no longer owns.

**A `startAt` seek lands before the first frame is heard.** `currentTime` cannot
be set until metadata is in, so a naive version starts at 0:00, seeks a moment
later, and leaks exactly the few milliseconds of intro the offset exists to skip.
`playOn` holds the layer with `seeking` until the `seeked` event.

---

## 5. How a page knows the phase

`web/app/components/PhaseProvider.js`, mounted in the **root** layout — not
`(app)`, because the closed door plays to people on `/handbook` and on the
sign-in screen too. The first answer streams from a promise the layout starts
(the pattern `MoveWindowProvider.js` already uses), and then it polls
`/api/music-phase` once a minute so a phase change reaches the music without a
hard refresh. A minute of latency on a soundtrack is imperceptible; do not poll
faster.

It asks two questions, not one, because **there is no CHARACTER_CREATION phase**
— creation is what `/character` renders when the phase is not `LOBBY` and you
have no living character (`LOBBY.md` §1). So `web/lib/gamePhase.js` returns
`{ phase, hasCharacter }`.

**`/api/character-version` cannot carry this**, which is worth writing down
because it is the obvious idea: that route answers 403 "No living character"
before it reaches its own `gameState` read, and every state the soundtrack cares
about is a state where it 403s.

---

## 6. Assets

`web/public/assets/music/` — the beds and the tracks, credited in the
`ATTRIBUTION.md` beside them. `web/public/assets/sfx/` is the cue library and has
its own.

The two long tracks are about 6 MB together, so: `preload="none"` on every
element, `src` set only when a step is about to start, and **never** a
`<link rel="preload">` in the head — that would pull megabytes on every page view
for a phase most viewers are not in. `warmAtMs` is the only prefetch, and a
program has to ask for it.

A running player with a living character downloads **zero bytes** of music. Worth
re-checking after any change to `resolveProgram`.

---

## 7. Known, and left alone

- **Two tabs play two unsynchronised copies.** Muting propagates (the `storage`
  event), the audio does not. The fix is a `BroadcastChannel` leader election —
  about sixty lines and a whole class of stuck-silent bugs — and it is not worth
  paying for before anybody has complained.
- **A click during page load is lost.** The gesture listener is registered when
  the module evaluates, so a click before that arms nothing. The listeners stay
  registered until a gesture lands, so the next click works.
- **Ogg Vorbis is what the app serves**, which Safari does not play. That is true
  of all 90-odd existing cues too, not something the music introduced.
- **`prefers-reduced-motion` is not consulted.** It is about motion. The mute
  switch is the accessibility answer and it is one click from every page.
