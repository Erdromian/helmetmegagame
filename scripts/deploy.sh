#!/usr/bin/env bash
# npm run deploy — a backup, then a push. The push IS the deploy: Railway
# builds web and bot from master, and web's Pre-Deploy command migrates and
# syncs before the new build takes traffic (CLAUDE.md, "Deploy workflow").
#
# This used to push, migrate by hand, then `railway redeploy --from-source`
# both services — which started a second full build of each on top of the one
# the push had already started. The only thing this adds over a bare push is
# the dump, taken while the old schema is still in place.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; [ -f .env ] && source .env; set +a

if [ -n "${RAILWAY_API_TOKEN:-}" ]; then
  bash scripts/db/backup-now.sh || { echo "deploy: backup failed, not pushing" >&2; exit 1; }
else
  echo "deploy: RAILWAY_API_TOKEN not set, skipping the dump; relying on PITR (BACKUPS.md)" >&2
fi
git push origin HEAD:master
