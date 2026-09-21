#!/usr/bin/env bash
# Copy the chosen sounds out of assets/osw-sounds/ into web/public/assets/, re-encoding
# as it goes. See docs/systemdocs/SOUND.md §6.
#
# The library is byte-for-byte masters; what the app SERVES is not. These play at
# -34 to -26 LUFS, under everything else, and a 6 MB stereo master of a seven-minute
# ambient piece is six megabytes spent on detail nobody in that mix can hear. Mono at
# 32 kHz keeps everything up to 16 kHz and costs about 36 kbps, which is a third of
# the size and the same sound in this bed.
#
# Needs ffmpeg, which is a DEV tool — nothing in the repo builds or runs against it,
# and the committed outputs are what matters. Safe to re-run; it overwrites.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/assets/osw-sounds"
OUT="$ROOT/web/public/assets"

command -v ffmpeg >/dev/null || { echo "no ffmpeg — apt-get install ffmpeg" >&2; exit 1; }

# The general music rotation: the ambient bus's big brother, one track at a time with
# minutes of nothing between them.
# white_waking_1 is served as white_waking.ogg and song_game/b12 keep their names —
# musicProgram.js's three phase tapes name those files.
MUSIC="
music/white_waking_1.ogg:white_waking.ogg
music/song_game.ogg
music/b12_combined_start.ogg
music/a-thousand-empty-rooms.ogg
music/haruspex.ogg
music/surfacing.ogg
music/graceperiod.ogg
music/holywarlobby.ogg
music/the_collective.ogg
music/morning.ogg
music/newlobby31.ogg
"

# A lute, an accordion, a boombox — the `player`/`room` layers (SOUND.md §3).
# db/lib/instrumentSongs.js is what names these to a player; keep the two lists
# in step. clouds.ogg is the one master that isn't a straight rip: the source
# ships it as a tracker module (clouds.s3m), rendered once to Ogg with
# openmpt123 before this script ever sees it — see assets/osw-sounds/instruments/
# boombox/ for the .s3m master kept alongside.
INSTRUMENTS="
instruments/accordion/b1.ogg
instruments/accordion/b2.ogg
instruments/accordion/b3.ogg
instruments/accordion/b4.ogg
instruments/accordion/b5.ogg
instruments/accordion/b6.ogg
instruments/accordion/b7.ogg
instruments/accordion/b8.ogg
instruments/lute/balalaika1.ogg
instruments/lute/bard1.ogg
instruments/lute/bard2.ogg
instruments/lute/bard3.ogg
instruments/lute/bard4.ogg
instruments/lute/bard5.ogg
instruments/boombox/newbar3.ogg
instruments/boombox/newbar46.ogg
instruments/boombox/newbar59.ogg
instruments/boombox/newbar9.ogg
instruments/boombox/ainda-e-cedo.ogg
instruments/boombox/boate-azul.ogg
instruments/boombox/como-eu-quero.ogg
instruments/boombox/cowboy-fora-da-lei.ogg
instruments/boombox/fixacao.ogg
instruments/boombox/metamorfose-ambulante.ogg
instruments/boombox/solidao-de-volta.ogg
instruments/boombox/boombox10.ogg
instruments/boombox/boombox3.ogg
instruments/boombox/boombox4.ogg
instruments/boombox/boombox8.ogg
instruments/boombox/space_asshole.ogg
instruments/boombox/space_oddity.ogg
instruments/boombox/title1.ogg
instruments/boombox/csrio.ogg
instruments/boombox/clown.ogg
instruments/boombox/fuckup.ogg
instruments/boombox/indihome.ogg
instruments/boombox/clouds.ogg
"

# Beds and spots. Anything a PLACE sounds like rather than anything the game is
# feeling — see web/app/components/placeAmbience.js for which goes where.
AMBIENCE="
music/track3.ogg
music/track13.ogg
music/outpost.ogg
music/beyondretrieval.ogg
music/pathologic.ogg:pathologic.ogg:+8.7dB
ambience/ambigen11.ogg
ambience/ambigen12.ogg
ambience/ambimine.ogg
ambience/ambi2.ogg
ambience/ambieng1.ogg
ambience/spookymaint1.ogg
ambience/spookyspace1.ogg
ambience/spookyspace2.ogg
ambience/ambispace.ogg
ambience/shore.ogg
ambience/newfireloop.ogg
ambience/ambicha1.ogg
ambience/ambicha2.ogg
ambience/ambicha3.ogg
ambience/ambicha4.ogg
ambience/lifeweb2b.ogg
ambience/train_loop.ogg
"

# "path/in/library.ogg", or "path:served-name.ogg", or "path:served-name.ogg:+8dB".
#
# The dB field is for a master that is quieter than the QUIETEST tier in musicGain.js —
# pathologic measures -42.7 LUFS, and a bed tier of -34 would need a gain above 1 to
# reach it. Turning a file up in the browser amplifies its own noise floor with it, so
# the lift happens once, here, against the master.
encode() {
  local spec="$1" dest="$2"
  local rel="${spec%%:*}" rest="${spec#*:}" name boost=""
  if [ "$rest" = "$spec" ]; then
    name="$(basename "$rel")"
  else
    name="${rest%%:*}"
    [ "${rest#*:}" != "$rest" ] && boost="${rest#*:}"
  fi
  local filter=()
  [ -n "$boost" ] && filter=(-af "volume=$boost")
  ffmpeg -v error -y -i "$SRC/$rel" "${filter[@]+"${filter[@]}"}" -ac 1 -ar 32000 -c:a libvorbis -q:a 0 \
    "$dest/$name"
  printf '  %-34s %6s KB\n' "$name" "$(( $(wc -c < "$dest/$name") / 1024 ))"
}

mkdir -p "$OUT/music" "$OUT/ambience" \
  "$OUT/instruments/accordion" "$OUT/instruments/lute" "$OUT/instruments/boombox"
echo "music/"
for f in $MUSIC; do encode "$f" "$OUT/music"; done
echo "instruments/"
for f in $INSTRUMENTS; do encode "$f" "$OUT/$(dirname "$f")"; done
echo "ambience/"
for f in $AMBIENCE; do encode "$f" "$OUT/ambience"; done

echo
echo "music/       $(du -sh "$OUT/music" | cut -f1)"
echo "instruments/ $(du -sh "$OUT/instruments" | cut -f1)"
echo "ambience/    $(du -sh "$OUT/ambience" | cut -f1)"
