# Music and ambience

Everything the music bus plays (`web/app/components/music.js`,
`docs/systemdocs/SOUND.md`). Separate from `../sfx/`, which is a flat library of
one-shot cues and whose own ATTRIBUTION.md makes a narrower claim than this file
can — every file there is a byte-for-byte copy out of `assets/osw-sounds/`, and
two of the files below are not.

## The wind beds and the creation track — CC BY-SA 3.0

Copied byte for byte out of the OpenSourceWeb tree, the wind beds by way of
`assets/osw-sounds/ambience/`, which
`scripts/osw/export-sounds.py` took from
[OpenSourceWeb](https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb)
at commit `edb003dc8ff5009476a9bcb74e79206039fb3390`, licensed
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Their path in
that tree is below. `b12_combined_start.ogg` (1:38, the character-creation loop)
came from the same commit and the same grant.

| File | Source path |
|---|---|
| `b12_combined_start.ogg` | `sound/music/b12_combined_start.ogg` |
| `wind_2_1.ogg` | `sound/effects/wind/wind_2_1.ogg` |
| `wind_2_2.ogg` | `sound/effects/wind/wind_2_2.ogg` |
| `wind_3_1.ogg` | `sound/effects/wind/wind_3_1.ogg` |
| `wind_4_1.ogg` | `sound/effects/wind/wind_4_1.ogg` |
| `wind_4_2.ogg` | `sound/effects/wind/wind_4_2.ogg` |
| `wind_5_1.ogg` | `sound/effects/wind/wind_5_1.ogg` |

## The two tracks

| File | Length | What it is |
|---|---|---|
| `song_game.ogg` | 3:51 | The lobby. Ogg Vorbis, mono, as supplied — nothing re-encoded. |
| `white_waking.ogg` | 6:42 | The once-per-visit wake-up under the closed door. Supplied as 80 kbps Opus in WebM and transcoded here to Ogg Vorbis (`-q:a 2`) so it matches every other file the app serves; the source is already lossy, so this is a second generation. |

**Provenance is not recorded here yet.** Both arrived through a sound board
rather than from the OpenSourceWeb tree, and neither carries the CC BY-SA grant
above. Write down where each came from and under what licence before v3 opens —
a blank here is a claim nobody can check, which is the thing the sfx file's own
guarantee exists to avoid.
