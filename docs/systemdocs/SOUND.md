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

Five layers. The **highest one holding a track is the one you hear**.

```
ambient   what the PLACE sounds like — wind outside, a drone in the Depths, the
          Cathedral's organ room (§4b)
music     the game's music, now and then once you have settled in (§4a)
event     a siren, an alarm, a thing arriving. Loud and brief
room      a jukebox, a gramophone: something switched on in the room
player    somebody playing an instrument — one voice per performance (§6b)
```

Player beats room because a person playing an instrument in front of you is
nearer than furniture in the corner, and because it is something somebody is
*doing*.

A layer under the top one does **not stop** — it ducks to silence, so when the
thing above it ends it is still where you left it. Takeover is a 1.2-second
crossfade.

`LAYER_MODE` is the one concession to bandwidth: `ambient` and `event` are
`"continue"` (a wind loop restarted at 0:00 under a jukebox is audible, and a
siren that pauses and resumes is a siren twice), everything else is `"pause"` (a
4 MB song should not stream through ten silent minutes of somebody's data plan).

### The two rules on top, and they are both about what a person is doing

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

Both live in one table rather than in branches, so a sixth bus is a line:

```js
const PERFORMANCE = new Set(["room", "player"]);
const COEXIST = { event: { under: PERFORMANCE, duck: 0.35, hz: 700 } };
```

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

**Only `ambient` and `music` have callers today.** `room`, `player` and `event`
are reachable by `playOn("room", …)` and wired into the rules above, waiting for
the jukeboxes, the instruments and the sirens.

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

| state | character? | program |
|---|---|---|
| any `/gm/` path | either | silence |
| `CLOSED` | either | wind beds for about a minute, then, **at most once an hour per browser profile**, `white_waking` fading in over 3 s and out over 4, then the wind again, forever |
| `LOBBY` | no | `song_game`, a 5-second tail, 15 seconds of nothing, again |
| `RUNNING`/`ENDED` | no | `b12_combined_start` from 0:00, then 10 s, then repeatedly from **0:18** fading in over a second — the intro is odd, so only the first pass hears it |
| anything but `CLOSED` | **yes** | no phase tape — the conductor takes over (§4a) |

Read it top to bottom; that is the order the code asks in.

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
| `startAt` | seeds `currentTime`. This is the 0:18 |
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

A piece is an ambient file for where you are standing (§4b) or one of the game's
music tracks (`MUSIC_TRACKS`). Ambient is the default; music is what comes once
you have settled in.

- **Nothing on the timeline cuts anything off.** Ambient and music never overlap,
  so neither ever ducks or replaces the other. A piece plays to its end. The
  only interruption is a performance — a jukebox or somebody playing — and §3's
  rules handle that: music pauses under it and resumes after.
- **About 75% of in-game time is silence.** After a piece that lasted *d*, the
  gap is *d* × 3, ±30%, never under 2 minutes (`SILENCE_SHARE`, `MIN_GAP_MS`).
  Scaling the gap to the piece is what keeps the ratio whatever came up.
- **Music is the flow.** Never in the first 8 minutes on the page
  (`FLOW_AFTER_MS`), then a 35% chance per piece (`MUSIC_CHANCE`), never two in a
  row, and never in a `music: false` place.
- **Ambient plays at 85%** of its measured level (`AMBIENT_GAIN`), so a song
  stands out when it arrives.
- **Walking somewhere new queues rather than cuts.** It changes what "here"
  means, and the next piece is picked from the new place. The one exception is
  music playing as you walk into a `music: false` place: it fades out over 10
  seconds.
- **It lives at module scope**, so a soft navigation never restarts it.
  `MusicDirector.js` calls `start()` / `stop()` when in-game play begins and
  ends, and `setPlace()` when where you are standing changes.
- A piece that never reports its end — a file that failed to load — is let go
  after 30 minutes, far past the longest file.

`node scripts/audio/sim-schedule.mjs` runs the rules against a fake clock for six
hours and fails if the silence share drifts or music breaks the flow rule. Set
`localStorage["bascinet:musicdebug"] = 1` to watch the timeline in the console.

---

## 4b. What a PLACE sounds like

`web/app/components/placeAmbience.js` answers **what** would play here: a pool
of pieces per place. The conductor (§4a) decides **when**.

**A piece is one of two things, and the difference is whether the file has an
end.**

- A file with an **end** — `once()` — plays start to finish and is never cut
  off. The Cathedral's organ room, a drip in the Lifeweb, a six-minute drone.
- A **texture** — `loop()` — has no end of its own: a three-second fire, a wind
  gust, an idling engine. It loops for a span (60–150 s unless the place says
  otherwise) and then fades out over 6 seconds. That fade is the end it was
  always going to have.

A pool never plays the same piece twice running when it has a choice.

### Resolution, and the one thing it cannot ask

Most specific wins: **Location slug → attribute → Zone slug → `indoors`**. The
attribute list is ordered rather than an object, because a place can carry
several and the order is the answer.

**There is no room.** `Character` has `locationId` and `zoneId` and no room
column — which room you *hear* is the room you are *reading*, and that is
`/chat`'s business, not the database's. So this resolves at Location level and
above. A per-room sound needs a client overlay off `chat/openPlace.js`, and it
belongs with the jukebox pass.

Every entry in the table is built once at module load, so two neighbouring
caves resolve to the very same object.

### Some places get no music, on purpose

`music: false` says the game's music does not play here at all — the
**Caves**, the **Depths**, the **Lifeweb** and **Space**. Their whole feel is
that nothing is keeping you company down there, and a tune arriving every few
minutes says the opposite. Each is one boolean to reverse.

The **Depot** is the one place whose bed is conditional: `train_loop` plays only
while the train is actually standing at the platform, which is
`db/lib/train.js#trainHere` and the first hour of the turn
(`web/lib/gamePhase.js`). It has to stop, or "the train is in" stops meaning
anything and becomes the Depot's permanent room tone. Rails empty, it is an
ordinary cellar.

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
shipping to a browser. `useStanding()` is the hook.

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

To add a file: drop it in, run `measure.sh`, paste its line into `musicGain.js`.
A file missing from the table plays at its step gain alone — the fallback is 1
rather than something cleverer precisely so an unmeasured file is obviously
wrong instead of quietly almost-right.

## 6b. Performances

A player with an instrument in hand plays a real song, and everybody standing
in the same Location hears it in their browser.

**The instruments.** Lute, Accordion and Boombox (`docs/tags.yaml`). Each is
`instrument: true`, and the code reads that flag, never a list of slugs. They
go in the WEAPON slot and take one hand. The Instrument Kit is what a Minstrel
starts with, and anyone can buy one at creation for 1 point: Consume it and
the player picks one of its `consumeChoice` list
(`web/app/components/actions/ConsumeChoiceDialog.js`). That is the one
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
| An attack, both sides | `db/lib/attack.js#fileAttack` |
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
- **A hard reload can play the creation tape for up to a minute.** The root
  layout's streamed answer sometimes comes back with no session where the route
  handler's `auth()` sees one, so the client briefly believes the viewer has no
  character. The poll corrects it. This predates the place ambience — it was
  simply invisible while a living character heard nothing either way.
- **`prefers-reduced-motion` is not consulted.** It is about motion. The mute
  switch is the accessibility answer and it is one click from every page.
