# Instruments

What a lute, an accordion and a boombox can play — the `player`/`room` layers
of the music bus (`web/app/components/music.js`,
`docs/systemdocs/SOUND.md` §3). `db/lib/instrumentSongs.js` names these to a
player; `../music/` is the general rotation and `../ambience/` is what a PLACE
sounds like.

## All of it — CC BY-SA 3.0

Every file here comes out of
[OpenSourceWeb](https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb)
at commit `edb003dc8ff5009476a9bcb74e79206039fb3390`, licensed
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by way of
`assets/osw-sounds/instruments/` (kept outside the export script's usual
groups — see its header — because these files are for a specific mechanic
rather than for the general library). The same grant already covers
`../music/`, `../ambience/`, `../sfx/`, `../items/`, `../helms/` and
`../chrome/` — see those folders' ATTRIBUTION.md files. **The repository's
CODE is GPLv3/AGPLv3 and none of it is used here.** Only the audio is taken,
under the separate CC BY-SA grant its README gives.

**These are not byte-for-byte copies**, the same as `../music/` and
`../ambience/`. Each is re-encoded by `scripts/audio/build-assets.sh` to mono
Ogg Vorbis at 32 kHz — see its header for why. The masters are in
`assets/osw-sounds/instruments/`, untouched, with one exception: `clouds.ogg`
started life as `clouds.s3m`, a Scream Tracker module rather than playable
audio, and was rendered to Ogg once with `openmpt123` (`libopenmpt`) before
`build-assets.sh` ever saw it. Both the `.s3m` and the rendered `.ogg` sit
in the master folder for that one file.

`song_game.ogg` is not copied a second time — it is already served at
`web/public/assets/music/song_game.ogg` for the lobby tape, and the boombox
catalog just points at it. See `../music/ATTRIBUTION.md` for its provenance.

| File | Length | Source path | Instrument |
|---|---|---|---|
| `b1.ogg` | 1:37 | `sound/music/instruments/b1.ogg` | accordion |
| `b2.ogg` | 0:50 | `sound/music/instruments/b2.ogg` | accordion |
| `b3.ogg` | 2:13 | `sound/music/instruments/b3.ogg` | accordion |
| `b4.ogg` | 2:22 | `sound/music/instruments/b4.ogg` | accordion |
| `b5.ogg` | 1:53 | `sound/music/instruments/b5.ogg` | accordion |
| `b6.ogg` | 0:17 | `sound/music/instruments/b6.ogg` | accordion |
| `b7.ogg` | 1:33 | `sound/music/instruments/b7.ogg` | accordion |
| `b8.ogg` | 0:42 | `sound/music/instruments/b8.ogg` | accordion |
| `balalaika1.ogg` | 1:30 | `sound/music/instruments/balalaika1.ogg` | lute |
| `bard1.ogg` | 0:38 | `sound/music/instruments/bard1.ogg` | lute |
| `bard2.ogg` | 0:40 | `sound/music/instruments/bard2.ogg` | lute |
| `bard3.ogg` | 0:36 | `sound/music/instruments/bard3.ogg` | lute |
| `bard4.ogg` | 0:25 | `sound/music/instruments/bard4.ogg` | lute |
| `bard5.ogg` | 1:45 | `sound/music/instruments/bard5.ogg` | lute |
| `newbar3.ogg` | 2:45 | `sound/turntable/newbar3.ogg` | boombox |
| `newbar46.ogg` | 3:07 | `sound/turntable/newbar46.ogg` | boombox |
| `newbar59.ogg` | 3:00 | `sound/turntable/newbar59.ogg` | boombox |
| `newbar9.ogg` | 4:02 | `sound/turntable/newbar9.ogg` | boombox |
| `ainda-e-cedo.ogg` | 3:57 | `sound/turntablebr/ainda-e-cedo.ogg` | boombox |
| `boate-azul.ogg` | 3:20 | `sound/turntablebr/boate-azul.ogg` | boombox |
| `como-eu-quero.ogg` | 4:12 | `sound/turntablebr/como-eu-quero.ogg` | boombox |
| `cowboy-fora-da-lei.ogg` | 3:34 | `sound/turntablebr/cowboy-fora-da-lei.ogg` | boombox |
| `fixacao.ogg` | 6:21 | `sound/turntablebr/fixacao.ogg` | boombox |
| `metamorfose-ambulante.ogg` | 3:47 | `sound/turntablebr/metamorfose-ambulante.ogg` | boombox |
| `solidao-de-volta.ogg` | 2:42 | `sound/turntablebr/solidao-de-volta.ogg` | boombox |
| `boombox10.ogg` | 3:13 | `sound/music/boombox10.ogg` | boombox |
| `boombox3.ogg` | 2:07 | `sound/music/boombox3.ogg` | boombox |
| `boombox4.ogg` | 3:22 | `sound/music/boombox4.ogg` | boombox |
| `boombox8.ogg` | 3:20 | `sound/music/boombox8.ogg` | boombox |
| `space_asshole.ogg` | 4:16 | `sound/music/space_asshole.ogg` | boombox |
| `space_oddity.ogg` | 5:18 | `sound/music/space_oddity.ogg` | boombox |
| `title1.ogg` | 2:30 | `sound/music/title1.ogg` | boombox |
| `csrio.ogg` | 2:46 | `sound/music/csrio.ogg` | boombox |
| `clown.ogg` | 1:47 | `sound/music/clown.ogg` | boombox |
| `fuckup.ogg` | 5:35 | `sound/music/fuckup.ogg` | boombox |
| `indihome.ogg` | 0:30 | `sound/music/indihome.ogg` | boombox |
| `clouds.ogg` | 2:56 | `sound/music/clouds.s3m` (rendered) | boombox |
| `song_game.ogg` | — | see `../music/ATTRIBUTION.md` (reused, not copied) | boombox |
