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

The telephone's three loops — the bell while a phone rings, the caller's long
tone, a dead line's busy tone — are NOT that drone. They live on a map of their
own in `sfx.js` (`setPhoneTones`), set as a whole from the feed's `phones`
frame: an ordinary cue does not stop them and a hidden tab does not either,
because a ringing phone has to keep ringing through every line said beside it.
See `PHONES.md` §8.

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

**With no key at all, the speaker starts on — except under `next dev`**, where it
starts off, so a pile of test browsers on a local server stays quiet. Clicking it
on is remembered like any other setting. Production builds are unaffected.

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
by `AppBar.js`), and on a phone in `/chat` the ⋯ menu in the chat head, since chat
hides the top bar there (`ChatBarControls.js`, CHAT.md §0). The places column's foot
no longer carries a copy. Same component, `layout` picks the shape — `"row"` puts
the volume behind a caret, `"stack"` draws the two switches alone for a panel that
has its own slider. The caret opens the panel rather than the speaker, because
clicking the speaker has to stay a one-click mute.

---

## 3. The music bus

Six layers. The **highest one holding a track is the one you hear**.

```
ambient   what the PLACE sounds like — wind outside, a drone in the Depths, the
          Cathedral's organ room (§4b)
spot      a short sound laid OVER that bed: a gull, a gust, a chapel tone (§4b)
music     the LOBBY's track, and nothing else — the one place a track simply
          plays, always, the same one for everybody (§4)
event     a siren, an alarm, a thing arriving. Loud and brief
room      a jukebox, a gramophone: something switched on in the room
player    somebody playing an instrument — one voice per performance (§6b)
```

Player beats room because a person playing an instrument in front of you is
nearer than furniture in the corner, and because it is something somebody is
*doing*.

A layer under the top one does **not stop** — it ducks to silence, so when the
thing above it ends it is still where you left it. Takeover is a 1.2-second
crossfade; the ambient bed takes 10 seconds to give way.

