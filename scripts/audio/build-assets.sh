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
  ffmpeg -v error -y -i "$SRC/$rel" "${filter[@]}" -ac 1 -ar 32000 -c:a libvorbis -q:a 0 \
    "$dest/$name"
  printf '  %-34s %6s KB\n' "$name" "$(( $(stat -c%s "$dest/$name") / 1024 ))"
}

mkdir -p "$OUT/music" "$OUT/ambience"
echo "music/"
for f in $MUSIC; do encode "$f" "$OUT/music"; done
echo "ambience/"
for f in $AMBIENCE; do encode "$f" "$OUT/ambience"; done

echo
echo "music/    $(du -sh "$OUT/music" | cut -f1)"
echo "ambience/ $(du -sh "$OUT/ambience" | cut -f1)"
