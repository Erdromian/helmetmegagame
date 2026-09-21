# Music

What the `music` bus plays — the general rotation, the lobby, the closed door and
character creation (`web/app/components/music.js`,
`docs/systemdocs/SOUND.md`). The beds a PLACE has are next door in `../ambience/`;
`../sfx/` is the one-shot cues.

## All of it — CC BY-SA 3.0

Every file here comes out of
[OpenSourceWeb](https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb)
at commit `edb003dc8ff5009476a9bcb74e79206039fb3390`, licensed
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by way of
`assets/osw-sounds/` and `scripts/osw/export-sounds.py`.

**The two blanks in this file are filled.** `song_game.ogg` and
`white_waking.ogg` used to sit here with "provenance is not recorded yet" over
them, because both had arrived through a sound board rather than from the tree.
They are both in the tree — `sound/ambience/song_game.ogg` and
`sound/music/white_waking_1.ogg` — so they carry the same grant as everything
else, and `white_waking.ogg` is now cut from that master rather than being a
transcode of a transcode.

**These are not byte-for-byte copies**, which is the one way this file claims
less than `../sfx/ATTRIBUTION.md` does. Each is re-encoded by
`scripts/audio/build-assets.sh` to mono Ogg Vorbis at 32 kHz — see its header
for why. The masters are in `assets/osw-sounds/`, untouched.

| File | Length | Source path | What it is |
|---|---|---|---|
| `a-thousand-empty-rooms.ogg` | 6:20 | `sound/lfwbambimusic/a-thousand-empty-rooms.ogg` | rotation |
| `haruspex.ogg` | 7:22 | `sound/music/haruspex.ogg` | rotation |
| `surfacing.ogg` | 2:45 | `sound/lfwbambimusic/surfacing.ogg` | rotation |
| `graceperiod.ogg` | 5:38 | `sound/holywar/graceperiod.ogg` | rotation |
| `holywarlobby.ogg` | 4:16 | `sound/holywar/holywarlobby.ogg` | rotation |
| `the_collective.ogg` | 4:50 | `sound/music/the_collective.ogg` | rotation |
| `morning.ogg` | 3:36 | `sound/music/morning.ogg` | rotation |
| `newlobby31.ogg` | 3:17 | `sound/music/newlobby31.ogg` | rotation |
| `song_game.ogg` | 3:50 | `sound/ambience/song_game.ogg` | the lobby, and the rotation |
| `white_waking.ogg` | 6:41 | `sound/music/white_waking_1.ogg` | the once-an-hour wake-up under the closed door |
| `b12_combined_start.ogg` | 1:38 | `sound/music/b12_combined_start.ogg` | character creation |
| `wind_2_1.ogg` | 0:05 | `sound/effects/wind/wind_2_1.ogg` | the closed door, and outdoors |
| `wind_2_2.ogg` | 0:05 | `sound/effects/wind/wind_2_2.ogg` | (same) |
| `wind_3_1.ogg` | 0:05 | `sound/effects/wind/wind_3_1.ogg` | (same) |
| `wind_4_1.ogg` | 0:07 | `sound/effects/wind/wind_4_1.ogg` | (same) |
| `wind_4_2.ogg` | 0:06 | `sound/effects/wind/wind_4_2.ogg` | (same) |
| `wind_5_1.ogg` | 0:10 | `sound/effects/wind/wind_5_1.ogg` | (same) |
