#!/usr/bin/env bash
# Take a portable dump right now, out of band from the nightly run.
#
# Railway will not run a cron service on demand: deploying one only schedules
# it, and setting the schedule to a minute from now rolls over to tomorrow. The
# one lever that does work is that a service with NO schedule runs its command
# as soon as it deploys. So this clears the schedule, deploys, waits, and puts
# the schedule back — the restore is on an EXIT trap, so a Ctrl-C or a failed
# deploy still leaves the nightly backup armed.
#
# Needs RAILWAY_API_TOKEN (the *account* token). The project token cannot call
# serviceInstanceUpdate — it answers "Not Authorized", which reads like a
# missing permission and is really the wrong token.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; [ -f .env ] && source .env; set +a

: "${RAILWAY_API_TOKEN:?RAILWAY_API_TOKEN is not set — see .env.example}"
SERVICE_ID="${BACKUP_SERVICE_ID:-2dff69fb-7aad-449a-962f-dd02bccd3bc4}"
ENV_ID="${RAILWAY_ENVIRONMENT_ID:-fb09d89d-750c-40ba-a242-0a32db53242b}"
SCHEDULE="${BACKUP_CRON:-0 4 * * *}"
API=https://backboard.railway.com/graphql/v2

gql() {
  curl -sS "$API" -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
    -H "Content-Type: application/json" --data "$1"
}

set_cron() {  # $1 is a JSON value: a quoted cron string, or null
  gql "{\"query\":\"mutation(\$s:String!,\$e:String,\$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:\$s,environmentId:\$e,input:\$i)}\",\"variables\":{\"s\":\"$SERVICE_ID\",\"e\":\"$ENV_ID\",\"i\":{\"cronSchedule\":$1}}}" >/dev/null
}

restore_cron() {
  echo "db-backup: restoring the nightly schedule ($SCHEDULE)"
  set_cron "\"$SCHEDULE\"" || echo "db-backup: WARNING — could not restore the schedule. Set it by hand." >&2
}
trap restore_cron EXIT

echo "db-backup: clearing the schedule so the service runs on deploy"
set_cron null

deployment=$(gql "{\"query\":\"mutation(\$s:String!,\$e:String!){serviceInstanceDeployV2(serviceId:\$s,environmentId:\$e)}\",\"variables\":{\"s\":\"$SERVICE_ID\",\"e\":\"$ENV_ID\"}}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["serviceInstanceDeployV2"])')
echo "db-backup: deployment $deployment"

for _ in $(seq 1 60); do
  status=$(gql "{\"query\":\"{deployment(id:\\\"$deployment\\\"){status}}\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["deployment"]["status"])')
  case "$status" in
    SUCCESS) echo "db-backup: run finished"; break ;;
    FAILED|CRASHED) echo "db-backup: the run $status — see: railway logs --service backup" >&2; exit 1 ;;
    *) sleep 5 ;;
  esac
done

# The deploy going green only means the container started. The dump is the
# thing being claimed, so check the dump.
echo "db-backup: checking what landed"
exec python3 scripts/db/bucket.py list
