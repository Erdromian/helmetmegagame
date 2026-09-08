#!/usr/bin/env bash
# Take a backup right now, out of band from the nightly cron.
#
# This used to call Railway's own volume-backup API. That API exists, but the
# workspace is on the Hobby plan, whose subscriptionPlanLimit reports
# volumes.maxBackupsCount = 0 — so every backup mutation answers "Not
# Authorized" no matter which token you hold. Backups are a Pro feature.
#
# So a backup is instead one run of the `backup` service (ops/backup/), which
# pg_dumps into the bascinet-backups bucket. Deploying that service runs it
# once immediately, which is what this does. migrate.sh calls it before every
# production migration.
#
# Needs RAILWAY_TOKEN (the *project* token) in the root .env.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; [ -f .env ] && source .env; set +a

: "${RAILWAY_TOKEN:?RAILWAY_TOKEN is not set — see .env.example}"
SERVICE="${BACKUP_SERVICE_NAME:-backup}"

echo "db-backup: starting a run of the '$SERVICE' service"
railway redeploy --service "$SERVICE" --yes >/dev/null

echo "db-backup: started. Watch it with:  railway logs --service $SERVICE"
echo "db-backup: list what landed with:   npm run db:backups"
