#!/bin/sh
# The other half. A backup nobody has restored is a rumour, so this ships in
# the same image as backup.sh — same pg_restore version, same credentials, same
# network — and is meant to be run as a one-off command on the backup service.
#
#   restore.sh --list                     what is in the bucket
#   restore.sh <dump-name>                load it into DATABASE_URL
#   restore.sh <dump-name> <target-url>   ...or somewhere else
#
# Restoring over a live database is refused unless FORCE_PROD=1, because the
# recovery is the moment you are most likely to be tired and pasting fast.
set -eu

: "${S3_BUCKET:?S3_BUCKET is not set}"
: "${S3_ENDPOINT:?S3_ENDPOINT is not set}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
PREFIX="${S3_PREFIX:-dumps}"
s3="aws --endpoint-url ${S3_ENDPOINT} s3"

if [ "${1:-}" = "--list" ] || [ $# -eq 0 ]; then
  $s3 ls "s3://${S3_BUCKET}/${PREFIX}/" | sort
  exit 0
fi

name="$1"
target="${2:-${DATABASE_URL:?DATABASE_URL is not set and no target given}}"

case "$target" in
  *rlwy.net*|*railway*|*.railway.internal*)
    [ "${FORCE_PROD:-}" = "1" ] || {
      echo "restore: that target is the live database. Set FORCE_PROD=1 if you mean it." >&2
      exit 2
    } ;;
esac

tmp="/tmp/${name}"
echo "restore: fetching ${name}"
$s3 cp "s3://${S3_BUCKET}/${PREFIX}/${name}" "$tmp"

echo "restore: verifying"
pg_restore --list "$tmp" > /dev/null

echo "restore: loading into the target"
# --clean --if-exists drops what it is about to replace, so a restore onto a
# database that still has rows in it lands whole rather than colliding.
pg_restore --clean --if-exists --no-owner --no-privileges \
           --dbname="$target" "$tmp"
rm -f "$tmp"
echo "restore: done"
