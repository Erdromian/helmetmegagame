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

| File | Length | Source path | Where it plays |
|---|---|---|---|
| `track3.ogg` | 7:44 | `sound/music/track3.ogg` | indoors, the default |
| `track13.ogg` | 7:20 | `sound/music/track13.ogg` | (same) |
| `outpost.ogg` | 6:34 | `sound/music/outpost.ogg` | (same) |
| `ambigen11.ogg` | 0:42 | `sound/ambience/ambigen11.ogg` | indoors; the Depths |
| `ambigen12.ogg` | 0:43 | `sound/ambience/ambigen12.ogg` | (same) |
| `ambimine.ogg` | 1:16 | `sound/ambience/ambimine.ogg` | the Black Hills |
| `ambi2.ogg` | 0:30 | `sound/ambience/ambi2.ogg` | the Black Hills; the Caves |
| `spookymaint1.ogg` | 0:41 | `sound/ambience/spookymaint1.ogg` | the Caves |
| `spookyspace1.ogg` | 1:40 | `sound/ambience/spookyspace1.ogg` | (same) |
| `beyondretrieval.ogg` | 8:33 | `sound/music/beyondretrieval.ogg` | (same) |
| `spookyspace2.ogg` | 1:41 | `sound/ambience/spookyspace2.ogg` | the Depths |
| `ambispace.ogg` | 3:15 | `sound/ambience/ambispace.ogg` | Space |
| `ambieng1.ogg` | 0:38 | `sound/ambience/ambieng1.ogg` | the Godard Factory |
| `shore.ogg` | 0:30 | `sound/ambience/shore.ogg` | the Lake |
| `newfireloop.ogg` | 0:03 | `sound/effects/newfireloop.ogg` | the Keep; the Inn |
| `pathologic.ogg` | 2:45 | `sound/music/pathologic.ogg` | the Sanctuary |
| `train_loop.ogg` | 0:21 | `sound/lfwbsounds/train_loop.ogg` | the Depot, while the train is in |
| `ambicha1.ogg` | 0:22 | `sound/ambience/ambicha1.ogg` | the Cathedral; the Order Chambers |
| `ambicha2.ogg` | 0:10 | `sound/ambience/ambicha2.ogg` | (same) |
| `ambicha3.ogg` | 0:11 | `sound/ambience/ambicha3.ogg` | (same) |
| `ambicha4.ogg` | 0:17 | `sound/ambience/ambicha4.ogg` | (same) |
| `lifeweb2b.ogg` | 0:05 | `sound/ambience/lifeweb2b.ogg` | the Lifeweb |
