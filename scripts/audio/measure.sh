#!/usr/bin/env bash
# What every served sound actually measures, and the gain that would put it on its tier.
#
# Reads web/public/assets/{music,ambience,sfx}/ and prints one line per file:
#
#   name    LUFS   peak dBTP   duration   gain-for(-34 -30 -26 -22)
#
# LUFS is EBU R128 integrated loudness (ffmpeg's ebur128 filter), which is the same
# quantity sfx.js's header describes and a better measurement of it. The four gain
# columns are the tiers in web/app/components/musicGain.js — read the one for the job
# the file is doing and paste it in there.
#
# Duration is here because every holdMs and silenceMs in placeAmbience.js has to be
# tuned against a real length. Peak is here because a bed that clips at gain 1 has to be
# caught before it ships, not after.
#
# ffmpeg is a DEV tool — `apt-get install ffmpeg`. Nothing in the repo builds against it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v ffmpeg >/dev/null || { echo "no ffmpeg — apt-get install ffmpeg" >&2; exit 1; }

printf '%-32s %8s %8s %8s   %7s %7s %7s %7s\n' \
  FILE LUFS dBTP SECS -34 -30 -26 -22

for dir in "$@"; do
  [ -d "$dir" ] || continue
  echo "--- ${dir#"$ROOT"/}"
  for f in "$dir"/*.ogg "$dir"/*.wav; do
    [ -e "$f" ] || continue
    out="$(ffmpeg -nostats -i "$f" -af ebur128=peak=true -f null - 2>&1 | tail -20)"
    lufs="$(printf '%s' "$out" | grep -o 'I: *-\?[0-9.]*' | tail -1 | tr -d 'I: ')"
    peak="$(printf '%s' "$out" | grep -o 'Peak: *-\?[0-9.]*' | tail -1 | sed 's/Peak: *//')"
    secs="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)"
    [ -n "$lufs" ] || continue
    awk -v n="$(basename "$f")" -v l="$lufs" -v p="${peak:-0}" -v s="${secs:-0}" 'BEGIN{
      printf "%-32s %8.1f %8.1f %8d  ", n, l, p, s
      split("-34 -30 -26 -22", t, " ")
      for (i = 1; i <= 4; i++) {
        g = 10 ^ ((t[i] - l) / 20)
        if (g > 1) g = 1
        printf " %7.3f", g
      }
      printf "\n"
    }'
  done
done