`LAYER_MODE` is the one concession to bandwidth: `ambient` and `event` are
`"continue"` (a wind loop restarted at 0:00 under a jukebox is audible, and a
siren that pauses and resumes is a siren twice), everything else is `"pause"` (a
4 MB song should not stream through ten silent minutes of somebody's data plan).

### The three rules on top

**`room` and `player` are mutually exclusive.** Starting one stops the other.
One jukebox or one lute, never a fight between them — winner-takes-all would
have *hidden* the quieter of the two rather than resolved it, and "the
gramophone is still going under the piano, you just cannot hear it" is a bug you
find by turning the piano off.

**`event` coexists with them rather than losing to them.** A siren does not stop
being a siren because somebody is at the piano. So instead of ducking to nothing
it drops to 0.35 of its own gain and its lowpass sweeps down to 700 Hz — a siren
heard through a wall, which is the sound of both facts being true at once. Every
other pairing is still winner-takes-all.

**`ambient` coexists under `spot`, and does not duck at all.** This is the one
pairing where the lower layer is meant to go on being *fully* heard: these are
the sounds the design document calls "played atop ambience", and a gull that
silenced the shore it was flying over would be telling the wrong story. What
makes a spot audible instead is its **level** — `musicGain.js`'s −30 LUFS tier,
four decibels over the bed, which is what that tier was always for. If a spot
gets lost in a bed, that number is the one to change, not this rule.

All three live in one table rather than in branches, so a seventh bus is a line:

```js
const PERFORMANCE = new Set(["room", "player"]);
const COEXIST = {
  event: { under: PERFORMANCE, duck: 0.35, hz: 700 },
  ambient: { under: new Set(["spot"]), duck: 1, hz: OPEN_HZ },
};
```

`OPEN_HZ` is declared **above** `COEXIST` for that second line: a `const` read
while the object is being built has to already exist.

The filter is a `BiquadFilterNode` built **in `state()` or never** — a
`MediaElementAudioSourceNode` is made once per element, and re-patching a live
graph mid-fade is the one thing worth avoiding. Only a layer with a `COEXIST`
entry gets one, parked at 20 kHz where a lowpass is inaudible. The sweep is
*exponential*: pitch is logarithmic, so a linear ramp down from 20 kHz spends
its whole first half in frequencies nobody was listening to and the muffle then
arrives all at once at the end.

`audibleNow(layer)` is the one place that answers "is this making a noise right
now", and it exists because two things fire *later* — the deferred pause and
`fadeOutAtEnd`'s timer — and both used to re-derive it as "am I the top layer".
That was true while only one layer could ever be audible. It is not true now,
and left alone it would pause a siren that is legitimately playing.

**Nothing starts or stops instantly.** `playOn` floors its fade-in and
`stopLayer` its fade-out at 250 ms, and `stopLayer`'s default is 600 ms — it
used to be 0, which meant every caller that forgot cut the sound dead. The floor
is applied in those two entry points and **nowhere else**: `ramp()` has
deliberate zero-length sets in it (a gain reset before a fade-in, a filter put
back to open) and a floor down there would leak the top of every track.

**Every layer but `event` has a caller.** `room` is the Den's jukebox (§6c). `event`
is reachable by `playOn("event", …)` and wired into the rules above, waiting for the
sirens.

**`room` carries a lowpass of its own** (`TONED` in `music.js`), whatever is above it:
the jukebox is "a low quality speaker". `playOn(…, { hz })` sets where that filter rests
while the layer is heard, in place of `OPEN_HZ`, and `setTone(layer, { gain, hz })` moves
it and the gain without restarting or re-seeking the song. The filter is still built in
`state()` and nowhere else.

**`duckLayer(layer, factor, ms)` holds a layer at a fraction of its own gain** until it
is lifted with `1`. It is how the bus makes room for something OUTSIDE it — the jukebox
under a sound effect (§6c) — and it is separate from `COEXIST`, which is one layer making
room for another. The factor lives in a per-layer map, so it survives the priority pass
and a new song, and ducking a layer that has not played yet builds nothing.

### Muting, and where a track comes back

**The music switch is a duck, not a stop.** `setMusicMuted()` pulls the master
gain to silence and leaves every layer as it was: the same track and the same tape.
`MusicDirector` keeps the program running while muted, since `audible` is not
among the program effect's dependencies. So unmuting returns to where the
listener would be now, not to the top. After the fade, songs pause so they stop
streaming. The ambient bed keeps playing silently, which keeps it in time.
`stopAllMusic()` is only for when nothing should be playing (no phase, a GM
desk). Never wire the mute switch to it. That was the original bug: muting
restarted the wind from scratch.

**Anchors decide what "where the listener would be now" means.** `playOn(layer, { anchor })`:

- `"local"` (the default) is a private tape. Paused, it waits, and it resumes
  where it was left. The lobby song and the wind use this.
- `{ startedAt }` (epoch ms) is somebody else's performance, like a lute or a
  jukebox. It does not wait. Whenever it comes back into earshot (unmute, the
  layer above it ending, walking in halfway through), it first seeks to
  `now − startedAt` (wrapped if it loops). If it has already finished, the tape
  hears `ended` and moves on.

Every un-pause goes through `resume()`, and `positionFor()` is the only place
that works out the answer. Anything new that plays a shared performance passes
its `startedAt` and gets all of this for free.

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
   for a living character, a ghost or a GM in a running game, and for every `/gm/`
   path — and then it is the conductor's turn (§4a), which is silent between pieces
   about three quarters of the time.
4. **On iOS**, the silent switch mutes Web Audio whatever the volume says. That
   is not a bug in this code.

---

## 4. Programs

What plays and when, in `web/app/components/musicProgram.js`. A program is a
layer plus a **tape** of steps. The timings are data on purpose: retune a gap, a
fade or a loop point by editing a number, never by editing control flow.

`MusicDirector.js` — mounted once in the root layout, renders nothing — picks the
program from the phase and runs it.

| state | who | program |
|---|---|---|
| any `/gm/` path | anyone | no phase tape. The conductor still runs for the three rows at the bottom, but for a GM with no character it is **held** there: a track already playing finishes, and nothing new starts (below) |
| `CLOSED` | anyone | wind beds for about a minute, then, **at most once an hour per browser profile**, `white_waking` fading in over 3 s and out over 4, then the wind again, forever |
| anything but `CLOSED` | a living character | no phase tape — the conductor plays where they stand (§4a) |
| `RUNNING` | a **ghost** | no phase tape — the conductor plays the dead's own ambience (§4b) |
| `RUNNING` | a **GM** with no character | no phase tape — the conductor plays the place they are looking at in Chat (below) |
| anything but `CLOSED` | anyone else | the **lobby**: one track, looping, the same one for everybody, changing on the hour |

Read it top to bottom; that is the order the code asks in.

**"Ambience is universal across all pages, including GM ones."** That is the new
design document's sentence, and it is why a living character hears their place on
`/gm/*` too, and why a GM hears one at all. A GM has no character to stand anywhere, so
the document gives them the place they are **viewing in Chat, or last viewed** —
`heardPlace.js#useLastHeardPlace` reads Chat's open place, falling back to the
`bascinet:play:last-place` key Chat keeps across page loads. Chat's keys are ids, so
`gmPlaces.js` turns one into slugs through `/api/music-places`, a GM-only route fetched
once per page load. A key that names no place — a DM, a net, Deadchat — leaves the last
place standing.

**A GM panel holds a characterless GM's ambience; it does not stop it.** No new
piece or spot starts while they are on a `/gm/` page, so a GM who opens the desk
straight from a bookmark hears nothing. A piece that started in Chat plays on to its
end across every page, desks included. It fades mid-track for one reason only: the GM
switches Chat to a place the piece could not have been picked in — the same rule a
living character's piece follows when they walk (§4a). Other pages (Map, Documents…)
are not desks, so new pieces keep coming there off the last place. A GM with a living
character of their own is not held: they hear where that character stands, desks
included.

`ghost` and `gm` ride the phase payload (§5), asked only when there is no living
character in a running game, so a player's poll never pays for either.

### The lobby, and why it is one row rather than two

**There is no creation tape.** Rolling a character happens in the lobby, so it
hears the lobby. That used to be a second row and a tape of its own on
`b12_combined_start.ogg` — a file the design document marks `Unused`.

**Every player in the lobby hears the same track**, which is the one rule the
document states about more than one listener. So which track is not a choice a
browser gets to make: the hour number off the wall clock picks it, and the same
hour number is the `anchor`, so somebody arriving forty minutes in is sought
forty minutes into the loop rather than starting it again. Two browsers agree
because neither of them decided anything, and it costs no server state, no new
route and no schema column.

`shared: true` on a step is what asks for this. The step takes its track, its
position **and** its length from the clock — one `Date.now()` for all three,
because reading it twice can straddle the changeover and pair one hour's track
with the next hour's anchor.

| Track | Role |
|---|---|
| `a-thousand-empty-rooms` `beyondretrieval` `newlobby31` `outpost` `track3` `track13` | the hourly rotation |
| `red-calx` `conflict-and-climax` `friction` `manunkind` `stone-in-focus` | (same) — the new document's lobby music |
| `white_waking` | *"Rare Lobby Music"* — one slot in twelve (`RARE_ONE_IN`) |
| `haruspex` | *"Lobby Music when there is a lateparty"* — **not wired**, see §7 |
| `holywarlobby` | *"Special round lobby music"* — **not wired**, see §7 |
| `surfacing` `identity-theft` | *"Lobby music after the game has started and the count is in play"* — **not wired**: there is no Count |
| `mission-end` | *"Lobby music after the round starts and the gamemode is OS13"* — **not wired**: there is no OS13 gamemode |

"Only lobby music tracks can play during lobby" — the new document says so outright, and
it is what the lobby tape already was: nothing but `LOBBY_TRACKS` and the rare slot.

The rare slot is decided by the slot number too, never by a roll: a rare track
only some of the lobby could hear would not be rare, it would be broken. Rare
slots are **skipped** rather than overwritten, so the ordinary rotation is not
quietly short of a track every twelfth hour.

The GM clause is worth knowing: a GM has no character of their own during a
running game, so without it the character-creation loop would start under the
audit desk.

**A living character outranks the lobby**, and the reason is worth writing down
because the row above looks like it changes the lobby. It does not. Creation is
a hard phase gate — `RUNNING` or `ENDED`, or a GM
(`character/createActions.js#creationOpen`) — Start Game creates no characters
of its own, and rolling a role in the lobby only stamps a `LobbyEntry`. So
`LOBBY` *with* a living character is reachable only by a GM who used the Skip
button, which is somebody testing, and they were the one person being handed
`song_game` instead of the place they were standing in.

`CLOSED` still wins over a character, deliberately. That phase is the door being
shut rather than a game in progress, and `white_waking` sits on the `ambient`
layer there — the layer the place tape would want.

### The step table

| key | meaning |
|---|---|
| `src` / `pick` | one file, or an array chosen from per entry, never the same one twice running |
| `startAt` | seeds `currentTime` |
| `shared` | the track, its position and its length all come off the wall clock, so every listener is on the same one. The lobby, and nothing else (§4) |
| `loop` | the element loops; only `holdMs` ends it |
| `holdMs` | advance after N ms whatever the track is doing |
| `fadeInMs` / `fadeOutMs` | gain ramps. The out ramp is read off `duration` when metadata lands, never guessed |
| `gain` | per-step trim, multiplied by the file's measured level (§6), the layer and the master |
| `once` | consumed on first entry, skipped thereafter |
| `cooldownMs` | with `once`: the clock is stamped in `localStorage` the moment the step STARTS, so a refresh or another tab skips it until it expires. Rolled back if the run is cancelled inside the first 15 seconds, or if the music was never audible |
| `silenceMs` | stop the layer, wait, continue |
| `warmAtMs` | fetch the next step's file this far into this one |
| `goto` | jump to an index. The only loop construct |

**Any of `holdMs`, `silenceMs`, `fadeInMs`, `fadeOutMs`, `gain` and `warmAtMs`
may be a `[min, max]` range** instead of a number, rolled once per entry. That
is what keeps a sparse ambience from becoming a metronome — see §4b.

**`once` is module scope** — a `Set` at the top of the file — so a *soft*
navigation from `/character` to `/notes` does not replay it. On its own that
reset on every refresh, and players heard `white_waking` constantly, so the step
also carries `cooldownMs: 3_600_000`: the time it played is kept in
`localStorage` (`bascinet:music:waking`), and a refresh or a second tab inside
the hour skips it.

**The stamp is written when the step starts, not when it finishes**, and that is
the whole of why the hour holds. It used to be paid halfway through the track,
which reads as the kinder rule and was not: `white_waking` is about five
minutes, so the hour was only ever paid by somebody who sat on the page for four
solid minutes, and every refresh before that heard it again. What is left of the
kindness is a **rollback** — `forget()` — on the run's cancel: a swell cut off
inside its first 15 seconds, or one that played to a muted bus, gives the hour
back. A hard tab close runs no React cleanup, so closing the page two seconds in
keeps the hour. That is the deliberate trade.

**It is per browser profile, not per person.** The key is plain `localStorage`
with no account in it — the same rule as the switches in §2, and for the same
reason. Another browser, a private window or cleared site data starts fresh, and
that is not a bug to fix by hanging a column off `Character`.

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

## 4a. The conductor: the soundtrack under a running game

`web/app/components/musicConductor.js`, with its rules as pure functions in
`musicSchedule.js`. It is **one timeline, one piece at a time**:

```
[piece] → [silence] → [piece] → [silence] → …
```

A piece is whatever the place you are standing in sounds like (§4b), picked off its
stack of tiers by `musicSchedule.js#pickTiered`. **There is only one kind of piece.**

This used to alternate an ambient bed with a track off a general music rotation,
on a 35% roll once you had settled in for eight minutes. **The design document has
no such rotation**, and that is not an omission: every one of the nine tracks that
was in it is either lobby music, the ambience of a particular place, or marked
`Unused`. So `MUSIC_TRACKS`, `nextKind`, `MUSIC_CHANCE`, `FLOW_AFTER_MS`,
`AMBIENT_GAIN` and `music: false` all went with the idea. A long track is still a
long track; it just belongs somewhere now.

- **A piece plays to its end, with two exceptions, and both are the document's:**
  "Ambience tracks continue to completion unless they are interrupted by an ambience
  interrupting SFX, or the character leaves the specific zone in which they can play,
  in which case they fade out."
  - `interrupt(piece)` fades the piece out over 1.5 s and plays the interrupter in its
    place, to its own end, then the ordinary gap. Three kinds are wired: `geist.ogg` the
    moment this page sees its viewer become a ghost, `locus-meropis.ogg` for the Charon's
    passengers once per launch (`standing.charonLaunchedAt`, a 10-minute window, and a
    `bascinet:music:charon` stamp so a reload does not play it twice), and a drug's song
    the moment it is taken (`standing.drugs[].takenAt`, the same window, and a
    `bascinet:music:dose` stamp; §4b). Asked for before the conductor starts, an
    interrupter is the first thing it plays.
  - `setPlace(next)` fades the piece over 4 s if `next` could never have picked it
    (`placeAmbience.js#placeHas`). Town to Undertown keeps a general or fortress track
    going, because it can play in both; Town to space does not. A spot is held to the
    same test against the new place's spots.
  - A characterless GM follows the same rule, with Chat's open place as where they
    stand. Going to a GM panel is not a move, so it fades nothing.
  A performance — a jukebox or somebody playing — still covers a piece rather than
  ending it, and §3's rules handle that.
- **`setHold(true)` holds the timeline** — MusicDirector's, for a characterless GM on a
  `/gm/` page. A piece or spot that comes due while held waits, and one already playing
  finishes. Let go, whatever waited starts after the same 5–20 s as a first visit; a
  silence gap still counting down just carries on, so bouncing on and off a desk never
  cuts the silence short.
- **About 75% of in-game time is silence**, which is the document's first rule for
  an ambience track. After a piece that lasted *d*, the gap is *d* × 3, ±30%,
  never under 2 minutes (`SILENCE_SHARE`, `MIN_GAP_MS`). Scaling the gap to the
  piece is what keeps the ratio whatever came up.
- **A bed plays at its measured level and nothing else.** There used to be a
  further ×0.85 to leave room for a song to stand out; with no rotation there is
  no song to make room for, and the tier in `musicGain.js` is the level it was
  meant to be playing at all along.
- **Spots run on a second, independent timeline.** The document says they are
  played atop ambience *or silence*, so a spot does not wait for a bed: pick one,
  play it on the `spot` layer, wait 45–180 s, again. §3's third rule is what keeps
  the two from fighting. That range is **ours**, not the document's — it says what
  a spot is for and never how often.
- **Walking somewhere new changes what plays NEXT.** The next piece is picked from
  the new place; the one in the air carries on if it may play there too (above).
- **It lives at module scope**, so a soft navigation never restarts it.
  `MusicDirector.js` calls `start()` / `stop()` when in-game play begins and
  ends, and `setPlace()` when where you are standing changes.
- A piece that never reports its end — a file that failed to load — is let go
  after 30 minutes, far past the longest file.

`npm run sounds:schedule` runs the rules against a fake clock for six hours and
fails if the silence share drifts or a piece repeats back to back. Set
`localStorage["bascinet:musicdebug"] = 1` to watch the timeline in the console.

---

## 4b. What a PLACE sounds like

`web/app/components/placeAmbience.js` answers **what** could play here: a stack of
tiers of pieces per place. The conductor (§4a) decides **when**.

**A piece is one of two things, and the difference is whether the file has an
end.**

- A file with an **end** — `once()` — plays start to finish. The Cathedral's organ
  room, a drip in the Lifeweb, a six-minute drone.
- A **texture** — `loop()` — has no end of its own: a three-second fire, a wind
  gust, an idling engine. It loops for a span (60–150 s unless the place says
  otherwise) and then fades out over 6 seconds. That fade is the end it was
  always going to have.

A place never plays the same piece twice running when it has a choice.

**Every placement in this file comes out of `docs/sounds.yaml` (§7), and each one
carries its use case as a comment beside it** — the sentence is the reason the
file is there and the filename is not. `ambimine.ogg` sounds like it belongs in a
mine and the document puts it in space, which is exactly the sort of thing this
file used to get wrong.

**Beds and spots are the document's own split.** Beds are class `ambience`, one at
a time on the `ambient` layer. Spots are class `atop` — "short sounds which add to
the atmosphere", laid *over* the bed on the `spot` layer rather than in place of it.
The winds are spots over the surface and the chapel tones are spots over the
Cathedral.

### The placement rules

The new design document opens with rules for where any ambience may play, old files
and new (`placement:` in `docs/sounds.yaml`, word for word). This file is those rules
in code, and `web/lib/__tests__/placeAmbience.test.mjs` holds it to them:

- **"ONLY ambience tracks referring to space are to be used in space."** Space has
  one tier and nothing else, whoever is listening. That moved `spookyspace1` and
  `spookyspace2` ("Quiet ambience in space") out of the Caves and the Depths and
  into space, took `ambigen11` ("atop silence in space stations") off the Depths,
  and keeps `charon_loop` ("in proximity to charon") to the ship on the ground.
- **"General ambience is for use in the town/undertown/keep/blackhills/caves/depths."**
  Eleven tracks, the bottom tier of every place in those six zones.
- **"The fortress" is every location in the Keep, the Town and the Undertown.** The
  Keep is the zone called `fortress` — the document lists "the keep" beside the town
  as a zone — and "the underfort" is the Undertown. So `loop_airy1` ("Ambience in the
  fortress") is in all three now, with six new fortress tracks.
- **Caves/depths tracks play in the Black Hills too.** The Hills have no bed of their
  own; `surfacing`, which was one, is lobby music for a Count that does not exist yet.
- **"The most specific ambience track to a situation will be selected over more
  general tracks, with some variation."** See the tiers below.

### Tiers, and how a room gets heard

A place is a **stack of tiers, most specific first**, with the empty ones dropped:

```
what the listener is → room → Location (or attribute) → zone → fortress → general
```

`musicSchedule.js#pickTiered` rolls a tier off `TIER_WEIGHTS` — 0.55, 0.25, 0.12,
0.08, renormalised over the tiers a place has — then a piece within it, never the
last one played. At the Inn that is its two tracks about half the time, the town's
walk, the fortress and the general tracks the rest. The weights are data: retune a
number, not control flow.

A Location attribute sits at the Location's tier; the list is ordered, because a
place can carry several and the order is the answer. `resolveAmbience` memoises
each distinct answer, so two neighbouring caves resolve to the very same object and
a re-render never looks like a move.

**A room is the one Chat has open.** `Character` has `locationId` and `zoneId`
and no room column, so which room you *hear* is the room you are *reading*.
Chat reports the place it is drawing to `heardPlace.js`, `MusicDirector` passes
that key to `resolveAmbience`, and the standing payload carries
`rooms` — id to slug for the rooms at the character's Location — so a
`room:<id>` can be looked up in `BY_ROOM`. A room somewhere else is not in that
map, so a key left open after walking away falls through to the Location.
Leaving Chat keeps the last room; a fresh page load that never opens Chat hears
the Location.

It is not `chat/openPlace.js` read from the root layout: that store adopts
whatever is in the URL hash, and on any other page the hash is not a place.

`BY_ROOM` holds only rooms that sound different from their Location, and today
it is empty. It was built for the fire in the Inn's **Bar**, the Court's
**Throne Room** and the Slums' **Firepit**.

**The fire is not ambience.** `newfireloop.ogg` used to be a bed on the whole
Inn and the whole Keep, and it is far too intense for a hearth or a brazier.
It is only for a fire that is out of control, and `docs/sounds.yaml` records
that as the file's `needs`. Nothing in the game can tell that a fire is out of
control yet, so nothing plays it.

### What the LISTENER is: the most specific tier

Some placements are conditions on the person rather than on the room. They make the
top tier — the most specific thing about a situation is who is in it — but a tier,
not a wall: the place still gets a word in. Space is the exception, because space
is space.

| Use case | Reading |
|---|---|
| `ambi2.ogg` — "Ambience while in pain shock or sedated" | `impaired`, anywhere |
| `parhelic-triangle.ogg`, `fools-village.ogg` — "Ambience while hallucinating" | the `hallucinating` tag |
| `abyssus-abyssum-invocat.ogg` — "Ambience while wearing thanati robes" | `black-robes`, **equipped** |
| `loop_airy4.ogg` — "Ambience in town when character mood is low" | zone `town` and `moodTone: "bad"` |
| a drug's song — see below | `drugs`, the drugs they are on |

These ride the phase payload (§5). **"Sedated" has no counterpart in the tag
catalog** — `pain-shock` is real and `unconscious` is the nearest thing to it, so
`IMPAIRED_TAGS` in `gamePhase.js` is a reading rather than a translation. Say so
before relying on it.

**Being on a drug is one song per drug**, and the song is two things: the "ambience
interrupting sfx" the moment the dose is taken (§4a), and then the listener's bed for as
long as the high lasts. The pairings are Bascinet's, picked against the documents'
sentences, and kept in one table, `placeAmbience.js#BY_DRUG`. No song belongs to two
drugs:

| Drug | State it leaves | Song | The document's sentence |
|---|---|---|---|
| Cave Fungus | High | `hishmaliin.ogg` | "…plays after smoking marijuana" |
| Bliss | Euphoric + High | `fools-village.ogg` | "Ambience while hallucinating" |
| Heroin | Doped | `ambi2.ogg` | "Ambience while in pain shock or sedated" — a texture, so it loops for a minute or two and fades |
| Changa | Changa High | `oval-sky.ogg` | "…a drug induced bad trip, VERY LOUD" — half the volume of the other tracks, on top of its measured level |
| ETH-LOD | Dissociated | `mature-raver.ogg` | "…after taking DOB or other hardcore drug" |

Buffout, Love Tablets and Opium High are drugs with no song yet, and are silent.
Ambrosia (tag points) and the Black Market Autoinjector (Damaged Vision) leave no high to
hear. Fool's Village still plays for the `hallucinating` tag as well, and so does
Parhelic Triangle, which no drug has — that is a state, not a drug. ambi2 likewise stays
the bed for `pain-shock` and `unconscious`.

The soundtrack can only see the STATE, so `web/lib/drugHighs.js` is the way back from
state to drug: a drug is on while every tag it leaves is held, and Bliss — refined fungus,
which leaves the same High with Euphoric on top — hides Cave Fungus rather than playing
beside it. Its test holds the table to each item's `consumesInto` in `docs/tags.yaml`.

The dose is heard from the tag's `acquiredAt`, not from the Consume button, so a drug taken
on Discord, or given by somebody else, cuts in too — on the next poll, or at once when this
page's own Consume dialog nudges it. Taking a second dose while still high adds no new tag,
so it is not heard again.

**A ghost is not anywhere.** `GHOST` is its own place: "Ambience while a ghost",
"Ambience for ghosts", and `geist.ogg`, which is both that and the interrupter for
becoming one (§4a).

### Conditional beds

The **Depot**'s bed is conditional: `train_loop` plays only while the train is
actually standing at the platform, which is `db/lib/train.js#trainHere` and the
first hour of the turn (`web/lib/gamePhase.js`). It has to stop, or "the train is
in" stops meaning anything and becomes the Depot's permanent room tone. Rails empty,
the Depot is the Undertown like anywhere else down there.

### What is described and not placed

Most of the new document's tracks are for things the game does not have yet — the
Count's camp, limbo, an alien location, a Wonder, the Dreamer, THEY, soulbreakers,
an alarm in the fortress, a space station, a revolutionary. Each one is in the library and the registry with a `needs` line
saying what is missing, and nothing plays it. `npm run sounds:report` lists them.

---

## 5. How a page knows the phase, and where it is standing

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
`{ phase, hasCharacter, standing }`.

**Standing rides this payload rather than having a provider of its own.** The
ambience bed is picked from it (§4b), and this is already the one query that
runs on every page for exactly this purpose — a separate provider and a second
poll would have been a second answer to a question being asked once a minute
anyway. The character select widens by one join and no extra round trip, and
what crosses to the client is slugs and booleans: never the `Location` row,
which carries descriptions and stash contents the soundtrack has no business
shipping to a browser. The one exception is `rooms`, id to slug for the rooms at
that Location, which is how the room Chat has open is matched (§4b); ids are
already in every place key Chat holds. `useStanding()` is the hook.

**`standing` also carries what the LISTENER is**, because some of the documents'
use cases are about the person rather than the room (§4b):

- `moodTone` — the *tone* of the mood band (`bad` / `warn` / `muted` / `good`)
  from `db/lib/mood.js#bandOf`, never the dial itself. The number is one no player
  is ever shown (`MOOD.md`), and it has no business crossing to a browser just so
  the soundtrack can compare it against a threshold of its own.
- `impaired`, `hallucinating` and `robed` — whether they hold any of
  `IMPAIRED_TAGS`, the `hallucinating` tag, and `black-robes` **equipped**. One join,
  filtered in the query to those few slugs rather than fetching the tag list.
- `drugs` — `[{ id, takenAt }]`, the drugs they are on (`drugHighs.js`), with `takenAt`
  only for a dose from the last ten minutes and null otherwise, so an old stamp nobody can
  act on does not churn the poll. The state tags ride the same narrow join.
- `charonLaunchedAt` — the launch time, for ten minutes after the Charon lifts, and
  only for somebody standing at the orbit Location it lifted them to. One more read,
  and only there.

Mood is free: it is a scalar on the `Character` row already being read. The tags
are the one extra join.

**With no living character in a running game**, the payload adds `ghost`
(`db/lib/ghost.js#isPlayerGhost`) and `gm` (`getGmSession`). Both are `false`
otherwise and cost nothing, so a living player's poll never pays for them (§4).

Two things that are easy to get wrong here:

- **The poll preserves identity**, so an unchanged answer does not re-run every
  effect downstream — which means the comparison has to cover *everything* in
  the payload. It compared `phase` and `hasCharacter` alone, and adding standing
  without extending it would have pinned the first location forever and left the
  ambience playing the bed of a place the character walked out of an hour ago.
- **A move is nudged, not waited for.** `nudgePhase()` fires one poll out of
  turn from `travelTo`'s continuation, so walking somewhere is heard at once
  rather than up to a minute later. One request per move actually made, and none
  per navigation. Anything else that moves a character — an escort, an ambush,
  the bot's picker — is caught by the ordinary poll.

**`/api/character-version` cannot carry this**, which is worth writing down
because it is the obvious idea: that route answers 403 "No living character"
before it reaches its own `gameState` read, and every state the soundtrack cares
about is a state where it 403s.

---

## 6. Assets

Three served folders, each with its own `ATTRIBUTION.md`:
`web/public/assets/music/` (the game's music and the phase tapes),
`web/public/assets/ambience/` (the beds and the spots) and
`web/public/assets/sfx/` (the cue library).

**What is served is not what is kept.** `assets/osw-sounds/` is the master
library — byte-for-byte copies, outside `web/public` on purpose, pulled by
`scripts/osw/export-sounds.py`. `scripts/audio/build-assets.sh` is what copies a
chosen sound into a served folder, re-encoding it to **mono Ogg Vorbis at
32 kHz** (about 36 kbps) as it goes. These play at −34 to −26 LUFS underneath
everything else, and a 6 MB stereo master of a seven-minute ambient piece is six
megabytes spent on detail nobody in that mix can hear; mono at 32 kHz keeps
everything up to 16 kHz for a third of the size. It took the served set from
about 60 MB to 25. `ffmpeg` is a dev tool — nothing in the repo builds or runs
against it, and the committed outputs are what matter.

**Bascinet's own picks are the one exception to "byte-for-byte".** The 75 tracks
from the new design document came in through `scripts/audio/import-bascinet-sounds.mjs`,
which keeps them re-encoded (stereo Vorbis, about 96 kbps) rather than as originals —
Bascinet's choice, to keep 290 MB out of the history. `assets/osw-sounds/bascinet-sources.json`
records the artist, title and YouTube id of each, and their served copies are credited
in their own section of each `ATTRIBUTION.md`, **with no license claimed**: they are
published recordings, not OpenSourceWeb files. The served set is about 80 MB with them.

`preload="none"` on every element, `src` set only when a step is about to start,
and **never** a `<link rel="preload">` in the head — that would pull megabytes on
every page view for a phase most viewers are not in. `warmAtMs` is the only
prefetch and a program has to ask for it, which is also the answer to "should
this preload": widen the `warmAtMs` instead. Post-re-encode a bed is a few
hundred KB, so the fetch lands well inside the gap and the fade-in is never a
buffering pause.

**"A running player downloads zero bytes of music" is over**, and deliberately:
that was true because a living character had no soundtrack at all. A player now
holds one bed and, outside the quiet places, one track.

### Levels

`web/app/components/musicGain.js` is `sfx.js`'s `GAIN` table for the other
engine — each file's measured loudness, and the gain that puts it on the tier
its *job* wants. Measured with `scripts/audio/measure.sh`, which is ffmpeg's
`ebur128`: true EBU R128 integrated loudness, not an eyeballed peak. The formula
is `sfx.js`'s, `10^((target − measured)/20)`, clamped to 1 — nothing here is
ever turned *up*, because amplifying a quiet file amplifies its own noise floor
with it. A master below the quietest tier gets its lift baked in once at encode
time instead (`pathologic.ogg`, +8.7 dB).

| Target | What |
|---|---|
| −34 LUFS | a bed you should be able to forget is on |
| −30 LUFS | a spot, which arrives out of nothing and may be heard |
| −26 LUFS | music, a jukebox, an instrument — background, but the loud end of it |
| −22 LUFS | an event. A siren is made to be heard |

**This is what "the music volume is bad" was.** The files measured twenty
decibels apart — `white_waking` at −17.1 LUFS against `wind_2_2` at −37.3 — and
four hand-set numbers in `musicProgram.js` were doing the levelling job for all
of them. Those four are gone. A step's `gain` now reads as "and this one a
little under *that*" rather than as an absolute somebody has to re-derive every
time a file is re-encoded, and most steps carry none at all.

To add a file: look it up in `docs/sounds.yaml` first (§7 — it says what the file
is *for*), then drop it in, run `measure.sh`, and paste its line into
`musicGain.js`. A file missing from the table plays at its step gain alone — the
fallback is 1 rather than something cleverer precisely so an unmeasured file is
obviously wrong instead of quietly almost-right.

### The one override

`message` in `sfx.js`'s `GAIN` is set **by ear**, not by `measure.sh`, and it is
the only entry that is. `pop` measures under the −26 tier, so the formula clamps
its gain to 1 and the cue plays at the file's own level — which is correct
arithmetic and too loud for the one sound that fires every single time anybody
speaks. It sits at 0.161, a third as loud (−15.85 dB).

So re-running `measure.sh` will disagree with that line, and `measure.sh` will be
right about the file and wrong about the room. Leave it, or change it by
listening rather than by measuring. It is commented at the call site too, because
this is exactly the kind of number a later pass tidies back to "correct".

## 6b. Performances

A player with an instrument in hand plays a real song, and everybody standing
in the same Location hears it in their browser.

**The instruments.** Lute, Accordion and Boombox (`docs/tags.yaml`). Each is
`instrument: true`, and the code reads that flag, never a list of slugs. They
go in the WEAPON slot and take one hand. The Instrument Kit is what a Minstrel
starts with, and anyone can buy one at creation for 1 point: Consume it and
the player picks one of its `consumeChoice` list, a Lute or an Accordion
(`web/app/components/actions/ConsumeChoiceDialog.js`). The Boombox is not on
it; it comes from the Merchant's order or a GM. That is the one
difference from `consumesInto`'s `oneOf`, which rolls.

**The songs.** `db/lib/instrumentSongs.js` holds each instrument's list as
`{ key, name, src, seconds }`. It has no requires, so the Play Instrument
panel and the listener both read it in the browser. Each file is levelled at
the −26 LUFS music tier (§6) through `musicGain.js`, like any other track.

**The row.** One `Performance` per song (`db/lib/performance.js`):
character, Location, instrument, song, the performer's volume, `startedAt`,
`endsAt`, and `stoppedAt`. A row is live while `stoppedAt` is null and
`endsAt` is still ahead, so a song that runs out needs no write. A character
holds at most one unstopped row. The partial unique index
`Performance_live_unique` backs that up, and a hand-written "fix drift"
migration must not drop it (CLAUDE.md).

**Starting.** The **Play Instrument** button on the sheet shows for anyone
carrying an instrument or holding Musician, and is greyed until one is
equipped. The panel lists the songs, with an instrument picker only when two
or more are in hand. Clicking a song calls `startPerformance`, which checks
the performer is alive, able to act, holding the instrument and asking for one
of its songs, stops any older song, and writes the row. It also runs `/play`'s
own `playInstrument` from the Location's key. Off the five-minute cooldown
that posts the line and soothes the room, and on cooldown the song still plays
and nothing is posted. From a Location key the line is scenery: one post, as
subtext.

**Stopping.** Stop in the panel, and each of these, all through
`stopPerformances`:

| What | Where |
|---|---|
| The instrument leaves the rack (unequip, give, destroy, a GM's tag op) | `web/lib/afterInventoryChange.js`, `db/lib/tagOps.js` (`stopIfInstrumentGone`) |
| A fight, everybody in it | `db/lib/combat.js` (`startCombat`, `intervene`, `springAmbush`) |
| An intercept hold, whoever is held | `db/lib/intercept.js#fireWatches` |
| Being bound | `db/lib/bind.js#applyBind` |
| Leaving the Location, however it happens | `db/lib/locationMove.js`, beside the phone hang-up |
| Death, or leaving play | `db/lib/characterDeath.js#releaseEntanglements` |
| Going Catatonic | `db/lib/catatonicPass.js`, `db/lib/playerDeparture.js` |

`livePerformancesAt` also leaves out anybody no longer standing there, alive
and able to act, so a hook that forgets costs nothing a listener can hear.

**The wire.** Each start, stop and volume change raises one `pg_notify` on
`bascinet_feed` with `op: "music"` and the Location's place key.
`web/lib/feedHub.js` reads the live list once per notify and sends every
stream standing in that Location an `event: music` frame with the whole list.
`/api/feed` sends the same frame when a stream opens or its character walks
somewhere, which is how somebody arriving halfway through a song lands halfway
through it. Only the character's own Location: a GM or a ghost hears nothing.

**The browser.** `useFeedStream.js` hands each frame to
`web/app/components/performanceStore.js`, and `InstrumentListener.js` (mounted
beside `MusicDirector`) turns it into sound. Each performance is its own voice
on the `player` layer, keyed `player:<id>`, so two people playing at once are
both heard (§3: every rule reads the base layer, so voices of one layer never
duck each other). A voice is anchored to its `startedAt`. Its gain is the
file's measured trim times the performer's slider. The performer's own start
is noted straight into the store too, so somebody playing from the sheet,
where no stream is open, still hears themselves.

**Muting.** A row in HERE for somebody who has ever played carries a
`performerKey` (`db/lib/hoodToken.js`), an HMAC in its own namespace so it
never matches a hood token. The speaker button left of the eye toggles that
key in `localStorage` (`bascinet:muted-performers`), and the listener skips
any performance carrying it. Named rows only: a key on a hooded row would be
the same key as that person's unhooded one.

**Known limits.** The music frame only arrives while `/chat` is open, because
that is the only page with a stream. On the sheet you hear your own song and
nobody else's.

---

## 6c. The Den's jukebox

"Den music is played from the jukebox located in the den. Whichever song has been
picked loops for all characters in the den until it is changed or turned off. It
replaces any ambience while playing. Muffle the sound to imitate a low quality
speaker." (`docs/sounds.yaml`, the `jukebox` rule.)

**Where it is.** A fixture in the Den's Bar (`undertown-8-1`): a Jukebox button on the
Bar's starter post and in Chat's room panel (`db/lib/placeAffordances.js`). Anybody alive,
able to act and standing in the Bar may put a song on, change it or turn it off. It is
free. It is an act, so it keeps to the sitting (SESSIONS.md).

**The songs** are the eleven `jukebox` tracks, `db/lib/jukeboxSongs.js`, served from
`web/public/assets/den/` 6 dB under their masters (`build-assets.sh`'s `DEN` list) and
measured at the −26 LUFS tier. A player sees them the way the document numbers them,
"Song 1" to "Song 11".

**State** is two columns on the Bar's row: `Room.jukeboxSongKey` (null is off) and
`Room.jukeboxStartedAt`, which every listener's loop is anchored to, so the whole Den
hears the same bar. Restart Game turns it off. `db/lib/jukebox.js#setJukebox` writes
them, audits `jukebox_played` / `jukebox_stopped`, puts one unsigned line in the Bar
("The jukebox starts playing Song 3." / "The jukebox goes quiet.") on both faces, and
raises the music notify (§6b) for the Den and the Den Interior.

**Who hears it.** Everybody standing in the Den (`undertown-8`) or the Den Interior
(`undertown-9`), in every room. `jukeboxAt(prisma, locationId)` answers `{ songKey,
startedAt, quietRoomIds }` there and null anywhere else. `quietRoomIds` are that
Location's soundproof rooms: with one of them open in Chat (the Exactor's Office) the song
is heard through the wall, darker and at 0.35 of its level.

**How it reaches a browser.** Two ways, the live one first. The feed's `music` frame
carries `jukebox` beside `performances` (`web/lib/feedHub.js`), so Chat hears a change
at once. Every other page reads `standing.jukebox` off the phase poll
(`web/lib/gamePhase.js`), a minute late at worst; this is why the jukebox, unlike an
instrument, is heard off Chat too. `performanceStore.js#useFramedJukebox` is the frame's
word, `undefined` while no stream is open, and closing the stream nudges the poll.

**How it sounds.** `InstrumentListener.js` plays it on `room`: looped, anchored, through
a 2.8 kHz lowpass (500 Hz behind a soundproof wall). As the top of the bus it ducks the
place's ambience to silence while it plays, and the bed comes back when it stops. An
instrument beats it: while anybody here is playing, `room` is not issued, and it comes
back at wherever its loop has got to when the last of them stops (a song running out on
its own is caught by a timer, since it raises no frame).

**Sound effects play over it**, because they are the other engine (§1). While a one-shot
cue is sounding (`sfx.js#onCuesSounding`) the jukebox drops to 0.15 of its level in
150 ms, and comes back over a second once the last cue has finished, after a 300 ms hold
so two cues close together do not make it pump. Drones and a phone's ring do not duck it:
they last minutes, and a jukebox held down for all of them would simply be off.

---

## 7. What each sound is FOR

**Before you wire a sound, read its use case.** 810 of the 816 files in
`assets/osw-sounds/` have one, and they are Bascinet's own sentences, hand-written,
one row per file, in two documents:

- `E:\Bascinet\V3\Sounds\Music and Sounds(OLD).docx` — the OpenSourceWeb library.
- `E:\Bascinet\V3\Sounds\New Music and Sounds.docx` — Bascinet's own picks (§6),
  and the placement rules for everything (§4b). Its rows are matched on the YouTube id
  in each filename, through `assets/osw-sounds/bascinet-sources.json`.

**Where both describe one file, the new document wins.** That happened twice:
`a-thousand-empty-rooms` (lobby music either way) and `surfacing`, which went from
"Ambience on the surface" to Count lobby music. The importer prints every such
replacement.

Those documents are the source of truth. `docs/sounds.yaml` is them projected into
the repo so that tooling can read it:

```
npm run sounds:import            # dry run: what it would write, and what it cannot place
npm run sounds:import -- --apply # write docs/sounds.yaml
npm run sounds:report            # what is wired where, and where that disagrees
npm run sounds:report -- --find "cave"
```

**The registry is generated.** `use`, `class`, `doc` and `served` are rewritten on
every import, so a correction belongs in the .docx and never in the YAML. `needs`
is the one field the repo owns and is carried across. Nothing syncs it to
Postgres — like `docs/assets/maps/nodes.yaml` it is a file that tooling reads,
not a table.

### The eight classes, which are the documents' own words

| Class | What it means |
|---|---|
| `ambience` | a longer track, seamlessly looped, **with silence still most of the background** |
| `atop` | a short sound played *over* ambience or silence, for a very specific circumstance |
| `cue` | a short, non-looping bite for when something happens |
| `lobby` | **a track is always playing, every player in the lobby hears the same one**, rotating roughly hourly |
| `instrument` | gated behind the instrument it belongs to |
| `unused` | not to be selected |
| `interrupt` | **cuts the ambience** — "Ambience interrupting sfx…" (the new document) |
| `jukebox` | a song for the Den's jukebox — "Den music…" (the new document) |

`atop` is the class that needed a new voice to exist at all. The top layer holding
a track is normally the one you hear, so "over" was not something the bus could
say — it is the `spot` layer plus §3's third rule now, and 12 of the 42 are wired.

### Names the documents use that the code does not have

`haruspex.ogg` is *"Lobby Music when there is a lateparty"* and
`holywarlobby.ogg` is *"Special round lobby music"*. Neither **lateparty** nor
**special round** exists anywhere in this repo, so both files sit in the registry
described and unwired. *"Sedated"* in `ambi2.ogg`'s use case has no tag of its own
either: the catalog has `pain-shock` and `unconscious`, and Heroin's Doped hears it as a
drug song (§4b).

The new document names many more, each recorded as the file's `needs` and left
unwired: the Count and its camp, limbo, an alien location, a Wonder, an ancient super
intelligence, the Dreamer, THEY, soulbreakers and their ship, a space station, an
alarm declared in the fortress, an OS13 gamemode, and becoming a revolutionary.
`npm run sounds:report`
groups them by what is missing.

### The checks

`db/test/sounds.test.js` holds the facts: every entry names a real file, every
`served` path resolves, every filename the app plays is described, and **nothing
the app plays is marked `unused`**. A served file with no master of its name in
the library is out of scope on purpose — `sfx/cathedral-bell.ogg` is from
BigSoundBank, not the library, and its `ATTRIBUTION.md` says so.

`npm run sounds:report` holds the judgement: whether a file is wired at the
surface its use case asks for. That one never fails a build.

---

## 8. Known, and left alone

- **Two tabs play two unsynchronised copies.** Muting propagates (the `storage`
  event), the audio does not. The fix is a `BroadcastChannel` leader election —
  about sixty lines and a whole class of stuck-silent bugs — and it is not worth
  paying for before anybody has complained.
- **A click during page load is lost.** The gesture listener is registered when
  the module evaluates, so a click before that arms nothing. The listeners stay
  registered until a gesture lands, so the next click works.
- **Ogg Vorbis is what the app serves**, which Safari does not play. That is true
  of all 90-odd existing cues too, not something the music introduced.
- **A hard reload can play the lobby to somebody with a character for up to a
  minute.** The root layout's streamed answer sometimes comes back with no session
  where the route handler's `auth()` sees one, so the client briefly believes the
  viewer has no character. The poll corrects it. This predates the place ambience —
  it was simply invisible while a living character heard nothing either way.
- **`prefers-reduced-motion` is not consulted.** It is about motion. The mute
  switch is the accessibility answer and it is one click from every page.
