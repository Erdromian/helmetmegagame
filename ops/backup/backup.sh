#!/bin/sh
# One backup: dump the database, prove the dump is readable, upload it, then
# drop the oldest ones. Railway runs this on a cron schedule; it exits when
# done, which is what a Railway cron service expects.
#
# A failure here must be loud. A backup system that quietly writes nothing is
# worse than none at all, because it buys confidence it hasn't earned — so
# every step is checked and any one of them failing exits non-zero.
set -eu

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${S3_BUCKET:?S3_BUCKET is not set}"
: "${S3_ENDPOINT:?S3_ENDPOINT is not set}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is not set}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is not set}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

KEEP="${KEEP_DUMPS:-30}"
PREFIX="${S3_PREFIX:-dumps}"
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
name="bascinet-${stamp}.dump"
tmp="/tmp/${name}"
s3="aws --endpoint-url ${S3_ENDPOINT} s3"

log() { echo "backup: $*"; }

log "dumping to ${tmp}"
# Custom format, so pg_restore can do a selective or parallel restore later.
# --no-owner/--no-privileges keep the dump loadable into a database whose roles
# differ from production's, which is the whole point of a rehearsal restore.
pg_dump --format=custom --compress=zstd --no-owner --no-privileges \
        --file="$tmp" "$DATABASE_URL"

# Read the dump's table of contents back. This is the cheap version of a
# restore test: it parses the archive header and every entry, so a truncated or
# half-written file fails here instead of on the night we actually need it.
log "verifying"
entries=$(pg_restore --list "$tmp" | grep -c '^[0-9]') || entries=0
[ "$entries" -gt 0 ] || { echo "backup: dump has no restorable entries, refusing to upload" >&2; exit 1; }
size=$(wc -c < "$tmp")
log "ok — ${entries} entries, ${size} bytes"

log "uploading s3://${S3_BUCKET}/${PREFIX}/${name}"
$s3 cp "$tmp" "s3://${S3_BUCKET}/${PREFIX}/${name}"
rm -f "$tmp"

# Prune oldest. The names sort lexicographically by timestamp because the stamp
# is ISO-8601 UTC with a fixed width, so plain `sort` is chronological.
log "pruning to the newest ${KEEP}"
all=$($s3 ls "s3://${S3_BUCKET}/${PREFIX}/" | awk '{print $4}' | grep '\.dump$' | sort)
total=$(echo "$all" | grep -c . || true)
if [ "$total" -gt "$KEEP" ]; then
  echo "$all" | head -n "$(( total - KEEP ))" | while read -r old; do
    [ -n "$old" ] || continue
    log "  removing ${old}"
    $s3 rm "s3://${S3_BUCKET}/${PREFIX}/${old}"
  done
fi

log "done — ${total} dump(s) held"
