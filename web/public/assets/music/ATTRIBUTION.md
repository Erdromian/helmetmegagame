# Music

What the `music` bus plays — the general rotation, the lobby, the closed door and
character creation (`web/app/components/music.js`,
`docs/systemdocs/SOUND.md`). The beds a PLACE has are next door in `../ambience/`;
`../sfx/` is the one-shot cues.

## The OpenSourceWeb files — CC BY-SA 3.0

Every file in the first table comes out of
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
for why. `outpost.ogg` additionally carries a **+4.8 dB** lift, baked in because
its master measures −30.8 LUFS — quieter than the −26 LUFS tier it plays at, and
turning a file up in the browser amplifies its own noise floor with it. The same
reasoning as `../ambience/pathologic.ogg`. The masters in `assets/osw-sounds/` are
untouched.

What each one is comes from `docs/sounds.yaml` — Bascinet's own use case for that
file. **There is no general music rotation any more**: in-game, music is the
ambience of a particular place (`../ambience/`, and the three long tracks below),
and the only place a track simply plays is the lobby.

| File | Length | Source path | What it is |
|---|---|---|---|
| `newlobby31.ogg` | 3:17 | `sound/music/newlobby31.ogg` | the lobby's hourly rotation |
| `outpost.ogg` | 6:34 | `sound/music/outpost.ogg` | (same) — carries a +4.8 dB lift, see below |
| `track3.ogg` | 7:44 | `sound/music/track3.ogg` | (same) |
| `track13.ogg` | 7:20 | `sound/music/track13.ogg` | (same) |
| `beyondretrieval.ogg` | 8:33 | `sound/music/beyondretrieval.ogg` | (same) |
| `white_waking.ogg` | 6:41 | `sound/music/white_waking_1.ogg` | the lobby's rare slot, and the wake-up under the closed door |
| `haruspex.ogg` | 7:22 | `sound/music/haruspex.ogg` | lobby music "when there is a lateparty" — not wired |
| `holywarlobby.ogg` | 4:16 | `sound/holywar/holywarlobby.ogg` | "special round lobby music" — not wired |
| `song_game.ogg` | 3:50 | `sound/ambience/song_game.ogg` | the Inn's ambience |
| `the_collective.ogg` | 4:50 | `sound/music/the_collective.ogg` | THEY's ambience — not wired |
| `graceperiod.ogg` | 5:38 | `sound/holywar/graceperiod.ogg` | **Unused.** Not rebuilt; nothing plays it |
| `morning.ogg` | 3:36 | `sound/music/morning.ogg` | **Unused.** (same) |
| `b12_combined_start.ogg` | 1:38 | `sound/music/b12_combined_start.ogg` | **Unused.** (same) |
| `wind_2_1.ogg` | 0:05 | `sound/effects/wind/wind_2_1.ogg` | the closed door, and outdoors |
| `wind_2_2.ogg` | 0:05 | `sound/effects/wind/wind_2_2.ogg` | (same) |
| `wind_3_1.ogg` | 0:05 | `sound/effects/wind/wind_3_1.ogg` | (same) |
| `wind_4_1.ogg` | 0:07 | `sound/effects/wind/wind_4_1.ogg` | (same) |
| `wind_4_2.ogg` | 0:06 | `sound/effects/wind/wind_4_2.ogg` | (same) |
| `wind_5_1.ogg` | 0:10 | `sound/effects/wind/wind_5_1.ogg` | (same) |

## Bascinet's own picks — not CC BY-SA

These are tracks Bascinet chose and described in "New Music and Sounds.docx", not
OpenSourceWeb files. **No license is claimed for them here.** Each is a published
recording by the artist named, taken from the YouTube upload whose id is given; the
grant above does not cover them. Their library copies are in `assets/osw-sounds/`,
listed with the same ids in `bascinet-sources.json`, and are served here re-encoded
by `scripts/audio/build-assets.sh` like everything else.

| File | Length | Artist — title | YouTube id | Where it plays |
|---|---|---|---|---|
| `a-thousand-empty-rooms.ogg` | 6:20 | Atrium Carceri, Cities Last Broadcast, God Body Disconnect — A Thousand Empty Rooms | `5jfU1HN2pSQ` | the lobby's hourly rotation |
| `red-calx.ogg` | 8:57 | Aphex Twin — Red Calx (medium pitch) | `Oktc1HXsvKI` | (same) |
| `conflict-and-climax.ogg` | 2:39 | Conflict & Climax | `M-uV_YKgb30` | (same) |
| `friction.ogg` | 5:08 | Friction | `8tFuur4Jk8M` | (same) |
| `manunkind.ogg` | 1:23 | Manunkind | `8pE2a-z5r0k` | (same) |
| `stone-in-focus.ogg` | 11:03 | Stone In Focus | `JRL1fqhDV1I` | (same) |
