#!/bin/bash
# Apply pending migrations to production, after a backup.
set -a
source .env
set +a
if [ -n "$RAILWAY_API_TOKEN" ]; then
  bash scripts/db/backup-now.sh || { echo "migrate.sh: backup failed, not migrating" >&2; exit 1; }
else
  # Not fatal: point-in-time recovery covers a bad migration better than a dump
  # does — you rewind to the minute before it ran. See BACKUPS.md.
  echo "migrate.sh: RAILWAY_API_TOKEN not set, skipping the pre-migration dump" >&2
  echo "migrate.sh: relying on PITR alone. Check: railway postgres pitr status --service Postgres" >&2
fi
npm run db:migrate:deploy
