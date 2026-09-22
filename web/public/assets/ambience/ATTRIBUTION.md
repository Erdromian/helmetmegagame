# Ambience

The bed a PLACE has, and the sparse sounds a place makes — picked by
`web/app/components/placeAmbience.js`, played on the `ambient` bus. Separate
from `../music/` because these are not music: nobody is meant to listen to them.

## All of it — CC BY-SA 3.0

Every file here comes out of
[OpenSourceWeb](https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb)
at commit `edb003dc8ff5009476a9bcb74e79206039fb3390`, licensed
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by way of
`assets/osw-sounds/` and `scripts/osw/export-sounds.py`.

**Not byte-for-byte copies.** Each is re-encoded by
`scripts/audio/build-assets.sh` to mono Ogg Vorbis at 32 kHz. `pathologic.ogg`
additionally carries a +8.7 dB lift, baked in because its master measures
-42.7 LUFS — quieter than the quietest tier `musicGain.js` has, and turning a
file up in the browser amplifies its own noise floor with it. The masters in
`assets/osw-sounds/` are untouched.

Where each one plays is decided by `docs/sounds.yaml` — Bascinet's own use case for
that file — and wired in `web/app/components/placeAmbience.js`. `track3.ogg`,
`track13.ogg`, `outpost.ogg` and `beyondretrieval.ogg` have moved to `../music/`:
the document calls all four Lobby Music.

| File | Length | Source path | Where it plays |
|---|---|---|---|
| `ambigen6.ogg` | 0:33 | `sound/ambience/ambigen6.ogg` | town and the underfort; indoors |
| `loop_altar.ogg` | 0:13 | `sound/machines/loop_altar.ogg` | the underfort; indoors |
| `loop_airy1.ogg` | 0:06 | `sound/ambience/loop_airy1.ogg` | the fortress; the Keep |
| `loop_airy4.ogg` | 0:19 | `sound/ambience/loop_airy4.ogg` | town, when the mood is low |
| `sacred_dagger.ogg` | 4:35 | `sound/music/sacred_dagger.ogg` | the Cathedral; the Order Chambers |
| `to_hell.ogg` | 4:18 | `sound/music/to_hell.ogg` | the Caves |
| `charon_loop.ogg` | 0:05 | `sound/misc/charon_loop.ogg` | off the map, by the Charon |
| `ambigen11.ogg` | 0:42 | `sound/ambience/ambigen11.ogg` | a spot over the Depths |
| `ambigen12.ogg` | 0:43 | `sound/ambience/ambigen12.ogg` | a spot over space |
| `ambimine.ogg` | 1:16 | `sound/ambience/ambimine.ogg` | space |
| `ambi2.ogg` | 0:30 | `sound/ambience/ambi2.ogg` | in pain shock, wherever you are |
| `spookymaint1.ogg` | 0:41 | `sound/ambience/spookymaint1.ogg` | the Caves; the Depths |
| `spookyspace1.ogg` | 1:40 | `sound/ambience/spookyspace1.ogg` | the Caves |
| `spookyspace2.ogg` | 1:41 | `sound/ambience/spookyspace2.ogg` | the Depths |
| `ambispace.ogg` | 3:15 | `sound/ambience/ambispace.ogg` | Space |
| `ambieng1.ogg` | 0:38 | `sound/ambience/ambieng1.ogg` | the Godard Factory |
| `shore.ogg` | 0:30 | `sound/ambience/shore.ogg` | the Lake |
| `newfireloop.ogg` | 0:03 | `sound/effects/newfireloop.ogg` | the Keep; the Inn |
| `pathologic.ogg` | 2:45 | `sound/music/pathologic.ogg` | the Sanctuary |
| `train_loop.ogg` | 0:21 | `sound/lfwbsounds/train_loop.ogg` | the Depot, while the train is in |
| `ambicha1.ogg` | 0:22 | `sound/ambience/ambicha1.ogg` | a spot over the Cathedral and the Order Chambers |
| `ambicha2.ogg` | 0:10 | `sound/ambience/ambicha2.ogg` | (same) |
| `ambicha3.ogg` | 0:11 | `sound/ambience/ambicha3.ogg` | (same) |
| `ambicha4.ogg` | 0:17 | `sound/ambience/ambicha4.ogg` | (same) |
| `lifeweb2b.ogg` | 0:05 | `sound/ambience/lifeweb2b.ogg` | the Lifeweb |
