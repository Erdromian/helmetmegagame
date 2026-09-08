#!/usr/bin/env bash
# What is actually in the bucket, newest last. The point of running this is to
# catch the failure that matters — a backup system that has quietly stopped
# writing — so it prints the age of the newest dump rather than just a listing.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; [ -f .env ] && source .env; set +a
exec python3 scripts/db/bucket.py list
